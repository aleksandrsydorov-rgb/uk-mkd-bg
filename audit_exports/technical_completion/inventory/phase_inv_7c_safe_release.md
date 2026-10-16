# AMADEUS 11 — Phase INV-7C  
## Safe Application Release — No Automatic Activation

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Release commit:** `6999ee89fbc34530fa7143af1ef89c28c276b4c6`  
**Vercel:** `dpl_3yKbU3QPBuJvcagcx58B6K99CYi5` · **Ready** · aliased to `amadeus11.online`

**References:** `phase_inv_7a1_browser_acceptance.md` · `phase_inv_7b_db_release.md` · `phase_inv_7b1_directory_fix.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Release preflight | **PASS** |
| 2 | Commit hash | `6999ee89fbc34530fa7143af1ef89c28c276b4c6` |
| 3 | Push status | **PASS** (`main` → `origin/main`) |
| 4 | Vercel deployment | `dpl_3yKbU3QPBuJvcagcx58B6K99CYi5` · **Ready** |
| 5 | UUID idempotency fix included | **YES** |
| 6 | Stale row_version handling | **PASS** (unit + UI wiring; full browser E2E conflict still not re-run on prod) |
| 7 | Inventory remains DISABLED | **YES** |
| 8 | Existing modules smoke | **PARTIAL** (homepage PASS; protected admin UI **BLOCKED** — no authorized session) |
| 9 | Existing financial data unchanged | **YES** |
| 10 | Tests/build | **368/368** · `tsc` PASS · `build` PASS |
| 11 | Cloud project unchanged except approved releases | **YES** (no re-apply / no activation) |
| 12 | Remaining blockers | See §8 |
| 13 | Ready for controlled Inventory activation | **YES** |

---

## 1. Preflight

| Check | Result |
|-------|--------|
| Branch `main` = `origin/main` (before push) | **PASS** |
| Inventory cloud migrations present | INV-1…INV-3 + INV-7B.1 (`20261108120000`) |
| Staff directory fix applied | **YES** (INV-7B.1) |
| UUID fix in `openingCommit.ts` | **YES** (unsigned hex + 12-digit final group) |
| Surgical Inventory types in `database.types.ts` | **YES** (no full overwrite) |
| Lifecycle DISABLED / `implemented=false` / `enabled=false` | **YES** |
| No cloud migration re-apply this phase | **YES** |
| IS-9a/9b/IS-10d | Committed for history only; **not** executed |

Staged release set: Inventory app/UI/lib/tests, opening adapter, i18n, types, approved migrations + preserved IS-9/10 files, inventory audit docs, local inv7a1 launcher/probe (probe gated OFF in prod).

---

## 2. Stale row_version UI

| Requirement | Result |
|-------------|--------|
| Detect conflict (`isStaleRowVersionError`) | **PASS** |
| Clear BG/RU/EN message (`invStaffConflict`) | **PASS** |
| Discard local draft / load latest (`resolveStaffStaleConflict`) | **PASS** |
| Explicit reload affordance (`invStaffReloadLatest`) | **PASS** |
| Never silent overwrite | **PASS** (form reset to server row) |
| Deterministic unit regression | **PASS** (`inventoryInv5StaffUi.test.ts`) |

**Limitation:** production browser E2E of concurrent staff conflict was **not** re-executed in this phase (no authenticated staff session). Local unit + UI contract proven.

---

## 3. Release

1. Commit `6999ee8` — Inventory Safe Release (no activation).  
2. Push `main` → `origin/main` (`8b6595c..6999ee8`).  
3. Vercel Production **Ready** in ~48s: `dpl_3yKbU3QPBuJvcagcx58B6K99CYi5`.  
4. Alias: https://amadeus11.online  

No `db push`. No imports. No activation.

---

## 4. Production smoke

| Check | Result |
|-------|--------|
| Homepage https://amadeus11.online | **PASS** (200, AMADEUS 11) |
| Login form present | **PASS** |
| Admin authenticated Property Book / Staff directory / Finance / Guest Mode | **BLOCKED** (no authorized session; auth not bypassed) |
| Inventory nav while DISABLED | Expected hidden for staff/admin gates; not contradicted by public homepage |
| Runtime blocking errors on home | None observed |

---

## 5. Data safety (before → after)

| Metric | Before | After |
|--------|--------|-------|
| `properties` | 22 | 22 |
| `staff` | 5 | 5 |
| `support_fee_ledger` rows | 13 | 13 |
| `support_fee_ledger` sum(`amount`) | 2204.50 | 2204.50 |
| `inventory_assets` | 0 | 0 |
| `inventory_stock_items` | 0 | 0 |
| `building_modules.inventory.enabled` | false | false |
| `module_lifecycle.inventory` | DISABLED | DISABLED |
| `module_catalog.inventory.implemented` | false | false |

No Inventory business seed. No opening stock. No module auto-activation. Email/debt gates not toggled.

---

## 6. Regression

| Command | Result |
|---------|--------|
| `npm test` | **368/368 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 7. Cloud / migrations note

- Approved Inventory DDL already on cloud from INV-7B / INV-7B.1.  
- This release publishes **application code** only.  
- IS-9a/9b/IS-10d SQL files are in git for packaging history; do **not** blind-`db push` them.

---

## 8. Remaining blockers

1. Authenticated production smoke of Property Book / Finance / Guest Mode / Staff directory (needs operator session).  
2. Controlled Inventory activation (separate phase — lifecycle + `implemented`/`enabled`).  
3. Do not apply IS-9a to cloud (mojibake risk) without a dedicated IS review.

---

## 9. Ready for controlled activation?

**YES** — app is on production Ready; module stays DISABLED until an explicit activation phase.

**STOP** after Safe Release and this report.
