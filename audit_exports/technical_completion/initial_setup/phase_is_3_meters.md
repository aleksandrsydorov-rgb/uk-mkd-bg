# ALSYD / AMADEUS 11 — Phase IS-3  
## Water & Electricity Initial Data Adapters

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (local implementation only — **not committed / not pushed / not deployed**)  
**Supabase:** `klowacuvufknbrkayjhz` (**no migration applied**)  
**Production:** https://amadeus11.online  
**Baseline:** IS-2 `a7b96c3` / docs `7a4e4e4`  
**Audit:** `is_3_meters_adapter_audit.md`  
**DDL packaging proposal:** `is_3_migration_packaging_proposal.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Water adapter implemented | **YES** (`water`) |
| 2 | Electricity adapter implemented | **YES** (`electricity`) |
| 3 | XLSX templates ready | **YES** (separate water / electricity + BG/RU/EN instructions) |
| 4 | Preview / validation | **PASS** |
| 5 | Import confirmation / idempotency | **PASS** (confirm → `assign_*` CREATE only; SKIP existing) |
| 6 | Opening readings supported | **BLOCKED** (see below) |
| 7 | Existing meter data unchanged | **YES** (no live import; default SKIP; no replace) |
| 8 | Migration required | **NO** for adapter release on current DB; **YES later** for fresh-install DDL packaging |
| 9 | Tests / build | **PASS** — `npm test` 218/218; `tsc --noEmit` PASS; `npm run build` PASS |
| 10 | Fresh-install DDL gap documented | **YES** (`is_3_migration_packaging_proposal.md`) |
| 11 | Ready for Safe Release | **YES** (local complete; release not performed) |
| 12 | Remaining blockers | Opening reading **row** commits; greenfield DDL packaging |

---

## Opening readings — BLOCKED (authoritative finding)

| Store | Role |
|-------|------|
| `water_meters.initial_reading` + `installed_at` | Inventarisation baseline via `assign_water_meter` — **used** |
| `electricity_meters.initial_day_reading` / `initial_night_reading` + `installed_at` | Inventarisation baseline via `assign_electricity_meter` — **used** |
| `water_readings` via `submit_water_reading` | Operational readings; **creates `water_ledger` charges** when consumption > 0 — **not used** |
| `meter_readings` via `submit_electricity_reading` | Operational day/night; **creates `electricity_charges`** — **not used** |

**Decision:** IS-3 does **not** insert reading rows. Template fields `initial_*` + `installed_at` feed **assign_*** only. Preview annotates `opening_reading_row_commit=BLOCKED`. No automatic charges.

**Missing product/tech dependency for unblocking reading rows:** a charge-free opening-reading workflow distinct from `submit_*` (does not exist in current migrations).

---

## What was implemented

### Adapters

- `src/lib/moduleCore/adapters/metersOpening.ts` — classify, templates, assign payloads, error report  
- `src/lib/moduleCore/adapters/waterOpeningAdapter.ts` — moduleKey `water`, depends on `property_book`  
- `src/lib/moduleCore/adapters/electricityOpeningAdapter.ts` — moduleKey `electricity`, depends on `property_book`  
- Registered in `bootstrap.ts`; exported from `index.ts`

### Admin Setup UI

- `AdminInitialSetup.tsx` — water/electricity template download, preview batch, confirm → loop `assign_*`, never `submit_*` / `replace_*`  
- i18n BG/RU/EN (`admin.is3*`)

### Templates (schema_version `1.0`)

**Water sheet `meters`:** `apartment_number`, `meter_number`, `initial_reading`, `installed_at`  
**Electricity sheet `meters`:** `apartment_number`, `meter_number`, `initial_day_reading`, `initial_night_reading`, `installed_at`  
Plus `instructions_bg` / `instructions_ru` / `instructions_en`.

### Safety observed

- No migrations applied  
- No real AMADEUS meter import  
- No module state changes on production  
- No commit / push / deploy  
- Email / debt gates untouched  

---

## Remaining blockers

1. **Opening reading rows** — BLOCKED until charge-free API exists.  
2. **Fresh Supabase DDL** — meter/property `CREATE TABLE` not in `supabase/migrations/` (proposal filed; not fixed in IS-3).  
3. **Partial multi-row assign** — sequential RPC calls; first failure may leave earlier assigns (document for operators; no new bulk RPC in IS-3).

---

## Ready for Safe Release

**YES** for adapter packaging when explicitly authorized. This phase **STOPs** after local implementation + report.
