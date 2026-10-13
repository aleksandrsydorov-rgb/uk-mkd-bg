# E2.3-D — Assessment restore implementation

**Date:** 2026-10-14  
**Baseline:** `ef0aca6` (P0 void guard released)  
**Supabase:** klowacuvufknbrkayjhz  
**Status:** Implemented in repo · migration **prepared, not applied** · incident **99405 not restored**

---

## Scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Restore mechanism implemented | **YES** |
| 2 | Supported restoration cases | Unpaid `void` assessment; no payment/credit allocations; void ledger present; no prior restore; no competing active assessment for same apartment/year |
| 3 | Blocked restoration cases | Not void; already restored; payments/credits; missing/mismatched `p_expected_property_id`; missing void ledger; zero void amount; active sibling year assessment; unauthorized caller |
| 4 | Ledger accounting behavior | Append-only `assessment_restore` amount = void ledger amount; `reverses_ledger_id` → void ledger; portal debt += amount; remaining_due restored; charge (25) + void (32) **kept** |
| 5 | Financial audit trail | Assessment keeps `void_*`; adds `restore_reason` / `restored_at` / `restored_by_email` / `restore_ledger_id`; ledger note `RESTORE assessment {id} (void ledger {n}): {reason}` |
| 6 | Wrong-apartment protection | **PASS** (client frozen target + apt confirm; RPC required `p_expected_property_id`) |
| 7 | Authorization/RLS | **PASS** (`can_manage_support_fees`, SECURITY DEFINER, `search_path=''`, EXECUTE → authenticated only) |
| 8 | Admin UI BG/RU/EN | **PASS** (distinct restore labels; apt/amount/period confirm) |
| 9 | Migration filename | `20261020120000_phase_e2_3_d_assessment_restore.sql` |
| 10 | Tests | **PASS** — 156/156; `tsc --noEmit` PASS; `npm run build` PASS |
| 11 | Financial records unchanged | **YES** (no migration apply; no restore of 99405) |
| 12 | Incident 99405 eligible for restoration | **YES** (void, unpaid, void ledger 32 = 360, no sibling active year assessment) |
| 13 | Ready for DB release | **YES** (coordinate migration apply + app deploy; then operator-approved restore of 99405) |

---

## Mechanism

### RPC `restore_support_fee_assessment`
Args: `p_assessment_id`, `p_reason`, `p_idempotency_key`, `p_expected_property_id` (required).

Order of safety:
1. Auth + `can_manage_support_fees`
2. Lock assessment + property
3. Property identity match (fail closed if null/mismatch)
4. Idempotency key replay
5. Status must be `void`; `restored_at` / `restore_ledger_id` null
6. No payment/credit applications
7. No other active assessment for property/year
8. Resolve latest matching `assessment_void` ledger by note marker
9. Reject if any ledger already `reverses_ledger_id` = that void (concurrent/dup)
10. Insert `assessment_restore`; reopen assessment; debt += restore amount

### Client
- `assessRestoreSupportAssessmentEligibility`, `buildSupportFeeRestoreTarget`, `assertSupportFeeRestoreTargetMatch`, `previewRestoreVoidedAssessment`
- Admin register: restore button only when eligible; frozen target; distinct submit label `feeRestoreSubmit`

### Incident 99405 (eligible, not executed)
| Field | Value |
|-------|--------|
| Apt / property | 99405 / 111 |
| Assessment | `e85d923f-77c1-494c-b752-52eb4f5e45ce` |
| Charge ledger | 25 |
| Void ledger | 32 (360 EUR) |
| Expected after restore | remaining_due=360, status=open, debt+=360, new restore ledger |

---

## Files
- `supabase/migrations/20261020120000_phase_e2_3_d_assessment_restore.sql`
- `src/lib/supportFeeReversal.ts`
- `src/lib/supportFeeAnnual.ts` / `supportFeeBalance.ts` / `securityRpcPolicy.ts` / `database.types.ts`
- `src/components/admin/AdminSupportFeeAnnual.tsx`
- `src/components/AdminReports.tsx`
- `src/i18n/messages.ts`
- `tests/finance/unit/supportFeeAssessmentRestore.test.ts`

## Not done (by design)
- Migration not applied
- 99405 not restored
- No Finance E2E
- No commit / push / deploy
