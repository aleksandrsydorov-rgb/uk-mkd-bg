-- AMADEUS 11 Module Core v2.
-- Catalog-driven modules: module_catalog → building_modules.
-- Preserves existing building_modules enabled/updated_at/updated_by.
-- Does not change Support Fee / Water / Electricity / GM business logic.

begin;

-- ---------------------------------------------------------------------------
-- 1. Catalog (migration-controlled only)
-- ---------------------------------------------------------------------------

create table if not exists public.module_catalog (
  module_key text primary key,
  default_name text not null,
  category text not null,
  implemented boolean not null default false,
  sort_order integer not null default 0
);

comment on table public.module_catalog is
  'Release-controlled module catalog. One complex = one database; no tenant_id.';

alter table public.module_catalog enable row level security;

revoke all on table public.module_catalog from public;
revoke all on table public.module_catalog from anon;
revoke all on table public.module_catalog from authenticated;

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values
  -- Finance (implemented)
  ('support_fee', 'Такса поддержки', 'finance', true, 10),
  ('capital_repair', 'Капитальный ремонт', 'finance', true, 20),
  -- Utilities (implemented)
  ('water', 'Вода', 'utilities', true, 10),
  ('electricity', 'Электроэнергия', 'utilities', true, 20),
  -- Communication (implemented)
  ('requests', 'Заявки', 'communication', true, 10),
  ('chat', 'Чат', 'communication', true, 20),
  ('polls', 'Опросы', 'communication', true, 30),
  ('announcements', 'Объявления', 'communication', true, 40),
  -- Documents / Management (implemented)
  ('general_meeting', 'Общие собрания', 'documents', true, 10),
  ('building_documents', 'Документы', 'documents', true, 20),
  -- Future
  ('internet', 'Интернет', 'utilities', false, 30),
  ('parking', 'Парковка', 'utilities', false, 40),
  ('security', 'Охрана', 'services', false, 10),
  ('rental', 'Аренда', 'commercial', false, 10),
  ('cleaning', 'Уборка', 'services', false, 20),
  ('maintenance', 'Обслуживание', 'services', false, 30),
  ('access_control', 'Контроль доступа', 'services', false, 40),
  ('contractors', 'Подрядчики', 'services', false, 50),
  ('inventory', 'Инвентарь', 'services', false, 60),
  ('common_areas', 'Общие зоны', 'services', false, 70),
  ('commercial_rentals', 'Коммерческая аренда', 'commercial', false, 20)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

-- Drop fixed CHECK before inserting new catalog keys into state.
alter table public.building_modules
  drop constraint if exists building_modules_key_check;

-- ---------------------------------------------------------------------------
-- 2. State rows for new catalog keys (never overwrite existing state)
-- ---------------------------------------------------------------------------

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select
  c.module_key,
  case when c.implemented then true else false end,
  now(),
  null
from public.module_catalog as c
on conflict (module_key) do nothing;

-- Fail safely if any state key is missing from catalog (before FK).
do $$
declare
  v_orphan text;
begin
  select bm.module_key
    into v_orphan
  from public.building_modules as bm
  left join public.module_catalog as c on c.module_key = bm.module_key
  where c.module_key is null
  limit 1;

  if v_orphan is not null then
    raise exception
      'module_catalog_v2: building_modules key % missing from module_catalog',
      v_orphan;
  end if;
end;
$$;

alter table public.building_modules
  drop constraint if exists building_modules_module_key_fkey;

alter table public.building_modules
  add constraint building_modules_module_key_fkey
  foreign key (module_key)
  references public.module_catalog (module_key)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- Compatible v1 reader (unchanged contract).
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

  if not (public.is_owner() or public.is_staff()) then
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

-- Toggle any implemented catalog module that has a state row.
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
  v_implemented boolean;
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
  if v_key = '' then
    raise exception 'set_building_module_enabled: unknown module'
      using errcode = '22023';
  end if;

  if p_enabled is null then
    raise exception 'set_building_module_enabled: enabled required'
      using errcode = '22023';
  end if;

  select c.implemented
    into v_implemented
  from public.module_catalog as c
  where c.module_key = v_key;

  if not found then
    raise exception 'set_building_module_enabled: unknown module'
      using errcode = '22023';
  end if;

  if v_implemented is not true then
    raise exception 'set_building_module_enabled: module not implemented'
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
