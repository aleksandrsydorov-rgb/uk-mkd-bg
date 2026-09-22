-- =============================================================================
-- AMADEUS 11 FIRST WATER/CAPITAL DEPLOYMENT
-- =============================================================================
-- This script is intentionally first-deployment-only.
-- If any new water/capital table already exists, STOP and inspect manually.
-- Do not remove the guard to force deployment.
--
-- Applies water_capital_schema.sql then water_capital_security.sql
-- in one outer transaction. No nested BEGIN/COMMIT.
-- Any RAISE EXCEPTION aborts the transaction; COMMIT does not run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT CHECKS
-- -----------------------------------------------------------------------------

do $deploy$
declare
  missing text;
begin
  if to_regclass('public.properties') is null then
    raise exception 'Pre-flight failed: public.properties does not exist.';
  end if;

  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;

  if to_regprocedure('public.is_staff()') is null then
    raise exception 'Pre-flight failed: public.is_staff() does not exist.';
  end if;

  if to_regprocedure('public.is_owner()') is null then
    raise exception 'Pre-flight failed: public.is_owner() does not exist.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.owns_property(bigint)',
    'EXECUTE'
  ) then
    raise exception
      'Pre-flight failed: authenticated lacks EXECUTE on public.owns_property(bigint).';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.is_staff()',
    'EXECUTE'
  ) then
    raise exception
      'Pre-flight failed: authenticated lacks EXECUTE on public.is_staff().';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.is_owner()',
    'EXECUTE'
  ) then
    raise exception
      'Pre-flight failed: authenticated lacks EXECUTE on public.is_owner().';
  end if;

  missing := null;
  if to_regclass('public.water_meters') is not null then
    missing := 'public.water_meters';
  elsif to_regclass('public.water_tariffs') is not null then
    missing := 'public.water_tariffs';
  elsif to_regclass('public.water_readings') is not null then
    missing := 'public.water_readings';
  elsif to_regclass('public.water_ledger') is not null then
    missing := 'public.water_ledger';
  elsif to_regclass('public.capital_repair_assessments') is not null then
    missing := 'public.capital_repair_assessments';
  elsif to_regclass('public.capital_repair_ledger') is not null then
    missing := 'public.capital_repair_ledger';
  end if;

  if missing is not null then
    raise exception
      'Water/capital tables already exist. Stop and inspect before deployment. Found: %',
      missing;
  end if;
end;
$deploy$;

-- =============================================================================
-- SCHEMA: exact contents of supabase/water_capital_schema.sql
-- =============================================================================

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

-- =============================================================================
-- SECURITY: exact contents of supabase/water_capital_security.sql
-- =============================================================================

-- =============================================================================
-- AMADEUS 11 — water + capital repair RLS / GRANT
-- =============================================================================
-- Apply AFTER public.owns_property(bigint) and public.is_staff() exist
-- (supabase/rls_helpers.sql) and AFTER the six tables exist
-- (supabase/water_capital_schema.sql).
--
-- This file does NOT:
--   - alter water_capital_schema.sql
--   - change existing helpers / existing table policies
--   - create business RPC (submit/payment/charge/assign/tariff)
--
-- Writes are intentionally RPC-only.
-- There are no INSERT / UPDATE / DELETE policies for authenticated.
-- Table GRANT is SELECT-only for authenticated. Anon has no privileges.
-- service_role is not touched.
--
-- This file intentionally has no BEGIN/COMMIT.
-- It must be executed together with water_capital_schema.sql
-- inside one outer deployment transaction.
-- Combined script is a later step if SQL Editor cannot paste both safely.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enable RLS first. With RLS on and no policies yet, non-owner roles see
-- zero rows. Then revoke table privileges, grant SELECT, add SELECT policies.
-- -----------------------------------------------------------------------------

alter table public.water_meters enable row level security;
alter table public.water_tariffs enable row level security;
alter table public.water_readings enable row level security;
alter table public.water_ledger enable row level security;
alter table public.capital_repair_assessments enable row level security;
alter table public.capital_repair_ledger enable row level security;

-- -----------------------------------------------------------------------------
-- Privileges: strip PUBLIC / anon / authenticated, then SELECT for JWT users.
-- No INSERT/UPDATE/DELETE GRANT — RPC (SECURITY DEFINER) will write later.
-- -----------------------------------------------------------------------------

revoke all on table public.water_meters from public;
revoke all on table public.water_meters from anon;
revoke all on table public.water_meters from authenticated;

revoke all on table public.water_tariffs from public;
revoke all on table public.water_tariffs from anon;
revoke all on table public.water_tariffs from authenticated;

revoke all on table public.water_readings from public;
revoke all on table public.water_readings from anon;
revoke all on table public.water_readings from authenticated;

revoke all on table public.water_ledger from public;
revoke all on table public.water_ledger from anon;
revoke all on table public.water_ledger from authenticated;

revoke all on table public.capital_repair_assessments from public;
revoke all on table public.capital_repair_assessments from anon;
revoke all on table public.capital_repair_assessments from authenticated;

revoke all on table public.capital_repair_ledger from public;
revoke all on table public.capital_repair_ledger from anon;
revoke all on table public.capital_repair_ledger from authenticated;

grant select on table public.water_meters to authenticated;
grant select on table public.water_tariffs to authenticated;
grant select on table public.water_readings to authenticated;
grant select on table public.water_ledger to authenticated;
grant select on table public.capital_repair_assessments to authenticated;
grant select on table public.capital_repair_ledger to authenticated;

-- Idempotent re-apply of this file (does not drop tables).
drop policy if exists water_meters_select on public.water_meters;
drop policy if exists water_tariffs_select on public.water_tariffs;
drop policy if exists water_readings_select on public.water_readings;
drop policy if exists water_ledger_select on public.water_ledger;
drop policy if exists capital_repair_assessments_select on public.capital_repair_assessments;
drop policy if exists capital_repair_ledger_select on public.capital_repair_ledger;

-- -----------------------------------------------------------------------------
-- WATER METERS
-- Owner: own apartments only. Staff: all. Direct write: none (assign/replace RPC).
-- -----------------------------------------------------------------------------

create policy water_meters_select
on public.water_meters
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.is_staff()
);

-- -----------------------------------------------------------------------------
-- WATER TARIFFS
-- Building-wide price list (not per apartment). Any owner needs the current
-- rate for the cabinet; staff need history. Not USING (true): only
-- is_owner() or is_staff(). Direct write: none (set_water_tariff RPC later).
-- -----------------------------------------------------------------------------

create policy water_tariffs_select
on public.water_tariffs
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

-- -----------------------------------------------------------------------------
-- WATER READINGS
-- Owner: own property. Staff: all. Direct INSERT/UPDATE/DELETE: none.
-- Owner submit goes through submit_water_reading(...) later.
-- -----------------------------------------------------------------------------

create policy water_readings_select
on public.water_readings
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.is_staff()
);

-- -----------------------------------------------------------------------------
-- WATER LEDGER
-- Owner: own property. Staff: all. Direct write: none (payment/charge RPC).
-- Zero-consumption readings do not create ledger charges (RPC later).
-- -----------------------------------------------------------------------------

create policy water_ledger_select
on public.water_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.is_staff()
);

-- -----------------------------------------------------------------------------
-- CAPITAL REPAIR ASSESSMENTS
-- Strategy: owner sees an assessment only if their apartment already has a
-- capital_repair_ledger row for that assessment_id (EXISTS + owns_property).
-- That avoids publishing uncharged/internal campaigns to every owner.
-- Staff see all assessments. Direct write: none (admin RPC later).
-- Ledger RLS still applies inside EXISTS (same JWT), so owners cannot probe
-- other apartments' charges.
-- -----------------------------------------------------------------------------

create policy capital_repair_assessments_select
on public.capital_repair_assessments
for select
to authenticated
using (
  public.is_staff()
  or exists (
    select 1
    from public.capital_repair_ledger as l
    where l.assessment_id = capital_repair_assessments.id
      and public.owns_property(l.property_id)
  )
);

-- -----------------------------------------------------------------------------
-- CAPITAL REPAIR LEDGER
-- Owner: own property. Staff: all. Direct write: none (charge/payment RPC).
-- -----------------------------------------------------------------------------

create policy capital_repair_ledger_select
on public.capital_repair_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.is_staff()
);

-- =============================================================================
-- SECURITY TEST MATRIX (manual, after schema+security are applied together)
-- =============================================================================
-- ANON (no JWT):
--   SELECT/INSERT/UPDATE/DELETE on all six tables → DENY (no GRANT + RLS)
--
-- OWNER A (owns property A only):
--   water_meters property A → SELECT ALLOW
--   water_meters property B → SELECT DENY
--   water_meters INSERT/UPDATE/DELETE → DENY
--   water_tariffs SELECT → ALLOW (is_owner)
--   water_tariffs INSERT/UPDATE/DELETE → DENY
--   water_readings property A → SELECT ALLOW
--   water_readings property B → SELECT DENY
--   water_readings INSERT/UPDATE/DELETE → DENY
--   water_ledger property A → SELECT ALLOW
--   water_ledger property B → SELECT DENY
--   water_ledger INSERT/UPDATE/DELETE → DENY
--   capital_repair_ledger property A → SELECT ALLOW
--   capital_repair_ledger property B → SELECT DENY
--   capital_repair_ledger INSERT/UPDATE/DELETE → DENY
--   capital_repair_assessments with ledger row on A → SELECT ALLOW
--   capital_repair_assessments with no row on A (only B or none) → SELECT DENY
--   capital_repair_assessments INSERT/UPDATE/DELETE → DENY
--
-- STAFF (active, is_staff()):
--   SELECT on all six tables → ALLOW
--   INSERT/UPDATE/DELETE on all six (direct client) → DENY
--
-- Writes are intentionally RPC-only.
-- =============================================================================

-- =============================================================================
-- POST-DEPLOY ASSERTIONS
-- =============================================================================

do $deploy$
declare
  tbl text;
  tables text[] := array[
    'water_meters',
    'water_tariffs',
    'water_readings',
    'water_ledger',
    'capital_repair_assessments',
    'capital_repair_ledger'
  ];
  policy_name text;
  policy_tables text[] := array[
    'water_meters',
    'water_tariffs',
    'water_readings',
    'water_ledger',
    'capital_repair_assessments',
    'capital_repair_ledger'
  ];
  policies text[] := array[
    'water_meters_select',
    'water_tariffs_select',
    'water_readings_select',
    'water_ledger_select',
    'capital_repair_assessments_select',
    'capital_repair_ledger_select'
  ];
  policy_i integer;
  obj_name text;
  objects text[] := array[
    'water_meters_one_active_per_property_idx',
    'water_tariffs_id_price_key',
    'water_readings_property_meter_fk',
    'water_readings_tariff_snapshot_fk',
    'water_readings_reversal_metadata_check',
    'water_readings_submitter_check',
    'water_ledger_charge_requires_reading',
    'water_ledger_one_charge_per_reading_idx',
    'capital_repair_charge_requires_assessment',
    'capital_repair_ledger_one_charge_per_property_assessment_idx'
  ];
  tariff_n integer;
  found_obj boolean;
begin
  foreach tbl in array tables loop
    if to_regclass('public.' || tbl) is null then
      raise exception 'Post-deploy failed: table public.% is missing.', tbl;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = tbl
        and c.relrowsecurity is true
    ) then
      raise exception 'Post-deploy failed: RLS is not enabled on public.%.', tbl;
    end if;

    if has_table_privilege('authenticated', 'public.' || tbl, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || tbl, 'DELETE') then
      raise exception
        'Post-deploy failed: authenticated has direct write privilege on public.%.',
        tbl;
    end if;

    if not has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') then
      raise exception
        'Post-deploy failed: authenticated is missing SELECT on public.%.',
        tbl;
    end if;

    if has_table_privilege('anon', 'public.' || tbl, 'SELECT')
       or has_table_privilege('anon', 'public.' || tbl, 'INSERT')
       or has_table_privilege('anon', 'public.' || tbl, 'UPDATE')
       or has_table_privilege('anon', 'public.' || tbl, 'DELETE') then
      raise exception
        'Post-deploy failed: anon has SELECT/INSERT/UPDATE/DELETE on public.%.',
        tbl;
    end if;
  end loop;

  select count(*)::integer
    into tariff_n
  from public.water_tariffs
  where valid_from = date '2026-09-22'
    and price_eur_per_m3 = 0.5000;

  if tariff_n <> 1 then
    raise exception
      'Post-deploy failed: expected exactly one test tariff (valid_from=2026-09-22, price_eur_per_m3=0.5000), found %.',
      tariff_n;
  end if;

  for policy_i in 1 .. array_length(policies, 1) loop
    tbl := policy_tables[policy_i];
    policy_name := policies[policy_i];
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = tbl
        and p.policyname = policy_name
        and p.cmd = 'SELECT'
        and p.roles @> array['authenticated']::name[]
    ) then
      raise exception
        'Post-deploy failed: required SELECT policy % on public.% for authenticated is missing.',
        policy_name,
        tbl;
    end if;
  end loop;

  foreach obj_name in array objects loop
    found_obj := exists (
      select 1
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
      where n.nspname = 'public'
        and con.conname = obj_name
    ) or exists (
      select 1
      from pg_indexes i
      where i.schemaname = 'public'
        and i.indexname = obj_name
    );

    if not found_obj then
      raise exception
        'Post-deploy failed: required constraint/index % is missing.',
        obj_name;
    end if;
  end loop;
end;
$deploy$;

COMMIT;
