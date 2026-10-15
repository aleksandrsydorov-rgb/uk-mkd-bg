# AMADEUS 11 — Phase IS-5 · Safe Release  
## Internet Opening Data Adapter

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (migration already applied in DB release — **not reapplied**)  
**Production:** https://amadeus11.online  
**Previous tip:** `71a539e` (IS-4 docs)  
**This release:** `e1d17e29737485dbcbf83d21f14752d48fcea6d1`

**References:**
- `phase_is_5_internet.md`
- `is_5_db_release.md`
- `is_5_internet_audit.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`e1d17e2`** pushed `main` → `origin/main` (`71a539e..e1d17e2`) |
| 2 | Vercel deployment | **`dpl_EoMWgXC5aj9xA7bcrPfaxxJKAkXk`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-hgmhhqovi` · ~42s |
| 3 | Tests / build | **PASS** — `npm test` 250/250; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Internet adapter UI | **PASS** (agent browser, admin session) — module **Интернет** ACTIVE · setup needed · IS-5 card copy |
| 5 | XLSX download | **PASS** (UI «Скачать шаблон» clicked; workbook verified via identical generator) |
| 6 | Read-only preview | **PASS** (synthetic classify dry-run; no confirm / no opening write RPC) |
| 7 | Existing Internet / financial data unchanged | **YES** |
| 8 | Other modules smoke | **PASS** — Initial Setup list loads; Support Fee + Property Book rows selectable with template controls |
| 9 | Email / debt gates OFF | **YES** |
| 10 | Remaining limitations | Production UI file-upload→preview batch not fully exercised (browser file injection limits); live inventarisation deferred; apartments with existing sub/ledger need manual reconcile |
| 11 | Ready for next Initial Setup adapter | **YES** |

---

## Preflight (at publish)

| Check | Result |
|-------|--------|
| Branch `main` == `origin/main` before push | **PASS** (at `71a539e`) |
| IS-5 change review | **PASS** — adapters, commit safety, AdminInitialSetup, i18n, migration, tests, phase/audit/db_release docs |
| Local migration vs applied remote | **PASS** — remote has `import_internet_opening_state`; dry-run **up to date**; SHA256 local `F58F9986…0999A9` |
| Unrelated / secrets excluded | **PASS** — staged only IS-5 paths; excluded other `audit_exports/*`, `tmp/`, fixtures, unrelated doc edits |
| No other migrations applied | **PASS** — `db push --dry-run` up to date before/after |
| Canonical Internet / Tariff Core | **PASS** — `internet_subscriptions` + `internet_ledger` + `resolve_internet_tariff` |
| No `request_internet_connect` on opening | **PASS** |
| Pending WO blocks finalization | **PASS** (classifier + RPC) |
| No auto import / activation on load | **PASS** — load only lists lifecycle |
| Opening debt/credit not duplicating balances | **PASS** — unique property opening import; conflict on existing ledger |
| Preview read-only | **PASS** — write RPC only on confirm path |
| STOP conditions | none |

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 24 files, 250 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add Internet opening Initial Setup adapter (IS-5)
e1d17e29737485dbcbf83d21f14752d48fcea6d1
```

Staged paths (only):
- `src/lib/moduleCore/adapters/internetOpening.ts`
- `src/lib/moduleCore/adapters/internetOpeningAdapter.ts`
- `src/lib/moduleCore/adapters/internetImportCommit.ts`
- `src/lib/moduleCore/bootstrap.ts`
- `src/lib/moduleCore/index.ts`
- `src/lib/database.types.ts`
- `src/components/admin/AdminInitialSetup.tsx`
- `src/i18n/messages.ts`
- `supabase/migrations/20261024120000_is5_internet_opening_state.sql`
- `tests/security/unit/moduleCoreIs5Internet.test.ts`
- `audit_exports/technical_completion/initial_setup/{phase_is_5_internet,is_5_db_release,is_5_internet_audit}.md`

### Push

```
71a539e..e1d17e2  main -> main
```

### Vercel

| Field | Value |
|-------|-------|
| Deployment ID | `dpl_EoMWgXC5aj9xA7bcrPfaxxJKAkXk` |
| Status | **Ready** |
| Alias | https://amadeus11.online |
| Duration | ~42s |
| Migration reapplied | **NO** |

---

## Production UI smoke (authorized admin session)

| Step | Result |
|------|--------|
| Open Initial Setup | **PASS** (`section=начальная_настройка`) |
| Internet module visible | **PASS** — `Интернет · ACTIVE · setup нужен` |
| Select Internet card | **PASS** — SSOT note, no connect WO, IS-5 Q4/Q5 copy |
| Download template | **PASS** — «Скачать шаблон» |
| Template structure | **PASS** — sheets `subscriptions` + `instructions_bg/ru/en`; 10 headers; 3 examples |
| Preview controls accessible | **PASS** — file input present; confirm not used |
| Existing subscriptions recognized | **PASS** (policy copy + dry-run CONFLICT/SKIP paths) |
| Other modules | **PASS** — SF + Property Book rows open; template button present |

---

## Read-only dry-run (synthetic classify only)

Evidence: `tmp/is5_dryrun_preview.json` (local; not committed).

| Scenario | Result |
|----------|--------|
| Valid apt + published tariff + paid-through | **CREATE** · `next_charge_on=2026-11-01` · balance_effect debt−credit |
| Opening debt / credit | **PASS** (25 − 5 = 20) |
| Existing subscription | **CONFLICT** |
| Identical opening | **SKIP** |
| Unknown apartment | **ERROR** |
| Invalid tariff | **ERROR** (`unsupported:tariff_code`) |
| Pending Internet WO | **ERROR** (`blocked:pending_internet_work_order`) |
| Duplicate apartment in file | **ERROR** |
| Invalid amount | **ERROR** |
| Confirm / opening RPC / connect / cron / WO | **not invoked** |

---

## Data-safety postcheck (pre == post)

| Metric | Value |
|--------|-------|
| internet_subscriptions | 1 (inactive) |
| next_charge fingerprint | `d970e5e8087c5f09bcd12e8110c10f01` |
| internet_ledger | 1 charge / 15.00 |
| opening_* ledger / opening_imports | 0 / 0 |
| internet WO all / pending | 2 / 0 |
| SF remaining_due active | 920.00 |
| SF ledger n | 13 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) |
| building_modules fp | `e7aeb778f1bbe55ae4692e514b679403` |
| email_core_is_ready | false |
| ordinary_debt_gate_enabled | false |

---

## Safety observed

- No inventarisation commit  
- No `import_internet_opening_state` business calls  
- No subscription / ledger / next_charge mutations  
- No billing cron  
- No work-order create/close  
- No tariff publish  
- No module activation changes  
- No migration reapply  
- No Email Core / debt gate enablement  

---

## Remaining limitations

1. Live opening inventarisation is a separately authorized phase.  
2. Production browser file-upload→preview batch path not fully exercised end-to-end.  
3. Existing Internet subscription/ledger apartments require manual reconciliation before inventarisation.

---

## STOP

IS-5 Safe Release complete.  
Next Initial Setup adapter may proceed when authorized.
