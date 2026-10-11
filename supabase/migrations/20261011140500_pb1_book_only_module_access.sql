-- PB-1 Book-only Module Core access
-- ---------------------------------------------------------------------------
-- Aligns is_owner() with active Property Book ownership (not properties.owner_email).
-- Extends get_building_modules / get_building_modules_v2 so authenticated guests
-- with active guest access can read module flags for their restricted cabinet.
--
-- Idempotent CREATE OR REPLACE. Does not modify business rows or module enabled flags.
-- Depends on: property_registry_people, property_book_owner_row_access_ready,
--             property_guest_accesses, building_modules, module_catalog, is_staff().
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- is_owner: active Book owner with access-ready row (share / ideals / entity)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- get_building_modules_v2: owner | staff | active guest
-- ---------------------------------------------------------------------------

create or replace function public.get_building_modules_v2()
returns table (
  module_key text,
  enabled boolean,
  default_name text,
  category text,
  sort_order integer,
  implemented boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_building_modules_v2: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.is_owner()
    or public.is_staff()
    or exists (
      select 1
      from public.property_guest_accesses as g
      where g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(coalesce(auth.email(), '')))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
    )
  ) then
    raise exception 'get_building_modules_v2: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    bm.module_key,
    bm.enabled,
    c.default_name,
    c.category,
    c.sort_order,
    c.implemented
  from public.building_modules as bm
  inner join public.module_catalog as c on c.module_key = bm.module_key
  order by c.category, c.sort_order, bm.module_key;
end;
$fn$;

revoke all on function public.get_building_modules_v2() from public;
revoke execute on function public.get_building_modules_v2() from anon;
grant execute on function public.get_building_modules_v2() to authenticated;

-- ---------------------------------------------------------------------------
-- get_building_modules (v1): same authorization as v2
-- ---------------------------------------------------------------------------

create or replace function public.get_building_modules()
returns table (
  module_key text,
  enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_building_modules: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.is_owner()
    or public.is_staff()
    or exists (
      select 1
      from public.property_guest_accesses as g
      where g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(coalesce(auth.email(), '')))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
    )
  ) then
    raise exception 'get_building_modules: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    bm.module_key,
    bm.enabled
  from public.building_modules as bm
  order by bm.module_key;
end;
$fn$;

revoke all on function public.get_building_modules() from public;
revoke execute on function public.get_building_modules() from anon;
grant execute on function public.get_building_modules() to authenticated;

commit;
