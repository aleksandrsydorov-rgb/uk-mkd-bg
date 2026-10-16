# AMADEUS 11 — Phase INV-10  
## Staff Inventory Permissions in Personnel Settings

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged** (no migration, no permission writes)  
**Mode:** Local implementation + unit/local write proof  
**No commit / push / deploy / cloud migration**

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Employee form integration | **PASS** |
| 2 | Granular capability model | **PASS** (maintenance shares `can_edit_assets` gate — see §2) |
| 3 | Database persistence | **PASS** (canonical `inventory_set_staff_capabilities`) |
| 4 | RLS/security | **PASS** |
| 5 | Staff navigation | **PASS** (`shouldShowInventoryStaff` unchanged contract) |
| 6 | Existing ticket settings unchanged | **YES** |
| 7 | BG/RU/EN | **PASS** |
| 8 | Tests/build | **377/377** · `tsc` PASS · `build` PASS |
| 9 | Local browser smoke | **BLOCKED** (local `/admin` stuck on loading; no auth session) |
| 10 | Cloud data unchanged | **YES** |
| 11 | Required migration filename | **none** |
| 12 | Ready for safe release | **YES** |

---

## 1. Employee form

Location: Система → Персонал → Редактировать сотрудника (`src/app/admin/page.tsx`).

New section (shown only when Inventory module enabled):

- Title: «Ответственность — Инвентарь» (`admin.invStaffRespTitle`)
- Master: «Имеет доступ к Инвентарю»
- When enabled:
  - Просматривать инвентарь → `can_view`
  - Участвовать в назначенных инвентаризациях → `can_session_participate`
  - Добавлять и редактировать имущество → `can_edit_assets`
  - Учитывать движение расходных материалов → `can_stock_move`
  - Регистрировать обслуживание имущества → maps to `can_edit_assets` (canonical RPC gate)

Ticket responsibility block preserved above Inventory section.

---

## 2. Authorization model

| Requirement | Result |
|-------------|--------|
| Reuse `staff_inventory_capabilities` | **PASS** — no parallel table/source |
| Persist via `inventory_set_staff_capabilities` | **PASS** — admin-only RPC |
| Admin manages employee permissions | **PASS** |
| No auto all-sessions access | **PASS** — participate still needs session assignment |
| No approve / write-off / manage_categories from form | **PASS** — payload forces those false |
| Inactive employee → all caps revoked on save | **PASS** |
| Access master off → all caps false | **PASS** |
| Module DISABLED → no effective staff Inventory UI | **PASS** — `shouldShowInventoryStaff` requires enabled module |
| Maintenance checkbox | Shares `edit_assets` because `inventory_record_maintenance` asserts `edit_assets` (INV-2). No new column / no parallel source. |

Helpers: `src/lib/inventory/staffPermissionsForm.ts`.

Audit: RPC continues to set `updated_by_email` + `updated_at` on capability rows.

---

## 3. Artifacts

| Piece | Path |
|-------|------|
| Form helpers | `src/lib/inventory/staffPermissionsForm.ts` |
| Admin form wiring | `src/app/admin/page.tsx` |
| i18n BG/RU/EN | `src/i18n/messages.ts` (`admin.invStaffResp*`) |
| Unit tests | `tests/security/unit/inventoryInv10StaffPermissions.test.ts` (9) |
| Local write script | `scripts/_inv10_local_permissions.sql` |

---

## 4. Local write proof

Against disposable `supabase_db_amadeus11-is10a-local`:

- Enable granular caps for `inv7a-staff@local.dev` as admin `inv7a-admin@local.dev`
- Reload row matches
- Revoke → all false
- Ticket `staff_work_capabilities` unchanged
- Staff `can_approve_inventory_session()` remains false

---

## 5. Cloud safety (verify-only)

| Metric | Value |
|--------|-------|
| `staff_inventory_capabilities` rows | **0** |
| `inventory_assets` | **0** |
| lifecycle / enabled / implemented | ACTIVE / true / true (unchanged by this phase) |

No cloud writes. No production employee permission changes.

---

## 6. Regression

| Command | Result |
|---------|--------|
| `npm test` | **377/377 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 7. Remaining notes

1. Local browser smoke of Personnel form **BLOCKED** (admin page loading without usable session).  
2. Optional future: dedicated `can_record_maintenance` column if product requires edit vs maintenance split (would need migration).  
3. Safe release can ship app code only — **no DB migration required**.

---

## 8. STOP

Local implementation and report complete. No commit / push / deploy / cloud migration.
