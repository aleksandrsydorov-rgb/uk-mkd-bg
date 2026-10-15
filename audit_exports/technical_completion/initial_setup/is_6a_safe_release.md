# AMADEUS 11 — Phase IS-6a · Safe Release  
## Historical UK Expenses Initial Data Adapter

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (migration already applied in DB release — **not reapplied**)  
**Production:** https://amadeus11.online  
**Previous tip:** `c54547b` (IS-5 docs)  
**This release:** `a2b5bc750ce874b5b5c9819da6f4bf922dd75524`

**References:**
- `phase_is_6a_expenses.md`
- `is_6a_db_release.md`
- `is_6_expenses_documents_audit.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`a2b5bc7`** pushed `main` → `origin/main` (`c54547b..a2b5bc7`) |
| 2 | Vercel deployment | **`dpl_4spTCTzeRCMTNZ2VSsxsd2Uqcyc9`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-hltql43tf` · ~45s |
| 3 | Tests / build | **PASS** — `npm test` 261/261; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Historical expenses adapter UI | **PASS** (agent browser, admin session) — **Расходы УК (исторические)** · DISABLED · setup нужен · optional skip checkbox · SSOT copy |
| 5 | XLSX template download | **PASS** — UI «Скачать шаблон» clicked; workbook verified via identical generator (`expenses` + `instructions_bg/ru/en`, schema `1.0`, 23227 bytes) |
| 6 | Read-only preview | **PASS** — synthetic classify dry-run; CREATE/SKIP/CONFLICT/ERROR; **no confirm / no opening write RPC** |
| 7 | Budget isolation | **PASS** — helper + dry-run flags; live migration already excludes opening from execution |
| 8 | Existing expenses / financial data unchanged | **YES** — expenses 0; opening imports 0; SF ledger 13; Internet ledger 1/15; modules fp identical; email/debt OFF |
| 9 | Other modules smoke | **PASS** — Support Fee, Internet, Property Book, Расходы УК, Бюджет pages load |
| 10 | Email / debt gates OFF | **YES** |
| 11 | Remaining limitations | Production file-upload→preview batch not fully exercised (browser file injection limits); live inventarisation deferred (empty existing → live SKIP N/A; deterministic tests cover SKIP/CONFLICT); IS-6b AP not in scope |
| 12 | Ready for next Initial Setup phase | **YES** |

---

## Preflight (at publish)

| Check | Result |
|-------|--------|
| Branch `main` == `origin/main` before push | **PASS** (at `c54547b`) |
| IS-6a change review | **PASS** — adapters, commit safety, AdminInitialSetup, i18n, migration, tests, phase/audit/db_release docs |
| Local migration vs applied remote | **PASS** — remote has `20261025120000`; dry-run **up to date**; SHA256 `1EC8148D…8F047C` |
| Unrelated / secrets excluded | **PASS** — staged only IS-6a paths; excluded other `audit_exports/*`, `tmp/`, fixtures, unrelated doc edits |
| No other migrations applied | **PASS** — `db push --dry-run` up to date before/after |
| Canonical `uk_expenses` | **PASS** |
| Pending-only import | **PASS** — RPC + UI copy |
| Publish via canonical admin approve | **PASS** — import does not publish |
| Opening excluded from budget execution | **PASS** |
| Preview cannot invoke write RPC | **PASS** — write only on confirm path |
| Optional skip | **PASS** — `skip_historical_import` checkbox in UI |
| No import on page load | **PASS** — load only lists lifecycle |
| No IS-4/IS-5 finance changes | **PASS** |
| STOP conditions | none |

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 25 files, 261 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add historical UK expenses Initial Setup adapter (IS-6a)
a2b5bc750ce874b5b5c9819da6f4bf922dd75524
```

Staged paths (only):
- `src/lib/moduleCore/adapters/ukExpensesOpening.ts`
- `src/lib/moduleCore/adapters/ukExpensesOpeningAdapter.ts`
- `src/lib/moduleCore/adapters/ukExpensesImportCommit.ts`
- `src/lib/moduleCore/bootstrap.ts`
- `src/lib/moduleCore/index.ts`
- `src/components/admin/AdminInitialSetup.tsx`
- `src/i18n/messages.ts`
- `src/lib/database.types.ts`
- `supabase/migrations/20261025120000_is6a_uk_expense_opening.sql`
- `tests/security/unit/moduleCoreIs6aUkExpenses.test.ts`
- `audit_exports/technical_completion/initial_setup/phase_is_6a_expenses.md`
- `audit_exports/technical_completion/initial_setup/is_6_expenses_documents_audit.md`
- `audit_exports/technical_completion/initial_setup/is_6a_db_release.md`

### Push / Deploy

- `git push origin main` → `c54547b..a2b5bc7`
- Vercel production **Ready**: `dpl_4spTCTzeRCMTNZ2VSsxsd2Uqcyc9`
- Alias: https://amadeus11.online
- Migration **not** reapplied

---

## Production UI smoke (admin session)

| Check | Result |
|-------|--------|
| Initial Setup → Расходы УК (исторические) | **PASS** |
| Optional skip + confirm + verified checkboxes | **PASS** |
| SSOT / no-AP / budget-exclusion copy | **PASS** |
| Download template button | **PASS** (clicked) |
| Upload control present | **PASS** (file input visible; no confirm) |
| Support Fee page | **PASS** |
| Internet page | **PASS** |
| Property Book page | **PASS** |
| Расходы УК page | **PASS** (published 2026: 0) |
| Бюджет page | **PASS** |

---

## Read-only dry-run (synthetic)

Local `tmp/is6a_dryrun_classify.mts` — **no write RPC**:

| Case | Class |
|------|-------|
| Valid historical | CREATE |
| Duplicate source_ref in file | ERROR |
| Identical existing (synthetic map) | SKIP |
| Conflicting source_ref | CONFLICT |
| Missing source_ref | ERROR |
| Invalid amount | ERROR |
| Expense after transition | ERROR |
| Optional category / missing receipt | CREATE |
| Unknown category | ERROR |
| Future transition date | ERROR |

Template sheets: `expenses`, `instructions_bg`, `instructions_ru`, `instructions_en` · schema `1.0`.  
`writeRpcInvoked: false` · `confirmedImport: false`.  
Live SKIP/CONFLICT against DB: **NOT APPLICABLE** (uk_expenses empty).

---

## Data safety postcheck

| Metric | Pre (DB release) | Post (Safe Release) |
|--------|------------------|---------------------|
| uk_expenses | 0 | 0 |
| opening_imports | 0 | 0 |
| SF ledger | 13 | 13 |
| Internet ledger n/sum | 1 / 15 | 1 / 15 |
| building_modules fp | `58a3f7b1…` | `58a3f7b1…` |
| email_ready | false | false |
| debt_gate | false | false |

---

## Safety observed

- No historical expense import / create / approve / publish  
- No AP / supplier invoices / payments  
- No SF/Internet ledger writes  
- No module lifecycle activation  
- Migration not reapplied  
- Email OFF · Debt gate OFF  

---

## Next

Inventory which remaining modules still need opening inventarisation.  
**IS-6b (AP / supplier payables)** remains a separate future phase.

---

## STOP

IS-6a Safe Release complete.
