# AMADEUS 11 — Phase INV-6  
## Initial Setup, XLSX Import & Opening Inventory

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used**  
**Mode:** Local Initial Setup adapter + XLSX opening inventarisation  
**No commit / push / deploy / cloud migration / module activation**

**References:** `inv_0_architecture.md` · `phase_inv_1.md` … `phase_inv_5.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Initial Setup integration | **PASS** — `inventoryOpeningAdapter` registered; Admin Initial Setup wired |
| 2 | Empty setup | **PASS** — `empty_inventory_ok` / skip / confirm complete setup |
| 3 | Manual setup | **PASS** — manual flags + validateManual |
| 4 | XLSX template | **PASS** — versioned `meta` + `inventory` sheet + BG/RU/EN instructions + examples |
| 5 | XLSX preview | **PASS** — READ-ONLY classify CREATE/SKIP/CONFLICT/ERROR; batch audit via `admin_create_module_import_batch` |
| 6 | Approved import | **PASS** — explicit confirm + INV-2 RPCs only |
| 7 | Asset import | **PASS** — `inventory_create_draft_asset` → `inventory_activate_asset` |
| 8 | Opening stock | **PASS** — `inventory_register_stock_item` + `inventory_stock_move` OPENING |
| 9 | Idempotency/concurrency | **PASS** — deterministic idempotency keys; retry merge; stop-on-fail + NOT_PROCESSED |
| 10 | Collaborative opening inventory | **PASS** — optional `start_physical_inventory`; sessions allowed before ACTIVE (INV-2 participant rule) |
| 11 | Lifecycle integration | **PASS** — DISABLED → SETUP_* → READY → ACTIVE; suspend preserves data contract |
| 12 | Financial isolation | **PASS** — no purchases/invoices/UK expenses/payments/ledgers; estimate informational |
| 13 | BG/RU/EN | **PASS** — `admin.inv6*` keys |
| 14 | Tests/build | **367/367** · `tsc --noEmit` PASS · `npm run build` PASS |
| 15 | Browser E2E | **BLOCKED** — module remains DISABLED |
| 16 | Cloud data unchanged | **YES** |
| 17 | Remaining blockers | INV-7 integrated testing; local db push + types regen; enable module only when ready |
| 18 | Ready for INV-7 | **YES** |

---

## 1. Artifacts

| Piece | Path |
|-------|------|
| Opening parse/preview/template | `src/lib/inventory/opening.ts` |
| Approved commit | `src/lib/inventory/openingCommit.ts` |
| Setup adapter | `src/lib/moduleCore/adapters/inventoryOpeningAdapter.ts` |
| Bootstrap | `src/lib/moduleCore/bootstrap.ts` |
| UI | `src/components/admin/AdminInitialSetup.tsx` (`isInventory`) |
| Tests | `tests/security/unit/inventoryInv6Opening.test.ts` (11) |

Template download: `inventory_opening_template_v1.xlsx` (Blob + `download` attribute; spreadsheet MIME).

---

## 2. Four workflows → one register

1. **Empty** — confirm empty OK → READY without rows  
2. **Manual** — admin confirms / continues in Admin Inventory UI  
3. **XLSX** — preview → approve CREATE rows → INV-2 register  
4. **Physical session** — optional setup flag; INV-4/5 session UI; may run during SETUP_* without ACTIVE  

---

## 3. Preview vs commit

- Preview never writes assets/stock/finance.  
- Commit only after admin confirm; per-row outcomes; no false full success.  
- Duplicate inventory numbers / opening movements → SKIP or CONFLICT (no overwrite).  

---

## 4. Types regen

Local Supabase (`127.0.0.1:54322`) is running and `supabase gen types typescript --local` confirms Inventory tables/RPCs (e.g. `inventory_create_draft_asset`) exist.

A full overwrite of `src/lib/database.types.ts` was **not kept**: regenerating from the current local DB introduced unrelated TypeScript breaks (pets / guest / platform nullability drift vs app code). Inventory continues to use loose RPC helpers (`inventoryRpc` / setup `as any` casts) until a dedicated types alignment pass.

`tsc` / `build` remain green on the restored prior types file.

---

## 5. Explicit non-goals

- No cloud migrations / activation / commit / push / deploy  
- No real business imports  
- No Rental / Email / debt-gate work  

---

## 6. Ready for INV-7

Initial Setup + opening inventarisation complete locally. INV-7 can run integrated testing / release checklist against disposable local Supabase after migrations are applied and the module is deliberately enabled in that environment only.
