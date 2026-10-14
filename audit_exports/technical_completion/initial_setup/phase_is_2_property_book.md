# ALSYD / AMADEUS 11 — Phase IS-2  
## Property Book Initial Data Adapter

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (local implementation only — **not committed / not pushed / not deployed**)  
**Supabase:** `klowacuvufknbrkayjhz` (**no new migration; no apply**)  
**Production:** https://amadeus11.online  
**Baseline release:** `df66dd5`  
**Standard:** Module Lifecycle & Initial Data Standard v1.2

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Adapter implemented | **YES** |
| 2 | Canonical Property Book reused | **YES** |
| 3 | XLSX template ready | **YES** |
| 4 | Validation and preview | **PASS** |
| 5 | Import approval and idempotency | **PASS** |
| 6 | Manual input integration | **PASS** |
| 7 | Existing data preservation | **PASS** |
| 8 | Migration required | **NO** |
| 9 | Tests/build results | **PASS** — `npm test` 206/206; `tsc --noEmit` PASS; `npm run build` PASS |
| 10 | Ready for release | **YES** (code complete; Safe Release / deploy not performed per safety) |

---

## What was implemented

### 1. Property Book opening adapter (IS-2)

- `src/lib/moduleCore/adapters/propertyBookOpeningAdapter.ts` — `ModuleSetupAdapter` for `property_book`
- Registered in `bootstrapModuleSetupAdapters()` alongside IS-1 adapters
- Out-of-catalog module key (same pattern as `example_opening_roster`)
- Setup: XLSX + manual; idempotent; gates: no overwrite, lawful transfers for corrections, Meeting Core reads Book SSOT

### 2. Canonical Book reuse (no duplicate tables)

- Opens via existing `admin_import_property_book` / `admin_list_property_book`
- Sheets/headers from `propertyBookAdmin` (`objects` / `owners`)
- Match key: `apartment_number` only — client `property_id` rejected
- Manual path: confirm that Book was filled via existing Admin Property Book UI (or verify existing read-only)

### 3. Classification / policy helpers

- `src/lib/moduleCore/adapters/propertyBookOpening.ts`
  - `classifyPropertyBookOpeningRows` → CREATE / UPDATE / SKIP / ERROR
  - Default policy: `allowOverwrite: false`, `allowCreateMissing: false`
  - Existing apartments → **SKIP** (preserves ownership, shares, ideal parts)
  - Missing apartments → **ERROR** until admin enables CREATE (empty/new install)
  - `previewFromPropertyBookDryRun` maps RPC dry-run payload to Core counters
  - Multi-sheet template + `instructions_bg` / `instructions_ru` / `instructions_en`
  - Downloadable error report XLSX

### 4. Admin Setup UI

- `AdminInitialSetup.tsx`:
  - Selectable out-of-catalog adapters (including `property_book`)
  - PB template download (multi-sheet + BG/RU/EN instructions)
  - Upload → local classify + **RPC dry_run** (no writes) → import batch preview
  - Explicit confirm before `admin_import_property_book` with `p_dry_run: false`, **`p_allow_overwrite: false`**
  - Commit batch via `admin_commit_module_import_batch`
  - Manual confirm / verified-existing checkboxes; i18n BG/RU/EN (`admin.is2*`)

### 5. Safety constraints observed

- No migrations applied
- No real imports executed in this phase
- No business data / module lifecycle state changes on production
- No commit / push / deploy
- Email Core and debt gate left OFF

---

## Critical data rules — compliance

| Rule | Status |
|------|--------|
| No duplicate apartment/owner tables | **PASS** |
| No overwrite of ownership / shares / ideal parts by default | **PASS** (`allow_overwrite=false`) |
| Lawful ownership transfers not replaced by generic import | **PASS** (UI + adapter gates) |
| Existing AMADEUS 11 data not modified by this delivery | **PASS** (no live import / no migrate) |
| Existing records detectable; read-only verification | **PASS** (SKIP + verified-existing) |
| Works for empty and populated installs | **PASS** (CREATE opt-in vs SKIP) |

---

## Security

- Administrator-only RPCs (`admin_assert_module_setup` / Book admin RPCs)
- Preview creates `module_import_batches` status=`preview` only
- No automatic activation / no UX toggle of `building_modules`
- Installation isolation via existing IS-1 `platform_installations`

---

## Tests covered (unit)

- Adapter registration + untrusted `property_id`
- Multi-owner + legal entity validation
- Ideal parts / share-sum soft checks in classifier
- Duplicate prevention
- Empty install CREATE vs populated SKIP
- Overwrite only when policy explicitly allows (IS-2 UI never enables)
- Template sheets + instruction locales
- Module UX helpers unchanged

---

## Migration

**Not required.** Reuses IS-1 tables/RPCs and existing Property Book RPCs.

---

## Ready for release

**YES** for Safe Release packaging (commit/push/deploy) when explicitly authorized.  
This phase **STOPs** after implementation + report per brief — no release actions performed.
