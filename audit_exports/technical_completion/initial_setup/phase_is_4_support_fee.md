# AMADEUS 11 — Phase IS-4  
## Support Fee Opening Data Adapter — Implementation

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (local implementation only — **not committed / not pushed / not deployed**)  
**Supabase:** `klowacuvufknbrkayjhz` (**migration prepared, not applied**)  
**Production:** https://amadeus11.online  
**Baseline:** IS-1 Core · IS-2 Property Book · IS-3 meters · Finance D1–D7 · Email OFF · Debt gate OFF  
**Audit:** `is_4_support_fee_audit.md`  
**Approved product decisions:** Q1–Q5 (opening granularity; verified paid without fake payments; partial identity; no early/late recalc; conflict ERROR)

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Opening finance mechanism implemented | **YES** |
| 2 | Finance D1–D7 compatibility | **PASS** |
| 3 | Fully paid historical periods | **PASS** |
| 4 | Partial paid periods | **PASS** |
| 5 | Opening debt | **PASS** |
| 6 | Opening credits / overpayments | **PASS** |
| 7 | XLSX template ready | **YES** |
| 8 | Preview / validation | **PASS** |
| 9 | Idempotency and conflict handling | **PASS** |
| 10 | No synthetic payments | **PASS** |
| 11 | Migration filename | `20261023120000_is4_support_fee_opening_state.sql` |
| 12 | Tests / build | **PASS** — `npm test` 238/238; `tsc --noEmit` PASS; `npm run build` PASS |
| 13 | Existing business data unchanged | **YES** (no migration apply; no live import; no module/email/debt changes) |
| 14 | Remaining blockers | DB Safe Release (apply migration + staged dry-run on non-prod); tariff readiness check is gate metadata only |
| 15 | Ready for DB Release | **YES** (local complete; release **not** performed) |

---

## Opening finance mechanism

### Design (Q1–Q5 → canonical path)

| Decision | Representation |
|----------|----------------|
| Q1 per apt / year / obligation / transition | Scope key `(property_id, billing_year, obligation_type=support_fee)` + `transition_date` |
| Q2 fully paid historical | Assessment `status=paid`, `remaining_due=0`; ledger `opening_historical_settlement` — **not** `kind=payment` |
| Q3 partial | `assessed = historically_paid + remaining`; identity enforced in adapter + SQL CHECK + RPC |
| Q4 no early/late | `pricing_reason_code=is4_opening_state`; no tariff recalculation of imported amounts |
| Q5 conflict | Existing active assessment / opening import / charge ledger → ERROR/CONFLICT; never overwrite |

### Canonical objects written (append-only inventarisation)

1. `support_fee_assessments` — D1 `remaining_due` SoT; `opening_import=true`; historical paid stored as declaration  
2. `support_fee_ledger` kinds: `opening_obligation`, `opening_historical_settlement`, `opening_credit`  
3. `support_fee_opening_imports` — idempotency key + unique scope audit  
4. Portal `properties.debt` / `properties.overpayment` — updated **only inside** `import_support_fee_opening_state` after ledger evidence (same RPC-maintained cache pattern as finalize/payment; **never** client UPDATE)

### Explicitly not written

- No `support_fee_ledger.kind = 'payment'`
- No `support_fee_allocations`
- No invoices / collection / Email Core
- No automatic module activation
- No early/late recalculation of opening amounts

---

## What was implemented

### Database (prepared only)

- `supabase/migrations/20261023120000_is4_support_fee_opening_state.sql`
  - Opening columns on assessments
  - Table `support_fee_opening_imports` (idempotency + scope uniqueness)
  - Ledger kind CHECK extended with opening_* kinds
  - RPC `import_support_fee_opening_state` — admin (`администрация`) only, transactional, conflict-safe

### Adapters / commit

- `src/lib/moduleCore/adapters/supportFeeOpening.ts` — validate, classify CREATE/SKIP/CONFLICT/ERROR, XLSX template + error report  
- `src/lib/moduleCore/adapters/supportFeeOpeningAdapter.ts` — moduleKey `support_fee`  
- `src/lib/moduleCore/adapters/supportFeeImportCommit.ts` — per-row RPC commit, stop-on-FAILED, retry merge, D1 outstanding sum  
- Registered in `bootstrap.ts`; exported from `index.ts`

### D1 balance

- `src/lib/supportFeeBalance.ts` — `supportLedgerNet` recognizes opening_* kinds for reconciliation (not as operational payments)

### Admin UI + i18n

- `AdminInitialSetup.tsx` — Support Fee template, preview, confirm → RPC, retry FAILED/NOT_PROCESSED, conflict messaging  
- BG/RU/EN `admin.is4*` keys in `src/i18n/messages.ts`

### Types

- `src/lib/database.types.ts` — `support_fee_opening_imports` + RPC args/returns (local mirror for compile)

### Tests

- `tests/security/unit/moduleCoreIs4SupportFee.test.ts` — paid/partial/unpaid, overpayment double-count, conflict/skip, unauthorized classify, D1, no synthetic payments, retry, ownership transfer policy hook

---

## XLSX template

Sheet `opening_balances` columns:

`apartment_number`, `billing_year`, `obligation_type`, `assessed_amount`, `historically_paid_amount`, `remaining_debt`, `opening_overpayment`, `transition_date`, `source_reference`, `notes`

Plus `instructions_bg` / `instructions_ru` / `instructions_en` and examples.  
Credits: at most one positive `opening_overpayment` per apartment in a file (prevents double-count against historical assessment).

---

## Preview / commit safety

| Rule | Behavior |
|------|----------|
| Preview | Classify only — **never** writes finance |
| Apartment match | Property Book lookup; rejects spoofed `property_id` |
| Consistency | `assessed = paid + remaining` |
| Existing obligation | CONFLICT (manual reconcile) |
| Identical prior opening | SKIP (idempotent) |
| Commit | Sequential `import_support_fee_opening_state`; per-row outcomes |
| Partial batch | Never reported as full success; retry only FAILED/NOT_PROCESSED |
| Auth | DB enforces administration role |

---

## Safety observed this phase

- Migration **not** applied  
- No real financial imports  
- No module state changes on production  
- No Email Core / debt gate changes  
- No commit / push / deploy  
- Existing AMADEUS business data untouched  

---

## Remaining blockers (for Safe Release, not for local IS-4 close)

1. Apply `20261023120000_is4_support_fee_opening_state.sql` via approved DB release process (not done here).  
2. Staged dry-run / controlled import on non-production before production inventarisation.  
3. Tariff Core / Property Book readiness remain operational gates at activation time (adapter does not auto-activate).

---

## STOP

Local IS-4 implementation, tests, and report complete.  
**Do not** apply migrations, commit, push, or deploy from this phase.
