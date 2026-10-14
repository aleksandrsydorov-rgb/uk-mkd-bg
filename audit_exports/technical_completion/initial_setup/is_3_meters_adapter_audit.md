# AMADEUS 11 — Phase IS-3  
## Meters Adapter — Technical Audit (READ-ONLY)

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** `origin/main` (baseline after IS-2: `a7b96c3` / docs `7a4e4e4`)  
**Production:** https://amadeus11.online  
**Supabase project (current):** `klowacuvufknbrkayjhz`  
**Mode:** READ-ONLY — no implementation, no migrations, no data changes, no commit/push/deploy  
**IS-2 report:** `audit_exports/technical_completion/initial_setup/is_2_safe_release.md`

**Evidence labels used below:**

- **VERIFIED** — confirmed in repository files inspected in this audit  
- **ASSUMPTION** — reasonable inference; not proven from a single authoritative source  
- **MISSING EVIDENCE** — not found in `supabase/migrations/` or application code under the searched paths  

---

## 1. Executive Summary

Meters in AMADEUS 11 are **not a single “meters” table**. They are split by utility:

| Utility | Device table | Operational readings | Assign / replace RPCs |
|---------|--------------|----------------------|------------------------|
| Water | `water_meters` | `water_readings` (+ `water_ledger`) | `assign_water_meter`, `replace_water_meter` |
| Electricity | `electricity_meters` | `meter_readings` (day/night) (+ `electricity_charges` / `electricity_ledger`) | `assign_electricity_meter`, `replace_electricity_meter` |

**Link to objects:** both device tables use stable **`properties.id` (`property_id`)** with `ON DELETE RESTRICT`. Property Book / IS-2 match objects by **`apartment_number`** and resolve to `property_id` — compatible if IS-3 resolves the same way and never trusts client-supplied `property_id`.

**IS-3 feasibility on the current product:** orchestration via Initial Setup + reuse of existing `assign_*` RPCs + IS-1/IS-2 XLSX preview/batch patterns is **architecturally viable**.

**Overall audit status: PARTIAL**

| Area | Status |
|------|--------|
| Existing domain model (water + electricity) | Clear (**VERIFIED**) |
| Property Book compatibility | Compatible via `apartment_number` → `property_id` (**VERIFIED** pattern) |
| XLSX import feasibility | Feasible as adapter orchestration (**VERIFIED** reuse paths; no meters XLSX today) |
| Fresh empty Supabase from `supabase/migrations/` alone | **Risk / incomplete** — meter **DDL** not found in migrations (**VERIFIED gap**) |
| Common-area / multi-active meters / hot water / gas / heat | **Not supported** by current domain model (**VERIFIED** constraints / absence) |
| Unit tests for meter assign/import | **Missing** in `tests/` (**VERIFIED**) |

---

## 2. Existing Meters Architecture

### 2.1 Conceptual model (**VERIFIED**)

1. **Property (object)** exists in `properties`.  
2. Staff assign at most **one active** physical meter per utility per property (`retired_at IS NULL`).  
3. Initial register values are stored on the meter row (`initial_reading` / day+night).  
4. Subsequent readings create charges via submit RPCs and ledgers.  
5. Replacement **retires** the old meter and inserts a new row (history retained).

### 2.2 UI / routes (**VERIFIED**)

| Surface | Location | Role |
|---------|----------|------|
| Admin meters / electricity | `src/app/admin/page.tsx` — section key `счётчики`; tabs `meter` / `readings` / finance | Assign/replace electricity, submit readings, list `meter_readings` / `electricity_meters` |
| Admin water | `src/components/admin/AdminWater.tsx` (mounted from `admin/page.tsx`) | Assign/replace water meters, readings, balance |
| Admin electricity finance | `src/components/admin/AdminElectricityFinance.tsx` | Payments / balance (not device inventarisation) |
| Owner utilities | `src/components/account/OwnerUtilities.tsx`, `OwnerElectricity.tsx` | Owner submit readings when mode allows |
| Owner account meters history | `src/app/account/page.tsx` | Loads `meter_readings` by `meter_type` |
| Finance KPI chip | `src/components/account/MeterFinanceStatus.tsx` | Balance display only |
| Module toggles | `src/lib/modules.ts` — keys `water`, `electricity` | UX enablement (not security boundary) |

Domain helpers:

- `src/lib/utilities.ts` — water types, volume formatting, role gates (`canAssignWaterMeter`, `canSeeWaterAdmin`)  
- `src/lib/electricity.ts` — electricity meter/pair/submit types, pairing day/night readings  

### 2.3 Server operations (**VERIFIED** in `src/lib/database.types.ts`)

| RPC | Purpose |
|-----|---------|
| `assign_water_meter(p_property_id, p_meter_number, p_initial_reading, p_installed_at)` | Create active water meter |
| `replace_water_meter(...)` | Retire + create water meter |
| `submit_water_reading(...)` | Owner/staff reading → charge path |
| `get_water_balance` / `record_water_payment` / `set_water_tariff` | Finance |
| `assign_electricity_meter(p_property_id, p_meter_number, p_initial_day_reading, p_initial_night_reading, p_installed_at)` | Create active electricity meter |
| `replace_electricity_meter(...)` | Retire + create electricity meter |
| `submit_electricity_reading(...)` | Day+night reading submit |
| `get_electricity_balance` / `record_electricity_payment` / `set_electricity_tariff` | Finance |
| `set_utility_information_mode` | `water_mode` / `electricity_mode` on building settings |

Authoritative assign SQL (roles **администрация** | **инженер**):

- Water: `supabase/migrations/20260925010000_water_role_exact_match_hardening.sql` (`assign_water_meter`, `replace_water_meter`)  
- Electricity: `supabase/legacy/DO_NOT_RUN/electricity_meter_hotfix.sql` (source of `assign_electricity_meter`; also reflected in live types)  
- Tariff/submit cutover references meters: `supabase/migrations/20260926050000_tariff_core_package2_cutover.sql`, `20260926050100_tariff_core_package2_integrity_fix.sql`

### 2.4 Dual reading stores (**VERIFIED** inconsistency)

| Store | Used for |
|-------|----------|
| `water_readings` | Canonical water operational readings + charge snapshots |
| `meter_readings` | Electricity day/night (`meter_type` `electricity_day` / `electricity_night`); also UI types still include legacy `cold_water` |

**Implication for IS-3:** opening import should create **device rows** via `assign_*`, not invent a third meter catalog. Do **not** treat `meter_readings.cold_water` as the water device SSOT.

---

## 3. Database Schema and Relationships

### 3.1 `water_meters` (**VERIFIED** — types + legacy schema)

Sources:

- Shape: `src/lib/database.types.ts` → `Tables.water_meters`  
- DDL (legacy, marked DO_NOT_RUN): `supabase/legacy/DO_NOT_RUN/water_capital_schema.sql`

| Column | Notes |
|--------|-------|
| `id` uuid PK | Device identity |
| `property_id` bigint NOT NULL → `properties(id)` ON DELETE RESTRICT | Object link |
| `meter_number` text UNIQUE | Serial / inventory number |
| `initial_reading` numeric ≥ 0 | Opening register |
| `installed_at` date | Installation date (defaults to today in DDL) |
| `retired_at` | NULL = active |
| `replacement_reason` | On replace |
| `assigned_by_email` | Actor |
| `created_at` | Audit |

Constraints (**VERIFIED** in legacy schema):

- Unique `meter_number` globally  
- Partial unique index: **one active meter per `property_id`** (`retired_at IS NULL`)  

### 3.2 `electricity_meters` (**VERIFIED**)

Sources: `database.types.ts`; DDL `supabase/legacy/DO_NOT_RUN/electricity_meter_hotfix.sql`

| Column | Notes |
|--------|-------|
| `id` uuid PK | |
| `property_id` → `properties(id)` RESTRICT | |
| `meter_number` UNIQUE | |
| `initial_day_reading`, `initial_night_reading` | Dual register |
| `installed_at` date | |
| `retired_at`, `replacement_reason`, `assigned_by_email`, `created_at` | Lifecycle |

Partial unique: one active electricity meter per property.

### 3.3 Readings / finance (related, not inventarisation)

- `water_readings`, `water_ledger`, `water_tariffs` (legacy schema + Package 2 tariff version refs in types)  
- `meter_readings` (+ optional `electricity_meter_id` FK)  
- `electricity_charges`, `electricity_ledger`, `electricity_tariffs`  
- Building modes: `water_mode` / `electricity_mode` on settings row in types  

### 3.4 Legacy column on `properties` (**VERIFIED**)

`properties.electricity_meter_number` still exists in types (`database.types.ts` properties Row). Current admin UI prefers `electricity_meters.meter_number` via `displayElectricityMeterNumber`.  

**Inconsistency risk:** denormalized legacy field may diverge from `electricity_meters` — **MISSING EVIDENCE** whether assign RPCs sync it.

### 3.5 Lifecycle coupling (**VERIFIED**)

`supabase/migrations/20261011120000_property_lifecycle_archive.sql` counts `water_meters`, `electricity_meters`, `water_readings`, electricity charges/ledger as **archive blockers**.

### 3.6 Migration gap (**VERIFIED**)

Search of `supabase/migrations/**/*.sql` found **no** `CREATE TABLE` for:

- `water_meters`  
- `electricity_meters`  
- `meter_readings`  
- `properties` (also absent from migrations folder)

Migrations **reference** these relations and redefine RPCs (e.g. `assign_water_meter` in `20260925010000_...`). Table creation appears to live under `supabase/legacy/DO_NOT_RUN/` (not a safe distribution path as named).

---

## 4. Property Book Integration

| Question | Finding | Evidence |
|----------|---------|----------|
| How meters link to objects | `property_id` → `properties.id` | DDL + RPCs |
| Identifiers used in Book / IS-2 | Match key **`apartment_number`**; resolve to `property_id`; reject client `property_id` | `src/lib/moduleCore/adapters/propertyBookOpening.ts`, `propertyBookOpeningAdapter.ts`, Book import docs |
| Compatible with Book adapter? | **YES**, if IS-3 resolves `apartment_number` → existing `property_id` the same way | Pattern **VERIFIED**; end-to-end IS-3 not implemented |
| Meters without object? | **NO** — `property_id NOT NULL` + property must exist (`Property not found.`) | assign RPCs |
| Multiple active meters same type per object? | **NO** — partial unique + RPC error `An active … meter is already assigned.` | schema + assign SQL |
| Shared / common-area meters? | **NOT SUPPORTED** in device tables (always property-scoped) | schema |
| Object rename / apartment_number change | Meters stay on `property_id` (stable). Book imports match by apartment_number string | **VERIFIED** FK; rename behaviour of Book admin — **MISSING EVIDENCE** of dedicated rename RPC semantics beyond import key |
| Stable identifiers | Device: `water_meters.id` / `electricity_meters.id`; Object: `properties.id` | **VERIFIED** |

**Architectural inconsistencies (**VERIFIED**):**

1. Dual water reading history (`water_readings` vs legacy `meter_readings.cold_water` in UI types).  
2. Electricity inventarisation in `electricity_meters` vs possible legacy `properties.electricity_meter_number`.  
3. Water and electricity schemas are parallel, not a unified `meters` entity — IS-3 adapter must treat **utility** as a first-class row discriminator or use two sheets.

**Dependency for IS-3:** Property Book / properties must exist first (`dependencies: ['property_book']` recommended — same as IS-1 test scenario using fictional `property_book` dependency).

---

## 5. Initial Setup Data Requirements

For a **new empty installation**, inventarisation needs:

### 5.1 Field matrix

| Field | Water domain | Electricity domain | Classification |
|-------|--------------|--------------------|----------------|
| Utility / meter type | Implicit (`water`) | Implicit (`electricity` + day/night registers) | Supported (as utility discriminator, not a DB enum column on device) |
| Serial / meter number | `meter_number` | `meter_number` | **Supported (required)** |
| Linked object | via `property_id` (resolve from `apartment_number`) | same | **Supported (required)** |
| Initial reading | `initial_reading` | `initial_day_reading` + `initial_night_reading` | **Supported (required)** |
| Initial reading date | Not separate — use `installed_at` | same | **Supported as `installed_at`**; separate “reading date” for opening is **not a device column** |
| Measurement unit | Implicit m³ / kWh in product UX | Implicit | **Not a DB field** — product presentation only |
| Installation date | `installed_at` | `installed_at` | **Supported** |
| Status | Derived: `retired_at IS NULL` ⇒ active | same | **Supported (derived)**; free-text status column **not supported** |
| Optional notes | No notes column on meter tables | same | **Not supported** without new column (forbidden by audit rules) |
| Shared / common-area | — | — | **Not supported** |
| Hot water / gas / heat | — | — | **Not supported** |

### 5.2 Product decisions required (see §13)

Whether opening import may call `assign_*` only (no readings/charges), whether tariffs must exist before first owner reading, whether every apartment must have both utilities, etc.

---

## 6. XLSX Import Feasibility

### 6.1 Reusable infrastructure (**VERIFIED**)

| Capability | Location |
|------------|----------|
| Module XLSX engine (template, parse, sanitize, preview counters) | `src/lib/moduleCore/xlsxEngine.ts` |
| Import batch audit (preview / commit marker) | IS-1 RPCs `admin_create_module_import_batch`, `admin_commit_module_import_batch` |
| IS-2 pattern: classify CREATE/UPDATE/SKIP/ERROR, dry-run, explicit confirm, no overwrite default | `propertyBookOpening.ts` + `AdminInitialSetup.tsx` |
| Canonical Book sheets/parse | `src/lib/propertyBookAdmin.ts` |

### 6.2 Meters-specific XLSX today

**MISSING EVIDENCE** of any meters workbook importer. Admin inventarisation is form/RPC based (`AdminWater`, electricity meter forms in `admin/page.tsx`).

### 6.3 Feasible adapter design (recommendation only — not implemented)

1. Template sheet(s) e.g. `meters` with columns: `apartment_number`, `utility` (`water`|`electricity`), `meter_number`, water `initial_reading` **or** electricity `initial_day_reading`/`initial_night_reading`, `installed_at`.  
2. Resolve `apartment_number` → `property_id` (Book SSOT).  
3. Preview: CREATE if no active meter; SKIP if active meter exists and policy forbids overwrite; ERROR on bad types/dates/duplicates.  
4. Commit: call existing `assign_water_meter` / `assign_electricity_meter` only (never silent replace).  
5. Reuse `module_import_batches` for preview audit; no business writes on dry-run.

### 6.4 Validation coverage (domain already enforces some rules)

| Check | Where enforced today |
|-------|----------------------|
| Meter number required / unique | assign RPCs |
| Non-negative initials | assign RPCs |
| Install date not future | assign RPCs (Europe/Sofia “today”) |
| One active per property | unique index + RPC |
| Property exists | RPC `FOR UPDATE` on `properties` |
| Duplicate serial globally | unique `meter_number` |

**Gaps for XLSX layer:** apartment_number matching, utility enum, row-level preview, BG/RU/EN instructions, downloadable error report (IS-2 already has patterns).

### 6.5 Transaction / idempotency / partial failure

- Each `assign_*` is its own security-definer function (**VERIFIED**).  
- **MISSING EVIDENCE** of a multi-row transactional bulk assign RPC.  
- **ASSUMPTION:** IS-3 commit would loop RPC calls → partial success possible unless a new bulk RPC is designed (product/tech decision; new RPC would be implementation phase).  
- Repeat import with SKIP-on-existing yields practical idempotency (same as IS-2 Book default).

---

## 7. Safe Initialization Strategy

Recommended policy aligned with IS-2:

| Guard | Approach |
|-------|----------|
| Empty install | No active meters → CREATE allowed after admin confirm |
| Populated install | Active meter present → **SKIP** (default); never call `replace_*` from Initial Setup |
| Server write guards | Only `assign_*` with staff roles; RLS blocks direct table INSERT (**VERIFIED** policy intent in legacy security SQL) |
| Authorization | Initial Setup admin assert + meter assign roles (admin/engineer) — **product decision** whether engineer may run IS-3 or admin-only |
| Preview | Local classify + optional dry “would assign” without calling assign; or call only after confirm |
| Overwrite | Forbidden in IS-3 UI/policy; replace remains Book/admin operational workflow |
| Audit | `module_import_batches` + existing `assigned_by_email` on rows |
| Rollback | No automatic rollback of partial assigns without new design — prefer all-or-nothing bulk RPC or stop-on-first-error |

**Do not** create parallel meter tables in Initial Setup.

---

## 8. Module Dependencies

| Module / area | Relationship to meters | Evidence |
|---------------|------------------------|----------|
| Property Book / `properties` | **Hard dependency** — meters require `property_id` | FK + assign RPCs |
| Water readings / ledger | Depend on active `water_meters` | submit path in Package 2 migrations |
| Electricity readings / charges / ledger | Depend on `electricity_meters` / `meter_readings` | electricity helpers + submit RPC |
| Tariff Core | `resolve_utility_tariff` for `water` / `electricity` | `20260927180000_tariff_subject_kind.sql` |
| Billing / payments | `record_water_payment`, `record_electricity_payment`, balances | `database.types.ts` |
| Finance reporting | Aggregates water/electricity **ledger** balances (explicitly not consumption) | `src/lib/financeReporting.ts` |
| Service lock | Triggers on `water_readings`, `meter_readings`, `electricity_charges` scopes | `20260926260000_service_lock_scopes.sql` |
| Building modules UX | `water`, `electricity` toggles | `src/lib/modules.ts` |
| Owner dashboard | OwnerUtilities / OwnerElectricity / account meter history | components above |
| Admin dashboard | Water + счётчики sections | `admin/page.tsx`, `AdminWater.tsx` |
| Guest Mode | `meter_readings` permission **denied** to guests | `src/lib/guestMode.ts`, `tests/security/unit/guestModeAuthz.test.ts` |
| Property archive | Meters/readings block archive | `20261011120000_property_lifecycle_archive.sql` |
| Email Core | **No direct meter enqueue adapter found** in `emailCoreAdapters.ts` | **VERIFIED** absence in grep |
| Debt gate / ownership transfers | No meter inventarisation dependency found in ownershipChange helpers | **MISSING EVIDENCE** of coupling; debt gate remains OUT OF SCOPE / OFF |
| Notifications | **MISSING EVIDENCE** of meter-specific notification module |

---

## 9. Fresh Supabase Compatibility

| Check | Result |
|-------|--------|
| Required migrations in `supabase/migrations/` for meter **DDL** | **NOT FOUND** — **BLOCKER** for migrations-only greenfield |
| RPC redefinitions assuming tables exist | Present (e.g. water assign hardening, tariff cutover) |
| Extensions | No meter-specific extension beyond normal Postgres/uuid usage found in meter DDL snippets |
| RLS | Defined in legacy security scripts; select-only for authenticated on meters; writes via SECURITY DEFINER RPCs |
| Storage | Meter inventarisation does not require Storage buckets (**VERIFIED** absence of storage path in assign flow) |
| Seed data | Legacy water schema inserts a test `water_tariffs` row — distribution packaging must decide whether that seed is desired |
| Env vars | No meter-specific env vars found; Email gates unrelated |
| External services | None for inventarisation |
| Production-specific IDs | None required for schema; **ASSUMPTION** that distribution must ship complete baseline DDL (properties + meters), not AMADEUS 11 data |

**Conclusion:** Meters **can** run on a new project **if and only if** the distribution package includes the baseline schema currently living outside `supabase/migrations/` (or migrations are completed beforehand). That packaging work is **broader than IS-3** but **blocks claiming** “apply platform migrations → meters ready” today.

---

## 10. Security and RLS

| Control | Evidence |
|---------|----------|
| Direct table writes revoked; SELECT policies | `supabase/legacy/DO_NOT_RUN/water_capital_security.sql`, electricity hotfix RLS |
| Assign/replace: staff roles администрация / инженер | Water migration `20260925010000_...`; electricity hotfix |
| Owner cannot assign meters via RPC role check | Same |
| Submit readings: separate authz / mode (`water_mode`, `electricity_mode`) | types + utilities/electricity helpers |
| Service lock can block reading inserts | `20260926260000_service_lock_scopes.sql` |
| Initial Setup admin gate (IS-1) | `admin_assert_module_setup` / admin-only UI |

IS-3 must not weaken these paths. Preview must not call assign. Commit must remain administrator-confirmed (product may optionally allow engineer).

---

## 11. Existing Test Coverage

| Area | Tests found |
|------|-------------|
| Meter creation / assign | **None** under `tests/**` |
| Meter assignment to property | **None** |
| Initial readings on assign | **None** |
| Duplicate prevention | **None** (DB constraints exist) |
| Authorization for meters | Guest denial of `meter_readings` only — `tests/security/unit/guestModeAuthz.test.ts` |
| Data preservation / import | IS-1/IS-2 Module Core tests only — `tests/security/unit/moduleCoreIs1.test.ts`, `moduleCoreIs2PropertyBook.test.ts` |
| Finance separation from consumption | `tests/finance/unit/financeReportingSeparation.test.ts` (ledger vs meters note) |
| Object relationships | Property Book / pkg-xfer tests exist but not meter-specific |

### Recommended IS-3 tests (do not write yet)

1. Adapter registration + `dependencies: ['property_book']`.  
2. Resolve apartment_number → property_id; reject `property_id` in draft.  
3. Classify CREATE vs SKIP when active meter exists.  
4. Utility discriminator validation (water vs electricity columns).  
5. Serial duplicate in file + against existing `meter_number`.  
6. Date / negative reading validation.  
7. Unauthorized caller denial (mirror RPC).  
8. Preview creates import batch without calling assign.  
9. Safe repeat import (idempotent SKIP).  
10. Fresh-empty vs populated preservation.  
11. (Distribution) migration presence check once DDL is in-repo.

---

## 12. Identified Risks

| # | Risk | Severity |
|---|------|----------|
| R1 | Meter/property **DDL not in** `supabase/migrations/` → greenfield claim false | **Critical** (distribution) |
| R2 | Dual reading models confuse IS-3 scope (inventarisation vs cold_water legacy) | High |
| R3 | Partial multi-row assign without bulk transaction | Medium |
| R4 | Calling `replace_*` from setup would overwrite operational meters | High if mis-designed |
| R5 | Tariffs missing on new install → first reading charge fails (inventarisation may still succeed) | Medium (ops) |
| R6 | `properties.electricity_meter_number` drift | Low/Medium |
| R7 | No automated tests for assign path | Medium |
| R8 | One-active-per-property blocks legitimate multi-meter apartments (product limitation) | Product |
| R9 | Timezone Europe/Sofia baked into install-date checks | Low (document for distribution) |

---

## 13. Required Product Decisions

1. **Scope of IS-3:** inventarisation only (`assign_*`) vs also seed first reading/charge.  
2. **Utilities in v1:** water only, electricity only, or both in one workbook.  
3. **Completeness rule:** must every property have meters, or optional rows?  
4. **Who may commit IS-3:** admin-only vs admin+engineer (RPC already allows engineer for assign).  
5. **Existing active meter:** SKIP-only (recommended) vs allow replace (not recommended for Initial Setup).  
6. **Common-area meters:** out of scope vs future schema (requires new model — not invent fields now).  
7. **Hot water / gas / heat:** out of scope for IS-3.  
8. **Distribution packaging:** when/how baseline meter DDL enters official migrations (blocker for empty Supabase story).  
9. **Tariff prerequisite:** must Tariff Core water/electricity versions exist before marking meters module READY?  
10. **Module key:** new out-of-catalog `meters` vs separate `water_meters` / `electricity_meters` adapters.

---

## 14. Recommended IS-3 Implementation Plan

*(Plan only — await approval; do not implement now.)*

1. **Pre-req gate:** confirm IS-2 Property Book ready / properties exist (dependency).  
2. **Decide product scope** (§13 items 1–2, 5, 10).  
3. **Adapter:** `metersOpeningAdapter` registering on Module Core bootstrap (mirror IS-2).  
4. **Helpers:** classify rows; resolve apartment_number; never trust property_id; default no overwrite.  
5. **XLSX template** BG/RU/EN instructions; columns covering water + electricity shapes.  
6. **AdminInitialSetup** path: template download, preview batch, explicit confirm, call `assign_*` only.  
7. **Manual path:** confirm meters filled via existing Admin Water / Счётчики UIs.  
8. **Tests** from §11 recommendations.  
9. **Do not** ship distribution DDL fix inside IS-3 unless product explicitly expands scope — but **document** R1 as release gate for empty-project packages.  
10. Keep Email / debt gates OFF; no production data migration into package.

---

## 15. Acceptance Criteria (for future IS-3 implementation)

1. Adapter registered; depends on Property Book / properties.  
2. Canonical `water_meters` / `electricity_meters` reused — no duplicate tables.  
3. XLSX template + validation + preview with CREATE/SKIP/ERROR.  
4. Explicit admin confirmation before any assign.  
5. Existing active meters preserved (SKIP); no silent replace.  
6. `apartment_number` matching; reject untrusted `property_id`.  
7. Manual confirmation integrates with existing admin meter UIs.  
8. Unauthorized import denied.  
9. Safe repeat import.  
10. `npm test` / `tsc` / `build` green with new tests.  
11. No migrations applied to production as part of adapter-only release unless DDL packaging is separately approved.  
12. Email / debt gates remain OFF.

---

## FINAL OUTPUT

### 1. Overall audit status

**PARTIAL**

### 2. Existing architecture summary

Two utility-specific device registries (`water_meters`, `electricity_meters`) linked to `properties.id`, with one active device per utility per property, initial registers on assign, readings/charges in separate tables, admin/owner UIs under water + `счётчики`.

### 3. Compatibility with Property Book

**Compatible** via `apartment_number` → `property_id`; meters cannot exist without a property; Book remains object/owner SSOT.

### 4. XLSX import feasibility

**Feasible** by orchestrating existing `assign_*` RPCs and reusing IS-1/IS-2 XLSX/preview/batch patterns. No meters XLSX exists today.

### 5. Fresh installation compatibility

**Not proven via migrations-only path.** Meter (and properties) DDL is absent from `supabase/migrations/`; live schema depends on legacy/out-of-band deploy history. Distribution packaging is a **critical prerequisite** beyond adapter UI code.

### 6. Critical risks

- R1 migration DDL gap  
- R2 dual reading models  
- R4 accidental use of replace/overwrite  
- R3 partial bulk assign  

### 7. Product decisions required before implementation

See §13 (scope, utilities, SKIP policy, roles, distribution DDL, tariffs, module key).

### 8. Recommended implementation sequence

See §14 — **stop here; wait for approval before implementing IS-3.**

---

**STOP.** No IS-3 code, migrations, data changes, commits, or deploys were performed in this audit.
