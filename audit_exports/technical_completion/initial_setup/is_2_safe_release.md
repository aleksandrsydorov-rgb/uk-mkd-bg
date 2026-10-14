# AMADEUS 11 — Phase IS-2 · Safe Release  
## Property Book Initial Data Adapter

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (**no migration applied / reapplied**)  
**Production:** https://amadeus11.online  
**Previous release:** `df66dd5`  
**This release:** `a7b96c39d0cfbe0b1ee3c137d46bfcfe143d618e`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`a7b96c3`** pushed `main` → `origin/main` (`df66dd5..a7b96c3`) |
| 2 | Vercel deployment | **`dpl_DHfn6hmAGSJcvXYYX7c4nBjrb9aC`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-1h9gcvufd` · duration ~40s |
| 3 | Tests / build | **PASS** — `npm test` 206/206; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Property Book adapter visibility | **PASS** (admin session `admin@example.com`) |
| 5 | XLSX template download | **PASS** (normal UI «Изтегли шаблон»; sheets verified `objects,owners,instructions_bg,instructions_ru,instructions_en`) |
| 6 | Existing-data preservation | **PASS** (no import; Book still lists existing apartments; IS-2 `allow_overwrite=false` UI + server default) |
| 7 | Other modules smoke | **PASS** (Overview/Settings/Book/Transfers load under admin session) |
| 8 | Email / debt gates OFF | **YES** |
| 9 | Ready for IS-3 meters adapter | **YES** |

---

## Preflight

| Check | Result |
|-------|--------|
| Branch / `origin/main` | **PASS** — `main` at `df66dd5` matching `origin/main` before release |
| IS-2 change review only | **PASS** — adapter, AdminInitialSetup PB path, i18n, propertyBookAdmin buffer parse, tests, phase doc |
| SQL migration required | **NO** — reuses IS-1 Module Core RPCs + existing `admin_import_property_book` |
| Canonical Book structures | **PASS** — `objects`/`owners` via `propertyBookAdmin` + `admin_import_property_book` / `admin_list_property_book` |
| Silent overwrite impossible by default | **PASS** — classifier SKIP; UI hardcodes `p_allow_overwrite: false`; SQL `p_allow_overwrite boolean default false` and blocks apply with `overwrite_requires_confirmation` when false |
| Preview writes business data | **NO** — preview uses `p_dry_run: true` + `module_import_batches` status=`preview` only |
| Auth / isolation | **PASS** — admin Setup RPCs + Book `admin_assert_book_admin`; installation via `platform_installations` |
| Unrelated / secrets staged | **PASS** — staged only IS-2 paths; excluded `tmp/`, other audits, fixtures, `.env` |

### Server-side overwrite enforcement (evidence)

`supabase/migrations/20261010120100_property_book_pb1_invites_import_transfer.sql`:

- `p_allow_overwrite boolean default false`
- On existing properties with differences, when `not p_allow_overwrite` and `not p_dry_run` → error `overwrite_requires_confirmation`

IS-2 Admin Setup never exposes an overwrite toggle; commit path always passes `p_allow_overwrite: false`.

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 20 files, 206 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add Property Book Initial Setup adapter (IS-2)
a7b96c39d0cfbe0b1ee3c137d46bfcfe143d618e
```

Files (9):

- `src/lib/moduleCore/adapters/propertyBookOpening.ts`
- `src/lib/moduleCore/adapters/propertyBookOpeningAdapter.ts`
- `src/lib/moduleCore/bootstrap.ts`
- `src/lib/moduleCore/index.ts`
- `src/lib/propertyBookAdmin.ts`
- `src/components/admin/AdminInitialSetup.tsx`
- `src/i18n/messages.ts`
- `tests/security/unit/moduleCoreIs2PropertyBook.test.ts`
- `audit_exports/technical_completion/initial_setup/phase_is_2_property_book.md`

### Push / deploy

| Field | Value |
|-------|--------|
| Push | `df66dd5..a7b96c3` → `origin/main` |
| Deployment ID | `dpl_DHfn6hmAGSJcvXYYX7c4nBjrb9aC` |
| Status | **Ready** |
| Aliases | https://amadeus11.online |
| Migration reapplied | **NO** |
| Real import performed | **NO** |
| Module states changed | **NO** |

---

## Post-deploy smoke (admin session)

**Session:** existing administrator browser (`admin@example.com`) — no logout, no password/token capture  
**Constraints:** no imports, no lifecycle transitions, no overwrite, no Email/debt toggles

| Check | Result | Source |
|-------|--------|--------|
| Initial Setup loads | **PASS** | agent |
| `property_book` listed (extras + selectable row «Книга на етажната собственост») | **PASS** | agent |
| Detail: manual confirm + verified-existing + XLSX UI | **PASS** | agent |
| Download template via «Изтегли шаблон» | **PASS** | agent (UI click) |
| Template sheets objects/owners + instructions_bg/ru/en | **PASS** | agent (HEAD generator + prod bundle markers `instructions_bg` / `property_book`) |
| Preview UI accessible without commit | **PASS** | agent (file input + dry-run policy text; no file upload / no import executed) |
| Existing Book records recognized | **PASS** | agent — Property Book table shows populated apartments (sample 1–10…; ~22 rows listed) |
| No new apartments/owners from this release action | **PASS** | agent — no import/commit invoked |
| Ownership / ideal parts unchanged by release | **PASS** | agent — no write path exercised; server overwrite default false |
| Other modules load | **PASS** | agent — Overview, Settings, Book, Ownership transfers |
| Email sending OFF | **YES** | agent — Settings: pause, `email_enabled=false` |
| Debt gate OFF | **YES** | agent — Transfers banner: ordinary overdue-debt check temporarily disabled |

---

## Safety confirmation

- No migrations applied
- No real Property Book import
- No module lifecycle activation/suspend from this release smoke
- Email Core sending left OFF
- Debt gate left OFF
- Unrelated working-tree files not committed

---

## Ready for IS-3

**YES** — Property Book opening adapter is live on production; next phase may add meters adapter against the same Initial Setup Core without changing Book SSOT rules.
