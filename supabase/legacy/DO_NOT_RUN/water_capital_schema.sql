-- =============================================================================
-- AMADEUS 11 — water + capital repair schema (tables / constraints / indexes)
-- =============================================================================
-- Parallel subledgers. Do NOT mix with support_fee_ledger or
-- properties.debt / properties.overpayment (support fee only).
--
-- This file does NOT:
--   - alter public.properties
--   - alter public.meter_readings (legacy; keep as-is)
--   - alter public.support_fee_ledger
--   - create RLS, GRANT, RPC, functions, or triggers
--
-- Water current tariff is NOT a mutable row. Resolve later as:
--   last water_tariffs where valid_from <= reading_date
--   ORDER BY valid_from DESC LIMIT 1
--
-- Balances are NOT stored on properties. Compute later from immutable ledgers.
-- Errors are corrected with new ledger rows (adjustment_*), not DELETE.
--
-- Safe to re-run: CREATE TABLE/INDEX IF NOT EXISTS + tariff ON CONFLICT DO NOTHING.
-- No DROP / TRUNCATE / CASCADE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. WATER METERS
-- -----------------------------------------------------------------------------
-- Active meter: retired_at IS NULL.
-- Replacement: set retired_at on the old row; insert a new row. History kept.

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
  -- Composite identity for readings FK (property_id, meter_id).
  -- PK already unique on id; do not also UNIQUE (id, property_id).
  constraint water_meters_property_id_id_key
    unique (property_id, id)
);

comment on table public.water_meters is
  'Physical water meters. Retired meters stay for history; at most one active per property.';

-- At most one active (non-retired) water meter per apartment.
create unique index if not exists water_meters_one_active_per_property_idx
  on public.water_meters (property_id)
  where retired_at is null;

-- -----------------------------------------------------------------------------
-- 2. WATER TARIFFS
-- -----------------------------------------------------------------------------
-- Immutable price history. valid_from is unique; no "current tariff" flag.

create table if not exists public.water_tariffs (
  id uuid primary key default gen_random_uuid(),
  price_eur_per_m3 numeric(12, 4) not null,
  valid_from date not null,
  note text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint water_tariffs_price_nonneg
    check (price_eur_per_m3 >= 0),
  constraint water_tariffs_valid_from_key
    unique (valid_from),
  -- Lets readings FK-lock snapshot price to the referenced tariff row.
  constraint water_tariffs_id_price_key
    unique (id, price_eur_per_m3)
);

comment on table public.water_tariffs is
  'Water price history. Snapshot price is stored on water_readings at charge time.';

-- Idempotent test seed. Future tariff changes must not rewrite this row.
insert into public.water_tariffs (price_eur_per_m3, valid_from, note)
values (0.5000, date '2026-09-22', 'Initial test tariff')
on conflict (valid_from) do nothing;

-- -----------------------------------------------------------------------------
-- 3. WATER READINGS
-- -----------------------------------------------------------------------------
-- consumption_m3 and charge_amount_eur are generated (immutable snapshot math).
-- tariff_eur_per_m3 is a price snapshot even if water_tariffs later change.
-- Duplicate HTTP submits are blocked by idempotency_key, not by reading_date.

create table if not exists public.water_readings (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  meter_id uuid not null,
  reading_date date not null,
  previous_value numeric(12, 3) not null,
  current_value numeric(12, 3) not null,
  tariff_id uuid not null,
  tariff_eur_per_m3 numeric(12, 4) not null,
  consumption_m3 numeric(12, 3)
    generated always as (current_value - previous_value) stored,
  charge_amount_eur numeric(12, 2)
    generated always as (
      round((current_value - previous_value) * tariff_eur_per_m3, 2)
    ) stored,
  submitted_by_email text null,
  submitted_via text not null,
  idempotency_key uuid not null,
  status text not null default 'active',
  reversed_at timestamptz null,
  reversed_by_email text null,
  reversal_reason text null,
  created_at timestamptz not null default now(),
  constraint water_readings_previous_value_nonneg
    check (previous_value >= 0),
  constraint water_readings_current_value_nonneg
    check (current_value >= 0),
  constraint water_readings_current_gte_previous
    check (current_value >= previous_value),
  constraint water_readings_tariff_eur_nonneg
    check (tariff_eur_per_m3 >= 0),
  constraint water_readings_submitted_via_check
    check (submitted_via in ('owner', 'staff', 'system')),
  constraint water_readings_submitter_check
    check (
      submitted_via = 'system'
      or (
        submitted_by_email is not null
        and length(trim(submitted_by_email)) > 0
      )
    ),
  constraint water_readings_status_check
    check (status in ('active', 'reversed')),
  constraint water_readings_reversal_metadata_check
    check (
      (
        status = 'active'
        and reversed_at is null
        and reversed_by_email is null
        and reversal_reason is null
      )
      or
      (
        status = 'reversed'
        and reversed_at is not null
        and reversed_by_email is not null
        and reversal_reason is not null
        and length(trim(reversal_reason)) > 0
      )
    ),
  constraint water_readings_idempotency_key_key
    unique (idempotency_key),
  -- Composite identity for water_ledger FK (reading belongs to same property).
  constraint water_readings_id_property_id_key
    unique (id, property_id),
  constraint water_readings_property_meter_fk
    foreign key (property_id, meter_id)
    references public.water_meters (property_id, id)
    on delete restrict,
  constraint water_readings_tariff_snapshot_fk
    foreign key (tariff_id, tariff_eur_per_m3)
    references public.water_tariffs (id, price_eur_per_m3)
    on delete restrict
);

comment on table public.water_readings is
  'Water meter submissions. Reversal is status=reversed; financial undo is a ledger adjustment.';

create index if not exists water_readings_property_date_created_idx
  on public.water_readings (property_id, reading_date desc, created_at desc);

create index if not exists water_readings_meter_date_created_idx
  on public.water_readings (meter_id, reading_date desc, created_at desc);

create index if not exists water_readings_status_idx
  on public.water_readings (status);

-- -----------------------------------------------------------------------------
-- 4. WATER LEDGER
-- -----------------------------------------------------------------------------
-- Separate financial journal. amount_eur is always > 0.
--   charge / adjustment_debit  → increase water debt
--   payment / adjustment_credit → decrease water debt
-- Payments may have reading_id IS NULL.
-- Charges must reference a reading; at most one charge per reading.
-- Zero-consumption water_readings are valid (current_value = previous_value).
-- Future RPC must NOT insert a water_ledger charge when charge_amount_eur = 0:
-- the reading is stored; no financial charge is created.

create table if not exists public.water_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  reading_id uuid null,
  kind text not null,
  amount_eur numeric(12, 2) not null,
  note text null,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint water_ledger_kind_check
    check (kind in ('charge', 'payment', 'adjustment_debit', 'adjustment_credit')),
  constraint water_ledger_amount_positive
    check (amount_eur > 0),
  constraint water_ledger_charge_requires_reading
    check (kind <> 'charge' or reading_id is not null),
  constraint water_ledger_idempotency_key_key
    unique (idempotency_key),
  -- MATCH SIMPLE: if reading_id is NULL, this FK is not enforced (payments).
  constraint water_ledger_reading_property_fk
    foreign key (reading_id, property_id)
    references public.water_readings (id, property_id)
    on delete restrict
);

comment on table public.water_ledger is
  'Immutable water finance journal. Balances are derived; do not store water_debt on properties.';

-- One water charge per reading.
create unique index if not exists water_ledger_one_charge_per_reading_idx
  on public.water_ledger (reading_id)
  where kind = 'charge' and reading_id is not null;

create index if not exists water_ledger_property_created_idx
  on public.water_ledger (property_id, created_at desc);

create index if not exists water_ledger_kind_idx
  on public.water_ledger (kind);

create index if not exists water_ledger_reading_id_idx
  on public.water_ledger (reading_id);

-- -----------------------------------------------------------------------------
-- 5. CAPITAL REPAIR ASSESSMENTS
-- -----------------------------------------------------------------------------
-- One decision / campaign (roof, pool, annual fund, …).

create table if not exists public.capital_repair_assessments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text null,
  decision_date date null,
  due_date date null,
  status text not null default 'active',
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint capital_repair_assessments_title_not_blank
    check (length(trim(title)) > 0),
  constraint capital_repair_assessments_status_check
    check (status in ('active', 'closed', 'cancelled'))
);

comment on table public.capital_repair_assessments is
  'Capital repair decision / fund campaign. Charges live in capital_repair_ledger.';

-- -----------------------------------------------------------------------------
-- 6. CAPITAL REPAIR LEDGER
-- -----------------------------------------------------------------------------
-- Same kind / amount semantics as water_ledger. Not mixed with support fee.

create table if not exists public.capital_repair_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  assessment_id uuid null
    references public.capital_repair_assessments (id) on delete restrict,
  kind text not null,
  amount_eur numeric(12, 2) not null,
  note text null,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint capital_repair_ledger_kind_check
    check (kind in ('charge', 'payment', 'adjustment_debit', 'adjustment_credit')),
  constraint capital_repair_ledger_amount_positive
    check (amount_eur > 0),
  constraint capital_repair_charge_requires_assessment
    check (kind <> 'charge' or assessment_id is not null),
  constraint capital_repair_ledger_idempotency_key_key
    unique (idempotency_key)
);

comment on table public.capital_repair_ledger is
  'Immutable capital-repair finance journal. Balances are derived, not stored on properties.';

-- One charge per apartment per assessment (same assessment cannot be charged twice).
create unique index if not exists capital_repair_ledger_one_charge_per_property_assessment_idx
  on public.capital_repair_ledger (property_id, assessment_id)
  where kind = 'charge' and assessment_id is not null;

create index if not exists capital_repair_ledger_property_created_idx
  on public.capital_repair_ledger (property_id, created_at desc);

create index if not exists capital_repair_ledger_assessment_id_idx
  on public.capital_repair_ledger (assessment_id);

create index if not exists capital_repair_ledger_kind_idx
  on public.capital_repair_ledger (kind);
