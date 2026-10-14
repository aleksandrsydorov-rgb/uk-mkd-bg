# AMADEUS 11 — Phase IS-3 · Safe Release  
## Water & Electricity Initial Setup Adapters

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (**no migration applied**)  
**Production:** https://amadeus11.online  
**Previous tip:** `7a4e4e4` (IS-2 docs)  
**This release:** `fced28ff4adfa88d011795a1ff851765d55687a0`

**References:**
- `phase_is_3_meters.md`
- `is_3_import_safety.md`
- `is_3_migration_packaging_proposal.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`fced28f`** pushed `main` → `origin/main` (`7a4e4e4..fced28f`) |
| 2 | Vercel deployment | **`dpl_8tMtK1bnPoYXV62bdyZVjZiWWo1U`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-p2eev1x19` |
| 3 | Tests / build | **PASS** — `npm test` 227/227; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Water adapter UI | **PASS** (agent browser, admin session) |
| 5 | Electricity adapter UI | **PASS** (agent browser, admin session) |
| 6 | Both XLSX downloads | **PASS** (UI download + local file inspect) |
| 7 | Existing meter / finance data unchanged | **YES** (no import/assign/submit executed) |
| 8 | Other modules smoke | **PASS** (Book, Support Fee, Meetings, Water ops, Electricity ops, Overview, Settings) |
| 9 | Email / debt gates OFF | **YES** |
| 10 | Remaining limitations | Opening reading **rows** still BLOCKED; fresh-install DDL packaging still deferred; commit is non-atomic per-row |
| 11 | Ready for IS-4 Support Fee adapter | **YES** |

---

## Preflight (at publish)

| Check | Result |
|-------|--------|
| Branch `main` == `origin/main` before push | **PASS** (at `7a4e4e4`) |
| IS-3 change review vs reference reports | **PASS** — adapters, `metersImportCommit`, AdminInitialSetup, i18n, tests, phase/safety/DDL docs |
| Unrelated / secrets excluded | **PASS** — staged only IS-3 paths; excluded other `audit_exports/*`, `tmp/`, fixtures, unrelated doc edits |
| Adapter migration required | **NO** |
| Canonical `water_meters` / `electricity_meters` reused | **PASS** — `assign_*` only |
| Property Book apartment identity | **PASS** — `apartment_number` → Book; `property_id` forbidden in templates |
| Existing meters SKIP / no overwrite | **PASS** — UI + instructions + `allow_replace=false` |
| Opening baselines via `initial_*` only | **PASS** |
| `submit_*` never called by adapter | **PASS** (code + UI copy) |
| Per-row outcomes | **PASS** — CREATED / SKIPPED_EXISTING / FAILED / NOT_PROCESSED |
| Retry reconciles DB | **PASS** (import-safety tests + UI retry path) |
| Partial success ≠ full success | **PASS** — `fullySuccessful` gate |
| Admin auth / isolation | **PASS** — Initial Setup admin role; assign_* SECURITY DEFINER |
| Module states / email / debt untouched | **PASS** |

**STOP conditions:** none triggered.

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 22 files, 227 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add Water and Electricity Initial Setup adapters (IS-3)
fced28ff4adfa88d011795a1ff851765d55687a0
```

Staged paths (only):
- `src/lib/moduleCore/adapters/{water,electricity}OpeningAdapter.ts`
- `src/lib/moduleCore/adapters/metersOpening.ts`
- `src/lib/moduleCore/adapters/metersImportCommit.ts`
- `src/lib/moduleCore/{bootstrap,index}.ts`
- `src/components/admin/AdminInitialSetup.tsx`
- `src/i18n/messages.ts`
- `tests/security/unit/moduleCoreIs3{Meters,ImportSafety}.test.ts`
- `audit_exports/technical_completion/initial_setup/{phase_is_3_meters,is_3_import_safety,is_3_meters_adapter_audit,is_3_migration_packaging_proposal}.md`

### Push / deploy

| Field | Value |
|-------|--------|
| Push | `7a4e4e4..fced28f` → `origin/main` |
| Deployment ID | `dpl_8tMtK1bnPoYXV62bdyZVjZiWWo1U` |
| Status | **Ready** |
| Aliases | https://amadeus11.online |
| Migration applied | **NO** |
| Real import | **NO** |
| Module activation changes | **NO** |

---

## Post-deploy smoke (admin session)

**Session:** existing administrator browser on https://amadeus11.online — no logout, no credential capture.  
**Constraints:** no imports, no meter create/replace, no readings, no charges, no lifecycle toggles, no Email/debt toggles.

| Check | Result | Evidence |
|-------|--------|----------|
| Initial Setup loads | **PASS** | heading «Начална настройка» |
| Water adapter displayed | **PASS** | row `Вода · ACTIVE · нужен`; detail `water · ACTIVE`; SKIP / BLOCKED / assign_* copy |
| Electricity adapter displayed | **PASS** | row `Електроенергия · ACTIVE · нужен`; detail `electricity · ACTIVE` |
| Water XLSX download | **PASS** | UI «Изтегли шаблон» → `Downloads/water_meters_opening_template.xlsx` (21 753 B, 22:13) |
| Water template structure | **PASS** | sheets `meters`, `instructions_bg/ru/en`; cols `apartment_number,meter_number,initial_reading,installed_at`; examples; FORBIDDEN submit_* |
| Electricity XLSX download | **PASS** | UI → `Downloads/electricity_meters_opening_template.xlsx` (21 960 B, 22:17) |
| Electricity template structure | **PASS** | sheets + cols `initial_day_reading,initial_night_reading`; BG/RU/EN; SKIP / BLOCKED |
| Existing meters recognized (no modify) | **PASS** | UI: «Съществуващите уреди… без замяна»; no import run |
| Preview controls without import | **PASS** | file input present; preview policy text; no upload/commit |
| Property Book loads | **PASS** | «Книга на етажната собственост» |
| Finance-adjacent (Support Fee) loads | **PASS** | «Такса поддръжка» with existing 920,00 € overview figures unchanged by release actions |
| Water / Electricity ops pages load | **PASS** | admin `Вода` / `Електроенергия` |
| Meetings load | **PASS** | «Събрания» |
| Overview / Settings load | **PASS** | Obзор; Настройки |
| Guest Mode module state | **PASS** (list) | Initial Setup: «Гостов достъп · ACTIVE» (no state change) |
| No meter/reading/charge writes | **YES** | no assign/submit/import invoked |
| Email sending OFF | **YES** | Settings: «На пауза (изпращането е изключено)»; `email_enabled=false` |
| Debt gate OFF | **YES** | Transfers: ordinary overdue-debt check temporarily disabled |

---

## Safety confirmation

- No migrations applied  
- No real meter import  
- No module lifecycle / UX activation changes from this release  
- Email Core sending left OFF  
- Debt gate left OFF  
- Unrelated working-tree files not committed  

---

## Remaining limitations

1. **Opening reading rows** — still BLOCKED (charge-free API absent). Baselines remain `initial_*` via `assign_*` only.  
2. **Fresh-install DDL packaging** — documented in `is_3_migration_packaging_proposal.md`; not executed.  
3. **Bulk assign is non-atomic** — per-row outcomes + reconcile/retry (see `is_3_import_safety.md`).

---

## Ready for IS-4

**YES** — Water/Electricity opening adapters are live on production with import-safety outcomes; Support Fee opening adapter can proceed against Initial Setup Core without changing meter SSOT or charge paths.

**STOP.**
