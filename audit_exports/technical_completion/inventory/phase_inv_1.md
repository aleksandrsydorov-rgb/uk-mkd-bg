# AMADEUS 11 — Phase INV-1  
## Inventory Foundation — Categories, Assets, Stock & Collaborative Sessions

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Local:** `amadeus11-is10a-local` @ `127.0.0.1:54322`  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used**  
**Mode:** Additive schema + RLS + auth helpers + seed category catalog  
**No commit / push / deploy / cloud migration**

**References:** `inv_0_architecture.md` · `phase_is_10d_financial_safety.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Migration file(s) | `supabase/migrations/20261031120000_inv1_inventory_foundation.sql` |
| 2 | Category/catalog schema | **YES** — hierarchical BG/RU/EN, cycle-safe, 12 seed rows |
| 3 | Asset schema | **YES** — `inventory_assets` + assignments/maintenance/docs/events/expense links |
| 4 | Stock/consumable schema | **YES** — SKUs, units, immutable movements, derived balances |
| 5 | Collaborative inventory schema | **YES** — sessions/participants/items/events + `row_version` |
| 6 | Internal balance design | **YES** — `opening_import` / `internal_balance` / OPENING movements; no finance |
| 7 | RLS and permissions | **YES** — capability table + admin bypass + SELECT policies |
| 8 | Module Lifecycle registration | **YES** — catalog stub kept `implemented=false`; lifecycle `DISABLED` |
| 9 | Test/build results | **319/319** · `tsc` PASS · `build` PASS |
| 10 | Local migration validation | **PASS** |
| 11 | Cloud data unchanged | **YES** |
| 12 | Remaining blockers | INV-2 RPCs/UI; write grants; posting; XLSX; enablement |
| 13 | Ready for INV-2 | **YES** |

---

## 1. Migration

**File:** `supabase/migrations/20261031120000_inv1_inventory_foundation.sql`  
**Ordering:** after IS-10d (`20261030120000_…`).  
**Applied:** local only via `npx supabase migration up --local`.  
**Historical migrations:** not modified. IS-9a / IS-9b / IS-10d tree preserved.

Isolation preflight:

- `DB_URL` = `postgresql://postgres:postgres@127.0.0.1:54322/postgres` → **PASS**
- Linked cloud project visible in CLI metadata but **no** `db push` / cloud migrate

---

## 2. Category catalog

| Feature | Implementation |
|---------|----------------|
| Hierarchy | `inventory_categories.parent_id` + cycle trigger (depth ≤ 64) |
| Locales | `name_bg` / `name_ru` / `name_en` required |
| Status | `active` + `archived_at` |
| Tracking hint | `allowed_tracking_type`: `INDIVIDUAL_ASSET` \| `QUANTITY_STOCK` \| `BOTH` |
| Sort / description | `sort_order`, `description` |
| Delete safety | BEFORE DELETE blocks if children / assets / stock reference; archive instead |
| Seed (metadata only) | tools, machinery (+ cleaning → floor machines), cleaning_equipment, furniture, electronics, security_safety, pool_territory, household, materials_consumables, other |

**Empty inventory remains valid** — seed creates **no** `inventory_assets` / `inventory_stock_items`.

---

## 3. Tracking types

| Mode | Tables | Identity |
|------|--------|----------|
| `INDIVIDUAL_ASSET` | `inventory_assets` (+ history tables) | Unique `inventory_number`; optional serial; condition ≠ lifecycle |
| `QUANTITY_STOCK` | `inventory_stock_items` + `inventory_stock_movements` | SKU + unit; **no** per-unit inventory numbers |

Movement types: `OPENING` / `RECEIPT` / `ISSUE` / `TRANSFER` / `ADJUSTMENT` / `WRITE_OFF`.  
Nonnegative on-hand enforced (except transfer pairing deferred to INV-2). Unit must match SKU. Movements append-only.

---

## 4. Asset data model

- **Lifecycle (`operational_status`):** draft / active / assigned / maintenance / written_off / archived  
- **Condition:** new / good / fair / poor / unserviceable  
- **Ownership (mandatory):** `CONDOMINIUM` / `MANAGEMENT_COMPANY` / `THIRD_PARTY` (note required for third party)  
- **Acquisition:** includes `opening_import`, `internal_balance` (register without purchase)  
- **Optional:** `inventory_asset_expense_links` → existing `uk_expenses` (informational only; INV-1 never inserts expenses)  
- **History:** `inventory_assignments`, `inventory_maintenance_events`, `inventory_documents`, append-only `inventory_asset_events`

---

## 5. Consumable stock model

- `inventory_units` — pcs/l/ml/kg/g/m/pack/box (BG/RU/EN)  
- `inventory_stock_items` — SKU, ownership, unit, optional `min_qty`  
- `inventory_stock_movements` — immutable journal (`qty_delta`)  
- `inventory_stock_balances` — **view** over `inventory_stock_on_hand()` (no mutable balance column)  
- Concurrency: `FOR UPDATE` on SKU row before nonnegative check

Operational insert RPCs = **INV-2**.

---

## 6. Collaborative inventory

| Table | Role |
|-------|------|
| `inventory_sessions` | Multi-day session; status DRAFT→IN_PROGRESS→REVIEW→APPROVED→CLOSED; `row_version` |
| `inventory_session_participants` | Multi-staff; optional zone/category assignment |
| `inventory_session_items` | Draft findings for assets **and** stock; duplicate unique indexes; `row_version` |
| `inventory_session_events` | Append-only approval/audit trail |

Staff may enter drafts without per-line admin approval. Final approval helper: `can_approve_inventory_session()` (admin or capability). Idempotent posting to register = **INV-2**.

---

## 7. Internal inventory balance

Approved findings / opening import may register existing equipment and opening stock quantities via:

- asset `acquisition_method = 'internal_balance' | 'opening_import'`  
- stock movement `OPENING`  

**Not** a GL: no Support Fee, Capital Repair, Internet, bank/cash, AP, depreciation, or automatic `uk_expenses` insert.

---

## 8. Authorization & RLS

- `staff_inventory_capabilities` — granular flags (view, edit assets, categories, stock move, participate, review, approve, write-off)  
- Admin role `администрация` bypasses via `inventory_is_admin()`  
- Helpers: `can_view_inventory`, `can_edit_inventory_assets`, `can_manage_inventory_categories`, `can_register_inventory_stock_moves`, `can_participate_inventory_session`, `can_review_inventory_session`, `can_approve_inventory_session`, `can_write_off_inventory`  
- Tables: RLS enabled; **SELECT** granted to `authenticated` under policies; **no** unrestricted all-staff access; owners have **no** default inventory access  
- Direct DML write grants intentionally omitted — INV-2 SECURITY DEFINER RPCs will own mutations

---

## 9. Module lifecycle

- `module_catalog.inventory` remains `implemented=false`  
- `building_modules.inventory.enabled = false` (insert-if-missing only)  
- `module_lifecycle` row for default installation: **DISABLED** / setup schema `1.0`  
- Empty inventory valid; no auto-activation

---

## 10. Tests & build

| Check | Result |
|-------|--------|
| `npm test` | **319/319** (incl. 14 INV-1 unit tests) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Helpers/tests:

- `src/lib/inventory/inv1Schema.ts` — migration contract analysis + invariant helpers  
- `tests/security/unit/inventoryInv1Foundation.test.ts`

Local SQL validation (docker `psql` on `supabase_db_amadeus11-is10a-local`):

| Invariant | Result |
|-----------|--------|
| 16 core tables present | PASS |
| 12 seed categories, BG/RU/EN | PASS |
| Nesting machinery→cleaning→floor | PASS |
| Cycle prevention trigger | PASS |
| Asset number uniqueness | PASS |
| THIRD_PARTY note required | PASS |
| Nonnegative stock | PASS |
| Movement unit match | PASS |
| Movement immutability | PASS |
| Multi-participant session + duplicate draft number | PASS |
| Session event immutability | PASS |
| Optimistic `row_version` | PASS |
| Auth helpers registered | PASS |
| Module disabled / catalog not implemented | PASS |
| Empty assets/stock after cleanup | PASS |

---

## 11. Cloud / finance

- **Cloud project `klowacuvufknbrkayjhz`:** not migrated; data unchanged (**YES**)  
- **Financial side effects in INV-1 SQL:** none (no SF/CR/Internet/uk_expenses inserts)

---

## 12. Remaining blockers (for INV-2+)

1. SECURITY DEFINER RPCs for asset CRUD, stock movements, session draft/submit/approve/post  
2. Authenticated INSERT/UPDATE policies or exclusive RPC path  
3. Idempotent session posting to asset/stock register  
4. Optional XLSX opening import adapter  
5. Admin/staff UI; module enablement path (Lifecycle SETUP→READY→ACTIVE)  
6. Write-off workflow UX; document storage bucket policies  

---

## 13. Ready for INV-2

**YES** — schema, catalog, RLS helpers, and local validation are in place. INV-2 should implement movement/session operations only (still no financial postings; Email/Debt gates remain OFF).
