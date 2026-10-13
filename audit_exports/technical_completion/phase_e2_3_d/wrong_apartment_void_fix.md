# E2.3-D P0 — Wrong-apartment void protection

**Date:** 2026-10-14  
**Baseline under incident:** `016c848`  
**Production:** https://amadeus11.online · Supabase `klowacuvufknbrkayjhz`  
**Status:** Safety fix implemented in repo; migration **prepared, not applied**; **no** financial writes / commit / deploy.

---

## 1. Root cause (evidence-based)

### What was submitted
Incident capture (`critical_incident.md`) shows RPC payload:

| Field | Value |
|-------|--------|
| `p_assessment_id` | `e85d923f-77c1-494c-b752-52eb4f5e45ce` |
| `p_reason` | `E2E-FINANCE-D test void` |
| Response | `void_ledger_id` **32**, `voided_remaining_due` **360.00** |

Intended target was apt **99408** assessment `20781d03-4fd8-4b39-91bb-d0223d563029` — **not** submitted.

### Read-only DB confirmation (2026-10-14, this session)
| Record | Facts |
|--------|--------|
| Assessment `e85d923f…` | property **111**, apt **99405**, year **2026**, status **`void`**, remaining_due **0**, final/base **360**, void_reason `E2E-FINANCE-D test void`, voided_at `2026-10-13 22:42:29+00` |
| Ledger **32** | kind `assessment_void`, property **111**, amount **360**, debt_after **0**, note references `e85d923f…` |
| Ledger **25** | original `charge` 360 for property 111 / period 2026 (**preserved**) |
| Apt 99408 `20781d03…` | still **open**, remaining_due **132** |
| Apt 99407 `8febdaa5…` | still **open**, remaining_due **120** |

### UI / automation path (baseline `016c848`)
At incident commit, `AdminSupportFeeAnnual`:

1. State was a bare `voidId: string` set by each row’s void button (`setVoidId(a.id)`).
2. Confirm panel showed **no** apartment number, amount, period, or assessment ID.
3. Confirm submit used the **same** i18n label as every row button (`admin.feeVoidAssessment` = «Аннулировать начисление»).
4. Submit called `void_support_fee_assessment` with only `{ p_assessment_id: voidId, p_reason, p_idempotency_key }` — **no** property binding.
5. Server RPC accepted any voidable assessment UUID authorized for the staff role.

**Conclusion:** The wrong assessment ID was selected in the client (browser automation matched the first enabled row button sharing the confirm label / overwrote `voidId` to 99405’s assessment). The UI did not display target identity, and the server did not verify expected apartment/property — so the mis-selection became a successful financial mutation. This is **not** a silent server remapping of a correct 99408 ID; the submitted UUID was already 99405’s.

---

## 2. Safety fix implemented

| Layer | Protection |
|-------|------------|
| Client state | Immutable `SupportFeeVoidTarget` frozen at row click (`assessmentId`, `propertyId`, apt #, year, amounts) |
| Confirm UI | Shows apt / year / final / remaining / assessment ID; requires typing apt number + checkbox + reason |
| Submit button | Distinct label `feeVoidSubmit` + `data-void-submit`; disabled until apt confirm matches |
| Client guard | `assertSupportFeeVoidTargetMatch` rejects wrong apt, stale/void live row, assessment mismatch, missing property |
| Year change | `useEffect` clears void panel when year changes |
| Server (migration) | `p_expected_property_id` **required**; reject property mismatch **before** ledger/assessment/property updates; UPDATE also constrains `property_id` |
| Auth | Existing `can_manage_support_fees` + auth email + idempotency preserved |

### Files
- `src/lib/supportFeeReversal.ts` — target types + match helpers
- `src/components/admin/AdminSupportFeeAnnual.tsx` — void panel rewrite
- `src/i18n/messages.ts` — RU/EN/BG strings
- `src/lib/database.types.ts` — RPC Args include `p_expected_property_id`
- `supabase/migrations/20261019120000_phase_e2_3_d_void_target_guard.sql` — **prepared, not applied**
- `tests/finance/unit/supportFeeReversalVoid.test.ts` — wrong-apt / stale / mismatch regressions

---

## 3. Affected financial record IDs

| ID | Type | Role |
|----|------|------|
| `e85d923f-77c1-494c-b752-52eb4f5e45ce` | assessment | Unintentionally voided (99405 / prop 111) |
| **32** | ledger `assessment_void` | Void correction row (keep) |
| **25** | ledger `charge` | Original 2026 charge for 99405 (keep) |
| property **111** | properties.debt | Now **0.00** (was 360 before void) |
| `20781d03-…` | assessment | Intended void target — **unchanged / still open 132** |

---

## 4. Safe restoration proposal for 99405 (DO NOT execute yet)

**Constraints:** do not delete void history; do not raw-UPDATE financial tables outside an audited RPC; do not re-run Finance E2E mutations until fix is released.

**Recommended auditable path (operator-approved later):**

1. Keep ledger **32** (`assessment_void`) and void metadata on `e85d923f…` as permanent incident audit.
2. Introduce a dedicated **restore / re-open** staff RPC (or carefully designed compensating charge + new assessment) that:
   - Verifies assessment id + `p_expected_property_id = 111` + apt 99405;
   - Inserts a new ledger row (e.g. `charge` or future `assessment_restore`) restoring **360** debt with reason `RESTORE after E2.3-D mis-void e85d923f… / ledger 32`;
   - Either re-opens the same assessment (`status=open`, `remaining_due=360`, clear void fields with restore audit columns) **or** creates a new open 2026 assessment if product rules forbid re-open;
   - Never deletes ledger 25/32.
3. Pre/post read-only checks: property 111 debt=360, rem due for open 99405 assessment=360, complex rem/debt totals documented.
4. Only after UI+migration security fix is live.

**Not allowed:** `DELETE` void ledger; silent `UPDATE support_fee_assessments SET status='open'` without ledger; DB reset.

---

## 5. Release readiness

| Gate | Result |
|------|--------|
| Wrong-apartment protection in code | YES |
| SQL migration required | **YES** (`20261019120000_…`) — **not applied** |
| Financial data changed by this investigation | **NO** (read-only queries only) |
| Ready for security fix release | **YES** (coordinate UI deploy + migration apply; then restore 99405 separately) |
| Finance E2E resume | **NO** until restore decision + fix release |

Debt gate / email sending: left OFF (not touched).
