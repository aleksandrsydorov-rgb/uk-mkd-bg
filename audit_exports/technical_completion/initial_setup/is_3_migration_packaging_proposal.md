# AMADEUS 11 — Future task proposal  
## Meter / Property baseline DDL packaging for clean installs

**Status:** Proposal only — **not executed** in IS-3  
**Date:** 2026-10-14  
**Related:** `is_3_meters_adapter_audit.md`, `phase_is_3_meters.md`

---

## Problem (VERIFIED)

`supabase/migrations/` contains RPC/hardening migrations that **assume** these relations already exist, but no migration in that folder **creates**:

- `public.properties` (and related Book tables as needed for greenfield)
- `public.water_meters`
- `public.electricity_meters`
- `public.meter_readings` (and related water_readings / ledgers as required by Package 2)

DDL currently lives under `supabase/legacy/DO_NOT_RUN/` (e.g. `water_capital_schema.sql`, `electricity_meter_hotfix.sql`). Those scripts must **not** be run as part of IS-3.

A new empty Supabase project that only applies `supabase/migrations/` therefore **cannot** claim meter readiness.

---

## Proposed future work (separate phase)

1. Inventory authoritative production DDL vs legacy scripts (read-only dump compare).  
2. Author **idempotent** baseline migrations (or a documented bootstrap package) that create properties + meter tables + RLS grants **without** production data.  
3. Order migrations so Package 2 / assign RPCs apply after DDL.  
4. Add CI check: `to_regclass` for meter tables after migrate on ephemeral DB.  
5. Explicitly exclude AMADEUS 11 business rows from any distribution package.

---

## Out of scope for IS-3

- Applying migrations to `klowacuvufknbrkayjhz`  
- Running DO_NOT_RUN scripts  
- Rewriting the entire distribution chain  
- Data migration from production  

---

## Acceptance for that future phase

- Fresh project: `supabase db reset` / migrate → `water_meters` / `electricity_meters` exist  
- IS-3 adapters can assign meters on empty Book after IS-2 import  
- No production data included  
