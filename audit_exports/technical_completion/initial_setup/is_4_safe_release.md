# AMADEUS 11 — Phase IS-4 · Safe Release  
## Support Fee Opening Data Adapter

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (migration already applied in DB release — **not reapplied**)  
**Production:** https://amadeus11.online  
**Previous tip:** `b4ef6a0` (IS-3 docs)  
**This release:** `187c67c1158296bd2b4e4bf84fa1aefc726ac542`

**References:**
- `phase_is_4_support_fee.md`
- `is_4_db_release.md`
- `is_4_support_fee_audit.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`187c67c`** feat + **`011088f`** docs pushed `main` → `origin/main` (`b4ef6a0..011088f`) |
| 2 | Vercel deployment | **`dpl_GTUEdGQgvr6MgJaQKnfWPnDhyb5y`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-740c6o3zh` · duration ~40s |
| 3 | Tests / build | **PASS** — `npm test` 238/238; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Support Fee adapter UI | **PASS** (agent browser, admin session) |
| 5 | XLSX template download | **PASS** (UI «Скачать шаблон» clicked; workbook verified via identical generator) |
| 6 | Staged read-only dry-run | **PASS** (synthetic XLSX → `classifySupportFeeOpeningRows` only; no confirm / no opening write RPC) |
| 7 | Financial invariants | **PASS** |
| 8 | Existing data unchanged | **YES** |
| 9 | Email / debt gates OFF | **YES** |
| 10 | Remaining limitations | Production UI file-upload dry-run not fully exercised (browser file injection limits); preview metadata batch not written; live opening inventarisation deferred |
| 11 | Ready for IS-5 Internet adapter | **YES** |

---

## Preflight (at publish)

| Check | Result |
|-------|--------|
| Branch `main` == `origin/main` before push | **PASS** (at `b4ef6a0`) |
| IS-4 change review | **PASS** — adapters, commit safety, AdminInitialSetup, i18n, D1 ledger kinds, migration file, tests, phase/audit/db_release docs |
| Local migration vs applied remote | **PASS** — remote has `import_support_fee_opening_state`; markers: historical settlement, no allocations, admin gate, `search_path=""`; dry-run up to date |
| Unrelated / secrets excluded | **PASS** — staged only IS-4 paths; excluded other `audit_exports/*`, `tmp/`, fixtures, unrelated doc edits |
| No other migrations applied | **PASS** — `db push --dry-run` up to date before/after |
| Finance D1–D7 compatibility | **PASS** — opening_* ledger kinds; D1 `remaining_due`; no synthetic payments |
| Opening RPC admin-only | **PASS** — DB `has_staff_role('администрация')` |
| Preview does not call write RPC | **PASS** — preview → classify + optional `admin_create_module_import_batch` (preview status); `import_support_fee_opening_state` only on confirm |
| Conflict / no overwrite | **PASS** — Q5 CONFLICT; UI copy + classifier |
| No auto import / activation on load | **PASS** — load only lists lifecycle |
| STOP conditions | none |

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 23 files, 238 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add Support Fee opening Initial Setup adapter (IS-4)
187c67c1158296bd2b4e4bf84fa1aefc726ac542
```

Staged paths (only):
- `src/lib/moduleCore/adapters/supportFeeOpening.ts`
- `src/lib/moduleCore/adapters/supportFeeOpeningAdapter.ts`
- `src/lib/moduleCore/adapters/supportFeeImportCommit.ts`
- `src/lib/moduleCore/bootstrap.ts`
- `src/lib/moduleCore/index.ts`
- `src/lib/supportFeeBalance.ts`
- `src/lib/database.types.ts`
- `src/components/admin/AdminInitialSetup.tsx`
- `src/i18n/messages.ts`
- `supabase/migrations/20261023120000_is4_support_fee_opening_state.sql`
- `tests/security/unit/moduleCoreIs4SupportFee.test.ts`
- `audit_exports/technical_completion/initial_setup/{phase_is_4_support_fee,is_4_db_release,is_4_support_fee_audit}.md`

### Push

```
b4ef6a0..187c67c  main -> main
```

### Vercel

| Field | Value |
|-------|-------|
| Deployment ID | `dpl_GTUEdGQgvr6MgJaQKnfWPnDhyb5y` |
| Status | **Ready** |
| Alias | https://amadeus11.online |
| URL | `uk-mkd-bg-8soe-740c6o3zh-aleksandrsydorov-rgbs-projects.vercel.app` |
| Migration reapply | **NO** |

---

## Production smoke (read-only)

| Check | Result | Evidence |
|-------|--------|----------|
| Admin session | **PASS** | agent browser on amadeus11.online |
| Initial Setup workspace | **PASS** | section `начальная_настройка` |
| Support Fee adapter under canonical module | **PASS** | row «Такса поддержки» / `support_fee`; card shows D1 SoT note |
| Template download control | **PASS** | «Скачать шаблон» clicked |
| Template structure | **PASS** | sheets `opening_balances`, `instructions_bg/ru/en`; required columns + BG instructions verified via generator |
| Existing SF / apartments visible | **PASS** | Overview debt **920,00 €**; props 22; SF module ACTIVE |
| Preview / validation controls | **PASS** | file input `accept=.xlsx,.xls`; confirm controls present but **not** clicked |
| Module activation | **not changed** | lifecycle fingerprint unchanged; Suspend/READY not used |

---

## Staged read-only dry-run (synthetic)

Synthetic workbook `tmp/is4_synthetic_dryrun.xlsx` (local only).  
Classifier: production-identical `classifySupportFeeOpeningRows` (same path as AdminInitialSetup preview).  
**No** `import_support_fee_opening_state`. **No** confirm import.

| Case | Result |
|------|--------|
| Fully paid historical year | **CREATE** (remaining 0) |
| Partially paid year | **CREATE** (remaining 150) |
| Outstanding debt | **CREATE** (remaining 480) |
| Opening overpayment | **CREATE** (over 25) |
| Duplicate apartment/year in file | **ERROR** `duplicate_in_file:apartment_year` |
| Existing obligation conflict | **CONFLICT** `conflict:existing_obligation` |
| Invalid arithmetic | **ERROR** `inconsistent:assessed_ne_paid_plus_remaining` |
| Unknown apartment | **ERROR** `unknown_apartment` |
| Synthetic payments flag | **false** (`no_synthetic_payments=true` on all rows) |

Counts: create 4 · conflict 1 · error rows 3 (+ conflict counted in errorCount aggregate).

---

## Data safety (pre → post smoke/dry-run)

| Metric | Pre | Post |
|--------|-----|------|
| properties | 22 | 22 |
| debt / over | 920.00 / 163.30 | 920.00 / 163.30 |
| remaining_due_active | 920.00 | 920.00 |
| assessments | 4 | 4 |
| ledger n / sum | 13 / 2204.50 | 13 / 2204.50 |
| allocations n / sum | 2 / 80.00 | 2 / 80.00 |
| payment ledger n | 4 | 4 |
| opening_imports | 0 | 0 |
| opening_* ledger | 0 | 0 |
| opening_import flag | 0 | 0 |
| registry people | 46 | 46 |
| building_modules fp | `e7aeb778…` | `e7aeb778…` |
| module_lifecycle fp | `23eb3c1b…` | `23eb3c1b…` |
| support_fee committed batches | 0 | 0 |
| email_core_is_ready | false | false |
| ordinary_debt_gate_enabled | false | false |

---

## Not done (by design)

- No opening import commit  
- No `import_support_fee_opening_state` business invocation  
- No synthetic payments / charges / credits  
- No module activation changes  
- No migration reapply  
- No Email Core / debt gate enable  

---

## Remaining limitations

1. Full browser-driven XLSX upload → on-page preview table was not completed (file injection tooling limit); dry-run used the identical client classifier against a synthetic workbook.  
2. Controlled production inventarisation (confirm path) remains a separate operator stage after staged dry-run approval.

**Ready for IS-5 Internet adapter: YES**
