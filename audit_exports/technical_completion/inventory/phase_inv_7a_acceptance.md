# AMADEUS 11 — Phase INV-7A  
## Local Integration Acceptance & Release Preflight

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Local:** `amadeus11-is10a-local` @ `127.0.0.1:54322`  
**Cloud:** `klowacuvufknbrkayjhz` — **unchanged / not used for mutations**  
**Mode:** Local SQL/RPC acceptance + types merge + tests/build preflight  
**No commit / push / deploy / cloud migration / production data changes**

**References:** `phase_inv_1.md` … `phase_inv_6.md` · `phase_is_10d_financial_safety.md`

**Script:** `scripts/_inv7a_local_acceptance.sql` (22/22 PASS)  
**Types merge helper:** `scripts/_inv7a_merge_inventory_types.mjs` (local gen → surgical merge)

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Local isolation | **PASS** (SQL/Docker) · **FAIL** (Next `.env.local` → cloud) |
| 2 | Types regeneration | **PASS** (local gen + surgical Inventory merge; full overwrite rejected) |
| 3 | Local module activation | **PASS** (`implemented=true` → lifecycle ACTIVE → `enabled=true`) |
| 4 | Admin workflows | **PASS** (SQL/RPC) · browser **BLOCKED** |
| 5 | Staff workflows | **PASS** (SQL/RPC) · browser **BLOCKED** |
| 6 | Collaborative inventory | **PASS** (SQL/RPC, incl. post retry no duplicate) · browser **BLOCKED** |
| 7 | XLSX import E2E | **PASS** (INV-6 unit + SQL opening stock) · UI browser **BLOCKED** |
| 8 | Storage/document access | **PASS** (bucket private + 4 policies + path builder) · upload UI **BLOCKED** |
| 9 | RLS/security | **PASS** (15 inventory RLS policies; deny paths proven) |
| 10 | Financial isolation | **PASS** |
| 11 | Tests/build | **367/367** · `tsc --noEmit` PASS · `npm run build` PASS |
| 12 | Browser smoke | **BLOCKED** (`.env.local` points at cloud) |
| 13 | Cloud data unchanged | **YES** |
| 14 | Remaining blockers | See §9 |
| 15 | Ready for INV-7B database release | **YES** (with blockers noted; not full product Release 1.0) |

---

## 1. Local environment preflight

| Check | Result |
|-------|--------|
| Docker containers `amadeus11-is10a-local` | **PASS** (db healthy on `0.0.0.0:54322`) |
| `npx supabase status` `DB_URL` | `postgresql://…@127.0.0.1:54322/postgres` |
| Linked project ref (CLI metadata only) | `klowacuvufknbrkayjhz` — **not written** |
| `.env.local` `NEXT_PUBLIC_SUPABASE_URL` | **CLOUD** (`klowacuvufknbrkayjhz`) — app/browser isolation **FAIL** |
| INV migrations applied locally | `20261031120000`, `20261101120000`, `20261101120100`, `20261102120000` |
| Unrelated IS-9 / IS-10 local state | **Preserved** (no package/tariff migrations touched) |
| Schema/type drift | Full `supabase gen types --local` ≠ canonical `database.types.ts` (pets/guests/RPC nullability). Inventory defs were **absent** before INV-7A merge. |

**STOP rule:** SQL acceptance proceeded on verified local Docker DB only. Browser E2E intentionally **not** run against cloud.

---

## 2. Types

1. Generated from **local** schema only: `npx supabase gen types typescript --local --schema public` → `scripts/_inv7a_types_local.ts`.
2. Full overwrite of `src/lib/database.types.ts` produced **219** unrelated `tsc` errors (pets / guest / RPC surface drift) — **not kept**.
3. Surgical merge of **16** Inventory tables (+ `staff_inventory_capabilities`) and **57** Inventory RPCs into the canonical hand-maintained types file.
4. `npx tsc --noEmit` → **0** errors after merge.
5. Canonical naming / RPC Args preserved (e.g. `inventory_create_draft_asset`).

---

## 3. Local enablement (disposable DB only)

Auth users (local GoTrue):

| Email | UID |
|-------|-----|
| `inv7a-admin@local.dev` | `6c039c0c-83eb-4ec6-84d2-70dd0cbea562` |
| `inv7a-staff@local.dev` | `632fab50-7332-475b-bdb1-4700e387c30d` |
| `inv7a-staff2@local.dev` | `651f1ac6-5842-46e7-925d-47db27f38f69` |

Workflow (no lifecycle bypass):

1. `module_catalog.implemented = true` (local only).
2. `admin_transition_module_lifecycle`: DISABLED → SETUP_REQUIRED → SETUP_IN_PROGRESS → READY → ACTIVE.
3. `admin_save_module_setup_progress` with empty-inventory confirmation draft.
4. `set_building_module_enabled('inventory', true)`.
5. Staff capabilities: view + `session_participate` only (no approve/write-off).

Final local state after acceptance: `implemented=t` · `enabled=t` · `state=ACTIVE`.

---

## 4. End-to-end workflows (SQL/RPC)

Evidence: `scripts/_inv7a_local_acceptance.sql` → **0 FAIL / 22 PASS**.

### A. Administrator — **PASS** (SQL)

Category/location upsert · draft asset → activate · assign · transfer · maintenance · write-off propose/approve · asset event history · document path builder.

### B. Staff — **PASS** (SQL)

Participant findings · update/resume · stale `row_version` conflict (`40001`) · submit · **cannot** `inventory_approve_and_post_session`.

### C. Collaborative inventory — **PASS** (SQL)

Two participants · parallel asset + stock findings · review accept · approve/post · retry approve → **posted asset count remains 1**.

### D. Initial Setup / XLSX — **PASS** (unit + SQL opening) · UI **BLOCKED**

- Empty setup path exercised via lifecycle + setup progress draft.
- Opening stock register + idempotent `OPENING` move retry (`opening_moves=2`).
- XLSX preview/commit/SKIP/CONFLICT covered by INV-6 unit tests (`inventoryInv6Opening.test.ts`) included in 367/367.
- Browser XLSX download/preview/import UI **not** exercised (env → cloud).

### E. Security — **PASS** (SQL)

| Case | Result |
|------|--------|
| Unauthorized staff on unassigned session | denied (`not a session participant`) |
| Owner (non-staff) create asset | denied (`capability required`) |
| Staff approve/post | denied (`administrator approval required`) |
| Inventory RLS policies | **15** |
| Cross-building | N/A on single-building local install (no second building fixture) |

---

## 5. Financial safety — **PASS**

Before/after synthetic INV-7A ops:

| Surface | Count |
|---------|------:|
| `uk_expenses` | 0 |
| `support_fee_ledger` | 0 |
| `payments` | 0 |
| `invoices` | 0 |
| `capital_repair_ledger` | 0 |

No Inventory RPC writes bank/cash/accounting ledgers (relations absent or untouched). Maintenance `cost_eur` remains informational metadata only.

---

## 6. Release preflight

| Item | Result |
|------|--------|
| SQL migrations ordered | **PASS** — INV-1→INV-3 timestamps ascending; applied in order |
| Storage bucket/policies | **PASS** — `inventory-documents` private + size limit; 4 storage policies |
| Module Registry / Lifecycle | **PASS** — catalog + lifecycle + building_modules wired; adapter registered |
| BG/RU/EN | **PASS** — `admin.inv*` / `inv6*` keys in `src/i18n/messages.ts` (60× `inv6*` across locales) |
| Secrets / env credentials in migrations | **PASS** — none found in `*inv*.sql` |
| Unrelated migration side effects | **PASS** — only Inventory migrations in INV window; IS-10d tariff guard file preserved |
| Fresh-install catalog | **PASS** — `inventory` seeded `implemented=false` in `60_module_catalog_baseline.sql` |
| Fresh-install MANIFEST companions | Inventory DDL arrives via chronological `supabase/migrations/*inv*` (not listed under `companionMigrations`) — acceptable; confirm on INV-7B clean install |
| No module auto-activation | **PASS** — catalog default `implemented=false`; enablement requires admin RPCs |
| Rental Management | Still unimplemented — **do not claim full product Release 1.0** |

---

## 7. Tests / build

| Command | Result |
|---------|--------|
| `npm test` | **367/367 PASS** (33 files) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** (Next.js 16.3.2) |
| Local SQL acceptance | **22/22 PASS** |

---

## 8. Browser smoke

**BLOCKED.** `.env.local` targets cloud project `klowacuvufknbrkayjhz`. Pointing the Next app at local without an explicit local env switch would risk cloud calls — not done.

**Remaining browser steps (for INV-7B / local UI pass):**

1. Point app at `http://127.0.0.1:54321` (local anon/service keys only; never cloud).
2. Sign in as `inv7a-admin@local.dev` / staff users.
3. Walk Admin Inventory tabs (categories, locations, assets, sessions, documents).
4. Staff session UI: add equipment/consumables, photo upload, save/resume, stale conflict toast.
5. XLSX template download → preview (no writes) → approved import → duplicate SKIP/CONFLICT.
6. Confirm module remains off in cloud.

---

## 9. Remaining blockers

1. **Browser / Next isolation** — `.env.local` still cloud; UI E2E not proven.
2. **Full types file alignment** — canonical `database.types.ts` still drifts from full local gen outside Inventory; Inventory section now present.
3. **Fresh-install proof** — INV migrations not yet re-proven on a brand-new `db reset` + package apply in this phase (local DB already had INV-1…3).
4. **Rental Management unimplemented** — blocks claiming complete commercial Release 1.0.
5. Email Core / debt gate remain **OFF** (unchanged).

---

## 10. INV-7B readiness

**YES** — local SQL/RPC acceptance, financial isolation, security denies, storage bucket, lifecycle enablement, tests/build, and Inventory TypeScript types are ready for a **controlled database release decision**.

**Not claimed:** full Release 1.0 product readiness, cloud apply, or browser smoke.

---

## Appendix — acceptance step dump

```
acceptance_complete       PASS
admin_asset_lifecycle     PASS  events=7
admin_category_location   PASS
building_module_enabled   PASS  enabled=true
catalog_implemented       PASS  implemented=true
collab_approve_post       PASS  posted_asset_count=1
document_path_builder     PASS
financial_isolation       PASS  uk=0 sf=0 pay=0 inv=0
jwt_staff_admin           PASS
lifecycle_activation      PASS  ACTIVE
local_db_reachable        PASS
opening_stock_idempotent  PASS  opening_moves=2
owner_denied              PASS
session_create_start      PASS
staff_cannot_approve      PASS
staff_capabilities        PASS
staff_finding_save_resume PASS
staff_parallel_finding    PASS
stale_row_version         PASS
storage_bucket_private    PASS
storage_policies          PASS  policies=4
unauthorized_staff_denied PASS
```
