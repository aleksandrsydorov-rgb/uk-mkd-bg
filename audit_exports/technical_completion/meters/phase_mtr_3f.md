# AMADEUS 11 — MTR-3F  
## Financially Safe Corrections of Charged/Paid Meter Readings

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz` (**unchanged — no writes**)  
**Local:** `amadeus11-is10a-local`  
**Mode:** Local implementation + verification · **no** commit/push/deploy/cloud migration  

**References:** `mtr_1_acceptance.md` · `phase_mtr_2.md` · `phase_mtr_3.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Canonical financial adjustment mechanism | `water_ledger` / `electricity_ledger` kinds **`adjustment_debit`** / **`adjustment_credit`** (I3 balance formula) |
| 2 | Charged WATER correction | **PASS** |
| 3 | Charged ELECTRICITY correction | **PASS** |
| 4 | Paid WATER correction | **PASS** (payments preserved; balance absorbs delta) |
| 5 | Paid ELECTRICITY correction | **PASS** |
| 6 | Historical preservation | **PASS** |
| 7 | Financial invariants | **PASS** |
| 8 | Idempotency | **PASS** |
| 9 | RLS / security | **PASS** (charged path: `администрация` only) |
| 10 | Fresh-install compatibility | **PASS** (IS-10d + MTR-2/3 preserved) |
| 11 | Tests / build | **389/389** · `tsc` PASS · `build` PASS |
| 12 | Exact remaining blockers | See §7 (non-blocking for MTR-4 meter acceptance) |
| 13 | Ready for MTR-4 | **YES** |

---

## 1. Safety gate — accounting invariants

Documented **before** implementation and enforced in SQL header:

| ID | Invariant |
|----|-----------|
| I1 | Original reading rows and original **charge** ledger/charge-snapshot rows are never deleted or amount-mutated |
| I2 | **Payment** rows are never rewritten, deleted, or reallocated |
| I3 | Balance = Σ(charge + adjustment_debit) − Σ(payment + adjustment_credit) |
| I4 | At most one charge per water reading / electricity charge snapshot |
| I5 | Charged correction posts at most one adjustment (debit XOR credit) for delta vs original posted charge, using **original tariff snapshot** (no live reprice) |
| I6 | Paid state handled solely via I3 (over/under balance); **no** refund / `payment_reversal` invention |
| I7 | Idempotent correction key; unique note marker prevents double adjustment |

**Gate verdict:** Canonical primitives **exist** on both utility ledgers (`adjustment_debit` / `adjustment_credit`, positive amounts, already consumed by UI balance displays). Therefore implementation proceeded. No second ledger invented.

---

## 2. Correction scenarios

| Scenario | Behavior |
|----------|----------|
| Uncharged (MTR-3) | Reverse + insert correction reading; no ledger write |
| Charged, consumption ↑ | Reverse + correction reading; `adjustment_debit` = new−old charge |
| Charged, consumption ↓ | Reverse + correction reading; `adjustment_credit` = old−new |
| Charged + paid | Same as charged; payment rows untouched; balance moves by delta only |
| Duplicate adjustment | Blocked by unique note index `mtr3f:water_reading:*` / `mtr3f:electricity_charge:*` |
| Non-latest reading | Blocked (chronology) |
| Engineer on charged | **Not authorized** (admin-only financial path) |

Water recalculation: `round((corrected − previous) × original tariff_eur_per_m3, 2)` vs posted charge amount.  
Electricity: same using `electricity_charges` day/night tariff snapshots and `previous_*` baselines; **charge row unchanged**.

---

## 3. Files

| Path | Role |
|------|------|
| `supabase/migrations/20261109140000_mtr3f_charged_paid_reading_corrections.sql` | Replace `correct_*` + unique adj indexes |
| `supabase/packages/fresh_install/83f_charged_paid_reading_corrections.sql` | Package mirror |
| `freshInstallMeterSchema.ts` / `MANIFEST.json` | Order + remove gap `charged_paid_meter_reading_financial_correction` |
| `tests/security/unit/moduleCoreMtr3fChargedPaidCorrections.test.ts` | Packaging / safety assertions |

---

## 4. Local verification (disposable fixtures)

| Check | Result |
|-------|--------|
| Water charged+paid increase (bal 15→25; debit 10; payment intact) | **PASS** |
| Water charged decrease → credit 9 | **PASS** |
| Idempotent replay / no double adj | **PASS** |
| Engineer blocked on charged | **PASS** |
| Electricity charged+paid increase (debit 2; charge snapshot 3.00 intact) | **PASS** |
| No duplicate charge ledger rows | **PASS** |

---

## 5. Fresh-install

- `83f_…` after `83_…`; IS-10d phase/package id unchanged.  
- No seeds of meters, readings, tariffs, or finance.  
- Gap list no longer includes charged/paid financial correction.

---

## 6. Safety

- No cloud writes / migrations / production finance edits  
- No commit / push / deploy  
- Email Core & debt gate OFF  
- Rental Management paused  
- MTR-2/MTR-3 not released to cloud

---

## 7. Exact remaining blockers (post-MTR-3F)

Not blockers for charged/paid **correction** acceptance, but still open for broader meters Release 1.0:

1. `electricity_balance_payment_rpcs` packaging (get/record electricity finance on greenfield)  
2. `water_electricity_submit_operational_rpcs` still chronological-only (not in package body)  
3. UI wiring for admin “correct charged reading” action (RPC ready; product surface optional for MTR-4)  
4. Cloud apply of MTR-2/MTR-3/MTR-3F migrations (explicitly out of scope here)

---

## 8. Ready for MTR-4

**YES** — opening + uncharged + charged/paid correction paths are locally proven with canonical ledger adjustments.

**STOP.**
