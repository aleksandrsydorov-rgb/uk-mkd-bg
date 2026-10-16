# AMADEUS 11 — Phase INV-2  
## Inventory Canonical Operations, Collaborative Sessions & Internal Balance Posting

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Local:** `amadeus11-is10a-local` @ `127.0.0.1:54322`  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used**  
**Mode:** SECURITY DEFINER RPCs on INV-1 schema  
**No commit / push / deploy / cloud migration**  
**Did not use `.env.local` for DB targeting**

**References:** `inv_0_architecture.md` · `phase_inv_1.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | RPC migration filename(s) | `20261101120000_inv2_inventory_operations.sql` · `20261101120100_inv2_inventory_admin_role_fix.sql` |
| 2 | Asset operations | **PASS** |
| 3 | Category/location operations | **PASS** |
| 4 | Stock operations | **PASS** |
| 5 | Collaborative session operations | **PASS** |
| 6 | Internal balance approval/posting | **PASS** |
| 7 | Concurrency/idempotency | **PASS** |
| 8 | RLS and permissions | **PASS** |
| 9 | Financial isolation | **PASS** |
| 10 | Local DB validation | **PASS** (`INV2_SMOKE_PASS`) |
| 11 | Tests/build | **329/329** · `tsc` PASS · `build` PASS |
| 12 | Cloud data unchanged | **YES** |
| 13 | Remaining blockers | Documents UI (INV-3); XLSX opening; module enablement UX; typed client bindings |
| 14 | Ready for INV-3 documents | **YES** |

---

## 1. Migrations

| File | Role |
|------|------|
| `supabase/migrations/20261101120000_inv2_inventory_operations.sql` | Canonical RPCs: assets, categories/locations, stock moves, sessions, approve+post |
| `supabase/migrations/20261101120100_inv2_inventory_admin_role_fix.sql` | `inventory_is_admin()` direct `staff.role` check; repairs `has_staff_role` Cyrillic whitelist |

Applied locally only: `npx supabase migration up --local` after `127.0.0.1:54322` isolation check.

INV-1 foundation not modified. Module remains `implemented=false` / `enabled=false` / lifecycle `DISABLED`.

---

## 2. Asset operations

| RPC | Purpose |
|-----|---------|
| `inventory_create_draft_asset` | Draft create + idempotency_key |
| `inventory_update_asset` | Permitted field edits |
| `inventory_set_asset_number` | Renumber while draft |
| `inventory_activate_asset` | draft → active |
| `inventory_assign_asset` | Assign to staff + open assignment row |
| `inventory_transfer_asset` | Staff and/or location transfer |
| `inventory_set_asset_condition` | Condition change + event |
| `inventory_record_maintenance` | Maintenance log; status → maintenance |
| `inventory_propose_asset_write_off` | Propose with reason |
| `inventory_approve_asset_write_off` | **Admin only** → written_off |
| `inventory_archive_asset` | written_off → archived (admin) |

Immutable `inventory_asset_events` on mutations. No destructive deletes.

---

## 3. Category & location operations

- `inventory_upsert_category` / `inventory_archive_category` (blocks active refs)  
- `inventory_upsert_location` / `inventory_archive_location`  
- Cycle prevention remains INV-1 trigger  
- BG/RU/EN preserved on upsert  

---

## 4. Stock operations

- `inventory_register_stock_item` (SKU + unit + ownership)  
- `inventory_stock_move` — OPENING / RECEIPT / ISSUE / TRANSFER / ADJUSTMENT / WRITE_OFF  
- Sign normalization, unit match, nonnegative invariant (INV-1 trigger + `FOR UPDATE`)  
- Idempotency via `idempotency_key`  
- No payments / invoices / GL entries  

---

## 5. Collaborative inventory

| RPC | Notes |
|-----|-------|
| `inventory_create_session` | DRAFT; auto-add creator as lead |
| `inventory_add_session_participant` | Zone/category assignment |
| `inventory_start_session` | Optimistic `row_version` |
| `inventory_add_session_item` | Multi-participant drafts |
| `inventory_update_session_item` | Own drafts; **stale row_version → 40001** |
| `inventory_submit_session_item` | Finding → submitted |
| `inventory_submit_session_for_review` | Session → REVIEW |
| `inventory_review_session_item` | accept / reject |
| `inventory_approve_and_post_session` | **Admin / approve_sessions only** + atomic post |
| `inventory_close_session` | APPROVED → CLOSED |

Lifecycle: DRAFT → IN_PROGRESS → REVIEW → APPROVED → CLOSED.

Participants may enter findings without per-line admin approval. Participants **cannot** approve.

---

## 6. Internal balance posting

On `inventory_approve_and_post_session`:

1. Fail closed if draft findings remain  
2. Auto-accept remaining `submitted` items  
3. Per accepted item via `inventory_post_session_item`:  
   - **Asset:** link existing or create with `acquisition_method=internal_balance`, `opening_import=true`, idempotency = session item id  
   - **Stock:** create SKU if needed; `OPENING` when ledger empty, else `ADJUSTMENT` = counted − on_hand (no double count)  
4. Mark items `posted`; session `APPROVED` + immutable session events  
5. Re-approve is idempotent (already APPROVED returns)

Session-item unique index on movements prevents duplicate OPENING/ADJUSTMENT for same item.

---

## 7. Security

- Admin bypasses module.enabled for setup/tests (does **not** flip enable flag)  
- Non-admin mutating caps require `inventory_module_enabled()`  
- Assigned participants may draft without module.enabled (setup inventarisation)  
- Final approval / write-off approve / archive = admin (or approve_sessions for sessions)  
- Owners: no inventory RPC grants beyond existing RLS deny-by-default  
- All public RPCs: `SECURITY DEFINER`, `search_path=''`, revoke anon, grant authenticated  

Companion migration repairs `has_staff_role` Cyrillic literals so platform admin checks match `staff.role`.

---

## 8. Module lifecycle

- Operations tested **without** enabling Inventory  
- `building_modules.enabled` remains false  
- `module_catalog.implemented` remains false  
- `module_lifecycle.state` remains `DISABLED`  
- Lifecycle transitions still via existing `admin_transition_module_lifecycle` (not bypassed)

---

## 9. Financial isolation

INV-2 SQL does **not** insert into:

- `uk_expenses`  
- Support Fee / Capital Repair / Internet ledgers  
- payments / bank / cash  

`estimated_value_eur` remains informational only.

---

## 10. Local validation

Isolation: `DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` — **PASS**

Smoke (JWT claim impersonation, not `.env.local`):

| Check | Result |
|-------|--------|
| Category/location upsert | PASS |
| Asset draft→activate→assign→condition→maintenance→write-off→archive | PASS |
| Asset idempotency_key | PASS |
| Stock opening/issue + nonnegative reject | PASS |
| Multi-participant findings | PASS |
| Stale item `row_version` conflict | PASS |
| Participant approve denied | PASS |
| Admin approve+post (asset + stock OPENING) | PASS |
| Duplicate approve idempotent | PASS |
| Close session | PASS |
| Module still disabled | PASS |
| Notice | `INV2_SMOKE_PASS` |

---

## 11. Tests / build

| Check | Result |
|-------|--------|
| `npm test` | **329/329** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Helpers/tests:

- `src/lib/inventory/inv2Operations.ts`  
- `tests/security/unit/inventoryInv2Operations.test.ts`

---

## 12. Remaining blockers (INV-3+)

1. Document upload / storage policies (INV-3)  
2. Admin/staff UI surfaces  
3. Optional XLSX opening import adapter  
4. Regenerate `database.types.ts` for new RPCs  
5. Production enablement path: Lifecycle SETUP→READY→ACTIVE + `building_modules.enabled`

---

## 13. Ready for INV-3

**YES** — canonical operations, collaborative posting, concurrency, and financial isolation are validated locally. INV-3 may add documents without changing ledger boundaries.
