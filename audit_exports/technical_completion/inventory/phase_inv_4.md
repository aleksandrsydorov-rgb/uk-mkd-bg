# AMADEUS 11 — Phase INV-4  
## Administrator UI — Assets, Stock & Inventory Sessions

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used**  
**Mode:** Local UI only (canonical INV-2 RPCs + INV-3 Storage helpers)  
**No commit / push / deploy / cloud migration**

**References:** `inv_0_architecture.md` · `phase_inv_1.md` · `phase_inv_2.md` · `phase_inv_3.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Admin routes created | **PASS** — SPA section `инвентарь` on `/admin` (same pattern as Cleaning/Budget); views: overview, assets, stock, categories, locations, sessions, asset detail, session detail |
| 2 | Navigation integration | **PASS** — gated by `shouldShowInventoryAdmin` (role `администрация` + `building_modules.inventory` enabled); hidden while DISABLED |
| 3 | Asset UI | **PASS** — search/filter, draft create, activate, edit, assign, transfer, maintenance, write-off propose+approve, archive, audit, documents |
| 4 | Stock UI | **PASS** — SKU register + `inventory_stock_move` (receipt/issue/transfer/adjust/write-off); balances list; no client-side negative stock |
| 5 | Categories/locations | **PASS** — hierarchical BG/RU/EN upsert, archive category, location upsert via RPCs |
| 6 | Inventory sessions | **PASS** — create, participants, start, findings list, submit review, close, history |
| 7 | Review/approval/posting | **PASS** — admin `inventory_approve_and_post_session` with confirm + `row_version`; item accept/reject |
| 8 | Documents/photos | **PASS** — `uploadAndRegisterInventoryDocument` + `SignedStorageLink`/`SignedStorageImage`; private `inventory-documents`; no service_role / public URLs |
| 9 | Authorization/lifecycle | **PASS** — UX gate + RPC SECURITY DEFINER; module remains `implemented=false` / `enabled=false` until separately enabled |
| 10 | BG/RU/EN | **PASS** — `admin.inventory` / `admin.inv*` keys in `ru` / `en` / `bg` |
| 11 | Tests/build | **346/346** · `tsc --noEmit` PASS · `npm run build` PASS |
| 12 | Browser smoke | **BLOCKED** — Inventory nav not exposed while module disabled; no cloud/local enablement for this phase |
| 13 | Cloud data unchanged | **YES** |
| 14 | Remaining blockers | Staff UI (INV-5); regenerate `database.types.ts` after local push; local `db push` + module enable for live UI smoke |
| 15 | Ready for INV-5 Staff UI | **YES** |

---

## 1. Navigation & surfaces

| Surface | Implementation |
|---------|----------------|
| Route | `/admin` section key `инвентарь` |
| Component | `src/components/admin/AdminInventory.tsx` |
| Gate | `shouldShowInventoryAdmin` in `src/lib/inventory/admin.ts` |
| Wiring | `src/app/admin/page.tsx` — import, section type, nav group, render case |

Module stays hidden when `building_modules.inventory.enabled !== true`.

---

## 2. Client helpers

| File | Role |
|------|------|
| `src/lib/inventory/admin.ts` | Overview stats, filters, tones, loose `inventoryRpc` / `inventorySelect`, finance-mention guard |
| `src/lib/inventory/documentsClient.ts` | Signed URL + upload/register (INV-3 bucket) |
| `src/lib/privateMedia.ts` | `inventory-documents` routing for stored paths |
| `src/lib/inventory/index.ts` | Re-exports |

All mutations go through INV-2 / INV-3 RPCs — no direct uncontrolled table writes from the UI.

---

## 3. UX coverage

- **Overview:** active assets, by ownership/condition/category, SKU count, low-stock alerts, active sessions, pending review; explicit non-finance banner for estimated values  
- **Assets:** filters, draft create, detail with lifecycle + edit/transfer/maintenance + docs/audit  
- **Stock:** SKU create + movement posting + balance table  
- **Categories / locations:** CRUD-style admin forms via RPCs  
- **Sessions:** DRAFT → IN_PROGRESS → REVIEW → APPROVED → CLOSED; confirm before approve/post  

Loading / error / empty / confirm for irreversible ops included.

---

## 4. Tests

**File:** `tests/security/unit/inventoryInv4AdminUi.test.ts` (10 cases)

- Nav wiring + module-disabled gate  
- Overview / filter / tones / localization  
- Canonical RPC presence + no finance ledger strings  
- Session approve/post contract  
- Signed URL validation + privateMedia inventory bucket  

**Suite:** 346/346 PASS (prior baseline 336 + 10 INV-4).

---

## 5. Explicit non-goals (this phase)

- No cloud migrations or module enablement  
- No commit / push / deploy  
- No Rental Management / Email Core / debt-gate changes  
- No Staff collaborative counting UI (INV-5)

---

## 6. Ready for INV-5

Administrator shell, gates, RPC wiring, and document helpers are in place. INV-5 can add staff-facing counting / findings UI on the same RPC and Storage contracts without enabling Inventory in cloud.
