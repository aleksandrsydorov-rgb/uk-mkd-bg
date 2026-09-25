-- AMADEUS 11 Module Core Phase 1.
-- One complex = one database. No tenant_id.
-- Enable/disable flags only. Does not change Water/Electricity/Capital
-- business logic, information modes, meters, readings, payments, or GM.
-- DO NOT weaken existing grants/RLS on other tables.

begin;

create table if not exists public.building_modules (
  module_key text primary key
    constraint building_modules_key_check
      check (
        module_key in (
          'water',
          'electricity',
          'internet',
          'parking',
          'security',
          'rental',
          'capital_repair'
        )
      ),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

comment on table public.building_modules is
  'Per-complex module enable flags. One complex = one database; no tenant_id.';

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
values
  ('water', true, now(), null),
  ('electricity', true, now(), null),
  ('capital_repair', true, now(), null),
  ('internet', false, now(), null),
  ('parking', false, now(), null),
  ('security', false, now(), null),
  ('rental', false, now(), null)
on conflict (module_key) do nothing;

alter table public.building_modules enable row level security;

revoke all on table public.building_modules from public;
revoke all on table public.building_modules from anon;
revoke all on table public.building_modules from authenticated;

-- Read: authenticated owner OR exact active staff. Never expose updated_by.
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

  if not (public.is_owner() or public.is_staff()) then
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

-- Write: exact active администрация only. Phase 1 toggles implemented modules only.
create or replace function public.set_building_module_enabled(
  p_module_key text,
  p_enabled boolean
)
returns table (
  module_key text,
  enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'set_building_module_enabled: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'set_building_module_enabled: not allowed'
      using errcode = '42501';
  end if;

  v_key := btrim(coalesce(p_module_key, ''));

  if v_key not in (
    'water',
    'electricity',
    'internet',
    'parking',
    'security',
    'rental',
    'capital_repair'
  ) then
    raise exception 'set_building_module_enabled: unknown module'
      using errcode = '22023';
  end if;

  if v_key not in ('water', 'electricity', 'capital_repair') then
    raise exception 'set_building_module_enabled: module not configurable in phase 1'
      using errcode = '22023';
  end if;

  if p_enabled is null then
    raise exception 'set_building_module_enabled: enabled required'
      using errcode = '22023';
  end if;

  update public.building_modules as bm
     set enabled = p_enabled,
         updated_at = now(),
         updated_by = auth.uid()
   where bm.module_key = v_key;

  if not found then
    raise exception 'set_building_module_enabled: module row not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    bm.module_key,
    bm.enabled
  from public.building_modules as bm
  where bm.module_key = v_key;
end;
$fn$;

revoke all on function public.set_building_module_enabled(text, boolean) from public;
revoke execute on function public.set_building_module_enabled(text, boolean) from anon;
grant execute on function public.set_building_module_enabled(text, boolean) to authenticated;

commit;
