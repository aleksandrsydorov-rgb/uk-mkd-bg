# AMADEUS 11 — MTR-7  
## Controlled Production Release: Water & Electricity Meters

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz`  
**Authorization:** Explicit user approval of MTR-7 per MTR-6 plan  
**Primary reference:** `phase_mtr_6_release_preflight.md` §4  

**Method (DB):** `supabase db query --linked -f <migration.sql>` per file, then `migration repair --status applied --linked <version>` — **not** bulk `db push`  

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Preflight | **PASS** |
| 2 | Six migrations applied | **YES** (see §3) |
| 3 | RPC signatures/grants | **PASS** |
| 4 | Financial before/after | **IDENTICAL** (see §2) |
| 5 | Commit hash / push | _(filled after git)_ |
| 6 | Vercel deployment | _(filled after deploy)_ |
| 7 | Tests/build | **403/403** · `tsc` PASS · `build` PASS |
| 8 | Water production checks | **PASS** |
| 9 | Electricity production checks | **PASS** |
| 10 | Admin browser smoke | _(filled)_ |
| 11 | Unrelated changes excluded | **YES** |
| 12 | Email/debt OFF | **YES** |
| 13 | Remaining blockers | See §8 |
| 14 | Final Meters production acceptance | _(filled)_ |

---

## 1. Preflight

| Check | Result |
|-------|--------|
| Branch `main` · HEAD was `9cfe075` | **PASS** |
| Linked project `klowacuvufknbrkayjhz` · URL match | **PASS** |
| Six MTR files present · approved order | **PASS** |
| Pending IS-9a/9b, IS-10d, INV-7a1 detected · **not applied** | **PASS** |
| `[db.migrations] enabled=false` · explicit apply used | **PASS** |
| No destructive top-level DML | **PASS** |
| Pre-release function dump | `audit_exports/technical_completion/meters/mtr7_prerelease_function_dump.json` |
| Financial baseline vs MTR-6 | **MATCH** |

---

## 2. Financial baseline (pre = post)

| Metric | Pre | Post |
|--------|----:|-----:|
| water_meters | 2 | 2 |
| electricity_meters | 2 | 2 |
| water_readings | 6 | 6 |
| meter_readings (el day+night) | 16 | 16 |
| electricity_charges / sum | 1 / 2.30 | 1 / 2.30 |
| water_ledger n / sum | 7 / 189.55 | 7 / 189.55 |
| water charge/pay/adj | 5 / 2 / 0+0 | identical |
| electricity_ledger n / sum | 2 / 4.60 | 2 / 4.60 |
| el charge/pay/adj | 1 / 1 / 0+0 | identical |
| support_fee_ledger | 13 / 2204.50 | 13 / 2204.50 |
| capital_repair_ledger | 7 / 1630.00 | 7 / 1630.00 |
| internet_ledger | 1 | 1 |
| properties | 22 | 22 |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |

No charges, payments, or adjustments fabricated by release.

---

## 3. Migrations applied

| # | File | Apply | Repair |
|---|------|-------|--------|
| 1 | `20261109120000_mtr2_electricity_meter_assign_replace.sql` | OK | applied |
| 2 | `20261109130000_mtr3_opening_readings_and_safe_corrections.sql` | OK | applied |
| 3 | `20261109130100_mtr3_submit_electricity_active_filter.sql` | OK | applied |
| 4 | `20261109140000_mtr3f_charged_paid_reading_corrections.sql` | OK | applied |
| 5 | `20261109150000_mtr4_utility_balance_payment_rpcs.sql` | OK | applied |
| 6 | `20261109151000_mtr4_utility_submit_resolve_packaging.sql` | OK | applied |

`schema_migrations` now lists all six `20261109*` versions. IS-9 / IS-10d / INV-7a1 **not** in history (excluded).

### RPCs post-apply (authenticated EXECUTE unless noted)

Present: `assign_*` / `replace_*` water+electricity · `submit_*` · `get_*_balance` · `record_*_payment` · **`register_*_opening_reading`** · **`correct_*_reading`** · `resolve_utility_tariff` (2-arg; 3-arg overload retained; EXECUTE null = internal/security definer path).

---

## 4. Application release

Selective staging of MTR-2…MTR-5 only. Excluded: `AdminInitialSetup.tsx`, IS-9/IS-10d migrations, INV-7a1, unrelated audits, Rental.

_(Commit / Vercel / browser filled in finalization.)_

---

## 5. STOP notes

Never reset production. Never fabricated finance. Email Core and debt gate remain OFF.
