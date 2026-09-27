-- Property book v2: ownership_type, owner shares / ideal parts, admin RPCs + import.

begin;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists ownership_type text null;

alter table public.properties
  drop constraint if exists properties_ownership_type_check;

alter table public.properties
  add constraint properties_ownership_type_check
  check (
    ownership_type is null
    or ownership_type in ('sole', 'shared')
  );

alter table public.property_registry_people
  add column if not exists ownership_share_percent numeric(12, 6) null;

alter table public.property_registry_people
  add column if not exists ideal_parts_percent numeric(12, 6) null;

comment on column public.properties.ownership_type is
  'Condominium book: sole | shared. Null = not classified yet.';
comment on column public.property_registry_people.ownership_share_percent is
  'Owner share of the unit (sums to 100% for active owners).';
comment on column public.property_registry_people.ideal_parts_percent is
  'Owner vote weight from the book (not computed at vote time).';

create index if not exists property_registry_people_owner_active_idx
  on public.property_registry_people (property_id)
  where relation_type = 'owner' and deregistered_at is null;

-- ---------------------------------------------------------------------------
-- Completeness / validation
-- ---------------------------------------------------------------------------

create or replace function public.property_book_active_owners(p_property_id bigint)
returns setof public.property_registry_people
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.*
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id;
$fn$;

revoke all on function public.property_book_active_owners(bigint) from public;
revoke all on function public.property_book_active_owners(bigint) from anon;
grant execute on function public.property_book_active_owners(bigint) to authenticated;

create or replace function public.property_book_validate(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
  v_errors text[] := array[]::text[];
  v_owners public.property_registry_people[] := array[]::public.property_registry_people[];
  v_row public.property_registry_people%rowtype;
  v_share_sum numeric := 0;
  v_ideal_sum numeric := 0;
  v_natural_n integer := 0;
  v_legal_n integer := 0;
  v_prop_ideal numeric;
begin
  select p.* into v_prop
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('property_not_found'));
  end if;

  if nullif(btrim(coalesce(v_prop.purpose, '')), '') is null then
    v_errors := array_append(v_errors, 'purpose_required');
  end if;
  if v_prop.area_sqm is null or v_prop.area_sqm <= 0 then
    v_errors := array_append(v_errors, 'area_required');
  end if;
  v_prop_ideal := v_prop.ideal_parts_percent;
  if v_prop_ideal is null then
    v_errors := array_append(v_errors, 'object_ideal_parts_required');
  end if;
  if v_prop.ownership_type is null
     or v_prop.ownership_type not in ('sole', 'shared') then
    v_errors := array_append(v_errors, 'ownership_type_required');
  end if;

  for v_row in
    select * from public.property_book_active_owners(p_property_id)
  loop
    v_owners := array_append(v_owners, v_row);
  end loop;

  if coalesce(array_length(v_owners, 1), 0) = 0 then
    v_errors := array_append(v_errors, 'owners_required');
  else
    foreach v_row in array v_owners
    loop
      if v_row.ownership_share_percent is null or v_row.ownership_share_percent <= 0 then
        v_errors := array_append(v_errors, 'owner_share_required');
      else
        v_share_sum := v_share_sum + v_row.ownership_share_percent;
      end if;
      if v_row.ideal_parts_percent is null or v_row.ideal_parts_percent < 0 then
        v_errors := array_append(v_errors, 'owner_ideal_parts_required');
      else
        v_ideal_sum := v_ideal_sum + v_row.ideal_parts_percent;
      end if;
      if nullif(btrim(coalesce(v_row.email, '')), '') is null then
        v_errors := array_append(v_errors, 'owner_email_required');
      end if;
      if v_row.entity_kind = 'legal_entity' then
        v_legal_n := v_legal_n + 1;
        if nullif(btrim(coalesce(v_row.entity_name, '')), '') is null then
          v_errors := array_append(v_errors, 'legal_name_required');
        end if;
        if nullif(btrim(coalesce(v_row.eik_bulstat, '')), '') is null then
          v_errors := array_append(v_errors, 'eik_required');
        end if;
      elsif v_row.entity_kind in ('natural_person', 'sole_trader') then
        v_natural_n := v_natural_n + 1;
        if v_row.entity_kind = 'natural_person'
           and (
             nullif(btrim(coalesce(v_row.first_name, '')), '') is null
             or nullif(btrim(coalesce(v_row.last_name, '')), '') is null
           ) then
          v_errors := array_append(v_errors, 'natural_name_required');
        end if;
        if v_row.entity_kind = 'sole_trader'
           and nullif(btrim(coalesce(v_row.entity_name, '')), '') is null
           and (
             nullif(btrim(coalesce(v_row.first_name, '')), '') is null
             or nullif(btrim(coalesce(v_row.last_name, '')), '') is null
           ) then
          v_errors := array_append(v_errors, 'sole_trader_name_required');
        end if;
      else
        v_errors := array_append(v_errors, 'invalid_entity_kind');
      end if;
    end loop;

    if v_legal_n > 0 and v_natural_n > 0 then
      v_errors := array_append(v_errors, 'mixed_natural_legal_forbidden');
    end if;
    if v_legal_n > 1 then
      v_errors := array_append(v_errors, 'multiple_legal_forbidden');
    end if;

    if v_prop.ownership_type = 'sole' then
      if coalesce(array_length(v_owners, 1), 0) <> 1 then
        v_errors := array_append(v_errors, 'sole_requires_one_owner');
      elsif abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'sole_share_must_be_100');
      end if;
      if v_prop_ideal is not null
         and coalesce(array_length(v_owners, 1), 0) = 1
         and v_owners[1].ideal_parts_percent is not null
         and abs(v_owners[1].ideal_parts_percent - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'sole_ideal_parts_mismatch');
      end if;
    elsif v_prop.ownership_type = 'shared' then
      if v_legal_n > 0 then
        v_errors := array_append(v_errors, 'shared_legal_forbidden');
      end if;
      if coalesce(array_length(v_owners, 1), 0) < 2 then
        v_errors := array_append(v_errors, 'shared_requires_two_owners');
      end if;
      if abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'shares_must_sum_100');
      end if;
      if v_prop_ideal is not null and abs(v_ideal_sum - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'owner_ideal_parts_sum_mismatch');
      end if;
    end if;

    if v_legal_n = 1 and v_prop.ownership_type = 'sole' then
      if abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'legal_must_own_100');
      end if;
    end if;
  end if;

  -- dedupe errors
  select coalesce(array_agg(distinct e), array[]::text[])
    into v_errors
  from unnest(v_errors) as e;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors),
    'owner_count', coalesce(array_length(v_owners, 1), 0),
    'share_sum', v_share_sum,
    'ideal_sum', v_ideal_sum
  );
end;
$fn$;

revoke all on function public.property_book_validate(bigint) from public;
revoke all on function public.property_book_validate(bigint) from anon;
grant execute on function public.property_book_validate(bigint) to authenticated;

create or replace function public.property_book_is_complete(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((public.property_book_validate(p_property_id) ->> 'ok')::boolean, false);
$fn$;

revoke all on function public.property_book_is_complete(bigint) from public;
revoke all on function public.property_book_is_complete(bigint) from anon;
grant execute on function public.property_book_is_complete(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin list / upsert / import
-- ---------------------------------------------------------------------------

create or replace function public.admin_assert_book_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_book: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_book: not allowed'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.admin_assert_book_admin() from public;
revoke all on function public.admin_assert_book_admin() from anon;

drop function if exists public.admin_list_property_book(integer);
create or replace function public.admin_list_property_book(p_limit integer default 500)
returns table (
  property_id bigint,
  apartment_number text,
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
    p.purpose,
    p.area_sqm,
    p.ideal_parts_percent,
    p.ownership_type,
    (
      select count(*)::integer
      from public.property_book_active_owners(p.id)
    ),
    public.property_book_is_complete(p.id),
    public.property_book_validate(p.id)
  from public.properties as p
  order by p.apartment_number::text
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_property_book(integer) from public;
revoke all on function public.admin_list_property_book(integer) from anon;
grant execute on function public.admin_list_property_book(integer) to authenticated;

drop function if exists public.admin_get_property_book(bigint);
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
      'purpose', v_prop.purpose,
      'area_sqm', v_prop.area_sqm,
      'ideal_parts_percent', v_prop.ideal_parts_percent,
      'ideal_parts_source', v_prop.ideal_parts_source,
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

create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null
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
         )
   where p.id = p_property_id;
  if not found then
    raise exception 'admin_upsert_property_book_object: not found'
      using errcode = 'P0002';
  end if;
  return public.admin_get_property_book(p_property_id);
end;
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

-- Replace active owners for a property (deregister old owners, insert new set).
create or replace function public.admin_replace_property_book_owners(
  p_property_id bigint,
  p_owners jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
begin
  perform public.admin_assert_book_admin();
  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_replace_property_book_owners: not found'
      using errcode = 'P0002';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_replace_property_book_owners: owners array required'
      using errcode = '22023';
  end if;

  update public.property_registry_people as r
     set deregistered_at = coalesce(r.deregistered_at, current_date),
         updated_at = now()
   where r.property_id = p_property_id
     and r.relation_type = 'owner'
     and r.deregistered_at is null;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
      raise exception 'admin_replace_property_book_owners: invalid entity_kind'
        using errcode = '22023';
    end if;
    insert into public.property_registry_people (
      property_id, relation_type, entity_kind,
      first_name, middle_name, last_name, entity_name, eik_bulstat, email,
      ownership_share_percent, ideal_parts_percent,
      registered_at, lives_on_property
    ) values (
      p_property_id,
      'owner',
      v_kind,
      nullif(btrim(coalesce(v_item ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'middle_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'entity_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), ''),
      lower(nullif(btrim(coalesce(v_item ->> 'email', '')), '')),
      nullif(v_item ->> 'ownership_share_percent', '')::numeric,
      nullif(v_item ->> 'ideal_parts_percent', '')::numeric,
      current_date,
      null
    );
  end loop;

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_replace_property_book_owners(bigint, jsonb) from public;
revoke all on function public.admin_replace_property_book_owners(bigint, jsonb) from anon;
grant execute on function public.admin_replace_property_book_owners(bigint, jsonb) to authenticated;

-- Import: objects + owners keyed by apartment_number. Missing apt = error. Replace owners.
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
  v_prop_id bigint;
  v_errors jsonb := '[]'::jsonb;
  v_touched bigint[] := array[]::bigint[];
  v_owners_by_apt jsonb := '{}'::jsonb;
  v_list jsonb;
  v_validation jsonb;
  v_ok_count integer := 0;
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

  -- group owners by apartment_number
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
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_required', 'row', v_obj
      ));
      continue;
    end if;

    select p.id into v_prop_id
    from public.properties as p
    where btrim(p.apartment_number::text) = v_apt
    limit 1;

    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'code', 'apartment_not_found',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if not p_dry_run then
      perform public.admin_upsert_property_book_object(
        v_prop_id,
        v_obj ->> 'purpose',
        nullif(v_obj ->> 'area_sqm', '')::numeric,
        nullif(v_obj ->> 'ideal_parts_percent', '')::numeric,
        v_obj ->> 'ownership_type',
        v_obj ->> 'ideal_parts_source'
      );
      perform public.admin_replace_property_book_owners(
        v_prop_id,
        coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
      );
    end if;

    if p_dry_run then
      if coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) = 0 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'owners',
          'code', 'owners_required',
          'apartment_number', v_apt
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

    v_touched := array_append(v_touched, v_prop_id);
  end loop;

  for v_apt in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_objects) as o(value)
      where btrim(coalesce(o.value ->> 'apartment_number', '')) = v_apt
    ) and not exists (
      select 1 from public.properties as p
      where btrim(p.apartment_number::text) = v_apt
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners',
        'code', 'apartment_not_found',
        'apartment_number', v_apt
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'touched_property_ids', to_jsonb(v_touched),
    'complete_count', v_ok_count
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from public;
revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean) to authenticated;

commit;
