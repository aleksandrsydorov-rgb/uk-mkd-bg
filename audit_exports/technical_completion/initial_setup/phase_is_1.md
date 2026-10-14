# ALSYD / AMADEUS 11 — Phase IS-1  
## Universal Module Core & Initial Setup Core (Lifecycle Standard v1.2)

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (local implementation only)  
**Supabase:** `klowacuvufknbrkayjhz` (**migration NOT applied**)  
**Production:** https://amadeus11.online  
**Baseline release:** `9571ee5`

---

## Scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Universal Module Core implemented | **YES** |
| 2 | Lifecycle Standard v1.2 implemented | **YES** |
| 3 | Initial Setup Core implemented | **YES** |
| 4 | Module registration contract implemented | **YES** |
| 5 | XLSX import foundation implemented | **YES** |
| 6 | Admin Setup workspace implemented | **YES** |
| 7 | Existing module compatibility | **PASS** |
| 8 | SQL migration filename | `20261022120000_initial_setup_module_core.sql` |
| 9 | Tests/build | **PASS** — `npm test` 194/194; `tsc` PASS; `build` PASS |
| 10 | Existing business data unchanged | **YES** (no DB apply; no DML against business tables in code paths) |
| 11 | Remaining domain-specific adapters | See below |
| 12 | Ready for DB release | **YES** |

---

## What was implemented

### 1. Module registration contract (extensible)

- `src/lib/moduleCore/types.ts` — `ModuleRegistration`, setup contract, XLSX schema, adapter interface.
- `src/lib/moduleCore/registry.ts` — `registerModuleAdapter` / discovery APIs.
- Lifecycle engine **does not** hardcode a fixed list of 12/35 modules; it discovers registered adapters.
- Existing UX catalog remains `src/lib/modules.ts` + DB `module_catalog` / `building_modules` (unchanged source of truth for product toggles).

### 2. Lifecycle Standard v1.2

States: `DISABLED` → `SETUP_REQUIRED` → `SETUP_IN_PROGRESS` → `READY` → `ACTIVE` ⇄ `SUSPENDED`.

- Validated in TS (`lifecycle.ts`) and SQL (`module_lifecycle_transition_allowed`).
- Per-installation via `platform_installations` + `module_lifecycle` (seeded `default` install).
- Audited transitions: `module_lifecycle_audit`.
- Admin-only RPCs: `admin_list_module_lifecycle`, `admin_transition_module_lifecycle`.
- **Does not** update `building_modules.enabled` (explicit comment + tests).

### 3. Initial Setup Core

- Resumable drafts: `module_setup_progress` + `admin_save/get_module_setup_progress`.
- Opening-data metadata table: `module_opening_data_meta` (effective date, source, batch, approvers).
- Modules without setup may go `DISABLED` → `READY`.
- No universal writes into business tables.

### 4. XLSX foundation (shared engine)

- `src/lib/moduleCore/xlsxEngine.ts`: template build/download, safe parse (`cellFormula: false`), upload limits, preview, duplicate detection, formula-injection sanitization, error workbook builder.
- Import batch audit: `module_import_batches` + `admin_create_module_import_batch` / `admin_commit_module_import_batch`.
- Domain commit left to future adapters (UI states preview-only).

### 5. Admin Setup workspace

- Section `начальная_настройка` (admin-only).
- Component `AdminInitialSetup.tsx`: module list, lifecycle actions, manual draft save, XLSX preview.
- i18n: BG / RU / EN (`admin.is1*`).

### 6. Bootstrap adapters (examples, not full domain importers)

| Adapter | Setup |
|---------|--------|
| `example_opening_roster` | XLSX + manual (demo; rejects untrusted `property_id`) |
| `guest_mode`, `chat`, `requests`, `announcements` | No initial data required |
| `building_documents` | Setup required (manual confirm stub) |

---

## Compatibility (PASS)

| Area | Status |
|------|--------|
| `building_modules` / Settings toggles | Untouched |
| Guest Mode / Property Book / PKG-XFER / Finance / Meeting / Email / Owner cabinet | No code path changes to their domain logic |
| Existing gates (`email_core_is_ready`, debt gate) | Not enabled / not modified |
| Production module states | Not activated/suspended/disabled via this phase (migration not applied; transition RPC never auto-runs) |

AMADEUS 11 is not hardcoded (no apt numbers / amounts / domains in Core).

---

## Security

- Tables: RLS on; `REVOKE ALL` from `public`/`anon`/`authenticated`.
- RPCs: `SECURITY DEFINER`, `search_path = ''`, `admin_assert_module_setup` → `has_staff_role('администрация')`.
- Upload treated as untrusted; no formula evaluation; no trust of client `property_id`.

---

## Remaining domain-specific adapters (out of IS-1)

1. Property Book opening import adapter (reuse `propertyBookAdmin` patterns; canonical owners/apts).
2. Finance opening-balance adapter (D1–D7 reconciliation; no fake payments).
3. Meeting / meters / tariffs / utilities opening adapters as needed.
4. Wire `ACTIVE` lifecycle → optional future sync with `set_building_module_enabled` (product decision; not IS-1).
5. ALSYD Control multi-installation provisioning (schema ready via `platform_installations`).

---

## Validation

```
npm test          → 194 passed (14 new IS-1)
npx tsc --noEmit  → PASS
npm run build     → PASS
```

---

## STOP

Local implementation + tests + report complete.  
**Do not apply migration / commit / push / deploy in this phase.**
