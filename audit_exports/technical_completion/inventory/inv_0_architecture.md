# AMADEUS 11 — INV-0  
## Inventory Module — Targeted Architecture & Implementation Plan

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Mode:** DESIGN ONLY (read-only inspection)  
**Cloud:** `klowacuvufknbrkayjhz` — not modified  
**Baseline:** IS-10d financial safety PASS · Inventory schema ABSENT · `module_catalog.inventory` stub (`implemented=false`) · Rental NOT_IMPLEMENTED

---

## RETURN scorecard

| # | Item | Summary |
|---|------|---------|
| 1 | Existing reusable components | Module Lifecycle, import batches, staff roles, UK expenses (optional FK), work orders, building_documents, cleaning/module-enable patterns |
| 2 | Proposed schema | Asset registry + categories/locations + assignment/maintenance/write-off/document/event journals |
| 3 | Asset lifecycle | draft → active → assigned/in_use → maintenance → written_off / archived |
| 4 | Roles/permissions | Admin · authorized staff · responsible assignee · read-only viewer; building isolation |
| 5 | Integration boundaries | Optional expense link; no SF/CR/Internet postings; no auto payments |
| 6 | Initial Setup strategy | Empty OK · manual · optional XLSX · preview · idempotent · Lifecycle gates |
| 7 | Mandatory R1.0 scope | Registry, numbers, ownership class, condition/status, assign/transfer, maintenance log, write-off, docs, audit, setup |
| 8 | Deferred | QR/barcode, depreciation, RFID, vendor AP, rental coupling |
| 9 | Implementation phases | INV-1 … INV-7 (DDL → RPCs → Admin UI → Staff UI → Setup → tests → release) |
| 10 | Product decisions needing approval | Ownership taxonomy, inventory-number policy, staff capability vs role, expense link cardinality, write-off vs disposal |
| 11 | Exact next task | **INV-1 — Inventory DDL + RLS package/migration (schema only, no UI)** |

---

## 1. Targeted inspection — reusable components

Scope limited to UK Budget/Expenses, Staff, Tickets, Cleaning, Initial Setup Core, Module Lifecycle.

### 1.1 Module Registry & Lifecycle (reuse as-is)

| Component | Location / pattern | Inventory use |
|-----------|-------------------|---------------|
| `module_catalog` | key `inventory` already seeded; `implemented=false`, category `services` | Flip `implemented=true` when module ships |
| `building_modules` | per-complex enable flag | Gate all Inventory RPCs like `cleaning_module_enabled()` |
| `module_lifecycle` | DISABLED → SETUP_* → READY → ACTIVE | Mandatory for Release 1.0 Initial Setup |
| `module_setup_progress` | resumable drafts | Opening wizard state |
| `module_import_batches` + row ops | XLSX preview/commit | Opening inventarisation |
| `ModuleSetupAdapter` | `src/lib/moduleCore/types.ts` + adapters | New `inventoryOpeningAdapter` mirroring UK expenses optional import |

### 1.2 Staff & authorization (reuse)

| Component | Pattern | Inventory use |
|-----------|---------|---------------|
| `staff` + `has_staff_role` / `is_staff` | Exact roles: администрация, бухгалтер, инженер, уборщик | Admin + authorized staff |
| Capability-style gates | e.g. `can_approve_uk_expenses`, `can_manage_building_governance` | Prefer dedicated `can_manage_inventory()` / `can_view_inventory()` rather than overloading инженер for all assets |
| Building isolation | Single-installation SoT today (`platform_installations`); no cross-building grants | All Inventory tables scoped to installation; no owner/anon write |

**Do not** grant unrestricted SELECT on all assets to every staff role.

### 1.3 UK Budget & Expenses (optional soft link only)

| Component | Pattern | Inventory use |
|-----------|---------|---------------|
| `uk_expenses` | Independent expense journal; publish/approve separate from import | **Optional** `acquisition_expense_id` / event link to an existing expense |
| `budget_categories` | Cost taxonomy for plan/execution | May *suggest* category mapping for reporting; **not** Inventory SoT |
| IS-6a opening | Optional XLSX, pending review, no AP/payments | Template for Inventory opening import |

**Hard boundary:** Inventory must **not** insert into `uk_expenses`, Support Fee, Capital Repair, or Internet ledgers.

### 1.4 Tickets / work orders (ops link, not ownership)

| Component | Pattern | Inventory use |
|-----------|---------|---------------|
| `requests` | Resident/staff tickets | Optional `related_asset_id` later (R1.0 optional); not required for MVP |
| `work_orders` | Assignable staff tasks; `assigned_staff_id` → `staff` | Optional link from maintenance events to WO |

Cleaning (`cleaning_orders`) is **apartment service orders**, not asset registry — reuse only the **module_enabled + RLS + SECURITY DEFINER RPC** style, not the table shape.

### 1.5 Documents & audit patterns

| Component | Pattern | Inventory use |
|-----------|---------|---------------|
| `building_documents` + storage policies | Document metadata + storage path | Asset supporting docs (or Inventory-specific doc table with same storage rules) |
| `property_change_log` | Append-only JSON change journal | Model for `inventory_asset_events` / immutable history |

### 1.6 Explicit non-reuse

| Domain | Why not |
|--------|---------|
| Support Fee / Capital Repair / Internet ledgers | Separate financial SoTs; Inventory is not billing |
| Meter “inventory” (water/electricity assigns) | Utility meter registry — different module; do not overload |
| Rental Management | NOT_IMPLEMENTED; no Inventory dependency |
| Budget plan lines | Planning, not asset ownership |

---

## 2. Proposed schema (logical)

All tables: RLS on, revoke public/anon writes, installation-scoped, empty on fresh install.

### 2.1 Catalog / classification

**`inventory_categories`**

- `id`, `code` (unique), localized names, `sort_order`, `active`
- Seed minimal defaults (e.g. equipment, furniture, tools, IT, safety, other) — **metadata only, no assets**

**`inventory_locations`**

- `id`, `code`, `name`, `location_kind` (`common_area` | `technical_room` | `office` | `storage` | `apartment` | `offsite` | `other`)
- Optional `property_id` → `properties` when location is apartment-linked
- `active`, notes

### 2.2 Asset registry (SoT)

**`inventory_assets`**

| Column group | Fields |
|--------------|--------|
| Identity | `id` (uuid), `inventory_number` (unique per installation), `name`, `description` |
| Classification | `category_id`, optional `manufacturer`, `model`, `serial_number` |
| Ownership class | `ownership_kind` — see §2.3 |
| Location | `location_id` (current), optional free-text `location_note` |
| Responsibility | `responsible_staff_id` → `staff` (nullable) |
| Acquisition | `acquired_on`, `acquisition_method` (`purchase` \| `donation` \| `transfer_in` \| `opening_import` \| `other`), `acquisition_cost_eur` (nullable informational), optional `uk_expense_id` → `uk_expenses` |
| Condition / ops | `condition` (`new` \| `good` \| `fair` \| `poor` \| `unserviceable`), `operational_status` (see lifecycle) |
| Write-off | `written_off_at`, `write_off_reason`, `write_off_by_email` |
| Audit | `created_at/by`, `updated_at/by`, `idempotency_key` (opening import) |
| Markers | `opening_import boolean default false` |

**Uniqueness:** `(installation_id, inventory_number)` when multi-install lands; until then unique `inventory_number` within DB (single-building SoT).

### 2.3 Ownership distinction (mandatory product field)

`ownership_kind` **CHECK**:

| Value | Meaning |
|-------|---------|
| `condominium_common` | Common property of the condominium / owners as a whole |
| `management_company` | Property of the managing company (UK), **not** automatically condominium property |
| `held_in_trust` | Held under documented responsibility (custody/loan/deposit) with external owner reference |
| `other_documented` | Other documented holding; requires `ownership_note` / document |

Rules:

- Default for opening import must be **explicit in row** (no silent default to condominium).
- UI must show ownership class prominently; filters by ownership required.
- Changing `ownership_kind` is an audited event (admin-only).

### 2.4 Assignment & transfer history

**`inventory_assignments`** (append-oriented; current pointer also on asset)

- `asset_id`, `assigned_to_staff_id`, `assigned_at`, `assigned_by_email`
- `released_at`, `release_reason`
- Optional `from_location_id`, `to_location_id`
- One open assignment per asset (`released_at is null`) enforced by unique partial index

Transfers = close current assignment + open new (single RPC transaction) + event row.

### 2.5 Maintenance & repair history

**`inventory_maintenance_events`**

- `asset_id`, `event_kind` (`inspection` \| `repair` \| `service` \| `calibration` \| `other`)
- `performed_on`, `performed_by_staff_id` / email, `summary`, `cost_eur` (informational only)
- Optional `work_order_id`, optional `uk_expense_id`
- **No** auto-ledger posting

### 2.6 Write-offs

Recorded on asset + immutable **`inventory_asset_events`** of kind `write_off`.  
Optional disposal document via documents table. No finance void/charge.

### 2.7 Supporting documents

**`inventory_asset_documents`**

- `asset_id`, `title`, `doc_kind` (`invoice` \| `warranty` \| `photo` \| `act` \| `other`)
- `storage_path`, `mime_type`, `uploaded_by_email`, `created_at`
- Storage bucket policies modeled after expense receipts / building documents (path prefix + staff capability)

### 2.8 Immutable audit history

**`inventory_asset_events`** (append-only)

- `asset_id`, `event_at`, `actor_email` / `actor_uid`, `event_kind`, `payload jsonb`
- Kinds: `created`, `updated`, `assigned`, `transferred`, `location_changed`, `condition_changed`, `status_changed`, `maintenance`, `document_added`, `write_off`, `ownership_changed`, `opening_import`
- No UPDATE/DELETE grants to authenticated; SECURITY DEFINER writers only

---

## 3. Asset lifecycle

```
[opening_import / manual create]
        ↓
     draft ──────────────┐
        ↓                │ (discard / never activated — rare)
     active ←────────────┤
        ↓                │
   in_use / assigned     │
        ↓                │
   maintenance           │
        ↓                │
     active / in_use     │
        ↓                │
   written_off ──────────┴──→ archived (read-only)
```

| `operational_status` | Meaning |
|----------------------|---------|
| `draft` | Incomplete; not operational |
| `active` | In registry, available |
| `assigned` | Currently assigned to a responsible person |
| `in_maintenance` | Temporarily out for service |
| `written_off` | Removed from operational stock |
| `archived` | Historical only |

Transitions via RPCs only; each transition appends `inventory_asset_events`.

---

## 4. Roles & permissions

### 4.1 Logical roles (product)

| Role | Capability |
|------|------------|
| **Administrator** (`has_staff_role('администрация')`) | Full CRUD, write-off, ownership change, import commit, module enable/lifecycle |
| **Authorized staff** | Create/update assets, assignments, maintenance, documents — **if** granted inventory capability |
| **Responsible employee** | Read assets where `responsible_staff_id` = self; update condition notes / acknowledge assignment (narrow write) |
| **Read-only authorized viewer** | SELECT limited columns/assets; no mutations |

### 4.2 Suggested auth helpers

- `inventory_module_enabled()`
- `can_manage_inventory()` → administration **or** explicit staff flag/capability (product decision: role subset vs new capability column)
- `can_view_inventory()` → manage **or** responsible **or** read-only grant
- RLS: deny owners/residents by default (Inventory is UK/ops, not Property Book)

### 4.3 Isolation

- No cross-installation access.
- No “all staff see all assets” unless `can_manage_inventory()` or admin.
- Responsible employee sees **only** assigned/responsible assets unless elevated.

---

## 5. Integration boundaries

| Allowed | Forbidden |
|---------|-----------|
| Optional FK to existing `uk_expenses.id` for acquisition/maintenance cost reference | Creating expenses/payments from Inventory |
| Optional FK to `work_orders` / later `requests` | Posting to Support Fee / Capital Repair / Internet |
| Module Lifecycle + import batches | Duplicate expense ledger or depreciation GL |
| Building documents storage patterns | Treating UK-owned assets as condominium by default |
| Read-only budget category *hint* | Auto budget execution from Inventory |

Financial principle: Inventory may **display** linked expense amounts; it never **owns** money movement.

---

## 6. Initial Setup strategy

Classification (aligned with IS-7 inventory of stubs): promote from **E (stub)** → **B (optional inventarisation)** with empty-start allowed (**D** ops).

| Path | Behavior |
|------|----------|
| Empty start | Confirm “no opening assets” → READY |
| Manual entry | Admin UI create assets during SETUP_IN_PROGRESS |
| Optional XLSX | Preview → validate → commit via `module_import_batches` |
| Duplicate detection | Match on `inventory_number` (+ optional serial); conflict → error, no overwrite |
| Idempotent retry | `idempotency_key` / batch row keys; re-commit safe |
| Lifecycle | DISABLED → SETUP_REQUIRED → SETUP_IN_PROGRESS → READY → ACTIVE |

**Adapter sketch** (mirror UK expenses):

- `requiresInitialSetup: true`
- `importMethods: ['xlsx', 'manual']`
- `completionCriteria: preview_ok | admin_confirm | optional_skip`
- Gates: `no_auto_finance`, `ownership_kind_required`, `inventory_number_unique`

**XLSX columns (minimum):**  
`inventory_number`, `name`, `category_code`, `ownership_kind`, `condition`, `operational_status`, `location_code`, `responsible_staff_email`, `acquired_on`, `acquisition_cost_eur`, `serial_number`, `note`, `idempotency_key`

---

## 7. Mandatory Release 1.0 functions

1. Asset registry with inventory numbers  
2. Categories + physical locations  
3. Ownership class (condominium vs management company vs documented other)  
4. Responsible personnel (staff link)  
5. Purchase/acquisition fields (+ optional expense reference)  
6. Condition + operational status  
7. Assignment / transfer with history  
8. Maintenance/repair event log  
9. Write-off  
10. Supporting documents (upload + list)  
11. Immutable audit event stream  
12. Module enable + Lifecycle + optional opening import  
13. Admin UI for full management  
14. Staff UI for responsible/authorized scoped views  
15. RLS + SECURITY DEFINER RPCs; no resident write access  

---

## 8. Deferred (post–Release 1.0)

| Item | Why defer |
|------|-----------|
| QR / barcode labels & scanning | Hardware/UX; not required for registry completeness |
| Accounting depreciation schedules | Unsupported automation; needs finance product |
| RFID / IoT tracking | Out of scope |
| Deep ticket auto-link from every request | Nice-to-have |
| Vendor/AP catalog | IS-6b domain absent |
| Coupling to Rental Management | Module not implemented |
| Multi-building portfolio UI | Platform not yet multi-complex in product UX |

---

## 9. Implementation phases

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **INV-1** | DDL: tables, indexes, RLS, grants, catalog `implemented` still false or gated | Schema present on local fresh-install path; empty data; RLS on |
| **INV-2** | Auth helpers + core RPCs (create/update asset, assign/transfer, maintenance, write-off, events) | RPC_PRESENT; no finance side effects |
| **INV-3** | Documents + storage policies | Upload/list/delete (staff-gated) |
| **INV-4** | Admin UI (registry, filters by ownership, detail, assign, write-off) | Admin can operate end-to-end on local |
| **INV-5** | Staff UI (responsible + authorized scopes) | No unrestricted all-asset access |
| **INV-6** | Initial Setup adapter + XLSX preview/commit + Lifecycle | Empty or import → READY/ACTIVE |
| **INV-7** | Integration tests + Safe Release / fresh-install package companion + mark `implemented=true` | Tests green; distribution-ready |

**Safe migration/release steps (each phase):**

1. Local disposable DB only first  
2. Additive migrations (`IF NOT EXISTS`) — no rewrite of SF/CR/Book  
3. Companion DDL in `supabase/packages/fresh_install/` when required for greenfield ordering  
4. No cloud apply until separately authorized Safe Release  
5. Feature flag: `building_modules.inventory.enabled` default **false** until ACTIVE  

Compatibility: register adapter in Module Core bootstrap; keep `BUILDING_MODULE_KEYS` alignment; Docker distribution consumes same package+migrations chain as IS-10c/d.

---

## 10. Product decisions requiring approval

| ID | Decision | Options | Recommendation |
|----|----------|---------|----------------|
| **Q-INV-1** | Inventory number allocation | Manual only · auto-sequence · hybrid | **Hybrid**: admin may type; system suggests next code |
| **Q-INV-2** | Who is “authorized staff”? | All `инженер` · all non-cleaner staff · explicit capability flag on `staff` | **Explicit capability** (least privilege) |
| **Q-INV-3** | Can owners see condominium assets? | No · read-only common assets | **No** in R1.0 (ops module); revisit later |
| **Q-INV-4** | Expense link cardinality | 0..1 · 0..n | **0..1** on asset for acquisition; maintenance events may each link 0..1 |
| **Q-INV-5** | Write-off vs physical disposal | Status only · require disposal act document | **Status + optional document**; act required only if ownership_kind = condominium_common (policy) |
| **Q-INV-6** | Opening import class | Optional (B) · required (A) · empty-only (D) | **Optional (B)** with skip-to-READY |
| **Q-INV-7** | Default ownership on manual create | Force explicit · default management_company | **Force explicit** (no silent condominium) |

---

## 11. Exact next task

**INV-1 — Inventory database foundation (DDL + RLS only)**

Deliverables:

1. Migration(s) creating §2 tables, indexes, RLS, revokes/grants  
2. Fresh-install package companion file(s) if greenfield ordering requires it  
3. Seed `inventory_categories` metadata only (no assets)  
4. Keep `module_catalog.inventory.implemented = false` until INV-7  
5. Local-only validation on disposable Supabase; **no cloud**, no UI yet  
6. Phase report `inv_1_db_foundation.md`

Out of INV-1: RPCs beyond stubs, UI, XLSX adapter, finance links beyond nullable FK columns.

---

## Appendix A — Alignment with Release 1.0 module set

Inventory is one of 13 mandatory Release 1.0 modules. Completing INV-1…INV-7 closes the ABSENT schema gap identified in IS-10c without implementing Rental Management.

## Appendix B — Non-goals (this design)

- Rental / commercial rental asset fleets  
- Automatic depreciation or tax books  
- Replacing meter registries or Property Book  
- Email Core / debt gate changes  
