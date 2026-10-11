-- PB-1 continued: invites (1.2/1.6), import preview (1.5), transfer via Book (1.7).

begin;

-- ---------------------------------------------------------------------------
-- Invite create / resend (PB-1.2, PB-1.4, PB-1.6)
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_property_invite(
  p_property_id bigint,
  p_registry_people_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner public.property_registry_people%rowtype;
  v_staff integer := public.current_staff_id();
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now() + interval '24 hours';
  v_email text;
begin
  perform public.admin_assert_book_admin();

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_create_property_invite: property not found'
      using errcode = 'P0002';
  end if;

  select r.* into v_owner
  from public.property_registry_people as r
  where r.id = p_registry_people_id
    and r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;

  if not found then
    raise exception 'admin_create_property_invite: not a current Book owner'
      using errcode = 'P0002';
  end if;

  if not public.property_book_owner_row_access_ready(v_owner) then
    raise exception 'admin_create_property_invite: incomplete ownership information'
      using errcode = 'P0001';
  end if;

  -- Invites require complete Book for the property (PB-1.4)
  if not public.property_book_is_complete(p_property_id) then
    raise exception 'admin_create_property_invite: property Book incomplete'
      using errcode = 'P0001';
  end if;

  v_email := lower(btrim(v_owner.email));

  -- Invalidate previous unused (pending) tokens for this owner/property
  update public.property_access_invites as i
     set status = 'expired'
   where i.property_id = p_property_id
     and (
       i.registry_people_id = p_registry_people_id
       or lower(i.email) = v_email
     )
     and i.status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.property_access_invites (
    property_id, email, token_hash, status, expires_at, invited_by_staff_id,
    registry_people_id, delivery_channel, delivery_status
  ) values (
    p_property_id, v_email, v_hash, 'pending', v_expires, v_staff,
    p_registry_people_id, 'copy_link', 'COPY_LINK'
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'property_id', p_property_id,
    'registry_people_id', p_registry_people_id,
    'email', v_email,
    'expires_at', v_expires,
    'token', v_token,
    'status', 'pending',
    'delivery_channel', 'copy_link',
    'delivery_status', 'COPY_LINK',
    'email_sent', false
  );
end;
$fn$;

revoke all on function public.admin_create_property_invite(bigint, bigint) from public, anon;
grant execute on function public.admin_create_property_invite(bigint, bigint) to authenticated;

-- Email overload: resolve current Book owner only (no stub creation)
create or replace function public.admin_create_property_invite(
  p_property_id bigint,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_owner public.property_registry_people%rowtype;
begin
  perform public.admin_assert_book_admin();
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'admin_create_property_invite: email required'
      using errcode = '22023';
  end if;

  v_owner := public.property_book_active_owner_by_email(p_property_id, v_email);
  if v_owner.id is null then
    raise exception 'admin_create_property_invite: not a current Book owner'
      using errcode = 'P0002';
  end if;

  return public.admin_create_property_invite(p_property_id, v_owner.id);
end;
$fn$;

revoke all on function public.admin_create_property_invite(bigint, text) from public, anon;
grant execute on function public.admin_create_property_invite(bigint, text) to authenticated;

create or replace function public.admin_resend_property_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old public.property_access_invites%rowtype;
  v_new jsonb;
  v_new_id uuid;
begin
  perform public.admin_assert_book_admin();

  select i.* into v_old
  from public.property_access_invites as i
  where i.id = p_invite_id
  for update;

  if not found then
    raise exception 'admin_resend_property_invite: not found'
      using errcode = 'P0002';
  end if;

  if v_old.registry_people_id is null then
    -- Legacy invite without registry link: resolve by email
    v_new := public.admin_create_property_invite(v_old.property_id, v_old.email);
  else
    v_new := public.admin_create_property_invite(v_old.property_id, v_old.registry_people_id);
  end if;

  v_new_id := (v_new ->> 'id')::uuid;

  update public.property_access_invites as i
     set superseded_by_invite_id = v_new_id,
         status = case when i.status = 'pending' then 'expired' else i.status end
   where i.id = p_invite_id;

  return v_new || jsonb_build_object(
    'resent_from_invite_id', p_invite_id,
    'email_sent', false,
    'delivery_status', 'COPY_LINK'
  );
end;
$fn$;

revoke all on function public.admin_resend_property_invite(uuid) from public, anon;
grant execute on function public.admin_resend_property_invite(uuid) to authenticated;

-- Accept: never mutates Book; mark requires auth email match (PB-1.2)
create or replace function public.accept_property_invite(
  p_token text,
  p_mark_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_hash text;
  v_row public.property_access_invites%rowtype;
  v_apt text;
  v_owner public.property_registry_people%rowtype;
  v_auth text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  if v_token is null then
    raise exception 'accept_property_invite: token required'
      using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select i.* into v_row
  from public.property_access_invites as i
  where i.token_hash = v_hash
  for update;

  if not found then
    raise exception 'accept_property_invite: invalid token'
      using errcode = 'P0002';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'accept_property_invite: revoked'
      using errcode = 'P0001';
  end if;

  if v_row.status = 'accepted' then
    select p.apartment_number::text into v_apt
    from public.properties as p where p.id = v_row.property_id;
    return jsonb_build_object(
      'status', 'accepted',
      'email', v_row.email,
      'property_id', v_row.property_id,
      'registry_people_id', v_row.registry_people_id,
      'apartment_number', v_apt,
      'already_accepted', true
    );
  end if;

  if v_row.status <> 'pending' or v_row.expires_at < now() then
    update public.property_access_invites as i
       set status = 'expired'
     where i.id = v_row.id and i.status = 'pending';
    raise exception 'accept_property_invite: expired'
      using errcode = 'P0001';
  end if;

  -- Ownership must still be current (PB-1.2 / PB-1.3)
  if v_row.registry_people_id is not null then
    select r.* into v_owner
    from public.property_registry_people as r
    where r.id = v_row.registry_people_id
      and r.property_id = v_row.property_id
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and lower(btrim(coalesce(r.email, ''))) = lower(btrim(v_row.email));
    if not found then
      update public.property_access_invites as i
         set status = 'expired'
       where i.id = v_row.id;
      raise exception 'accept_property_invite: ownership changed'
        using errcode = 'P0001';
    end if;
    if not public.property_book_owner_row_access_ready(v_owner) then
      raise exception 'accept_property_invite: incomplete ownership information'
        using errcode = 'P0001';
    end if;
  else
    v_owner := public.property_book_active_owner_by_email(v_row.property_id, v_row.email);
    if v_owner.id is null then
      update public.property_access_invites as i
         set status = 'expired'
       where i.id = v_row.id;
      raise exception 'accept_property_invite: not a current Book owner'
        using errcode = 'P0001';
    end if;
  end if;

  if p_mark_accepted then
    if auth.uid() is null or v_auth is null then
      raise exception 'accept_property_invite: authentication required to accept'
        using errcode = '28000';
    end if;
    if v_auth is distinct from lower(btrim(v_row.email)) then
      raise exception 'accept_property_invite: authenticated email mismatch'
        using errcode = '42501';
    end if;

    update public.property_access_invites as i
       set status = 'accepted',
           accepted_at = now()
     where i.id = v_row.id
    returning * into v_row;
    -- Intentionally no Book / properties ownership mutation
  end if;

  select p.apartment_number::text into v_apt
  from public.properties as p where p.id = v_row.property_id;

  return jsonb_build_object(
    'status', v_row.status,
    'email', v_row.email,
    'property_id', v_row.property_id,
    'registry_people_id', coalesce(v_row.registry_people_id, v_owner.id),
    'apartment_number', v_apt,
    'expires_at', v_row.expires_at,
    'already_accepted', false
  );
end;
$fn$;

revoke all on function public.accept_property_invite(text, boolean) from public, anon;
grant execute on function public.accept_property_invite(text, boolean) to anon;
grant execute on function public.accept_property_invite(text, boolean) to authenticated;

-- Mass invites: Book owners only (no legacy owner_email union)
create or replace function public.admin_mass_create_property_invites(
  p_floor bigint default null,
  p_section_code text default null,
  p_block_code text default null,
  p_dry_run boolean default true,
  p_skip_existing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_section text := nullif(btrim(coalesce(p_section_code, '')), '');
  v_block text := nullif(btrim(coalesce(p_block_code, '')), '');
  v_prop record;
  v_owner record;
  v_inv jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_prop_count integer := 0;
  v_has_existing boolean;
begin
  perform public.admin_assert_book_admin();

  for v_prop in
    select p.id, p.apartment_number::text as apartment_number, p.floor, p.section_code, p.block_code
    from public.properties as p
    where (p_floor is null or p.floor = p_floor)
      and (
        v_section is null
        or lower(btrim(coalesce(p.section_code, ''))) = lower(v_section)
      )
      and (
        v_block is null
        or lower(btrim(coalesce(p.block_code, ''))) = lower(v_block)
      )
    order by p.apartment_number asc, p.id asc
  loop
    v_prop_count := v_prop_count + 1;

    if not public.property_book_is_complete(v_prop.id) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'property_id', v_prop.id,
        'apartment_number', v_prop.apartment_number,
        'email', null,
        'reason', 'book_incomplete'
      ));
      continue;
    end if;

    for v_owner in
      select r.id, lower(btrim(r.email)) as email
      from public.property_registry_people as r
      where r.property_id = v_prop.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
        and public.property_book_owner_row_access_ready(r)
    loop
      if coalesce(p_skip_existing, true) then
        select exists (
          select 1
          from public.property_access_invites as i
          where i.property_id = v_prop.id
            and lower(i.email) = v_owner.email
            and i.status in ('pending', 'accepted')
            and (i.status <> 'pending' or i.expires_at >= now())
        ) into v_has_existing;
        if v_has_existing then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'property_id', v_prop.id,
            'apartment_number', v_prop.apartment_number,
            'email', v_owner.email,
            'reason', 'already_invited'
          ));
          continue;
        end if;
      end if;

      if coalesce(p_dry_run, true) then
        v_created := v_created || jsonb_build_array(jsonb_build_object(
          'property_id', v_prop.id,
          'apartment_number', v_prop.apartment_number,
          'registry_people_id', v_owner.id,
          'email', v_owner.email,
          'status', 'would_create',
          'delivery_status', 'COPY_LINK',
          'email_sent', false
        ));
        continue;
      end if;

      v_inv := public.admin_create_property_invite(v_prop.id, v_owner.id);
      v_created := v_created || jsonb_build_array(v_inv || jsonb_build_object(
        'apartment_number', v_prop.apartment_number
      ));
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', coalesce(p_dry_run, true),
    'filter', jsonb_build_object(
      'floor', p_floor,
      'section_code', v_section,
      'block_code', v_block
    ),
    'property_count', v_prop_count,
    'created_count', jsonb_array_length(v_created),
    'skipped_count', jsonb_array_length(v_skipped),
    'created', v_created,
    'skipped', v_skipped,
    'email_sent', false
  );
end;
$fn$;

revoke all on function public.admin_mass_create_property_invites(
  bigint, text, text, boolean, boolean
) from public, anon;
grant execute on function public.admin_mass_create_property_invites(
  bigint, text, text, boolean, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- Import preview + atomic apply with explicit confirms (PB-1.5)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_import_property_book(jsonb, jsonb, boolean);

create or replace function public.admin_import_property_book(
  p_objects jsonb,
  p_owners jsonb,
  p_dry_run boolean default true,
  p_allow_create_missing boolean default false,
  p_allow_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_obj jsonb;
  v_own jsonb;
  v_apt text;
  v_apt_num bigint;
  v_prop_id bigint;
  v_errors jsonb := '[]'::jsonb;
  v_existing jsonb := '[]'::jsonb;
  v_new_props jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_touched bigint[] := array[]::bigint[];
  v_created bigint[] := array[]::bigint[];
  v_owners_by_apt jsonb := '{}'::jsonb;
  v_list jsonb;
  v_validation jsonb;
  v_ok_count integer := 0;
  v_purpose text;
  v_area numeric;
  v_ideal numeric;
  v_own_type text;
  v_floor bigint;
  v_section text;
  v_block text;
  v_seen_apts text[] := array[]::text[];
  v_prop public.properties%rowtype;
  v_would_create boolean;
  v_would_change boolean;
  v_owner_count int;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'admin_import_property_book: objects array required'
      using errcode = '22023';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_import_property_book: owners array required'
      using errcode = '22023';
  end if;

  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_apt := nullif(btrim(coalesce(v_own ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'code', 'apartment_number_required', 'row', v_own
      ));
      continue;
    end if;
    v_list := coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb);
    v_owners_by_apt := jsonb_set(
      v_owners_by_apt,
      array[v_apt],
      v_list || jsonb_build_array(v_own)
    );
  end loop;

  for v_obj in select value from jsonb_array_elements(p_objects) as t(value)
  loop
    v_would_create := false;
    v_would_change := false;
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_required', 'row', v_obj
      ));
      continue;
    end if;

    if v_apt = any (v_seen_apts) then
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'duplicate_apartment', 'apartment_number', v_apt
      ));
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'duplicate_apartment', 'apartment_number', v_apt
      ));
      continue;
    end if;
    v_seen_apts := array_append(v_seen_apts, v_apt);

    begin
      v_apt_num := v_apt::bigint;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;

    v_purpose := nullif(btrim(coalesce(v_obj ->> 'purpose', '')), '');
    begin
      v_area := nullif(btrim(coalesce(v_obj ->> 'area_sqm', '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'area_sqm_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;
    begin
      v_ideal := nullif(btrim(coalesce(v_obj ->> 'ideal_parts_percent', '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'ideal_parts_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;
    v_own_type := nullif(btrim(coalesce(v_obj ->> 'ownership_type', '')), '');
    if v_own_type is not null and v_own_type not in ('sole', 'shared') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'ownership_type_invalid', 'apartment_number', v_apt
      ));
      continue;
    end if;
    v_section := nullif(btrim(coalesce(v_obj ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_obj ->> 'block_code', '')), '');
    begin
      v_floor := nullif(btrim(coalesce(v_obj ->> 'floor', '')), '')::bigint;
    exception when others then
      v_floor := null;
    end;

    select p.* into v_prop
    from public.properties as p
    where p.apartment_number = v_apt_num
    limit 1;

    if not found then
      v_would_create := true;
      v_new_props := v_new_props || jsonb_build_array(jsonb_build_object(
        'apartment_number', v_apt,
        'purpose', v_purpose,
        'area_sqm', v_area,
        'ideal_parts_percent', v_ideal,
        'ownership_type', v_own_type
      ));
      if not coalesce(p_allow_create_missing, false) and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'code', 'create_missing_requires_confirmation',
          'apartment_number', v_apt
        ));
        continue;
      end if;
      if not coalesce(p_allow_create_missing, false) and coalesce(p_dry_run, true) then
        -- preview lists new; apply blocked without confirm
        null;
      end if;
      v_prop_id := null;
    else
      v_prop_id := v_prop.id;
      v_existing := v_existing || jsonb_build_array(jsonb_build_object(
        'property_id', v_prop.id,
        'apartment_number', v_apt
      ));

      select count(*)::int into v_owner_count
      from public.property_registry_people as r
      where r.property_id = v_prop.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null;

      if (v_purpose is distinct from v_prop.purpose)
         or (v_area is distinct from v_prop.area_sqm)
         or (v_ideal is distinct from v_prop.ideal_parts_percent)
         or (v_own_type is distinct from v_prop.ownership_type)
         or (v_section is distinct from v_prop.section_code)
         or (v_block is distinct from v_prop.block_code)
         or (v_floor is distinct from v_prop.floor)
         or coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) <> v_owner_count
         or coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) > 0
      then
        v_would_change := true;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'property_id', v_prop.id,
          'apartment_number', v_apt,
          'object_fields_differ', true,
          'owners_in_file', coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0),
          'active_owners_now', v_owner_count
        ));
      end if;

      if v_would_change
         and not coalesce(p_allow_overwrite, false)
         and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'code', 'overwrite_requires_confirmation',
          'apartment_number', v_apt,
          'property_id', v_prop.id
        ));
        continue;
      end if;
    end if;

    if coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) = 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'code', 'owners_required', 'apartment_number', v_apt
      ));
    end if;
    if v_purpose is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'purpose_required', 'apartment_number', v_apt
      ));
    end if;
    if v_area is null or v_area <= 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'area_required', 'apartment_number', v_apt
      ));
    end if;
    if v_ideal is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'object_ideal_parts_required', 'apartment_number', v_apt
      ));
    end if;
    if v_own_type is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'ownership_type_required', 'apartment_number', v_apt
      ));
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    -- Apply path (atomic within this function transaction)
    if v_would_create then
      if v_floor is null then
        v_floor := case
          when v_apt_num between 1 and 99 then 1
          else greatest(1, (v_apt_num / 100)::bigint)
        end;
      end if;
      insert into public.properties (
        apartment_number, floor, section_code, block_code,
        area_sqm, purpose, ideal_parts_percent, ownership_type, status
      ) values (
        v_apt_num, v_floor, v_section, v_block,
        v_area, v_purpose, v_ideal, v_own_type, 'vacant'
      )
      returning id into v_prop_id;
      v_created := array_append(v_created, v_prop_id);
    end if;

    perform public.admin_upsert_property_book_object(
      v_prop_id,
      v_purpose,
      v_area,
      v_ideal,
      v_own_type,
      v_obj ->> 'ideal_parts_source',
      v_apt_num,
      v_floor,
      null,
      null,
      v_section,
      v_block
    );
    perform public.admin_replace_property_book_owners(
      v_prop_id,
      coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
    );

    v_validation := public.property_book_validate(v_prop_id);
    if not coalesce((v_validation ->> 'ok')::boolean, false) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'validation',
        'apartment_number', v_apt,
        'property_id', v_prop_id,
        'codes', v_validation -> 'errors'
      ));
    else
      v_ok_count := v_ok_count + 1;
    end if;

    v_touched := array_append(v_touched, v_prop_id);
  end loop;

  for v_apt in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_objects) as o(value)
      where btrim(coalesce(o.value ->> 'apartment_number', '')) = v_apt
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'code', 'object_row_missing', 'apartment_number', v_apt
      ));
    end if;
  end loop;

  -- Fail apply atomically if any errors
  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_property_book: apply aborted — % errors', jsonb_array_length(v_errors)
      using errcode = 'P0001',
            detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'existing_properties', v_existing,
    'new_properties', v_new_props,
    'changes', v_changes,
    'duplicates', v_duplicates,
    'requires_create_confirmation', jsonb_array_length(v_new_props) > 0,
    'requires_overwrite_confirmation', jsonb_array_length(v_changes) > 0,
    'allow_create_missing', coalesce(p_allow_create_missing, false),
    'allow_overwrite', coalesce(p_allow_overwrite, false),
    'touched_property_ids', to_jsonb(v_touched),
    'created_property_ids', to_jsonb(v_created),
    'complete_count', v_ok_count
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(
  jsonb, jsonb, boolean, boolean, boolean
) from public, anon;
grant execute on function public.admin_import_property_book(
  jsonb, jsonb, boolean, boolean, boolean
) to authenticated;

-- Compatibility: 3-arg callers (dry-run / strict apply without creates or overwrites)
create or replace function public.admin_import_property_book(
  p_objects jsonb,
  p_owners jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.admin_import_property_book(
    p_objects, p_owners, p_dry_run, false, false
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Owner transfer approval via Book (PB-1.7)
-- ---------------------------------------------------------------------------

create or replace function public.admin_approve_owner_transfer(p_transfer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
  v_prop public.properties%rowtype;
  v_parts text[];
  v_first text;
  v_last text;
  v_book jsonb;
  v_ideal numeric;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'admin_approve_owner_transfer: not found'
      using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'admin_approve_owner_transfer: not pending'
      using errcode = 'P0001';
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = v_tr.property_id;
  if not found then
    raise exception 'admin_approve_owner_transfer: property not found'
      using errcode = 'P0002';
  end if;

  v_ideal := coalesce(v_prop.ideal_parts_percent, 0);
  v_parts := regexp_split_to_array(btrim(coalesce(v_tr.to_owner_name, '')), '\s+');
  v_first := coalesce(v_parts[1], 'Owner');
  if coalesce(array_length(v_parts, 1), 0) >= 2 then
    v_last := array_to_string(v_parts[2:array_length(v_parts, 1)], ' ');
  else
    v_last := v_first;
  end if;

  -- Ensure ownership_type sole for transfer target model
  update public.properties as p
     set ownership_type = coalesce(p.ownership_type, 'sole')
   where p.id = v_tr.property_id
     and (p.ownership_type is null or p.ownership_type = 'sole');

  if (select p.ownership_type from public.properties as p where p.id = v_tr.property_id) = 'shared' then
    raise exception 'admin_approve_owner_transfer: shared ownership — edit Book manually'
      using errcode = 'P0001';
  end if;

  update public.properties as p
     set ownership_type = 'sole'
   where p.id = v_tr.property_id;

  v_book := public.admin_replace_property_book_owners(
    v_tr.property_id,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', v_first,
      'last_name', v_last,
      'email', lower(btrim(v_tr.to_owner_email)),
      'ownership_share_percent', 100,
      'ideal_parts_percent', v_ideal
    ))
  );

  -- Portal phone is not a Book field; allow under mutating flag
  update public.properties as p
     set owner_phone = v_tr.to_owner_phone
   where p.id = v_tr.property_id;

  update public.owner_transfers as t
     set status = 'утверждена',
         decided_at = now(),
         decided_by = nullif(auth.email(), '')
   where t.id = p_transfer_id;

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'property_id', v_tr.property_id,
    'book', v_book
  );
end;
$fn$;

revoke all on function public.admin_approve_owner_transfer(bigint) from public, anon;
grant execute on function public.admin_approve_owner_transfer(bigint) to authenticated;

-- Block client-side approval that would bypass Book
create or replace function public.owner_transfers_block_direct_approve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.status = 'утверждена'
     and old.status is distinct from 'утверждена'
     and current_setting('property_book.mutating', true) is distinct from '1'
  then
    raise exception 'owner_transfers: approve only via admin_approve_owner_transfer'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists owner_transfers_block_direct_approve_trg on public.owner_transfers;
create trigger owner_transfers_block_direct_approve_trg
  before update on public.owner_transfers
  for each row
  execute function public.owner_transfers_block_direct_approve();

-- User Activation invite resend still uses email overload (Book-resolved)
-- No change required beyond updated admin_create_property_invite(email).

commit;
