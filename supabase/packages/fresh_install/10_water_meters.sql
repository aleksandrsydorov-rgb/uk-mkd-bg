-- =============================================================================
-- IS-7a fresh-install package — public.water_meters
-- =============================================================================
-- Canonical shape aligned with live AMADEUS 11 schema (database.types + probe).
-- Derived from legacy water_capital_schema.sql without tariff seed / DO_NOT_RUN.
-- Requires public.properties (00_properties_baseline.sql).
-- =============================================================================

create table if not exists public.water_meters (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  meter_number text not null,
  initial_reading numeric(12, 3) not null,
  installed_at date not null default current_date,
  retired_at timestamptz null,
  replacement_reason text null,
  assigned_by_email text null,
  created_at timestamptz not null default now(),
  constraint water_meters_meter_number_not_blank
    check (length(trim(meter_number)) > 0),
  constraint water_meters_initial_reading_nonneg
    check (initial_reading >= 0),
  constraint water_meters_meter_number_key
    unique (meter_number),
  constraint water_meters_property_id_id_key
    unique (property_id, id)
);

comment on table public.water_meters is
  'Physical water meters. Retired meters stay for history; at most one active per property.';

create unique index if not exists water_meters_one_active_per_property_idx
  on public.water_meters (property_id)
  where retired_at is null;

create index if not exists water_meters_property_id_idx
  on public.water_meters (property_id);
