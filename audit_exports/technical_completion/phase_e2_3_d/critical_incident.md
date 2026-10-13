# E2.3-D CRITICAL INCIDENT — Wrong assessment voided

## What happened
While attempting to void the **new unpaid** assessment on apt **99408** (property **114**, assessment `20781d03-4fd8-4b39-91bb-d0223d563029`), the UI submitted:

```json
{
  "p_assessment_id": "e85d923f-77c1-494c-b752-52eb4f5e45ce",
  "p_reason": "E2E-FINANCE-D test void"
}
```

That ID is the **historical 2026 assessment for apt 99405** (property 111), not 99408.

RPC response (200):
```json
{
  "status": "void",
  "assessment_id": "e85d923f-77c1-494c-b752-52eb4f5e45ce",
  "void_ledger_id": 32,
  "voided_remaining_due": 360.00,
  "debt": 0.00
}
```

## Observed register after incident (2026)
| Apt | remaining_due | Status |
|-----|---------------|--------|
| 99405 | 0,00 € | **Аннулировано** (VOIDED — unintended) |
| 99406 | 440,00 € | debt (unchanged) |
| 99407 | 120,00 € | debt (E2E test scope) |
| 99408 | 132,00 € | debt (intended void target **not** voided) |

## Read-only re-confirm (P0 investigation, 2026-10-14)
| Object | State |
|--------|--------|
| `e85d923f…` | status=`void`, property_id=111, apt 99405, remaining_due=0, void_reason=`E2E-FINANCE-D test void` |
| ledger 32 | `assessment_void` 360, property 111, debt_after=0 |
| ledger 25 | original `charge` 360 (intact) |
| `20781d03…` (99408) | still `open` remaining_due=132 |
| property 111 debt | 0.00 |

## Impact
- Violates “Do not void an existing historical assessment”.
- Violates “Do not modify unrelated apartments” (99405 / 99401–99406 fixture band).
- Canonical SF remaining_due for the complex dropped by **360 EUR** vs pre-test baseline rem=800.

## Confirmed cause
**Client selected the wrong assessment ID; server accepted it.**

Evidence at baseline `016c848`:
1. Void state was bare `voidId` with no frozen property/apartment binding.
2. Confirm dialog did **not** show apartment, amount, period, or assessment ID.
3. Row void buttons and the confirm submit shared the same label («Аннулировать начисление»), so browser automation that matched `button text === label && !disabled` could hit a **row** button (first voidable row = 99405) and overwrite `voidId` before submit.
4. RPC `void_support_fee_assessment` took only `p_assessment_id` — no `p_expected_property_id` check.

The submitted UUID was already 99405’s; the server did not remap a correct 99408 id.

## Response
- **Stopped** all further financial writes immediately.
- Did **not** auto-retry void, reverse the void, or “fix” 99405.
- P0 safety fix: see `wrong_apartment_void_fix.md` (UI target freeze + apt confirm + prepared RPC property guard). Migration **not** applied in investigation; restore **not** executed.
- Operator decision required for any remediation of 99405.
