# AMADEUS 11 — Phase INV-10 Safe Release  
## Inventory Permissions in Personnel Settings

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Reference:** `phase_inv_10_staff_permissions.md`  
**Release commit:** `7bbd5a5394596db0df30202519580982716302a9`  
**Vercel:** `dpl_7dbheGyTH9N29TiQeWkqnGRvfAM8` · **Ready** · aliased to `amadeus11.online`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Preflight | **PASS** |
| 2 | Commit hash / push | `7bbd5a5394596db0df30202519580982716302a9` · **PASS** → `origin/main` |
| 3 | Vercel deployment | `dpl_7dbheGyTH9N29TiQeWkqnGRvfAM8` · **Ready** |
| 4 | Tests/build | **377/377** · `tsc` PASS · `build` PASS |
| 5 | Personnel UI | **PASS** (admin session; form opened; Cancel — no save) |
| 6 | Permission security | **PASS** |
| 7 | Existing staff permissions unchanged | **YES** (`staff_inventory_capabilities` = 0 before/after) |
| 8 | Ticket settings preserved | **YES** (visible on form; no save) |
| 9 | Financial data unchanged | **YES** (SFL 13 / 2204.50) |
| 10 | Remaining blockers | BG locale UI click timing flaky in automation; keys covered by unit tests |
| 11 | Inventory final acceptance | **PASS** |

---

## 1. Preflight

| Check | Result |
|-------|--------|
| Branch `main` = tracking `origin/main` | **PASS** (ahead 1 before push) |
| INV-10-only staging | **PASS** — 7 files; IS-9a/9b/IS-10d **not** staged |
| Cloud RPC `inventory_set_staff_capabilities` signature | **PASS** — 9 boolean args + `p_staff_id` |
| Master/granular → canonical caps | **PASS** |
| Disabled/inactive → no effective rights | **PASS** (payload forces false) |
| Participate requires session assignment | **PASS** (unchanged INV-5 contract) |
| Approve/post/write-off admin-only | **PASS** (form never sets those flags) |
| Ticket responsibility preserved | **PASS** |
| No migrations | **PASS** |

Staged set: `admin/page.tsx`, `messages.ts`, `inventory/index.ts`, `staffPermissionsForm.ts`, unit test, phase_inv_10 report, local SQL evidence script.

---

## 2. Validation

| Command | Result |
|---------|--------|
| `npm test` | **377/377 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 3. Release

1. Commit `7bbd5a5` — INV-10 Personnel Inventory permissions.  
2. Push `aa24af1..7bbd5a5` → `origin/main`.  
3. Vercel Production **Ready** (~54s): `dpl_7dbheGyTH9N29TiQeWkqnGRvfAM8`.  
4. Alias: https://amadeus11.online  

No `db push`. No cloud migrations.

---

## 4. Production Personnel UI smoke

Authorized administrator session on https://amadeus11.online/admin.

| Check | Result |
|-------|--------|
| Система → Персонал | **PASS** |
| Open edit (engineer@example.com) | **PASS** |
| «Ответственность — Инвентарь» | **PASS** |
| Master «Имеет доступ к Инвентарю» | **PASS** |
| Granular controls (expand client-side) | **PASS** — view / participate / edit / stock / maintenance |
| Ticket «Ответственность» still present | **PASS** |
| RU labels | **PASS** |
| EN labels | **PASS** — Responsibility — Inventory / Has access to Inventory / granular EN |
| BG labels | Unit-test covered; live BG form open flaky in automation |
| Save | **Not used** — Cancel only |

---

## 5. Safety (before → after)

| Metric | Before | After |
|--------|--------|-------|
| `staff_inventory_capabilities` | 0 | **0** |
| `inventory_assets` | 0 | 0 |
| support_fee_ledger | 13 / 2204.50 | 13 / 2204.50 |
| capital_repair_ledger | 7 / 1630.00 | (unchanged preflight baseline) |
| Inventory lifecycle | ACTIVE / enabled | **ACTIVE / enabled** |
| email_enabled | false | false |
| ordinary_debt_gate_enabled | false | false |

No employee permission writes. No Inventory business records. Email/debt remain OFF.

---

## 6. Inventory final acceptance

**PASS** — INV-10 Safe Release published; Personnel Inventory responsibility UI live; security/data gates hold.

---

## 7. STOP

Safe Release and report complete. No further cloud writes.
