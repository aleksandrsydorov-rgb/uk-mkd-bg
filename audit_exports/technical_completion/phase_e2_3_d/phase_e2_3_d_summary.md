# AMADEUS 11 — PHASE E2.3-D
## FINAL FINANCE E2E — INTERACTIVE BROWSER TEST

**Date:** 2026-10-14  
**Production:** https://amadeus11.online  
**Released commit under test:** `016c848`  
**Supabase:** klowacuvufknbrkayjhz  

**STOP reason:** Critical mis-void of historical apt **99405** while intending to void **99408**. See `critical_incident.md`. No further financial writes performed after the incident.

---

## Scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Manual administrator login | **PASS** |
| 2 | Test apartment ID | **99407 / property 113** (primary SF flow); **99408 / property 114** (void target, not voided) |
| 3 | Assessment creation | **PASS** (99407 → remaining **120,00 €** after late finalize 132 + correction −12) |
| 4 | Partial payment | **PASS** (40 € → remaining **80**; ledger_id **29**) |
| 5 | Payment reversal | **PASS** (debt **120**; reversal_ledger_id **30**; reason `E2E-FINANCE-D test reversal`) |
| 6 | Duplicate reversal protection | **PASS** (UI: original payment status «Сторнировано», no reverse action) |
| 7 | Unpaid assessment void | **FAIL** — wrong assessment voided (99405 instead of 99408) |
| 8 | Duplicate void protection | **NOT RUN** (stopped after incident) |
| 9 | Paid assessment protection | **NOT RUN** (stopped after incident) |
| 10 | Financial audit trail | **PARTIAL PASS** on 99407 (charge / adjustment / payment / reversal visible); void trail exists but on **wrong** apt |
| 11 | Admin/PDF balance consistency | **NOT RUN** (stopped after incident) |
| 12 | Security checks | **NOT RUN** (stopped after incident) |
| 13 | Automated regression | **PASS** — `npm test` 140/140; `tsc --noEmit` PASS; `npm run build` PASS |
| 14 | Unrelated financial records unchanged | **NO** — apt **99405** voided (360 € removed from remaining_due) |
| 15 | Finance technical completion | **NOT READY** |

---

## Test apartments (E2E-FINANCE-D)

| Apt | property_id | Area | Role |
|-----|-------------|------|------|
| 99407 | 113 | 15 m² | SF assess / pay 40 / reverse |
| 99408 | 114 | 15 m² | Intended unpaid void target (still open 132 €) |

Forbidden apts not used as *targets*: 1, 2, 111, 112, 99401–99406 — but **99405 was incorrectly voided**.

---

## Step 3 evidence (99407 / 2026) — completed before incident

1. Finalize → base 120, late final 132, remaining 132 (`8febdaa5-ffcb-4186-8641-c065bb1539da`)
2. Correction −12 reason `E2E-FINANCE-D adjust to 120 EUR test assessment` → remaining **120** (ledger 28)
3. Payment 40 note `E2E-FINANCE-D partial payment 40` → debt **80** (ledger 29)
4. Reverse ledger 29 reason `E2E-FINANCE-D test reversal` → debt **120** (reversal ledger 30); original marked «Сторнировано»

Note: 2027 early window returns `early_window_not_qualified` for unpaid finalize — used **2026** (late) + correction to reach 120.

---

## Step 4 failure

- Created unpaid assessment on 99408: `20781d03-4fd8-4b39-91bb-d0223d563029`, remaining 132
- Void submit used assessment id **`e85d923f-77c1-494c-b752-52eb4f5e45ce`** (99405)
- 99405 now **Аннулировано**; 99408 still **132 € open**

---

## Gates / local regression

- Automated: **140/140 tests PASS**, TypeScript PASS, production build PASS
- Email Core / debt gate: not re-enabled by this session (no settings changes). Pre-incident baseline assumed still OFF; post-incident financial totals changed due to void only.

---

## Verdict

**Finance technical completion: NOT READY**

Interactive E2E stopped after a destructive mis-void of historical fixture apt **99405**. Operator remediation of 99405 is required before any claim of finance E2E completion. Do not treat remaining Step 4–6 items as passed.
