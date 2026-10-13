# AMADEUS 11 — Phase E2.3-B · Financial Reversal & Void (D4-A)

**Status:** Local implementation complete · migration **not applied**  
**Baseline:** `b461d7c`  
**Supabase:** `klowacuvufknbrkayjhz` (unchanged)

---

## Final checklist

| Item | Result |
|------|--------|
| Payment reversal implemented | **YES** |
| Assessment void implemented | **YES** (unpaid only; paid/partial blocked) |
| Admin UI ready | **YES** |
| Tests | **132/132 PASS** · tsc PASS · build PASS |
| Migration filename | `supabase/migrations/20261018120000_phase_e2_3_b_reversal_and_void.sql` |
| Ready for DB release | **YES** (apply migration when approved) |

---

## What was built

### RPCs (SECURITY DEFINER, `search_path=''`, `can_manage_support_fees`)

| RPC | Behavior |
|-----|----------|
| `reverse_support_payment(ledger_id, reason, idempotency_key)` | Appends `payment_reversal`; restores `remaining_due` / `applied_payment_amount`; adjusts portal debt/over; inserts `payment_reversal` allocation audit rows; rejects duplicate reverse |
| `void_support_fee_assessment(assessment_id, reason, idempotency_key)` | Appends `assessment_void`; sets `status=void`, `remaining_due=0`, void metadata; reduces portal debt by outstanding |

### Schema

- Ledger: `reverses_ledger_id`, `reversal_reason`; kinds `+ payment_reversal`, `assessment_void`
- Assessments: `void_reason`, `voided_at`, `voided_by_email`; status `+ void`, `corrected`
- Partial unique `(property_id, billing_year)` for non-void/non-corrected
- Allocations: type `+ payment_reversal`

### Admin UI

- Finance → operations ledger: Reverse Payment (reason + confirm)
- Finance → register: Void Assessment on eligible unpaid rows
- Ledger/PDF kinds distinguish payment / reversal / void
- i18n: BG / RU / EN

### Client mirrors / authz

- `src/lib/supportFeeReversal.ts`
- `canMutateSupportFeeReversalOrVoid` in `securityRpcPolicy.ts`
- Types updated in `database.types.ts`, `finance.ts`, `supportFeeAnnual.ts`

---

## Blocked edge cases (intentional)

1. **Void of partially/fully paid assessment** — blocked; reverse payments first.  
2. **Void with applied credit / credit allocations** — blocked (reallocation not defined).  
3. **Void zero-due / paid** — blocked.  
4. **Re-finalize same billing year after void while charge ledger exists** — still blocked by existing `charge_already_exists` path; documented in void RPC `note`. Partial unique index allows a future reopen RPC without inventing double-charge policy now.  
5. **Editing/erasing reversal history** — not provided (append-only).

---

## Safety

- No migration applied  
- No live payment/assessment corrections  
- No historical rewrites / deletes  
- Debt gate OFF · Email Core OFF  
- No commit / push / deploy  

---

## Files touched

| Area | Paths |
|------|--------|
| Migration | `supabase/migrations/20261018120000_phase_e2_3_b_reversal_and_void.sql` |
| Lib | `supportFeeReversal.ts`, `finance.ts`, `supportFeeAnnual.ts`, `securityRpcPolicy.ts`, `database.types.ts` |
| UI | `admin/page.tsx`, `AdminSupportFeeAnnual.tsx`, `AdminReports.tsx` |
| i18n | `messages.ts` |
| Tests | `tests/finance/unit/supportFeeReversalVoid.test.ts` |

---

## Next step

Operator-authorized **DB release**: apply `20261018120000_phase_e2_3_b_reversal_and_void.sql` only, then smoke reverse/void on a non-production path or carefully selected test apartment — not against historical discrepancy apartments without approval.
