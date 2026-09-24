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
