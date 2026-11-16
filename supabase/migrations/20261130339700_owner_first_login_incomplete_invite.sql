-- Owner first login: invite incomplete Book rows, complete own profile, then cabinet.
-- Cabinet RLS (owns_property) requires access_ready; onboarding uses owner_linked_to_property.

-- ---------------------------------------------------------------------------
-- Link to property for onboarding (access-ready OR accepted invite)
-- ---------------------------------------------------------------------------
create or replace function public.owner_linked_to_property(p_property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
  v_property_id bigint := p_property_id;
begin
  if v_email is null or auth.uid() is null then
    return false;
  end if;

  v_owner := public.property_book_active_owner_by_email(v_property_id, v_email);
  if v_owner.id is null then
    return false;
  end if;
  if public.property_book_owner_row_access_ready(v_owner) then
    return true;
  end if;

  return exists (
    select 1
    from public.property_access_invites as i
    where i.property_id = v_property_id
      and i.registry_people_id = v_owner.id
      and i.status = 'accepted'
      and lower(btrim(coalesce(i.email, ''))) = v_email
  );
end;
$fn$;

revoke all on function public.owner_linked_to_property(bigint) from public, anon;
grant execute on function public.owner_linked_to_property(bigint) to authenticated;

-- Cabinet access: access-ready only (blocks modules until profile complete)
create or replace function public.owns_property(property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
  v_property_id bigint := property_id;
begin
  if v_email is null or auth.uid() is null then
    return false;
  end if;

  v_owner := public.property_book_active_owner_by_email(v_property_id, v_email);
  if v_owner.id is null then
    return false;
  end if;
  return public.property_book_owner_row_access_ready(v_owner);
end;
$fn$;

revoke all on function public.owns_property(bigint) from public, anon;
grant execute on function public.owns_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Invite create: email + current owner row; allow incomplete / clarification
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_property_invite(
  p_property_id bigint,
  p_registry_people_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
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

  v_email := lower(nullif(btrim(coalesce(v_owner.email, '')), ''));
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'admin_create_property_invite: email required'
      using errcode = '22023';
  end if;

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
    'email_sent', false,
    'profile_incomplete', not public.property_book_owner_row_access_ready(v_owner)
  );
end;
$fn$;

revoke all on function public.admin_create_property_invite(bigint, bigint) from public, anon;
grant execute on function public.admin_create_property_invite(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Accept invite: keep ownership + email checks; allow incomplete profile
-- ---------------------------------------------------------------------------
create or replace function public.accept_property_invite(
  p_token text,
  p_mark_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_hash text;
  v_row public.property_access_invites%rowtype;
  v_apt text;
  v_section text;
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
    select p.apartment_number::text, p.section_code into v_apt, v_section
    from public.properties as p where p.id = v_row.property_id;
    return jsonb_build_object(
      'status', 'accepted',
      'email', v_row.email,
      'property_id', v_row.property_id,
      'registry_people_id', v_row.registry_people_id,
      'apartment_number', v_apt,
      'section_code', v_section,
      'already_accepted', true,
      'profile_incomplete', true
    );
  end if;

  if v_row.status <> 'pending' or v_row.expires_at < now() then
    update public.property_access_invites as i
       set status = 'expired'
     where i.id = v_row.id and i.status = 'pending';
    raise exception 'accept_property_invite: expired'
      using errcode = 'P0001';
  end if;

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
  end if;

  select p.apartment_number::text, p.section_code into v_apt, v_section
  from public.properties as p where p.id = v_row.property_id;

  return jsonb_build_object(
    'status', v_row.status,
    'email', v_row.email,
    'property_id', v_row.property_id,
    'registry_people_id', coalesce(v_row.registry_people_id, v_owner.id),
    'apartment_number', v_apt,
    'section_code', v_section,
    'expires_at', v_row.expires_at,
    'already_accepted', false,
    'profile_incomplete', not public.property_book_owner_row_access_ready(v_owner)
  );
end;
$fn$;

revoke all on function public.accept_property_invite(text, boolean) from public, anon;
grant execute on function public.accept_property_invite(text, boolean) to anon;
grant execute on function public.accept_property_invite(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Recompute voting_eligible from live row (same rules as incomplete save)
-- ---------------------------------------------------------------------------
create or replace function public.property_book_owner_row_recompute_voting_eligible(
  p_owner_id bigint
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_owner public.property_registry_people%rowtype;
  v_eligible boolean;
begin
  select r.* into v_owner
  from public.property_registry_people as r
  where r.id = p_owner_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;
  if not found then
    return false;
  end if;

  v_eligible :=
    nullif(btrim(coalesce(v_owner.email, '')), '') is not null
    and position('@' in v_owner.email) > 0
    and v_owner.ownership_share_percent is not null
    and v_owner.ownership_share_percent > 0
    and (
      (v_owner.entity_kind = 'natural_person'
        and nullif(btrim(coalesce(v_owner.first_name, '')), '') is not null
        and nullif(btrim(coalesce(v_owner.last_name, '')), '') is not null)
      or (v_owner.entity_kind = 'legal_entity'
        and nullif(btrim(coalesce(v_owner.entity_name, '')), '') is not null
        and nullif(btrim(coalesce(v_owner.eik_bulstat, '')), '') is not null)
      or (v_owner.entity_kind = 'sole_trader'
        and (
          nullif(btrim(coalesce(v_owner.entity_name, '')), '') is not null
          or (
            nullif(btrim(coalesce(v_owner.first_name, '')), '') is not null
            and nullif(btrim(coalesce(v_owner.last_name, '')), '') is not null
          )
        ))
    );

  update public.property_registry_people as r
     set voting_eligible = v_eligible,
         updated_at = now()
   where r.id = p_owner_id
     and r.voting_eligible is distinct from v_eligible;

  return v_eligible;
end;
$fn$;

revoke all on function public.property_book_owner_row_recompute_voting_eligible(bigint) from public, anon;
grant execute on function public.property_book_owner_row_recompute_voting_eligible(bigint) to authenticated;
grant execute on function public.property_book_owner_row_recompute_voting_eligible(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Clarification status / contact update: linked (invite) not only owns_property
-- ---------------------------------------------------------------------------
create or replace function public.owner_property_book_clarification_status(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
  v_issues jsonb;
  v_mine jsonb := '[]'::jsonb;
  v_issue jsonb;
  v_missing jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_property_book_clarification_status: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owner_linked_to_property(p_property_id) then
    raise exception 'owner_property_book_clarification_status: not allowed'
      using errcode = '42501';
  end if;

  v_owner := public.property_book_active_owner_by_email(p_property_id, v_email);
  v_issues := public.property_book_clarification_issues(p_property_id);

  for v_issue in select value from jsonb_array_elements(coalesce(v_issues -> 'issues', '[]'::jsonb)) as t(value)
  loop
    if (v_issue ->> 'registry_people_id')::bigint is not distinct from v_owner.id
       or (
         v_issue ->> 'scope' = 'owner'
         and (v_issue ->> 'registry_people_id') is null
         and (v_issue ->> 'code') in ('owner_email_required', 'natural_name_required')
       )
       or (
         v_issue ->> 'code' in ('owner_email_required')
         and (v_issue ->> 'registry_people_id')::bigint = v_owner.id
       )
    then
      if (v_issue ->> 'code') in (
        'owner_email_required', 'natural_name_required', 'sole_trader_name_required'
      ) then
        v_mine := v_mine || jsonb_build_array(v_issue);
      end if;
    end if;
  end loop;

  if nullif(btrim(coalesce(v_owner.email, '')), '') is null then
    v_missing := v_missing || jsonb_build_array('email');
    v_mine := v_mine || jsonb_build_array(jsonb_build_object(
      'scope', 'owner', 'code', 'owner_email_required', 'field', 'email',
      'registry_people_id', v_owner.id
    ));
  end if;
  if v_owner.entity_kind = 'natural_person' then
    if nullif(btrim(coalesce(v_owner.first_name, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('first_name');
    end if;
    if nullif(btrim(coalesce(v_owner.last_name, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('last_name');
    end if;
    if nullif(btrim(coalesce(v_owner.first_name, '')), '') is null
       or nullif(btrim(coalesce(v_owner.last_name, '')), '') is null then
      v_mine := v_mine || jsonb_build_array(jsonb_build_object(
        'scope', 'owner', 'code', 'natural_name_required', 'field', 'first_name',
        'registry_people_id', v_owner.id
      ));
    end if;
  elsif v_owner.entity_kind = 'legal_entity' then
    if nullif(btrim(coalesce(v_owner.entity_name, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('entity_name');
    end if;
    if nullif(btrim(coalesce(v_owner.eik_bulstat, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('eik_bulstat');
    end if;
  elsif v_owner.entity_kind = 'sole_trader' then
    if nullif(btrim(coalesce(v_owner.entity_name, '')), '') is null
       and (
         nullif(btrim(coalesce(v_owner.first_name, '')), '') is null
         or nullif(btrim(coalesce(v_owner.last_name, '')), '') is null
       ) then
      v_missing := v_missing || jsonb_build_array('sole_trader_name');
      v_mine := v_mine || jsonb_build_array(jsonb_build_object(
        'scope', 'owner', 'code', 'sole_trader_name_required', 'field', 'entity_name',
        'registry_people_id', v_owner.id
      ));
    end if;
  end if;
  if v_owner.ownership_share_percent is null or v_owner.ownership_share_percent <= 0 then
    v_missing := v_missing || jsonb_build_array('ownership_share_percent');
  end if;

  return jsonb_build_object(
    'property_id', p_property_id,
    'registry_people_id', v_owner.id,
    'needs_clarification', coalesce((v_issues ->> 'needs_clarification')::boolean, false)
      or jsonb_array_length(v_missing) > 0,
    'owner_can_complete', (
      v_owner.entity_kind = 'natural_person'
      and (
        nullif(btrim(coalesce(v_owner.first_name, '')), '') is null
        or nullif(btrim(coalesce(v_owner.last_name, '')), '') is null
        or nullif(btrim(coalesce(v_owner.email, '')), '') is null
      )
    ) or (
      v_owner.entity_kind = 'sole_trader'
      and nullif(btrim(coalesce(v_owner.entity_name, '')), '') is null
      and (
        nullif(btrim(coalesce(v_owner.first_name, '')), '') is null
        or nullif(btrim(coalesce(v_owner.last_name, '')), '') is null
      )
    ),
    'owner_issues', v_mine,
    'missing_fields', v_missing,
    'access_ready', public.property_book_owner_row_access_ready(v_owner),
    'uk_only_fields', case
      when v_owner.ownership_share_percent is null or v_owner.ownership_share_percent <= 0
        then jsonb_build_array('ownership_share_percent')
      when v_owner.entity_kind = 'legal_entity'
           and (
             nullif(btrim(coalesce(v_owner.entity_name, '')), '') is null
             or nullif(btrim(coalesce(v_owner.eik_bulstat, '')), '') is null
           )
        then jsonb_build_array('entity_name', 'eik_bulstat')
      else '[]'::jsonb
    end,
    'all_issues', v_issues -> 'issues',
    'uk_required_codes', coalesce(v_issues -> 'hard_errors', '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.owner_property_book_clarification_status(bigint) from public, anon;
grant execute on function public.owner_property_book_clarification_status(bigint) to authenticated;

create or replace function public.owner_update_own_registry_contact(
  p_property_id bigint,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_new_email text;
  v_new_first text;
  v_new_middle text;
  v_new_last text;
  v_new_phone text;
  v_new_phone2 text;
  v_changes jsonb := '{}'::jsonb;
  v_pending text[] := array[]::text[];
  v_eligible boolean;
  k text;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_update_own_registry_contact: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owner_linked_to_property(p_property_id) then
    raise exception 'owner_update_own_registry_contact: not allowed'
      using errcode = '42501';
  end if;

  foreach k in array array[
    'ownership_share_percent', 'ideal_parts_percent', 'entity_kind',
    'relation_type', 'eik_bulstat', 'entity_name', 'property_id', 'id',
    'apartment_number', 'section_code', 'block_code', 'voting_eligible'
  ]
  loop
    if v_patch ? k then
      raise exception 'owner_update_own_registry_contact: field not allowed: %', k
        using errcode = '42501';
    end if;
  end loop;

  v_owner := public.property_book_active_owner_by_email(p_property_id, v_email);
  if v_owner.id is null then
    raise exception 'owner_update_own_registry_contact: owner row not found'
      using errcode = '42501';
  end if;

  v_new_email := nullif(btrim(coalesce(v_patch ->> 'email', '')), '');
  v_new_first := nullif(btrim(coalesce(v_patch ->> 'first_name', '')), '');
  v_new_middle := nullif(btrim(coalesce(v_patch ->> 'middle_name', '')), '');
  v_new_last := nullif(btrim(coalesce(v_patch ->> 'last_name', '')), '');
  v_new_phone := nullif(btrim(coalesce(v_patch ->> 'phone', '')), '');
  v_new_phone2 := nullif(btrim(coalesce(v_patch ->> 'phone_secondary', '')), '');

  if v_patch ? 'email' then
    if nullif(btrim(coalesce(v_owner.email, '')), '') is null and v_new_email is not null then
      v_changes := v_changes || jsonb_build_object('email', jsonb_build_object('from', v_owner.email, 'to', lower(v_new_email)));
      update public.property_registry_people
        set email = lower(v_new_email), updated_at = now()
      where id = v_owner.id;
    elsif nullif(btrim(coalesce(v_owner.email, '')), '') is not null
          and v_new_email is not null
          and lower(v_new_email) is distinct from lower(btrim(v_owner.email)) then
      v_pending := array_append(v_pending, 'email');
    end if;
  end if;

  if v_owner.entity_kind in ('natural_person', 'sole_trader') then
    if v_patch ? 'first_name' then
      if nullif(btrim(coalesce(v_owner.first_name, '')), '') is null and v_new_first is not null then
        v_changes := v_changes || jsonb_build_object('first_name', jsonb_build_object('from', v_owner.first_name, 'to', v_new_first));
        update public.property_registry_people set first_name = v_new_first, updated_at = now() where id = v_owner.id;
      elsif nullif(btrim(coalesce(v_owner.first_name, '')), '') is not null
            and v_new_first is not null
            and v_new_first is distinct from btrim(v_owner.first_name) then
        v_pending := array_append(v_pending, 'first_name');
      end if;
    end if;
    if v_patch ? 'middle_name' then
      if nullif(btrim(coalesce(v_owner.middle_name, '')), '') is null and v_new_middle is not null then
        v_changes := v_changes || jsonb_build_object('middle_name', jsonb_build_object('from', v_owner.middle_name, 'to', v_new_middle));
        update public.property_registry_people set middle_name = v_new_middle, updated_at = now() where id = v_owner.id;
      elsif nullif(btrim(coalesce(v_owner.middle_name, '')), '') is not null
            and v_new_middle is not null
            and v_new_middle is distinct from btrim(v_owner.middle_name) then
        v_pending := array_append(v_pending, 'middle_name');
      end if;
    end if;
    if v_patch ? 'last_name' then
      if nullif(btrim(coalesce(v_owner.last_name, '')), '') is null and v_new_last is not null then
        v_changes := v_changes || jsonb_build_object('last_name', jsonb_build_object('from', v_owner.last_name, 'to', v_new_last));
        update public.property_registry_people set last_name = v_new_last, updated_at = now() where id = v_owner.id;
      elsif nullif(btrim(coalesce(v_owner.last_name, '')), '') is not null
            and v_new_last is not null
            and v_new_last is distinct from btrim(v_owner.last_name) then
        v_pending := array_append(v_pending, 'last_name');
      end if;
    end if;
  end if;

  if v_patch ? 'phone' then
    if nullif(btrim(coalesce(v_owner.phone, '')), '') is null and v_new_phone is not null then
      v_changes := v_changes || jsonb_build_object('phone', jsonb_build_object('from', v_owner.phone, 'to', v_new_phone));
      update public.property_registry_people set phone = v_new_phone, updated_at = now() where id = v_owner.id;
    elsif nullif(btrim(coalesce(v_owner.phone, '')), '') is not null
          and v_new_phone is not null
          and v_new_phone is distinct from btrim(v_owner.phone) then
      v_pending := array_append(v_pending, 'phone');
    end if;
  end if;
  if v_patch ? 'phone_secondary' then
    if nullif(btrim(coalesce(v_owner.phone_secondary, '')), '') is null and v_new_phone2 is not null then
      v_changes := v_changes || jsonb_build_object('phone_secondary', jsonb_build_object('from', v_owner.phone_secondary, 'to', v_new_phone2));
      update public.property_registry_people set phone_secondary = v_new_phone2, updated_at = now() where id = v_owner.id;
    elsif nullif(btrim(coalesce(v_owner.phone_secondary, '')), '') is not null
          and v_new_phone2 is not null
          and v_new_phone2 is distinct from btrim(v_owner.phone_secondary) then
      v_pending := array_append(v_pending, 'phone_secondary');
    end if;
  end if;

  if v_changes <> '{}'::jsonb then
    perform public.log_property_change(
      p_property_id,
      'book_ui',
      'owner',
      'update',
      v_changes,
      'owner contact clarification'
    );
    perform public.property_book_sync_portal_owner_fields(p_property_id);
  end if;

  v_eligible := public.property_book_owner_row_recompute_voting_eligible(v_owner.id);

  if coalesce(array_length(v_pending, 1), 0) > 0 then
    perform public.submit_property_book_change(
      p_property_id,
      format(
        'Owner requests UK confirmation for contact fields: %s. Proposed patch: %s',
        array_to_string(v_pending, ', '),
        v_patch::text
      ),
      jsonb_build_object(
        'source', 'owner_contact_clarification',
        'pending_fields', to_jsonb(v_pending),
        'patch', v_patch,
        'registry_people_id', v_owner.id
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'applied', v_changes,
    'pending_uk', to_jsonb(coalesce(v_pending, array[]::text[])),
    'voting_eligible', v_eligible,
    'access_ready', public.property_book_owner_row_access_ready(
      (select r from public.property_registry_people r where r.id = v_owner.id)
    ),
    'clarification', public.owner_property_book_clarification_status(p_property_id)
  );
end;
$fn$;

revoke all on function public.owner_update_own_registry_contact(bigint, jsonb) from public, anon;
grant execute on function public.owner_update_own_registry_contact(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- First-login status for UI routing
-- ---------------------------------------------------------------------------
create or replace function public.owner_first_login_status(p_locale text default 'bg')
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_locale text := case when p_locale in ('bg', 'ru', 'en') then p_locale else 'bg' end;
  v_acceptance jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_must_profile boolean := false;
  v_has_link boolean := false;
  r record;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_first_login_status: not authenticated'
      using errcode = '28000';
  end if;

  for r in
    select p.id as property_id,
           p.apartment_number::text as apartment_number,
           p.section_code,
           p.block_code,
           p.ownership_type,
           p.ideal_parts_percent,
           o.id as registry_people_id,
           o.entity_kind,
           o.first_name,
           o.middle_name,
           o.last_name,
           o.email,
           o.phone,
           o.phone_secondary,
           o.ownership_share_percent,
           o.voting_eligible,
           public.property_book_owner_row_access_ready(o) as access_ready,
           exists (
             select 1 from public.property_access_invites i
             where i.property_id = p.id
               and i.registry_people_id = o.id
               and i.status = 'accepted'
               and lower(btrim(coalesce(i.email, ''))) = v_email
           ) as invite_accepted
    from public.property_registry_people o
    join public.properties p on p.id = o.property_id
    where o.relation_type = 'owner'
      and o.deregistered_at is null
      and lower(btrim(coalesce(o.email, ''))) = v_email
    order by p.apartment_number, p.id
  loop
    v_has_link := true;
    if not r.access_ready and r.invite_accepted then
      v_must_profile := true;
    end if;
    if r.access_ready or r.invite_accepted then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'property_id', r.property_id,
        'apartment_number', r.apartment_number,
        'section_code', r.section_code,
        'block_code', r.block_code,
        'ownership_type', r.ownership_type,
        'ideal_parts_percent', r.ideal_parts_percent,
        'registry_people_id', r.registry_people_id,
        'entity_kind', r.entity_kind,
        'first_name', r.first_name,
        'middle_name', r.middle_name,
        'last_name', r.last_name,
        'email', r.email,
        'phone', r.phone,
        'phone_secondary', r.phone_secondary,
        'ownership_share_percent', r.ownership_share_percent,
        'voting_eligible', r.voting_eligible,
        'access_ready', r.access_ready,
        'invite_accepted', r.invite_accepted,
        'clarification', case
          when r.access_ready then null
          else public.owner_property_book_clarification_status(r.property_id)
        end
      ));
    end if;
  end loop;

  begin
    v_acceptance := public.portal_legal_acceptance_status(v_locale);
  exception when others then
    v_acceptance := jsonb_build_object('must_accept', false, 'role', 'unknown');
  end;

  -- Ensure legal actor sees incomplete invited owners as owners.
  if v_has_link and coalesce(v_acceptance ->> 'role', 'unknown') = 'unknown' then
    v_acceptance := coalesce(v_acceptance, '{}'::jsonb) || jsonb_build_object('role', 'owner');
    if coalesce((v_acceptance ->> 'must_accept')::boolean, false) is not true
       and v_acceptance ? 'obligation_id' then
      null;
    end if;
  end if;

  return jsonb_build_object(
    'email', v_email,
    'must_complete_profile', v_must_profile,
    'must_accept_terms', coalesce((v_acceptance ->> 'must_accept')::boolean, false)
      and coalesce(v_acceptance ->> 'role', '') = 'owner',
    'cabinet_ready', v_has_link and not v_must_profile
      and not coalesce((v_acceptance ->> 'must_accept')::boolean, false),
    'acceptance', v_acceptance,
    'properties', v_rows
  );
end;
$fn$;

revoke all on function public.owner_first_login_status(text) from public, anon;
grant execute on function public.owner_first_login_status(text) to authenticated;

-- Legal actor: treat linked incomplete owners as owners (list_my_owned may be empty)
create or replace function public.portal_legal_actor()
returns table (user_id uuid, complex_id uuid, member_role text)
language plpgsql
stable
security definer
set search_path to public
as $$
declare
  uid uuid := public.portal_legal_uid();
  email text := lower(btrim(coalesce(
    current_setting('request.jwt.claim.email', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'email',
    ''
  )));
  cid uuid := public.portal_legal_complex_id();
  role text;
  linked boolean := false;
begin
  if uid is null then
    return;
  end if;

  select m.member_role into role
  from public.portal_legal_members m
  where m.user_id = uid;
  if role is not null then
    user_id := uid;
    complex_id := cid;
    member_role := role;
    return next;
    return;
  end if;

  if to_regclass('public.staff') is not null and email <> '' then
    execute
      'select 1 from public.staff where active is true and lower(btrim(email)) = $1 limit 1'
      into role
      using email;
    if role is not null then
      user_id := uid;
      complex_id := cid;
      member_role := 'staff';
      return next;
      return;
    end if;
  end if;

  if to_regprocedure('public.list_my_owned_properties()') is not null then
    begin
      execute 'select 1 from public.list_my_owned_properties() limit 1' into role;
      if role is not null then
        user_id := uid;
        complex_id := cid;
        member_role := 'owner';
        return next;
        return;
      end if;
    exception
      when others then
        null;
    end;
  end if;

  -- Incomplete invited owners: no owns_property yet, but linked via accepted invite.
  if email <> '' and to_regclass('public.property_registry_people') is not null then
    begin
      execute $q$
        select exists (
          select 1
          from public.property_registry_people o
          where o.relation_type = 'owner'
            and o.deregistered_at is null
            and lower(btrim(coalesce(o.email, ''))) = $1
            and (
              public.property_book_owner_row_access_ready(o)
              or exists (
                select 1 from public.property_access_invites i
                where i.property_id = o.property_id
                  and i.registry_people_id = o.id
                  and i.status = 'accepted'
                  and lower(btrim(coalesce(i.email, ''))) = $1
              )
            )
        )
      $q$ into linked using email;
    exception
      when others then
        linked := false;
    end;
    if linked then
      user_id := uid;
      complex_id := cid;
      member_role := 'owner';
      return next;
      return;
    end if;
  end if;

  return;
end;
$$;
