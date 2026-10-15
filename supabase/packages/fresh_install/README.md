# AMADEUS 11 — Fresh-install baseline package (IS-7a)

**Status:** Packaging only. Do **not** apply to production `klowacuvufknbrkayjhz` in IS-7a.  
**Purpose:** Provide ordered, idempotent DDL so a **future empty** Supabase can create Property Book / meter prerequisites **before** the chronological `supabase/migrations/` chain.

## Why a package (not only a late migration)

Many migrations in `supabase/migrations/` **ALTER** or **reference** `properties`, `water_meters`, and `electricity_meters` but never **CREATE** them. Those objects historically came from legacy scripts under `supabase/legacy/DO_NOT_RUN/` (must not be executed as-is).

A late `CREATE IF NOT EXISTS` migration is **safe on existing installs** (no-op) but **cannot** repair greenfield chronological apply: earlier migrations would already fail. This package is the documented bootstrap step for empty projects.

## Apply order (empty project only)

1. Create empty Supabase project (not done in IS-7a).
2. Apply files in `MANIFEST.json` `orderedFiles` order via `psql` / SQL editor (or future distributive tool).
3. Then apply `supabase/migrations/` chronologically (`supabase db push` / migrate).
4. Companion no-op-safe migration `20261026120000_is7a_fresh_install_meter_baseline_ddl.sql` remains in the chain for existing DBs.

## Explicit remaining greenfield gaps

This package does **not** claim full greenfield readiness. Still missing from a pure `migrations/` + this package empty chain (non-exhaustive):

- Full Property Book registry (`property_registry_people` and related Book tables/RPCs beyond minimal `properties`)
- `meter_readings` / `water_readings` / water & electricity ledgers
- Auth helpers (`owns_property`, `has_staff_role`, `is_owner`, staff) — expected from early migrations / platform baseline
- Tariff Core catalog seed / publish workflow (admin Tariffs UI — no auto-publish)
- Support Fee / Internet / Capital operational ledger baselines beyond what migrations already create
- Module catalog / building_modules seed data for a new complex

## Safety

- Idempotent: `CREATE TABLE/INDEX IF NOT EXISTS`, no DROP/TRUNCATE/CASCADE of business data
- No seed of AMADEUS 11 production rows
- No execution of `supabase/legacy/DO_NOT_RUN/*`
- Existing production: apply companion migration only when approved in a later DB Release; tables already exist → no-op
