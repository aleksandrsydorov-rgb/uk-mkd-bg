-- =============================================================================
-- IS-9b — Property Book authorization helpers (canonical BOOK-ONLY)
-- =============================================================================
-- Sources: PB-1 access truth, lifecycle archive (archived_at), XFER admin_status,
--          Phase E1 active_owners hardening, PB-1 is_owner.
-- properties.owner_email is NEVER consulted for authorization.
-- Depends on: property_registry_people, properties, has_staff_role / is_staff.
-- =============================================================================

create or replace function public.property_book_set_mutating(p_on boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform set_config('property_book.mutating', case when p_on then '1' else '0' end, true);
end;
$fn$;

revoke all on function public.property_book_set_mutating(boolean) from public, anon;

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

create or replace function public.property_book_owner_row_access_ready(
  p_owner public.property_registry_people
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
begin
  if p_owner.relation_type is distinct from 'owner' then
    return false;
  end if;
  if p_owner.deregistered_at is not null then
    return false;
  end if;
  if nullif(btrim(coalesce(p_owner.email, '')), '') is null
     or position('@' in p_owner.email) = 0 then
    return false;
  end if;
  if p_owner.ownership_share_percent is null or p_owner.ownership_share_percent <= 0 then
    return false;
  end if;
  if p_owner.ideal_parts_percent is null or p_owner.ideal_parts_percent < 0 then
    return false;
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = p_owner.property_id;
  if not found then
    return false;
  end if;
  if v_prop.archived_at is not null then
    return false;
  end if;
  if v_prop.ownership_type is null
     or v_prop.ownership_type not in ('sole', 'shared') then
    return false;
  end if;

  if p_owner.entity_kind = 'legal_entity' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null then
      return false;
    end if;
    if nullif(btrim(coalesce(p_owner.eik_bulstat, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'natural_person' then
    if nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
       or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'sole_trader' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null
       and (
         nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
         or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null
       ) then
      return false;
    end if;
  else
    return false;
  end if;

  return true;
end;
$fn$;

revoke all on function public.property_book_owner_row_access_ready(public.property_registry_people)
  from public, anon;

create or replace function public.property_book_active_owner_by_email(
  p_property_id bigint,
  p_email text
)
returns public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_row public.property_registry_people%rowtype;
begin
  if v_email is null then
    return null;
  end if;
  select r.* into v_row
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and r.admin_status is distinct from 'deceased_recorded'
    and lower(btrim(coalesce(r.email, ''))) = v_email
  order by r.id
  limit 1;
  return v_row;
end;
$fn$;

revoke all on function public.property_book_active_owner_by_email(bigint, text) from public, anon;

create or replace function public.owns_property(property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
begin
  if v_email is null or auth.uid() is null then
    return false;
  end if;

  v_owner := public.property_book_active_owner_by_email(property_id, v_email);
  if v_owner.id is null then
    return false;
  end if;
  return public.property_book_owner_row_access_ready(v_owner);
end;
$fn$;

revoke all on function public.owns_property(bigint) from public, anon;
grant execute on function public.owns_property(bigint) to authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.property_registry_people as r
    where r.relation_type = 'owner'
      and r.deregistered_at is null
      and r.admin_status is distinct from 'deceased_recorded'
      and lower(btrim(coalesce(r.email, ''))) = lower(btrim(coalesce(auth.email(), '')))
      and public.property_book_owner_row_access_ready(r)
  );
$fn$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.property_book_active_owners(p_property_id bigint)
returns setof public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is not distinct from 'service_role' then
    null;
  elsif public.has_staff_role('администрация') then
    null;
  elsif auth.uid() is not null and public.owns_property(p_property_id) then
    null;
  else
    raise exception 'property_book_active_owners: forbidden'
      using errcode = '42501';
  end if;

  return query
  select r.*
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id;
end;
$fn$;

revoke all on function public.property_book_active_owners(bigint) from public;
revoke all on function public.property_book_active_owners(bigint) from anon;
grant execute on function public.property_book_active_owners(bigint) to authenticated;
grant execute on function public.property_book_active_owners(bigint) to service_role;

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
    select * from public.property_registry_people as r
    where r.property_id = p_property_id
      and r.relation_type = 'owner'
      and r.deregistered_at is null
    order by r.id
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

-- Re-apply Book/capital SELECT policies now that owns_property exists.
do $$
begin
  if to_regprocedure('public.owns_property(bigint)') is null
     or to_regprocedure('public.has_staff_role(text)') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'property_registry_people'
      and policyname = 'property_registry_people_select'
  ) then
    create policy property_registry_people_select
    on public.property_registry_people
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('администрация')
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'water_meters'
      and policyname = 'water_meters_select'
  ) then
    create policy water_meters_select
    on public.water_meters
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
      or public.has_staff_role('инженер')
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'electricity_meters'
      and policyname = 'electricity_meters_select'
  ) then
    create policy electricity_meters_select
    on public.electricity_meters
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
      or public.has_staff_role('инженер')
    );
  end if;
end $$;
