# PKG-XFER Package 5 Progress — PASS

**Project:** `klowacuvufknbrkayjhz`  
**Completed:** Admin session (no protected apts mutated for goals)

## Scenarios

| ID | Scenario | Status | Evidence |
|----|----------|--------|----------|
| P5.1 | SF overdue + future-due fixture | **PASS** | 99405: capital overdue 350 + SF future 360 (pre-backfill); 99406: SF late overdue 440 with `early_deadline_at=2025-12-31`. After `admin_backfill_support_fee_early_deadlines(111)` SF also overdue. |
| P5.2 | Ordinary approve gate OFF → warning + success (F1) | **PASS** | Transfer **#43** `утверждена`; `debt_check.overdue_unpaid_eur=350`; `ordinary_debt_gate_enabled=false`; `debt_gate_applied=false` |
| P5.3 | Assessments unchanged after ownership change (F4) | **PASS** | SF + capital ledger JSON equal before/after #43 and #44 |
| P5.4 | Inherited liability record + confirm (I4) | **PASS** | `ownership_inherited_liabilities` id **1** accepted/confirmed on 99405 |
| P5.5 | LE Book owner + representative change (L1 / S5B-AUTH-01) | **PASS** | Rep update on registry 129; `ownership_unchanged=true`; tariff transitions `[]` |
| P5.6 | Natural↔legal approve → prospective tariff only (L2/F4) | **PASS** | Transfer **#44** LE→natural; transition id **3** `historic_assessments_untouched=true`; note `prospective_only…` |
| P5.7 | Gate ON blocks ordinary → restore OFF (F3) | **PASS** | Transfer **#46** blocked; gate restored `false` via `admin_set_ordinary_debt_gate` |
| P4.5 | Inheritance approve with overdue (F2) | **PASS** | Transfer **#45** inheritance approved despite overdue 350; ledgers unchanged |

## Isolated fixtures
- Apt **99405** / property **111** — finance / ordinary / inheritance-with-debt
- Apt **99406** / property **112** — LE + N↔L + SF late overdue

## Code / DB repairs applied (TEST linked)
1. `20261011203000_pkg_xfer_sf_early_deadline_stamp.sql` — stamp deadline on finalize + `admin_backfill_support_fee_early_deadlines`
2. `20261011204500_pkg_xfer_admin_set_ordinary_debt_gate.sql` — staff toggle for F3 (direct UPDATE was denied)
3. Removed temporary `window.__lastSfFinalize` debug hook from `AdminSupportFeeAnnual.tsx`
4. Types: `admin_set_ordinary_debt_gate`, `admin_backfill_support_fee_early_deadlines`

## Gate safety
`ordinary_debt_gate_enabled = **false**` after F3 (verified).

## Protected
99401 / 99402 / 99501 not mutated for P5 goals.
