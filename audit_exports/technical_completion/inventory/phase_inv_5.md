# AMADEUS 11 — Phase INV-5  
## Staff UI — Collaborative Physical Inventory

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used**  
**Mode:** Local UI only (INV-2 session finding RPCs + INV-3 photos)  
**No commit / push / deploy / cloud migration / module activation**

**References:** `phase_inv_1.md` · `phase_inv_2.md` · `phase_inv_3.md` · `phase_inv_4.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Staff routes created | **PASS** — `/admin` section `моя_инвентаризация` (My Tasks pattern) |
| 2 | Staff navigation | **PASS** — `shouldShowInventoryStaff` (module enabled + active staff + participate cap **or** assigned session); not granted to all employees |
| 3 | Assigned sessions | **PASS** — dashboard lists only participant assignments; scope zone/category when set |
| 4 | Finding entry | **PASS** — asset + quantity stock drafts via `inventory_add_session_item` / update / submit |
| 5 | Multi-day save/resume | **PASS** — drafts persist server-side; reload restores sessions/findings; last-saved indicator |
| 6 | Collaboration/conflict | **PASS** — `p_row_version` on update; stale → conflict message + reload |
| 7 | Photo upload/display | **PASS** — INV-3 `session-item` upload + signed media; no public/service_role |
| 8 | Permission boundaries | **PASS** — no approve/post/write-off/stock-move/capability RPCs in Staff UI |
| 9 | Mobile UX | **PASS** — max-width column, `min-h-11/12` controls, camera `capture`, touch-friendly CTA |
| 10 | BG/RU/EN | **PASS** — `admin.invStaff*` keys |
| 11 | Tests/build | **356/356** · `tsc --noEmit` PASS · `npm run build` PASS |
| 12 | Browser smoke | **BLOCKED** — Inventory module remains DISABLED |
| 13 | Cloud data unchanged | **YES** |
| 14 | Remaining blockers | INV-6 XLSX/setup; local `db push` + module enable for live smoke; types regen |
| 15 | Ready for INV-6 Initial Setup/XLSX | **YES** |

---

## 1. Surfaces

| Piece | Path |
|-------|------|
| Staff UI | `src/components/admin/StaffInventory.tsx` |
| Helpers | `src/lib/inventory/staff.ts` |
| Nav gate | `shouldShowInventoryStaff` in admin page probe of caps + participants |
| Section key | `моя_инвентаризация` |

Administrator Inventory (`инвентарь`) remains separate (INV-4).

---

## 2. Staff access model

- Module must be **enabled** for nav visibility.
- Staff must be **active**.
- Eligibility: `can_session_participate` / `can_view` **or** at least one active `inventory_session_participants` row.
- Server RPCs still enforce participant / capability checks (`inventory_assert_session_participant`).
- Staff UI never calls approve/post/write-off/admin capability setters.

---

## 3. Workflow

1. Dashboard → assigned active sessions, counts (mine / drafts / pending / discrepancies), last saved  
2. Open session → list findings; add / edit own drafts  
3. Finding form → category, location, ownership, inv/serial or qty+unit, condition, notes  
4. Save draft or save+submit (`inventory_submit_session_item`)  
5. Photos → private Storage via `uploadAndRegisterInventoryDocument` (`finding_photo`)  
6. Stale `row_version` → user-visible conflict + reload  

No offline sync in this phase.

---

## 4. Tests

**File:** `tests/security/unit/inventoryInv5StaffUi.test.ts` (10)

Nav gating · assigned filter · dashboard stats · draft edit rights · row_version conflict · session status lock · approval denied for participants · forbidden RPC absence · BG/RU/EN

**Suite:** 356/356 (baseline 346 + 10 INV-5).

---

## 5. Explicit non-goals

- No cloud migrations / module enable / commit / push / deploy  
- No Rental / Email / debt-gate / finance postings  
- No offline sync  
- No INV-6 XLSX bootstrap  

---

## 6. Ready for INV-6

Staff collaborative counting UI is in place on canonical RPCs. INV-6 can add initial setup / XLSX import without changing Staff finding contracts.
