# AMADEUS 11 — Phase INV-7B.1  
## Staff Directory RPC Compatibility Fix

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Cloud:** `klowacuvufknbrkayjhz`  
**Reference:** `phase_inv_7b_db_release.md`  
**Migration:** `20261108120000_inv7b1_staff_property_directory_setof_fix.sql`  
**No commit / push / deploy · No Inventory activation · No financial changes**

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Root cause | Fixed-position `SELECT` lagged `properties` DDL (cloud gained `ownership_type` / `section_code` / `block_code` / `archived_at`); local column order/types also diverge from cloud |
| 2 | Production function signature | `list_staff_property_directory()` → **`SETOF properties`** (no args) |
| 3 | Correction implemented | **YES** |
| 4 | Local compatibility | **PASS** |
| 5 | Cloud migration applied | **YES** (this migration only) |
| 6 | Existing staff data unchanged | **YES** (`staff` count 5; no DML) |
| 7 | Auth/RLS | **PASS** |
| 8 | Existing application callers | **PASS** (same RPC name/args/return contract) |
| 9 | Tests/build | **367/367** · `tsc` PASS · `build` PASS |
| 10 | Inventory remains DISABLED | **YES** |
| 11 | Ready for INV-7C | **YES** |

---

## 1. Targeted inspection

### Cloud (before)
- Signature: `()` → `SETOF properties`
- Body: fixed-position projection ending at `owner_user_management_agreement` (**27** expressions)
- Table: **31** columns (`section_code`/`block_code` at 29–30, `archived_at` at 31)
- Runtime risk: PostgreSQL `42804` structure-of-query vs SETOF mismatch

### Local
- `properties` ordinals/types differ (e.g. `apartment_number` text; `section_code` early)
- Prior experimental `20261107120100` hard-coded local layout → **not portable** (correctly excluded in INV-7B)

### Caller
- `src/app/admin/page.tsx` → `supabase.rpc('list_staff_property_directory')` when `canReadPropertyDirectory`
- Types: `Returns: Database['public']['Tables']['properties']['Row'][]`
- Contract preserved: no-arg RPC, SETOF properties Row shape

### Auth
- Finance: `администрация` / `бухгалтер` via `has_staff_role`
- Engineer: `инженер` with SH-2C1 redaction (no fee/PII)
- Others: empty set (no broaden)

---

## 2. Implementation

**File:** `supabase/migrations/20261108120000_inv7b1_staff_property_directory_setof_fix.sql`

| Design | Detail |
|--------|--------|
| Finance path | `SELECT p.*` — always matches current `properties` |
| Engineer path | `jsonb_populate_record(null::properties, to_jsonb(p) \|\| redact_map)` — name-keyed, order/type agnostic |
| Role literals | UTF-8 **hex decode** (avoids tooling mojibake) |
| Grants | `authenticated` + `service_role`; revoke public/anon |
| Safety | `CREATE OR REPLACE` only · no `DROP CASCADE` · no staff DML · no Inventory enable |

---

## 3. Local validation

| Check | Result |
|-------|--------|
| Function replace | **PASS** |
| `fn_keys` == `props_cols` (31) | **PASS** |
| Admin sees owner/debt | **PASS** |
| Engineer redacts owner/debt/area; keeps id/status | **PASS** |
| Unknown email → 0 rows | **PASS** |
| `inventory_assets` / finance ledgers | unchanged in rolled-back probe |
| Portable body present | **PASS** |

Script: `scripts/_inv7b1_local_validate.sql`

---

## 4. Cloud release

| Step | Result |
|------|--------|
| Project | `klowacuvufknbrkayjhz` confirmed linked |
| Selective push | Quarantine IS-9a/9b/IS-10d + local-only 7A.1 repairs; dry-run → **only** `20261108120000_…` |
| Apply | **PASS** (`scripts/_inv7b1_db_push.txt`) |
| Restore quarantine + `[db.migrations] enabled=false` | **DONE** |

### Postcheck
| Probe | Value |
|-------|-------|
| Result type | `SETOF properties` |
| Portable body / hex roles | **true** |
| Call without JWT | **0 rows** (no type error) |
| `properties` | 22 |
| `staff` | 5 |
| `inventory_assets` | 0 |
| `support_fee_ledger` | 13 |
| `building_modules.inventory.enabled` | **false** |
| `module_lifecycle.inventory` | **DISABLED** |

---

## 5. Regression

| Command | Result |
|---------|--------|
| `npm test` | **367/367 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 6. Ready for INV-7C?

**YES** — directory SETOF compatibility restored on cloud without activating Inventory or changing business/finance data.

**STOP** after this report.
