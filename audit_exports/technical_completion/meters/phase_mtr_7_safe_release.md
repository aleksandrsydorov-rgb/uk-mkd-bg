# AMADEUS 11 — MTR-7  
## Controlled Production Release: Water & Electricity Meters

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz`  
**Authorization:** Explicit user approval of MTR-7 per MTR-6 plan  
**Primary reference:** `phase_mtr_6_release_preflight.md` §4  

**Method (DB):** `supabase db query --linked -f <migration.sql>` per file, then `migration repair --status applied --linked <version>` — **not** bulk `db push`  

**Recovery dump:** `audit_exports/technical_completion/meters/mtr7_prerelease_function_dump.json`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Preflight | **PASS** |
| 2 | Six migrations applied | **YES** (all six) |
| 3 | RPC signatures/grants | **PASS** |
| 4 | Financial before/after | **IDENTICAL** |
| 5 | Commit hash / push | `4aca102` → `origin/main` **PASS** |
| 6 | Vercel deployment | `dpl_8bgqaVvGp3UJL1hK5dCi5drKvJoP` · **Ready** · aliased to amadeus11.online |
| 7 | Tests/build | **403/403** · `tsc` PASS · `build` PASS |
| 8 | Water production checks | **PASS** |
| 9 | Electricity production checks | **PASS** (RPC/data); UI Correct smoke **PARTIAL** |
| 10 | Admin browser smoke | **PARTIAL** (water correction panel **PASS**; electricity Correct not reconfirmed) |
| 11 | Unrelated changes excluded | **YES** |
| 12 | Email/debt OFF | **YES** |
| 13 | Remaining blockers | P2 electricity Correct visibility smoke; IS-9/IS-10d still local-only |
| 14 | Final Meters production acceptance | **PASS** (PARTIAL on electricity Correct UI smoke only) |

---

## 1. Preflight

| Check | Result |
|-------|--------|
| Branch `main` · project `klowacuvufknbrkayjhz` · URL match | **PASS** |
| Six approved files · order verified | **PASS** |
| Pending IS-9a/9b, IS-10d, INV-7a1 detected · **not applied** | **PASS** |
| `[db.migrations] enabled=false` → explicit apply | **PASS** |
| No destructive historical DML | **PASS** |
| Function dump captured before replace | **PASS** |
| Baseline vs MTR-6 | **MATCH** |

---

## 2. Financial baseline (pre = post = final)

| Metric | Value |
|--------|------:|
| water_meters / electricity_meters | 2 / 2 |
| water_readings / meter_readings (el) | 6 / 16 |
| electricity_charges / sum | 1 / **2.30** |
| water_ledger n / sum | 7 / **189.55** (charge 5 · pay 2 · adj 0) |
| electricity_ledger n / sum | 2 / **4.60** (charge 1 · pay 1 · adj 0) |
| support_fee_ledger | 13 / **2204.50** |
| capital_repair_ledger | 7 / **1630.00** |
| internet_ledger | 1 |
| properties | 22 |
| email_core_is_ready() | **false** |
| ordinary_debt_gate_enabled | **false** |

No fabricated charges/payments/adjustments. No historical payment rewrite.

---

## 3. Migrations applied

| # | Filename | SQL | Repair |
|---|----------|-----|--------|
| 1 | `20261109120000_mtr2_electricity_meter_assign_replace.sql` | OK | applied |
| 2 | `20261109130000_mtr3_opening_readings_and_safe_corrections.sql` | OK | applied |
| 3 | `20261109130100_mtr3_submit_electricity_active_filter.sql` | OK | applied |
| 4 | `20261109140000_mtr3f_charged_paid_reading_corrections.sql` | OK | applied |
| 5 | `20261109150000_mtr4_utility_balance_payment_rpcs.sql` | OK | applied |
| 6 | `20261109151000_mtr4_utility_submit_resolve_packaging.sql` | OK | applied |

`schema_migrations` contains all six. IS-9 / IS-10d / INV-7a1 **absent** from remote history.

### RPCs (authenticated EXECUTE)

`assign_*` / `replace_*` · `submit_*` · `get_*_balance` · `record_*_payment` · `register_*_opening_reading` · `correct_*_reading` · `resolve_utility_tariff` (2-arg packaging; 3-arg overload retained).

---

## 4. Application release

**Commit:** `4aca1021d5ce338080a1a124ce286f9848dd3c1b`  
**Push:** `9cfe075..4aca102` → `origin/main`  

**Included:** six migrations · fresh-install `82`/`83`/`83f`/`84`/`87` (+ `75`/`MANIFEST`) · AdminWater / AdminMeterCorrectionPanel / admin electricity correction wiring · opening adapters · i18n · types · MTR unit tests · meters audit reports  

**Excluded:** `AdminInitialSetup.tsx` · IS-9a/9b · IS-10d · INV-7a1 · Rental · unrelated audits  

**Vercel:** `dpl_8bgqaVvGp3UJL1hK5dCi5drKvJoP` · Production **Ready** · https://amadeus11.online  

---

## 5. Post-release verification

| Check | Result |
|-------|--------|
| Required meter RPCs present | **PASS** |
| Grants / authz (EXECUTE authenticated; staff gates in RPC) | **PASS** |
| Readings / ledger counts unchanged | **PASS** |
| Support Fee / Internet / Capital / Inventory | **PASS** (unchanged) |
| Email / debt OFF | **PASS** |
| Water admin route + history + **Исправить** panel | **PASS** (opened; cancelled; **no submit**) |
| Electricity admin route + meter + readings | **PASS** |
| Electricity **Исправить** visible in smoke | **PARTIAL** (not reconfirmed this session; code shipped) |
| BG/RU/EN keys shipped | **PASS** (unit-tested; RU panel verified live) |

Water panel confirmed: original values, new value field, mandatory reason, confirm checkbox, impact note, submit/cancel — cancel used only.

---

## 6. Remaining blockers

| Pri | Item |
|-----|------|
| P2 | Reconfirm electricity Correct button on production apt 12 after hard refresh / pairing check |
| P2 | IS-9 / IS-10d / INV-7a1 remain local-only pending (intentionally excluded) |
| — | No P0 |

---

## 7. Verdict

**Meters Distribution Release 1.0 — production acceptance: PASS (PARTIAL only on electricity Correct UI smoke).**  

DB packaging and water correction admin UI are live. Existing financial history preserved. Email Core and debt gate remain OFF.
