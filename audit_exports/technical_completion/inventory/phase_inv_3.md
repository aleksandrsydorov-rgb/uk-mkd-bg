# AMADEUS 11 — Phase INV-3  
## Asset Documents, Photos & Secure Storage

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Local:** `amadeus11-is10a-local` @ `127.0.0.1:54322`  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used**  
**Mode:** Private Storage bucket + document metadata RPCs  
**No commit / push / deploy / cloud migration**  
**DB targeting:** local status URL only (not `.env.local`)

**References:** `inv_0_architecture.md` · `phase_inv_1.md` · `phase_inv_2.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Migration file(s) | `supabase/migrations/20261102120000_inv3_inventory_documents_storage.sql` |
| 2 | Storage bucket/policy design | Private `inventory-documents`; path-gated SELECT/INSERT; no client UPDATE; admin-only DELETE |
| 3 | Asset document support | **PASS** |
| 4 | Inventory finding photos | **PASS** |
| 5 | Authorization/RLS | **PASS** |
| 6 | Building isolation | **PASS** (install-key path segment + target match) |
| 7 | History/audit | **PASS** (soft archive / supersede; asset events) |
| 8 | Local Storage verification | **PASS** (`INV3_SMOKE_PASS`) |
| 9 | Tests/build | **336/336** · `tsc` PASS · `build` PASS |
| 10 | Cloud data unchanged | **YES** |
| 11 | Remaining blockers | Admin UI (INV-4); signed-URL client helpers; types regen |
| 12 | Ready for INV-4 Administrator UI | **YES** |

---

## 1. Migration

**File:** `20261102120000_inv3_inventory_documents_storage.sql`

Extends INV-1 `inventory_documents`:

| Column | Purpose |
|--------|---------|
| `session_item_id` | Finding photographs |
| `maintenance_event_id` | Maintenance attachments |
| `original_filename` / `byte_size` | Metadata |
| `archived_at` / `archived_by_email` | Soft archive (no silent destroy) |
| `superseded_by_id` | Controlled correction chain |
| `uploaded_by_staff_id` / `uploaded_by_uid` | Actor attribution |
| `row_version` | Optimistic concurrency on metadata archive |

**Doc kinds:** photo, finding_photo, purchase, manual, warranty, assignment_act, transfer_act, maintenance, write_off_act, invoice, act, other.

**Target rule:** exactly one of asset / stock / session_item / maintenance.

Module remains `implemented=false` / `enabled=false`.

---

## 2. Storage design

| Aspect | Choice |
|--------|--------|
| Bucket | `inventory-documents` |
| Public | **false** |
| Size limit | **20 MiB** |
| MIME | images + PDF + Office + text (bucket + RPC allowlists) |
| Path | `inventory/{install_key}/{scope}/{target_uuid}/{file_uuid}.{ext}` |
| Scopes | `asset` \| `stock` \| `session-item` \| `maintenance` |

**Policies on `storage.objects`:**

- SELECT → `can_read_inventory_document(name)` (requires metadata row + authz)  
- INSERT → `can_upload_inventory_document(name)` (path + target attach rights)  
- UPDATE → **denied** (no in-place overwrite)  
- DELETE → admin only (prefer soft-archive metadata)

Guessable paths without a metadata row cannot be read. Cross-install paths rejected via `inventory_install_key()`.

Clients obtain short-lived signed URLs **after** authorization using the existing Supabase client pattern (`createSignedUrl`); service_role is never exposed.

---

## 3. RPCs

| RPC | Role |
|-----|------|
| `inventory_build_document_path` | Canonical path builder |
| `inventory_register_document` | Metadata after upload; MIME/size/path/target checks; optional session `row_version` |
| `inventory_archive_document` | Soft archive + audit |
| `inventory_supersede_document` | Archive old + register new + link |
| `inventory_list_documents_for_asset` | Authorized list |
| `inventory_list_documents_for_session_item` | Authorized list |
| `can_upload_inventory_document` / `can_read_inventory_document` | Storage policy helpers |

No direct `INSERT`/`UPDATE`/`DELETE` grants on `inventory_documents` for `authenticated`.

---

## 4. Collaborative finding photos

- Participants may upload while session is DRAFT / IN_PROGRESS / REVIEW  
- Each photo uses a unique `file_uuid` → concurrent uploads do not replace each other  
- Optional `p_session_item_row_version` bumps finding concurrency; stale → `40001`  
- Photos remain after session approval/close (no cascade delete on session close)  
- Session audit event recorded on attach  

---

## 5. History preservation

Documents stay linked through assign / transfer / maintenance / write-off / archive.  
Asset status changes do **not** auto-delete attachments.  
Corrections use archive or supersede with audit (`document_added` payload / archive note).

---

## 6. Security summary

- Admin / authorized staff / session participants / responsible assignee  
- Read-only inventory viewers via `can_view_inventory`  
- **Owners denied by default**  
- Building isolation via install-key + target UUID in path  
- Path must match metadata target (prevents cross-object bind)  
- Storage object must exist before register (upload verification)  

---

## 7. Financial isolation

No inserts into `uk_expenses`, Support Fee, Capital Repair, Internet, payments, or cash.

---

## 8. Local validation

Isolation: `127.0.0.1:54322` — **PASS**  
Applied: `migration up --local` — **PASS**  
Smoke notice: **`INV3_SMOKE_PASS`**

| Check | Result |
|-------|--------|
| Bucket private + 20 MiB | PASS |
| 4 storage policies | PASS |
| MIME rejection | PASS |
| Size rejection | PASS |
| Path/target mismatch | PASS |
| Asset photo register + idempotent path | PASS |
| Participant multi-photo findings | PASS |
| Stale row_version on attach | PASS |
| Guessable path unread | PASS |
| Docs survive asset write-off/archive | PASS |
| Soft archive | PASS |
| Asset event audit | PASS |
| Module still disabled | PASS |

---

## 9. Tests / build

| Check | Result |
|-------|--------|
| `npm test` | **336/336** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

- `src/lib/inventory/inv3Documents.ts`  
- `tests/security/unit/inventoryInv3Documents.test.ts`

---

## 10. Remaining blockers (INV-4+)

1. Administrator UI for upload/preview/archive  
2. Thin client helper wrapping path build → storage upload → `inventory_register_document` → signed URL  
3. Regenerate `database.types.ts`  
4. Optional staff UI for finding photos during sessions  

---

## 11. Ready for INV-4

**YES** — secure document/photo foundation is validated locally. INV-4 can build Administrator UI on these RPCs and the private bucket without changing financial boundaries.
