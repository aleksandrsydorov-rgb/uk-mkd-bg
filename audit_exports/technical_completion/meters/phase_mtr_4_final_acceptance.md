# AMADEUS 11 — MTR-4  
## Final Meters Acceptance for Distribution Release 1.0

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz` (**unchanged — no writes**)  
**Local:** `amadeus11-is10a-local` · disposable synthetic fixtures only  
**Mode:** Local packaging + acceptance · **no** commit/push/deploy/cloud migration  

**References:** `mtr_1_acceptance.md` · `phase_mtr_2.md` · `phase_mtr_3.md` · `phase_mtr_3f.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | WATER end-to-end | **PASS** |
| 2 | ELECTRICITY end-to-end | **PASS** |
| 3 | Electricity balance/payment packaging | **PASS** |
| 4 | Submit RPC packaging | **PASS** |
| 5 | Opening / Initial Setup | **PASS** |
| 6 | Charged/paid corrections | **PASS** (RPC); UI **PARTIAL** |
| 7 | Financial invariants | **PASS** |
| 8 | RLS / security | **PASS** |
| 9 | Clean installation | **PASS** (package + local apply; empty registry / no auto tariffs in package SQL) |
| 10 | Administrator UI | **PARTIAL** (ops complete; charged/paid correction UI missing) |
| 11 | Staff UI | **PASS** (code-path; no browser E2E claimed) |
| 12 | Owner UI | **PASS** (code-path; no browser E2E claimed) |
| 13 | Tests / build | **394/394** · `tsc` PASS · `build` PASS |
| 14 | Remaining P0/P1/P2 | See §8 |
| 15 | Release 1.0 acceptance | **PARTIAL** → technical meters core **PASS**; correction **UI** P1 non-blocking |
| 16 | Exact files for subsequent safe release | See §9 |

**Browser E2E:** **not claimed**.

---

## 1. Packaging gaps closed (MTR-4)

| Surface | Source | Package / migration |
|---------|--------|---------------------|
| `get_water_balance` | live types / water_rpc semantics via `has_staff_role` | `84_…` + `20261109150000_…` |
| `record_electricity_payment` | `electricity_finance_hotfix` | same |
| `get_electricity_balance` | `electricity_finance_hotfix` | same |
| `submit_water_reading` | Package2 integrity_fix | `87_…` + `20261109151000_…` |
| `submit_electricity_reading` | Package2 + MTR-3 active filter | same |
| `resolve_utility_tariff` / `tariff_rates_json` | Package2 (submit deps) | `87_…` |

**Gaps removed from MANIFEST / `REMAINING_GREENFIELD_MIGRATION_GAPS`:**

- `water_electricity_submit_operational_rpcs`
- `electricity_balance_payment_rpcs`

IS-10d package id/phase preserved. No tariff/price seeds in MTR-4 SQL.

---

## 2. Local E2E (synthetic)

### Water — **PASS**

Assign → opening (charge 0) → uncharged correct → submit (cons 10 × €2 = €20, one charge) → idempotent submit → payment €8 → balance €12 → charged+paid correct (+€10 debit, balance €22) → replace (history retained) → isolation / unauth reject.

### Electricity — **PASS**

Assign → opening (no `electricity_charges`) → uncharged correct → submit (€3, one ledger charge) → payment €1 → balance/debt €2 → charged+paid correct (+€2 debit, balance €4) → replace (old retained).

### Clean-install / package safety

- Package SQL: no meter/reading/payment seeds; no published utility prices.  
- Local apply of `84`/`87` migrations succeeded.  
- Unit coverage asserts orderedFiles + requiredFunctions after package.  
- Full empty-DB reset not re-run twice (same standard as MTR-2/3); disposable local + package path proven.

---

## 3. Initial Setup

| Check | Result |
|-------|--------|
| XLSX templates water/electricity | Present (`metersOpening.ts`) |
| Preview read-only | PASS |
| Commit assign + `register_*_opening_reading` | PASS (ENABLED) |
| No `submit_*` on opening commit | PASS |
| Reimport SKIP existing | PASS (classify) |
| No auto module activation | PASS |

---

## 4. UI acceptance (code inspection — no browser)

| Surface | Verdict | Evidence |
|---------|---------|----------|
| Admin water | **PASS** | `AdminWater.tsx` — assign/replace/submit/pay |
| Admin electricity meters | **PASS** | `admin/page.tsx` section `счётчики` / `электроэнергия` — assign/replace/submit |
| Admin electricity finance | **PASS** | `AdminElectricityFinance.tsx` — balance/payment |
| Staff | **PASS** | Same admin surfaces; role gates on RPCs |
| Owner water/electricity | **PASS** | `OwnerUtilities` / `OwnerElectricity` — submit + balance |
| Initial Setup | **PASS** | `AdminInitialSetup.tsx` — opening path |
| Charged/paid **correction UI** | **MISSING** | No `correct_water_reading` / `correct_electricity_reading` calls in UI |

**P1 — Correction UI:** Does **not** block Distribution Release 1.0 technical acceptance (RPC packaged, locally proven, admin can invoke via SQL/API). Blocks only “full UI completeness” claim. Recommended follow-up before operator handoff.

---

## 5. Financial invariants

Confirmed on E2E:

- One charge per operational submit (idempotent).  
- Opening never posts charges.  
- Corrections use `adjustment_debit` / `adjustment_credit`; original charge & payments preserved.  
- Balance = Σ(charge+debit) − Σ(payment+credit).

---

## 6. Regression

| Area | Status |
|------|--------|
| Canonical ledgers kinds | Unchanged |
| Support Fee / Internet | Untouched in MTR-4 |
| Inventory | Untouched |
| Email Core | OFF (no enablement) |
| Debt gate | OFF |
| Tests | 394/394 |

---

## 7. Security

- Balance: owner own property or admin/accountant.  
- Payment: admin/accountant.  
- Assign/replace/opening/correct uncharged: admin/engineer.  
- Charged correct: admin only (MTR-3F).  
- Anon execute revoked on packaged RPCs.

---

## 8. Remaining blockers

| Pri | Item | Blocks R1.0? |
|-----|------|--------------|
| P1 | Admin UI for charged/paid reading correction | **No** (RPC ready) |
| P2 | Full empty-DB clean-install soak on a brand-new volume (optional proof) | No |
| P2 | `publish_tariff_version_full_rpc_from_migrations` (tariff admin, not meters ops) | No for meters ops |
| P2 | Cloud apply of MTR-2…MTR-4 (out of scope this phase) | Release process |
| — | Rental Management | Paused |

**P0:** none for meters technical acceptance.

---

## 9. Exact files required for subsequent safe release

### Migrations (chronological)

1. `supabase/migrations/20261109120000_mtr2_electricity_meter_assign_replace.sql`  
2. `supabase/migrations/20261109130000_mtr3_opening_readings_and_safe_corrections.sql`  
3. `supabase/migrations/20261109130100_mtr3_submit_electricity_active_filter.sql`  
4. `supabase/migrations/20261109140000_mtr3f_charged_paid_reading_corrections.sql`  
5. `supabase/migrations/20261109150000_mtr4_utility_balance_payment_rpcs.sql`  
6. `supabase/migrations/20261109151000_mtr4_utility_submit_resolve_packaging.sql`  

### Fresh-install package (ordered additions)

- `82_electricity_meter_assign_replace_rpcs.sql`  
- `83_opening_readings_and_safe_corrections.sql`  
- `83f_charged_paid_reading_corrections.sql`  
- `84_utility_balance_payment_rpcs.sql`  
- `87_utility_submit_resolve_packaging.sql`  
- Plus prior IS-7a…IS-10d package files / `MANIFEST.json` / `freshInstallMeterSchema.ts`

### App / tests (already local)

- `AdminInitialSetup` opening register wiring  
- `metersOpening` / `metersImportCommit` ENABLED path  
- Unit tests `moduleCoreMtr2*` … `moduleCoreMtr4*`

**Not for release:** cloud migration apply until an explicit Safe Release authorization.

---

## 10. Verdict

**Meters Distribution Release 1.0 — technical acceptance: PASS (PARTIAL on correction UI).**

Ready for a **separate Safe Release** authorization (commit / cloud migration / deploy) of the file set in §9. This phase **STOPs** without commit, push, deploy, or cloud writes.
