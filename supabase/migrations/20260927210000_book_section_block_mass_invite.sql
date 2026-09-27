-- Book: section_code + block_code; mass cabinet invites by floor/section/block/all.

begin;

alter table public.properties
  add column if not exists section_code text null;

alter table public.properties
  add column if not exists block_code text null;

comment on column public.properties.section_code is
  'Секция / вход (A, B, 1…) в книге этажной собственности';
comment on column public.properties.block_code is
  'Блок здания (если комплекс из нескольких блоков)';

create index if not exists properties_section_code_idx
  on public.properties (lower(btrim(section_code)))
  where section_code is not null and btrim(section_code) <> '';

create index if not exists properties_block_code_idx
  on public.properties (lower(btrim(block_code)))
  where block_code is not null and btrim(block_code) <> '';

create index if not exists properties_floor_idx
  on public.properties (floor)
  where floor is not null;

-- Track new fields in change log snapshot
create or replace function public.property_tracked_snapshot(p public.properties)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'apartment_number', p.apartment_number,
    'floor', p.floor,
    'section_code', p.section_code,
    'block_code', p.block_code,
    'area_sqm', p.area_sqm,
    'purpose', p.purpose,
    'ideal_parts_percent', p.ideal_parts_percent,
    'ideal_parts_source', p.ideal_parts_source,
    'ideal_parts_note', p.ideal_parts_note,
    'ideal_parts_meeting_ref', p.ideal_parts_meeting_ref,
    'ownership_type', p.ownership_type,
    'status', p.status,
    'occupancy_status', p.occupancy_status,
    'owner_name', p.owner_name,
    'owner_email', p.owner_email,
    'owner_phone', p.owner_phone,
    'owner_type', p.owner_type,
    'company_name', p.company_name,
    'occupant_kind', p.occupant_kind,
    'occupant_name', p.occupant_name,
    'occupant_phone', p.occupant_phone,
    'occupant_email', p.occupant_email,
    'occupant_until', p.occupant_until,
    'pet_info', p.pet_info,
    'electricity_meter_number', p.electricity_meter_number
  ));
$$;

revoke all on function public.property_tracked_snapshot(public.properties) from public;

-- Expand book upsert with section/block
drop function if exists public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text
);

create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null,
  p_apartment_number bigint default null,
  p_floor bigint default null,
  p_ideal_parts_note text default null,
  p_ideal_parts_meeting_ref text default null,
  p_section_code text default null,
  p_block_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text := nullif(btrim(coalesce(p_ownership_type, '')), '');
begin
  perform public.admin_assert_book_admin();
  if v_type is null or v_type not in ('sole', 'shared') then
    raise exception 'admin_upsert_property_book_object: invalid ownership_type'
      using errcode = '22023';
  end if;

  update public.properties as p
     set purpose = nullif(btrim(coalesce(p_purpose, '')), ''),
         area_sqm = p_area_sqm,
         ideal_parts_percent = p_ideal_parts_percent,
         ownership_type = v_type,
         ideal_parts_source = coalesce(
           nullif(btrim(coalesce(p_ideal_parts_source, '')), ''),
           p.ideal_parts_source
         ),
         ideal_parts_note = case
           when p_ideal_parts_note is null then p.ideal_parts_note
           else nullif(btrim(p_ideal_parts_note), '')
         end,
         ideal_parts_meeting_ref = case
           when p_ideal_parts_meeting_ref is null then p.ideal_parts_meeting_ref
           else nullif(btrim(p_ideal_parts_meeting_ref), '')
         end,
         apartment_number = coalesce(p_apartment_number, p.apartment_number),
         floor = coalesce(p_floor, p.floor),
         section_code = case
           when p_section_code is null then p.section_code
           else nullif(btrim(p_section_code), '')
         end,
         block_code = case
           when p_block_code is null then p.block_code
           else nullif(btrim(p_block_code), '')
         end
   where p.id = p_property_id;

  if not found then
    raise exception 'admin_upsert_property_book_object: not found'
      using errcode = 'P0002';
  end if;

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text, text, text
) from public;
revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text, text, text
) from anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text, text, text
) to authenticated;

-- Keep 6-arg overload for import / older clients
create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select public.admin_upsert_property_book_object(
    p_property_id, p_purpose, p_area_sqm, p_ideal_parts_percent,
    p_ownership_type, p_ideal_parts_source,
    null::bigint, null::bigint, null::text, null::text, null::text, null::text
  );
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) from public;
revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) from anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) to authenticated;

create or replace function public.admin_get_property_book(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
  v_owners jsonb;
begin
  perform public.admin_assert_book_admin();
  select p.* into v_prop
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    raise exception 'admin_get_property_book: not found'
      using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_owners
  from public.property_book_active_owners(p_property_id) as o;

  return jsonb_build_object(
    'property', jsonb_build_object(
      'id', v_prop.id,
      'apartment_number', v_prop.apartment_number,
      'floor', v_prop.floor,
      'section_code', v_prop.section_code,
      'block_code', v_prop.block_code,
      'purpose', v_prop.purpose,
      'area_sqm', v_prop.area_sqm,
      'ideal_parts_percent', v_prop.ideal_parts_percent,
      'ideal_parts_source', v_prop.ideal_parts_source,
      'ideal_parts_note', v_prop.ideal_parts_note,
      'ideal_parts_meeting_ref', v_prop.ideal_parts_meeting_ref,
      'ownership_type', v_prop.ownership_type,
      'owner_email', v_prop.owner_email,
      'owner_name', v_prop.owner_name
    ),
    'owners', v_owners,
    'validation', public.property_book_validate(p_property_id)
  );
end;
$fn$;

revoke all on function public.admin_get_property_book(bigint) from public;
revoke all on function public.admin_get_property_book(bigint) from anon;
grant execute on function public.admin_get_property_book(bigint) to authenticated;

drop function if exists public.admin_list_property_book(integer);

create or replace function public.admin_list_property_book(p_limit integer default 500)
returns table (
  property_id bigint,
  apartment_number text,
  floor bigint,
  section_code text,
  block_code text,
  purpose text,
  area_sqm numeric,
  ideal_parts_percent numeric,
  ownership_type text,
  owner_count integer,
  book_complete boolean,
  validation jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  perform public.admin_assert_book_admin();
  return query
  select
    p.id,
    p.apartment_number::text,
    p.floor,
    p.section_code,
    p.block_code,
    p.purpose,
    p.area_sqm::numeric,
    p.ideal_parts_percent,
    p.ownership_type,
    (
      select count(*)::integer
      from public.property_book_active_owners(p.id)
    ),
    public.property_book_is_complete(p.id),
    public.property_book_validate(p.id)
  from public.properties as p
  order by
    lower(coalesce(nullif(btrim(p.block_code), ''), '')),
    lower(coalesce(nullif(btrim(p.section_code), ''), '')),
    p.floor nulls last,
    p.apartment_number asc,
    p.id asc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_property_book(integer) from public;
revoke all on function public.admin_list_property_book(integer) from anon;
grant execute on function public.admin_list_property_book(integer) to authenticated;

-- Import: floor + section_code + block_code (keeps prior create-missing + validation)
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
declare
  v_obj jsonb;
  v_own jsonb;
  v_apt text;
  v_apt_num bigint;
  v_prop_id bigint;
  v_errors jsonb := '[]'::jsonb;
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
  v_created_flag boolean;
begin
  perform public.admin_assert_book_admin();
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
    v_created_flag := false;
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_required', 'row', v_obj
      ));
      continue;
    end if;

    begin
      v_apt_num := v_apt::bigint;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'code', 'apartment_number_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;

    v_purpose := nullif(btrim(coalesce(v_obj ->> 'purpose', '')), '');
    v_section := nullif(btrim(coalesce(v_obj ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_obj ->> 'block_code', '')), '');
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

    begin
      v_floor := nullif(btrim(coalesce(v_obj ->> 'floor', '')), '')::bigint;
    exception when others then
      v_floor := null;
    end;

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt_num
    limit 1;

    if v_prop_id is null then
      if v_floor is null then
        v_floor := case
          when v_apt_num between 1 and 99 then 1
          else greatest(1, (v_apt_num / 100)::bigint)
        end;
      end if;

      if p_dry_run then
        v_created_flag := true;
        v_prop_id := -v_apt_num;
      else
        insert into public.properties (
          apartment_number,
          floor,
          section_code,
          block_code,
          area_sqm,
          purpose,
          ideal_parts_percent,
          ownership_type,
          status
        ) values (
          v_apt_num,
          v_floor,
          v_section,
          v_block,
          v_area,
          v_purpose,
          v_ideal,
          v_own_type,
          'vacant'
        )
        returning id into v_prop_id;
        v_created := array_append(v_created, v_prop_id);
        v_created_flag := true;
      end if;
    end if;

    if not p_dry_run then
      perform public.admin_upsert_property_book_object(
        v_prop_id,
        v_purpose,
        v_area,
        v_ideal,
        v_own_type,
        v_obj ->> 'ideal_parts_source',
        v_apt_num,
        v_floor,
        null::text,
        null::text,
        v_section,
        v_block
      );
      perform public.admin_replace_property_book_owners(
        v_prop_id,
        coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
      );

      update public.properties as p
         set owner_email = coalesce(
               (
                 select nullif(btrim(o ->> 'email'), '')
                 from jsonb_array_elements(coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)) as o
                 where nullif(btrim(o ->> 'email'), '') is not null
                 limit 1
               ),
               p.owner_email
             ),
             owner_name = coalesce(
               (
                 select nullif(
                   btrim(concat_ws(' ',
                     nullif(btrim(o ->> 'first_name'), ''),
                     nullif(btrim(o ->> 'last_name'), ''),
                     nullif(btrim(o ->> 'entity_name'), '')
                   )),
                   ''
                 )
                 from jsonb_array_elements(coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)) as o
                 limit 1
               ),
               p.owner_name
             )
       where p.id = v_prop_id;
    end if;

    if p_dry_run then
      if coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) = 0 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'owners',
          'code', 'owners_required',
          'apartment_number', v_apt
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
    else
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
    end if;

    if v_prop_id is not null and v_prop_id > 0 then
      v_touched := array_append(v_touched, v_prop_id);
    end if;

    if v_created_flag and p_dry_run then
      null;
    end if;
  end loop;

  for v_apt in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_objects) as o(value)
      where btrim(coalesce(o.value ->> 'apartment_number', '')) = v_apt
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners',
        'code', 'object_row_missing',
        'apartment_number', v_apt
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'touched_property_ids', to_jsonb(v_touched),
    'created_property_ids', to_jsonb(v_created),
    'complete_count', v_ok_count
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from public;
revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean) to authenticated;

-- Mass invites: filter by floor / section / block (any combination; all null = whole house)
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
  v_staff integer := public.current_staff_id();
  v_prop record;
  v_email text;
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now() + interval '24 hours';
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_prop_count integer := 0;
  v_email_count integer := 0;
  v_has_existing boolean;
begin
  perform public.admin_assert_book_admin();

  for v_prop in
    select
      p.id,
      p.apartment_number::text as apartment_number,
      p.floor,
      p.section_code,
      p.block_code,
      p.owner_email
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
    v_email_count := 0;

    for v_email in
      select distinct lower(btrim(e.email)) as email
      from (
        select r.email
        from public.property_registry_people as r
        where r.property_id = v_prop.id
          and r.relation_type = 'owner'
          and r.deregistered_at is null
          and nullif(btrim(coalesce(r.email, '')), '') is not null
          and position('@' in r.email) > 0
        union
        select v_prop.owner_email
        where nullif(btrim(coalesce(v_prop.owner_email, '')), '') is not null
          and position('@' in v_prop.owner_email) > 0
      ) as e(email)
    loop
      v_email_count := v_email_count + 1;

      if coalesce(p_skip_existing, true) then
        select exists (
          select 1
          from public.property_access_invites as i
          where i.property_id = v_prop.id
            and lower(i.email) = v_email
            and i.status in ('pending', 'accepted')
            and (i.status <> 'pending' or i.expires_at >= now())
        ) into v_has_existing;
        if v_has_existing then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'property_id', v_prop.id,
            'apartment_number', v_prop.apartment_number,
            'email', v_email,
            'reason', 'already_invited'
          ));
          continue;
        end if;
      end if;

      if coalesce(p_dry_run, true) then
        v_created := v_created || jsonb_build_array(jsonb_build_object(
          'property_id', v_prop.id,
          'apartment_number', v_prop.apartment_number,
          'floor', v_prop.floor,
          'section_code', v_prop.section_code,
          'block_code', v_prop.block_code,
          'email', v_email,
          'status', 'would_create'
        ));
        continue;
      end if;

      update public.property_access_invites as i
         set status = 'expired'
       where i.property_id = v_prop.id
         and lower(i.email) = v_email
         and i.status = 'pending';

      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

      insert into public.property_access_invites (
        property_id, email, token_hash, status, expires_at, invited_by_staff_id
      ) values (
        v_prop.id, v_email, v_hash, 'pending', v_expires, v_staff
      )
      returning id into v_id;

      v_created := v_created || jsonb_build_array(jsonb_build_object(
        'id', v_id,
        'property_id', v_prop.id,
        'apartment_number', v_prop.apartment_number,
        'floor', v_prop.floor,
        'section_code', v_prop.section_code,
        'block_code', v_prop.block_code,
        'email', v_email,
        'expires_at', v_expires,
        'token', v_token,
        'status', 'pending'
      ));
    end loop;

    if v_email_count = 0 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'property_id', v_prop.id,
        'apartment_number', v_prop.apartment_number,
        'email', null,
        'reason', 'no_email'
      ));
    end if;
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
    'skipped', v_skipped
  );
end;
$fn$;

revoke all on function public.admin_mass_create_property_invites(
  bigint, text, text, boolean, boolean
) from public;
revoke all on function public.admin_mass_create_property_invites(
  bigint, text, text, boolean, boolean
) from anon;
grant execute on function public.admin_mass_create_property_invites(
  bigint, text, text, boolean, boolean
) to authenticated;

commit;
