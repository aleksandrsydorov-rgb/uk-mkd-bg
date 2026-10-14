# AMADEUS 11 — IS-3 Import Safety Hardening

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (local only — **no commit / push / deploy**)  
**Supabase:** `klowacuvufknbrkayjhz` (**no migrations applied**)  
**Reference:** `phase_is_3_meters.md`  
**DDL gap (unchanged):** `is_3_migration_packaging_proposal.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Atomic transaction feasible | **NO** |
| 2 | Implemented safety strategy | **Per-row outcomes** via canonical `assign_*` (stop after first FAILED; SKIPPED_EXISTING continues) |
| 3 | Partial-failure handling | **PASS** |
| 4 | Idempotent retry | **PASS** |
| 5 | Concurrent duplicate protection | **PASS** (RPC + unique active-per-property / serial; race → SKIPPED_EXISTING) |
| 6 | Opening baselines safe | **PASS** (`initial_*` / `installed_at` only via assign; no replace) |
| 7 | No charge generation | **PASS** (`submit_*` never called; `chargesGenerated: false`) |
| 8 | Tests / build | **PASS** — see below |
| 9 | Existing data unchanged | **YES** (no real import in this phase) |
| 10 | Ready for IS-3 Safe Release | **YES** |

---

## 1. Atomic feasibility (**NO**)

Inspected sequential commit in `AdminInitialSetup.confirmMeterImport` and DB surface:

- Only per-device RPCs: `assign_water_meter`, `assign_electricity_meter` (SECURITY DEFINER, role checks, active-meter + serial uniqueness).
- **No** bulk transactional assign RPC in `supabase/migrations/` or `database.types.ts`.
- Implementing true atomic multi-row assign would require a **new** migration/SECURITY DEFINER wrapper — out of scope for IS-3 hardening and forbidden to apply migrations here.

**Conclusion:** atomic bulk commit is **not** feasible without a substantial domain/SQL addition.

---

## 2. Safety strategy implemented

New module: `src/lib/moduleCore/adapters/metersImportCommit.ts`

| Outcome | Meaning |
|---------|---------|
| `CREATED` | `assign_*` succeeded |
| `SKIPPED_EXISTING` | Preview skip, or RPC “already assigned”, or DB reconcile found active meter |
| `FAILED` | Assign error (auth, serial in use elsewhere, etc.) — **stops** further assigns |
| `NOT_PROCESSED` | Remaining CREATE rows after stop |

Additional behaviour:

- Preview SKIP rows never call assign.
- After commit: `reconcileMeterCommitWithDb` upgrades FAILED/NOT_PROCESSED when an active meter is already present (authoritative DB).
- Audit: second `admin_create_module_import_batch` with per-row outcomes (`source=api`).
- Original preview batch marked `committed` **only** when `fullySuccessful`.
- UI: outcome table + “Retry missing” (`filterPreviewForRetry` + `mergeMeterCommitBatches`).
- Opening reading rows remain **BLOCKED**; no `submit_*`.

UI: `AdminInitialSetup.tsx`  
Exports: `src/lib/moduleCore/index.ts`  
i18n: `admin.is3MetersPartial*` / `is3MetersRetry*` / `is3Outcome`

---

## 3–7. Guarantees

| Concern | How |
|---------|-----|
| Partial failure | Never reports full success; shows CREATED/SKIPPED/FAILED/NOT_PROCESSED |
| Retry | Only FAILED/NOT_PROCESSED without active meter; no duplicate assign when already present |
| Concurrent | Unique indexes + RPC “already assigned” → SKIPPED_EXISTING; continue |
| Baselines | assign inserts only; never replace_*; never updates existing initial_* |
| Charges | Path never invokes submit_water_reading / submit_electricity_reading |

---

## Tests / build

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 227 tests (incl. `moduleCoreIs3ImportSafety.test.ts`) |
| `npx tsc --noEmit` | **PASS** (after Json cast fix) |
| `npm run build` | **PASS** (re-run after tsc fix) |

Covered: success, mid-batch failure, retry merge, concurrent already-assigned, preview SKIP, reconcile, no charges, admin role / no property_id spoofing.

---

## Greenfield DDL

Unchanged. Still documented in `is_3_migration_packaging_proposal.md`. No DO_NOT_RUN scripts executed.

---

## Safety observed

- No real imports  
- No existing data / module activation changes  
- No migrations applied  
- No commit / push / deploy  
- Email / debt gates untouched  

**STOP.**
