-- =============================================================================
-- IS-7a fresh-install package — public.electricity_meters
-- =============================================================================
-- Canonical shape aligned with live AMADEUS 11 schema (database.types + probe).
-- Derived from legacy electricity_meter_hotfix.sql without assign RPC rewrite /
-- DO_NOT_RUN execution. Requires public.properties.
-- =============================================================================

create table if not exists public.electricity_meters (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  meter_number text not null,
  initial_day_reading numeric(12, 3) not null,
  initial_night_reading numeric(12, 3) not null,
  installed_at date not null,
  retired_at date null,
  replacement_reason text null,
  assigned_by_email text not null,
  created_at timestamptz not null default now(),
  constraint electricity_meters_meter_number_not_blank
    check (length(trim(meter_number)) > 0),
  constraint electricity_meters_initial_day_nonneg
    check (initial_day_reading >= 0),
  constraint electricity_meters_initial_night_nonneg
    check (initial_night_reading >= 0),
  constraint electricity_meters_assigned_by_not_blank
    check (length(trim(assigned_by_email)) > 0),
  constraint electricity_meters_meter_number_key
    unique (meter_number)
);

comment on table public.electricity_meters is
  'Physical electricity meters (day+night registers). Retired meters stay for history.';

create unique index if not exists electricity_meters_one_active_per_property_idx
  on public.electricity_meters (property_id)
  where retired_at is null;

create index if not exists electricity_meters_property_id_idx
  on public.electricity_meters (property_id);
