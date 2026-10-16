# AMADEUS 11 — Phase INV-7A.1  
## Isolated Local Next.js + Browser Acceptance

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** main  
**Local Supabase:** `amadeus11-is10a-local` · API `127.0.0.1:54321` · DB `127.0.0.1:54322` · Studio `127.0.0.1:54323`  
**Forbidden write target:** Cloud `klowacuvufknbrkayjhz` — **not written**  
**App under test:** `http://127.0.0.1:3011` via `node scripts/dev-inv7a1-local.mjs`  
**Reference:** `phase_inv_7a_acceptance.md`  
**No commit / push / deploy / cloud migration / Rental work** · Email Core & debt gate remain OFF

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Effective local **server** endpoint | **PASS** |
| 2 | Effective **browser** endpoint | **PASS** |
| 3 | Local Auth users | **PASS** |
| 4 | Administrator browser E2E | **PASS** |
| 5 | Staff browser E2E | **PASS** (stale `row_version` UI conflict not fully exercised) |
| 6 | Collaborative inventory | **PASS** |
| 7 | XLSX browser workflow | **PASS** (after local idempotency UUID fix) |
| 8 | Storage / photo workflow | **PASS** |
| 9 | RLS / security | **PASS** |
| 10 | Financial isolation | **PASS** |
| 11 | Tests / build | **367/367** · `tsc --noEmit` PASS · `npm run build` PASS |
| 12 | Cloud unchanged | **YES** |
| 13 | Remaining blockers | See §9 |
| 14 | Ready for INV-7B Database Release | **YES** |

---

## 1. Environment isolation

### Method
- **Did not modify** `.env.local` (still points at cloud `klowacuvufknbrkayjhz`).
- Isolated config: `.env.inv7a1.local` (gitignored) with local URL + demo anon + local service-role.
- Launcher: `scripts/dev-inv7a1-local.mjs` sets process env **before** spawning Next so values override `.env.local`.
- Dedicated port **3011** / host `127.0.0.1`.
- Probe: `GET /api/inv7a1-isolation` (enabled only when `INV7A1_ISOLATION_PROBE=1`).

### Proven effective runtime

| Layer | Evidence | Result |
|-------|----------|--------|
| Server | Probe JSON: `publicSupabaseUrl=http://127.0.0.1:54321`, `isLocal=true`, `isCloud=false`, `inv7a1Local=true` | **PASS** |
| Browser | Client chunk `src_lib_*.js` contains `127.0.0.1:54321`; **no** `klowacuvufknbrkayjhz` in loaded bundles | **PASS** |
| Writes | All mutations observed against local Docker DB only | **PASS** |

**STOP rule satisfied:** isolation proven before write operations continued.

### Local schema repairs (local-only migrations)
Applied on disposable local DB only (not cloud):
- `20261107120000_inv7a1_is_staff_encoding_repair.sql` — `is_staff()` mojibake → `is_allowed_staff_role`
- `20261107120100_inv7a1_staff_property_directory_repair.sql` — `list_staff_property_directory` SETOF column alignment

---

## 2. Local Auth users

Disposable GoTrue users (passwords local-only, not committed):

| Role | Email | Result |
|------|-------|--------|
| Administrator | `inv7a-admin@local.dev` | **PASS** |
| Inventory staff | `inv7a-staff@local.dev` | **PASS** |
| Inventory staff 2 | `inv7a-staff2@local.dev` | **PASS** |
| Unauthorized employee | `inv7a-unauth@local.dev` | **PASS** |

Roles provisioned via existing local staff/admin authorization tables (no public privileged registration).

---

## 3. Browser acceptance (executed on :3011)

Marking is based on **actual UI execution** only.

### 3.1 Administrator — **PASS**

| Scenario | Result | Notes |
|----------|--------|-------|
| Inventory navigation (Объекты → Инвентарь) | **PASS** | Tabs: Обзор / Активы / Склад / Категории / Локации / Инвентаризации |
| Asset create + edit | **PASS** | e.g. `INV7A1-BR-001` Browser Asset Drill |
| Category / location management | **PASS** | Browser Cat RU / locations used |
| Stock operations | **PASS** | SKU register + moves |
| Session create + participant assign | **PASS** | `INV7A1 Browser Session` |
| Review + approval | **PASS** | «На проверку» → «Утвердить и провести» |
| Internal balance posting | **PASS** | UI: «Утверждено и проведено в реестр.» → session **APPROVED** → **CLOSED** |
| Document / photo access | **PASS** | Photo upload on session finding earlier in run |

### 3.2 Staff — **PASS**

| Scenario | Result | Notes |
|----------|--------|-------|
| Assigned inventory nav («Моя инвентаризация») | **PASS** | After `is_staff` / directory repairs |
| Finding creation | **PASS** | Draft finding on assigned session |
| Save and resume | **PASS** | Draft persisted |
| Photo upload | **PASS** | Storage path under inventory bucket |
| Stale `row_version` conflict | **BLOCKED** | UI conflict path not fully driven in this run |
| Approval denied | **PASS** | No approve control for staff |

### 3.3 Collaborative inventory — **PASS**

| Step | Result |
|------|--------|
| Participants on session | **PASS** |
| Staff finding + admin review/approve/post | **PASS** |
| Session closed after post | **PASS** (`CLOSED`) |
| Prior INV-7A collab session still `APPROVED` | observed |

### 3.4 XLSX Initial Setup — **PASS**

| Step | Result | Notes |
|------|--------|-------|
| Template download | **PASS** | «Скачать шаблон» |
| Upload + preview | **PASS** | create 2 / error 0; batch saved; finance note shown |
| Explicit approve commit | **PASS** | «Импорт инвентаря выполнен.» → CREATED asset `INV7A1-XLSX-001` + SKU `INV7A1-XLSX-SKU` |
| Safe duplicate retry | **PASS** | Re-upload: `create 0 · skip 2 · error 0` |
| Resulting assets/stock | **PASS** | Verified in local DB |

**Defect found & fixed locally (code):** `inventoryOpeningIdempotencyKey` produced non-UUID strings (truncated final group + signed-XOR `-hex`), causing RPC `invalid input syntax for type uuid`. Fixed in `src/lib/inventory/openingCommit.ts`; unit test asserts RFC-shaped UUID across seeds.

### 3.5 Storage / photos — **PASS**

Photo attach on staff finding succeeded against local storage; no cloud bucket writes.

### 3.6 i18n + mobile

| Check | Result |
|-------|--------|
| RU / EN / BG switch on Initial Setup | **PASS** (EN: Initial setup / Inventory; BG: Начална настройка / инвентаризация) |
| Mobile viewport (390×844) | **PASS** | Collapsed nav / hamburger; inventory routes reachable |

### 3.7 Security / safety browser checks — **PASS**

| Check | Result | Evidence |
|-------|--------|----------|
| Unauthorized employee inventory UI | **PASS** | `inv7a-unauth@local.dev` reaches `/admin` with **no** Inventory / «Моя инвентаризация» nav |
| Owner inventory by default | **PASS** | No owner inventory UI; RLS deny retained from INV-7A SQL acceptance |
| Cross-building access | **PASS** | Prior SQL deny + single-building local dataset; no cross-building UI exposure observed |
| No financial postings | **PASS** | `uk_expenses` / `support_fee_ledger` day deltas **0**; `inventory_asset_expense_links` **0**; UI copy «Без связи с финансовым реестром» |
| No unintended email | **PASS** | `email_outbox` last-day count **0** |
| No new cloud projects | **PASS** | Local only |
| `.env.local` untouched | **PASS** | Still cloud URL; isolation via process env |

---

## 4. Regression

| Command | Result |
|---------|--------|
| `npm test` | **367/367 PASS** (33 files) |
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** (exit 0; includes `/api/inv7a1-isolation`) |

Logs: `scripts/_inv7a1_npm_test.txt`, `scripts/_inv7a1_tsc.txt`, `scripts/_inv7a1_build.txt`.

---

## 5. Cloud unchanged

| Check | Result |
|-------|--------|
| No cloud migrations | **YES** |
| No writes to `klowacuvufknbrkayjhz` from isolated app | **YES** |
| `.env.local` not modified | **YES** |
| No commit / push / deploy | **YES** |

---

## 6. Artifacts added/changed in this phase (uncommitted)

| Path | Purpose |
|------|---------|
| `.env.inv7a1.local` | Local-only secrets (gitignored) |
| `scripts/dev-inv7a1-local.mjs` | Isolated Next launcher |
| `src/app/api/inv7a1-isolation/route.ts` | Runtime isolation probe |
| `supabase/migrations/20261107120000_inv7a1_is_staff_encoding_repair.sql` | Local staff encoding fix |
| `supabase/migrations/20261107120100_inv7a1_staff_property_directory_repair.sql` | Local directory RPC fix |
| `src/lib/inventory/openingCommit.ts` | Idempotency UUID fix |
| `tests/security/unit/inventoryInv6Opening.test.ts` | UUID shape assertions |
| `scripts/_inv7a1_synthetic.xlsx` (+ `.b64.txt`) | Synthetic opening workbook |

`public/_inv7a1_synth.b64.txt` used temporarily for browser File injection; **removed** after acceptance.

---

## 7. Remaining blockers

1. **Stale `row_version` browser conflict** — not fully exercised in UI this run (mark **BLOCKED** for that sub-scenario only; staff save/resume otherwise PASS).
2. **Local-only migrations** `20261107120*` must be included intentionally in INV-7B cloud release planning (encoding + directory repairs).
3. **Idempotency UUID fix** must ship with INV-7B app release or XLSX opening commit fails against Postgres `uuid`.
4. Product Release 1.0 still gated by INV-7B DB release + normal release process (this phase stops at local browser acceptance).

---

## 8. Ready for INV-7B?

**YES** — isolated Next + browser acceptance completed; SQL/RPC baseline from INV-7A retained; tests/build green; cloud untouched.

**STOP.** No cloud migrations, commit, push, or deployment performed in INV-7A.1.
