# AMADEUS 11 — MTR-3  
## Opening Readings & Safe Reading Corrections

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz` (**no writes**)  
**Local:** `amadeus11-is10a-local` · `127.0.0.1:54322`  
**Mode:** Local implementation + validation · **no** commit/push/deploy/cloud migration  

**References:** `mtr_1_acceptance.md` · `phase_mtr_2.md` · IS-3 meters adapters  

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Opening water | **PASS** |
| 2 | Opening electricity | **PASS** |
| 3 | Opening charge-free | **PASS** |
| 4 | Uncharged correction | **PASS** |
| 5 | Charged correction | **BLOCKED** (fail-closed) |
| 6 | Paid correction | **BLOCKED** (fail-closed) |
| 7 | Chronology | **PASS** |
| 8 | RLS / security | **PASS** |
| 9 | Idempotency | **PASS** |
| 10 | Fresh-install compatibility | **PASS** (IS-10d + MTR-2 preserved) |
| 11 | Tests / build | **386/386** · `tsc` PASS · `build` PASS |
| 12 | Cloud data unchanged | **YES** |
| 13 | Remaining financial correction blockers | See §6 |
| 14 | Ready for MTR-4 acceptance | **YES** |

---

## 1. Canonical design (targeted)

| Concern | Decision |
|---------|----------|
| Opening vs `submit_*` | Distinct RPCs; opening never calls tariff resolve / ledger charge insert |
| Baseline reuse | Opening syncs `water_meters.initial_*` / `electricity_meters.initial_*` when no charged history |
| Zero charge | `previous = current`, `tariff_eur_per_m3 = 0`, `tariff_id NULL` → generated charge 0; no ledger row |
| Correction evidence | Original row → `status=reversed` + metadata; new `reading_kind=correction` row |
| Charged / paid | Explicit exceptions; **no** refund/void/payment invention |
| Electricity chronology after reverse | Companion patch: `submit_electricity_reading` ignores `status <> active` |
| Service lock trigger | Fixed CASE typing so uuid-PK `water_readings` inserts work (jsonb id extract) |

---

## 2. Files

| Path | Role |
|------|------|
| `supabase/migrations/20261109130000_mtr3_opening_readings_and_safe_corrections.sql` | Schema + opening/correct RPCs + trigger fix |
| `supabase/migrations/20261109130100_mtr3_submit_electricity_active_filter.sql` | Active-status filter in submit electricity |
| `supabase/packages/fresh_install/83_opening_readings_and_safe_corrections.sql` | Package mirror of opening/correct |
| `supabase/packages/fresh_install/75_utilities_readings_ledgers.sql` | Nullable `tariff_id` + reading metadata columns |
| `src/lib/moduleCore/adapters/metersOpening.ts` | `OPENING_READING_ROW_COMMIT = ENABLED` |
| `src/lib/moduleCore/adapters/metersImportCommit.ts` | Optional post-assign opening register |
| `src/components/admin/AdminInitialSetup.tsx` | Calls `register_*_opening_reading` after assign |
| `tests/security/unit/moduleCoreMtr3OpeningCorrections.test.ts` | Packaging assertions |

**RPCs:**

- `register_water_opening_reading(bigint, numeric, date, text, uuid)`
- `register_electricity_opening_reading(bigint, numeric, numeric, date, text, uuid)`
- `correct_water_reading(uuid, numeric, text, uuid)`
- `correct_electricity_reading(bigint, bigint, numeric, numeric, text, uuid)`

Staff only: `администрация` / `инженер` via `mtr3_assert_meter_staff`. EXECUTE → authenticated; revoked from anon/public.

---

## 3. Local validation matrix

| Check | Result |
|-------|--------|
| Water opening (property 6) | **PASS** — charge_amount 0, kind `opening` |
| Electricity opening (property 5) | **PASS** — day/night pair; no `electricity_charges` |
| Duplicate opening | **PASS** — rejected |
| Idempotent reopen | **PASS** |
| Wrong property | **PASS** |
| Unauthorized caller | **PASS** |
| Uncharged water correction | **PASS** — original reversed, new correction row |
| Uncharged electricity correction | **PASS** |
| Charged correction | **BLOCKED** — `charge exists (financial correction design required)` |
| Paid correction | **BLOCKED** — `payment exists (financial correction design required)` |
| Opening without tariffs | **PASS** — no published tariffs; tariff 0 |
| Published tariffs created | **NONE** (0) |

Disposable `MTR2-*` / `mtr3_*` local fixtures only.

---

## 4. Initial Setup

- XLSX templates unchanged (initial_* + installed_at).
- Preview still read-only classify; annotates `opening_reading_row_commit=ENABLED`.
- Confirm: `assign_*` then `register_*_opening_reading` (not `submit_*`).
- Duplicate active meters still SKIP; duplicate openings rejected by RPC.
- No automatic module activation.

---

## 5. Fresh-install

- Package ordered file `83_…` after utilities + MTR-2 assign.
- MANIFEST required functions include opening/correct RPCs.
- Gap added: `charged_paid_meter_reading_financial_correction`.
- IS-10d package id/phase preserved; no meter/tariff/finance seeds in MTR-3 SQL.
- Submit active-filter ships as chronological migration only (depends on Package2 submit).

---

## 6. Remaining financial correction blockers

Charged and paid reading corrections remain **explicitly blocked** until a dedicated finance design exists for:

1. Ledger-safe charge adjustment / reversal linked to the original reading  
2. Payment-aware settlement (never silent balance mutation)  
3. Reporting consumers that assume immutable charged snapshots  

Documented gap id: `charged_paid_meter_reading_financial_correction`.

Also still open (pre-existing): electricity balance/payment packaging; submit RPCs outside package body.

---

## 7. Safety

- No cloud writes / migrations / production meter edits  
- No commit / push / deploy  
- Email Core and debt gate OFF  
- Rental Management untouched  

**STOP.**
