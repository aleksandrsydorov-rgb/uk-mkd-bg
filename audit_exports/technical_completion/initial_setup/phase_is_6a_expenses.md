# AMADEUS 11 — PHASE IS-6a  
## Historical UK Expenses Initial Data Adapter

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg  
**Branch:** main (local implementation — not committed)  
**Supabase:** `klowacuvufknbrkayjhz` — **migration NOT applied**  
**Production:** https://amadeus11.online — **not deployed**  
**Mode:** Local implementation only  

**Approved decisions:** Q1–Q12 locked for IS-6a (expenses inventarisation only; IS-6b AP deferred).  
**Baseline:** IS-1–IS-5 released · Email OFF · Debt gate OFF  

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Adapter implemented | **YES** |
| 2 | Canonical `uk_expenses` reused | **YES** |
| 3 | Opening expense model implemented | **YES** (migration prepared, not applied) |
| 4 | XLSX template ready | **YES** |
| 5 | Preview/validation | **PASS** |
| 6 | Pending-review workflow | **PASS** |
| 7 | Budget execution isolation | **PASS** |
| 8 | Idempotency/concurrency | **PASS** (unique `source_ref` + `idempotency_key`; unit-tested) |
| 9 | Existing data preservation | **PASS** (no overwrite; no auto-modify of operational rows) |
| 10 | No AP/payment creation | **PASS** |
| 11 | Migration required | **YES** — `supabase/migrations/20261025120000_is6a_uk_expense_opening.sql` |
| 12 | Tests/build | **261/261 PASS** · `tsc --noEmit` PASS · `npm run build` PASS |
| 13 | Optional setup skip | **PASS** (`skip_historical_import` / confirm / verified) |
| 14 | Remaining blockers | DB Release (apply migration) + Safe Release (commit/push/deploy) |
| 15 | Ready for DB Release or Safe Release | **YES — ready for DB Release next** (not applied yet) |

---

## What was built

### Opening model (canonical `uk_expenses`)
- `opening_import`, `opening_transition_date`, `source_ref`, `opening_source_document`, `opening_notes`, batch/audit columns
- Unique index on `lower(btrim(source_ref))` where `opening_import`
- Audit table `uk_expense_opening_imports`
- Guard trigger: opening inserts only via RPC GUC; opening identity immutable outside RPC
- Publish category trigger: opening archival rows may omit `budget_category_id` even when budget module is on

### Budget isolation (Q3)
- Helper `budget_expense_counts_in_operational_execution(opening_import)`
- `admin_budget_execution` and `owner_get_budget_year` **exclude** `opening_import = true` from operational fact
- Pending rows still do not count (published-only)
- Publishing an opening row still does **not** inflate post-go-live operational execution
- Non-opening expenses unchanged
- Historical transparency: published opening rows remain visible in expenses lists; not treated as AP

### Import RPC
- `import_uk_expense_opening_row` — `администрация` only, SECURITY DEFINER
- Always creates status `на проверке` — **no auto-publish**
- Idempotent by `idempotency_key`; identical `source_ref` → SKIP; mismatch → CONFLICT
- Never calls SF/Internet opening or payment RPCs; never creates AP

### Initial Setup Core adapter
- Platform-service key `uk_expenses` (not a UX module toggle / not budget key)
- Optional: skip historical import without blocking activation path
- XLSX sheet `expenses` + BG/RU/EN instructions · schema `1.0`
- Preview CREATE/SKIP/CONFLICT/ERROR · commit via batch · retry FAILED/NOT_PROCESSED
- Wired in `AdminInitialSetup` + i18n RU/EN/BG

### IS-6b boundary
- No suppliers, invoices, payments, payable ledger
- No cash/bank opening (Q12 out)

---

## Files (primary)

| Path | Role |
|------|------|
| `supabase/migrations/20261025120000_is6a_uk_expense_opening.sql` | DDL + RPC + budget exclusion |
| `src/lib/moduleCore/adapters/ukExpensesOpening.ts` | Classify / template / validation |
| `src/lib/moduleCore/adapters/ukExpensesOpeningAdapter.ts` | Module Core registration |
| `src/lib/moduleCore/adapters/ukExpensesImportCommit.ts` | Safe commit batch |
| `src/lib/moduleCore/bootstrap.ts` / `index.ts` | Register + exports |
| `src/components/admin/AdminInitialSetup.tsx` | UI wire-up |
| `src/i18n/messages.ts` | RU/EN/BG |
| `src/lib/database.types.ts` | Types |
| `tests/security/unit/moduleCoreIs6aUkExpenses.test.ts` | Focused tests (11) |

---

## Safety observed

- Migration **not** applied  
- No historical expenses imported  
- No existing expense rows modified  
- No SF/Internet ledger changes  
- No module lifecycle production transitions  
- Email sending OFF · Debt gate OFF  
- **No commit / push / deploy**  

---

## Next steps (when approved)

1. **DB Release** — apply `20261025120000_is6a_uk_expense_opening.sql` to `klowacuvufknbrkayjhz` with post-check  
2. **Safe Release** — commit + deploy after DB verify  
3. Then inventory which other modules still need opening data before IS-6b (AP)

---

## STOP

IS-6a local implementation complete. Awaiting DB Release approval.
