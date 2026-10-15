# AMADEUS 11 — Phase IS-8 · Safe Release  
## Capital Repair Initial Data Adapter

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (opening migration already applied in DB release — **not reapplied**)  
**Production:** https://amadeus11.online  
**Previous tip:** `15a7184` (IS-7a docs)  
**This release:** `e13c91f1e5bb50373fef45e98dbbc73515b99ae3`

**References:**
- `phase_is_8_capital_repair.md`
- `is_8_db_release.md`
- `is_8_capital_repair_audit.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`e13c91f`** pushed `main` → `origin/main` (`15a7184..e13c91f`) |
| 2 | Vercel deployment | **`dpl_FhSCBzYGnkTiD7KncUvHVquJ32DU`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-4y1h0onwk` · build ~54s |
| 3 | Tests / build | **PASS** — `npm test` **288/288**; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Capital Repair adapter in Initial Setup | **BLOCKED** — no authorized admin session (production redirected `/admin` → public login) |
| 5 | XLSX template (workbook structure) | **PASS** — local generator: sheets `opening_balances` + `instructions_bg/ru/en`; schema `1.0`; 11 columns; 4 example rows |
| 6 | Upload/validation/preview controls | **BLOCKED** (browser admin UI); deterministic classify **PASS** (synthetic preview below) |
| 7 | Existing Capital assessments unmodified | **YES** — DB fingerprints identical pre/post (4 assessments / 7 ledger) |
| 8 | Property Book / SF / Internet / Finance pages | **PARTIAL** — public homepage **PASS**; authenticated admin pages **BLOCKED** (no session) |
| 9 | Data / gates unchanged | **YES** — opening imports 0; opening kinds 0; email OFF; debt OFF |
| 10 | Fresh-install Capital packaging | **PARTIAL** — gaps remain documented; package **not executed** |
| 11 | Migration not reapplied | **YES** — dry-run **up to date** after release |
| 12 | Ready for next Initial Setup phase | **YES** |

---

## Preflight (at publish)

| Check | Result |
|-------|--------|
| Branch `main` == `origin/main` before push | **PASS** (at `15a7184`) |
| IS-8 change review | **PASS** — adapters, AdminInitialSetup, OwnerUtilities, i18n, types, migration, fresh-install gap docs, tests, phase/db docs |
| Local migration vs applied remote | **PASS** — remote has `20261027120000`; dry-run **up to date** |
| Unrelated / secrets excluded | **PASS** — staged only IS-8 paths; excluded other `audit_exports/*`, `tmp/`, unrelated doc edits |
| Reuses `capital_repair_*` canonical tables | **PASS** |
| Opening requires `assessment_id` | **PASS** |
| Credits/debts reconcile with capital balance consumers | **PASS** (migration + unit tests) |
| Preview does not invoke opening write RPC | **PASS** — confirm button gated; classify sets `no_synthetic_payments` / `no_operational_charges` |
| No overwrite of existing assessments/ledger | **PASS** — CONFLICT on charge/opening; shell create only if missing |
| Admin-only authorization | **PASS** |
| No automatic module activation | **PASS** |
| No operational payment/charge RPCs in opening path | **PASS** |
| STOP conditions | none |

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 27 files, 288 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add Capital Repair Initial Setup opening adapter (IS-8)
e13c91f1e5bb50373fef45e98dbbc73515b99ae3
```

Staged paths (only):
- `src/components/admin/AdminInitialSetup.tsx`
- `src/components/account/OwnerUtilities.tsx`
- `src/i18n/messages.ts`
- `src/lib/database.types.ts`
- `src/lib/moduleCore/bootstrap.ts`
- `src/lib/moduleCore/index.ts`
- `src/lib/moduleCore/freshInstallMeterSchema.ts`
- `src/lib/moduleCore/adapters/capitalRepairOpening.ts`
- `src/lib/moduleCore/adapters/capitalRepairOpeningAdapter.ts`
- `src/lib/moduleCore/adapters/capitalRepairImportCommit.ts`
- `supabase/migrations/20261027120000_is8_capital_repair_opening_state.sql`
- `supabase/packages/fresh_install/MANIFEST.json`
- `supabase/packages/fresh_install/README.md`
- `tests/security/unit/moduleCoreIs8CapitalRepair.test.ts`
- `audit_exports/technical_completion/initial_setup/is_8_capital_repair_audit.md`
- `audit_exports/technical_completion/initial_setup/is_8_db_release.md`
- `audit_exports/technical_completion/initial_setup/phase_is_8_capital_repair.md`

### Push / deploy

```
15a7184..e13c91f  HEAD -> main
Vercel: dpl_FhSCBzYGnkTiD7KncUvHVquJ32DU Ready → https://amadeus11.online
```

Migration **not** reapplied (`db push --dry-run` → Remote database is up to date).

---

## Production UI smoke

| Check | Result |
|-------|--------|
| Open https://amadeus11.online | **PASS** — homepage loads |
| Admin session / Initial Setup | **BLOCKED** — no authorized administrator session; `/admin` redirects to public login |
| Capital Repair adapter visible | **BLOCKED** |
| Download XLSX via UI | **BLOCKED** |
| Workbook inspection (local generator = same template UI uses) | **PASS** — see §Template |
| Upload/preview controls in UI | **BLOCKED** |
| Existing Capital assessments recognized without modification | **PASS** (DB read-only) |
| Authenticated SF/Internet/Finance/Budget pages | **BLOCKED** (no session) |

**Do not claim live browser Initial Setup E2E PASS.**

---

## Template (local, identical builder as UI download)

| Item | Value |
|------|-------|
| schema_version | `1.0` |
| Sheets | `opening_balances`, `instructions_bg`, `instructions_ru`, `instructions_en` |
| Columns | apartment_number, billing_year, obligation_type, assessment_title, assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment, transition_date, source_reference, notes |
| Example rows | 4 |

---

## Read-only synthetic preview (deterministic; no write RPC)

Synthetic classify (local, no DB writes):

| Scenario | Class | Notes |
|----------|-------|-------|
| Fully paid | CREATE | balance effect 0 |
| Partially paid | CREATE | balance effect 50 |
| Opening debt | CREATE | balance effect 120 |
| Opening credit | CREATE | balance effect −15 |
| Missing assessment (shell) | CREATE | `assessment_will_create=true` |
| Wrong apartment | ERROR | `unknown_apartment` |
| Existing operational charge | CONFLICT | `conflict:existing_operational_charge` |
| Invalid arithmetic | ERROR | `inconsistent:assessed_ne_paid_plus_remaining` |
| Future transition date | ERROR | `invalid:transition_date_future` |

Flags: `no_synthetic_payments=true`, `no_operational_charges=true` on all rows.  
**Import batch not confirmed.** Opening write RPC not invoked.

Unit regression (`moduleCoreIs8CapitalRepair.test.ts`) additionally covers skip/idempotency/unauthorized/concurrency.

---

## Data safety (read-only before/after)

| Metric | Pre | Post |
|--------|-----|------|
| capital assessments n / ids fp | 4 / `96c20e8a…` | **identical** |
| capital ledger n / ids fp / net | 7 / `9b8740d8…` / 1430 | **identical** |
| opening kinds / opening_imports rows | 0 / 0 | **0 / 0** |
| SF ledger / remaining_due | 13 / 920 | **identical** |
| Internet subs / ledger | 1 / 1 (sum 15) | **identical** |
| Book people / extracts | 46 / 4 | **identical** |
| module_lifecycle | ACTIVE 19 / DISABLED 8 | **identical** |
| building_modules fp | `58a3f7b1…` | **identical** |
| email_core_is_ready | false | false |
| ordinary_debt_gate_enabled | false | false |

---

## Fresh-install limitation

Capital Repair DDL/RPC packaging remains **PARTIAL** (`capital_repair_*` gaps in MANIFEST/README).  
`supabase/packages/fresh_install` was **not** executed. No new Supabase project.

---

## Not done (by design)

- No opening inventarisation / financial import  
- No synthetic payments or operational charges  
- No module activation  
- No migration reapply  
- No Email Core / debt gate enable  

---

## Remaining blockers

1. Authorized admin browser smoke of Initial Setup Capital Repair UI (session required).  
2. Staged dry-run inventarisation before any real opening import.  
3. Fresh-install Capital baseline packaging still PARTIAL.

**Ready for next Initial Setup phase: YES** (app + DB published; live opening import not performed).
