# AMADEUS 11 — Phase INV-7B  
## Cloud Database Release — Inventory Structures Only

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Target cloud:** `klowacuvufknbrkayjhz` (MKD AMADUES 11) — **linked**  
**Local test:** `amadeus11-is10a-local`  
**Mode:** Selective Inventory DDL/RPC publish · **no** activation · **no** business import  
**No commit / push / deploy / Rental work** · Email Core & debt gate remain OFF

**References:** `phase_inv_1.md` … `phase_inv_6.md` · `phase_inv_7a_acceptance.md` · `phase_inv_7a1_browser_acceptance.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Preflight | **PASS** |
| 2 | Pending migration list | See §2 |
| 3 | Cloud migrations applied | **YES** (Inventory INV-1…INV-3 only) |
| 4 | Staff RLS compatibility | **PASS** (`is_staff` → `is_allowed_staff_role`) |
| 5 | Directory RPC compatibility | **FAIL** (pre-existing SETOF drift; local repair **not** portable — not applied) |
| 6 | Inventory DB/RPC | **PASS** |
| 7 | Storage/RLS | **PASS** |
| 8 | Lifecycle still DISABLED | **YES** |
| 9 | Existing financial data unchanged | **YES** |
| 10 | Tests/build | **367/367** · `tsc` PASS · `build` PASS |
| 11 | Remaining blockers | See §8 |
| 12 | Ready for INV-7C Safe Release | **YES** (with blockers noted) |

---

## 1. Strict preflight

### Cloud identity
| Check | Result |
|-------|--------|
| Linked project | `klowacuvufknbrkayjhz` |
| Name | MKD AMADUES 11 |
| Status | ACTIVE_HEALTHY |
| Remote history tip (before apply) | `20261027120000` (IS-8) |

### Classification A vs B

| Item | Class | Cloud action |
|------|-------|----------------|
| `20261028120000` IS-9a fresh-install companion (mojibake role literals in `is_staff` / constraints) | **A — must not apply** | Quarantined |
| `20261029120000` IS-9b fresh-install companion | **A — unrelated / not Inventory** | Quarantined |
| `20261030120000` IS-10d distributive neutralize | **B portable but unrelated**; brownfield NO-OP | Quarantined (not Inventory) |
| `20261031120000` INV-1 foundation | **B** | **Applied** |
| `20261101120000` INV-2 operations | **B** | **Applied** |
| `20261101120100` INV-2 admin/`has_staff_role` repair | **B** | **Applied** |
| `20261102120000` INV-3 storage | **B** | **Applied** |
| `20261107120000` `is_staff` encoding repair | **B** redundant on cloud (already `is_allowed_staff_role`) | **Not applied** |
| `20261107120100` `list_staff_property_directory` local column layout | **A — local-only** (assumes local `section_code`/`block_code` ordinals; **wrong** for cloud) | **Not applied** |
| `openingCommit.ts` UUID idempotency fix | **B** app code | Not a DB migration (INV-7C) |
| `database.types.ts` surgical Inventory merge | **B** app code | Already local; INV-7C ships app |

**Do not transfer local-only permissive / layout-specific policies to production** — honored.

### Tooling constraint
- `supabase db push` has **no** per-file select.
- `[db.migrations] enabled = false` in `config.toml` skips push entirely.
- Blind push of all pending would execute IS-9a/9b → **STOP** under brief rules.

**Mitigation used (selective):** temporary quarantine of non-Inventory pending files + temporary `enabled = true` → dry-run showed **exactly** four INV migrations → apply → restore quarantine + `enabled = false`.

---

## 2. Pending migration list (pre-apply)

| Version | File | Remote before | Decision |
|---------|------|---------------|----------|
| 20261028120000 | IS-9a fresh-install | pending | **HOLD** (unsafe mojibake) |
| 20261029120000 | IS-9b fresh-install | pending | **HOLD** |
| 20261030120000 | IS-10d | pending | **HOLD** (unrelated) |
| 20261031120000 | INV-1 | pending | **APPLY** |
| 20261101120000 | INV-2 | pending | **APPLY** |
| 20261101120100 | INV-2 admin fix | pending | **APPLY** |
| 20261102120000 | INV-3 | pending | **APPLY** |
| 20261107120000 | INV-7A.1 is_staff | pending | **HOLD** (redundant) |
| 20261107120100 | INV-7A.1 directory | pending | **HOLD** (local-only) |

Dry-run after quarantine:

```
• 20261031120000_inv1_inventory_foundation.sql
• 20261101120000_inv2_inventory_operations.sql
• 20261101120100_inv2_inventory_admin_role_fix.sql
• 20261102120000_inv3_inventory_documents_storage.sql
```

---

## 3. Migration safety review

| Topic | Verdict |
|-------|---------|
| INV-1 schema additive; `building_modules.inventory.enabled=false`; lifecycle `DISABLED`; `implemented` not forced true | **PASS** |
| INV-2 operational RPCs; no finance posts | **PASS** |
| INV-2 admin-role / `has_staff_role` Cyrillic whitelist repair | **PASS** |
| INV-3 private bucket `inventory-documents` + 4 storage policies | **PASS** |
| No Inventory auto-activation | **PASS** |
| No default financial transactions | **PASS** |
| IS-9a/9b not applied (would rewrite staff auth with mojibake) | **PASS** |
| IS-10d financial safety preserved (not applied; brownfield tariffs untouched) | **PASS** |

Reference catalog seeds only (`inventory_categories` / `inventory_units`) — **not** business assets/stock.

---

## 4. Apply

```
npx supabase db push --linked --yes
```

Log: `scripts/_inv7b_db_push.txt` — all four migrations applied successfully.

Post-history: INV versions **present on remote**; IS-9a/9b/IS-10d/7A.1 repairs remain **local-only pending**.

---

## 5. Postcheck

| Check | Result |
|-------|--------|
| Tables `inventory_assets` / `stock_items` / `sessions` / `documents` | **exist** |
| Business rows | assets **0**, stock **0** |
| Catalog seeds | categories **12**, units **8** (reference only) |
| Inventory RPCs (`inventory_%`) | **63** |
| Key RPCs present | `inventory_create_draft_asset`, `inventory_activate_asset`, `inventory_stock_move`, `inventory_assert_cap` |
| Storage bucket | `inventory-documents` · **public=false** |
| Storage policies | **4** (select/insert/update/delete) |
| Inventory table RLS policies | **15** |
| `building_modules.inventory.enabled` | **false** |
| `module_lifecycle.inventory.state` | **DISABLED** |
| `module_catalog.inventory.implemented` | **false** |
| `is_staff()` | still uses `is_allowed_staff_role` (**PASS**) |
| `list_staff_property_directory` | still returns projection **missing** cloud `section_code` / `block_code` / `archived_at` vs `SETOF properties` → runtime risk **FAIL** (pre-existing; not worsened; local repair not applied) |
| `support_fee_ledger` | **13** (unchanged) |
| `support_fee_assessments` | **4** (unchanged) |
| `properties` | **22** (unchanged) |
| `email_outbox` (1d) | **0** |
| No production write exercises | honored |

---

## 6. Regression

| Command | Result |
|---------|--------|
| `npm test` | **367/367 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Logs: `scripts/_inv7b_npm_test.txt`, `_inv7b_tsc.txt`, `_inv7b_build.txt`.

---

## 7. Safety confirmations

| Gate | Status |
|------|--------|
| No Inventory activation | **YES** |
| No business data import | **YES** |
| No fresh-install package execution | **YES** |
| No cloud DB reset | **YES** |
| Email Core sending | OFF (no outbox growth) |
| Debt gate | not toggled by this release |
| Rental Management | untouched |
| Commit / push / deploy | **not performed** |

---

## 8. Remaining blockers

1. **`list_staff_property_directory` SETOF drift on cloud** — needs a **cloud-correct** portable repair (column order matching production `properties`, including `section_code`/`block_code`/`archived_at`). Do **not** apply `20261107120100` as-is.
2. **Pending non-Inventory migrations** still local-only: IS-9a, IS-9b, IS-10d — must never be applied via blind `db push` without separate IS release review (IS-9a is actively harmful).
3. **App-side INV-7C** must ship: UUID idempotency fix in `openingCommit.ts`, Inventory UI, types already merged locally.
4. Inventory remains **DISABLED** / `implemented=false` until INV-7C Safe Release activates deliberately.

---

## 9. Ready for INV-7C?

**YES** — Inventory schema, RPCs, private storage, and RLS are on cloud `klowacuvufknbrkayjhz` without activation or business data. Proceed to Safe Release for app/code enablement only after operator plan for activation and directory repair.

**STOP** after Database Release and this report.
