-- =============================================================================
-- IS-9a fresh-install package — Tariff Core catalog shell (no published prices)
-- =============================================================================
-- Creates catalog definitions (keys/units/governance metadata) only.
-- Does NOT create tariff_versions rows, component amounts, or AMADEUS 11 prices.
-- Administrator must publish versions via Tariffs UI after install.
-- Depends on: public.module_catalog, public.has_staff_role(text).
-- =============================================================================

create or replace function public.tariff_sofia_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Sofia')::date;
$$;

revoke all on function public.tariff_sofia_today() from public;
revoke all on function public.tariff_sofia_today() from anon;
grant execute on function public.tariff_sofia_today() to authenticated;

create or replace function public.tariff_text_array_unique(p_arr text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_arr is not null
    and cardinality(p_arr) >= 1
    and cardinality(p_arr) = (
      select count(distinct btrim(x))
      from unnest(p_arr) as x
      where btrim(coalesce(x, '')) <> ''
    );
$$;

revoke all on function public.tariff_text_array_unique(text[]) from public;
revoke all on function public.tariff_text_array_unique(text[]) from anon;
grant execute on function public.tariff_text_array_unique(text[]) to authenticated;

create or replace function public.tariff_can_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер');
$$;

revoke all on function public.tariff_can_view() from public;
revoke all on function public.tariff_can_view() from anon;
grant execute on function public.tariff_can_view() to authenticated;

create or replace function public.tariff_can_publish(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case btrim(coalesce(p_module_key, ''))
    when 'support_fee' then public.has_staff_role('администрация')
    when 'capital_repair' then public.has_staff_role('администрация')
    when 'water' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    when 'electricity' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    when 'internet' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    else false
  end;
$$;

revoke all on function public.tariff_can_publish(text) from public;
revoke all on function public.tariff_can_publish(text) from anon;
grant execute on function public.tariff_can_publish(text) to authenticated;

create table if not exists public.tariff_catalog (
  id uuid primary key default gen_random_uuid(),
  tariff_key text not null,
  module_key text not null
    references public.module_catalog (module_key)
    on delete restrict,
  default_name text not null,
  unit_code text not null
    constraint tariff_catalog_unit_code_check
      check (unit_code in ('m2', 'm3', 'kwh', 'item')),
  currency text not null default 'EUR'
    constraint tariff_catalog_currency_check check (currency = 'EUR'),
  calculation_type text not null
    constraint tariff_catalog_calculation_type_check
      check (calculation_type in ('per_unit', 'fixed')),
  billing_period text null
    constraint tariff_catalog_billing_period_check
      check (billing_period is null or billing_period in ('month', 'year')),
  application_basis text not null
    constraint tariff_catalog_application_basis_check
      check (application_basis in ('calendar_date', 'billing_year')),
  governance_type text not null
    constraint tariff_catalog_governance_type_check
      check (governance_type in ('internal_decision', 'external_supplier')),
  component_keys text[] not null
    constraint tariff_catalog_component_keys_check
      check (public.tariff_text_array_unique(component_keys)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null,
  constraint tariff_catalog_tariff_key_key unique (tariff_key)
);

comment on table public.tariff_catalog is
  'Tariff Core catalog. Definitions only — not a billing engine. No published prices here.';

create index if not exists tariff_catalog_module_key_idx
  on public.tariff_catalog (module_key);

alter table public.tariff_catalog enable row level security;

revoke all on table public.tariff_catalog from public;
revoke all on table public.tariff_catalog from anon;
revoke all on table public.tariff_catalog from authenticated;

grant select on table public.tariff_catalog to authenticated;

do $$
begin
  if to_regprocedure('public.tariff_can_view()') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'tariff_catalog'
         and policyname = 'tariff_catalog_select'
     ) then
    create policy tariff_catalog_select
    on public.tariff_catalog
    for select
    to authenticated
    using (public.tariff_can_view());
  end if;
end $$;

-- Catalog definition rows (metadata only — zero prices / no tariff_versions).
insert into public.tariff_catalog (
  tariff_key, module_key, default_name, unit_code, currency,
  calculation_type, billing_period, application_basis, governance_type, component_keys, active
) values
  (
    'support_fee', 'support_fee', 'Такса поддержки', 'm2', 'EUR',
    'per_unit', 'year', 'billing_year', 'internal_decision', array['base']::text[], true
  ),
  (
    'water', 'water', 'Вода', 'm3', 'EUR',
    'per_unit', null, 'calendar_date', 'external_supplier', array['base']::text[], true
  ),
  (
    'electricity', 'electricity', 'Электроэнергия', 'kwh', 'EUR',
    'per_unit', null, 'calendar_date', 'external_supplier', array['day','night']::text[], true
  ),
  (
    'capital_repair', 'capital_repair', 'Капитальный ремонт', 'm2', 'EUR',
    'per_unit', 'year', 'billing_year', 'internal_decision', array['base']::text[], true
  ),
  (
    'internet', 'internet', 'Интернет', 'item', 'EUR',
    'fixed', null, 'calendar_date', 'external_supplier', array['day','month']::text[], true
  )
on conflict (tariff_key) do nothing;
