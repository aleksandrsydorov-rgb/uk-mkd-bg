# AMADEUS 11 — MTR-6  
## Safe Release Preflight: Water & Electricity Meters

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main` @ `9cfe075a09779807c5c245f9cab9898cf226cb59`  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked · **read-only probes only**)  
**Mode:** PREFLIGHT AND RELEASE PREPARATION ONLY  

**Not performed:** cloud migration apply · commit · push · deploy · meter/financial writes · Email Core / debt gate enablement  

**References:** `phase_mtr_2.md` · `phase_mtr_3.md` · `phase_mtr_3f.md` · `phase_mtr_4_final_acceptance.md` · `phase_mtr_5_correction_ui.md`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Preflight | **PASS** (with mandatory release gates in §4 / §8) |
| 2 | Exact ordered migration list | See §4.1 |
| 3 | Production compatibility | **PASS** |
| 4 | Financial baseline captured | **YES** |
| 5 | Data preservation | **PASS** |
| 6 | Unrelated changes excluded | **YES** (plan + not staged; must stay excluded at commit) |
| 7 | Tests/build | **403/403** · `tsc` PASS · `build` PASS |
| 8 | Rollback plan | See §4.5 |
| 9 | Blockers | See §8 (procedure gates; no MTR SQL P0 defect) |
| 10 | Ready for controlled production release | **YES** — after separate explicit authorization following §4 only |

---

## 1. Preflight — branch & inventory

| Check | Result |
|-------|--------|
| Branch | `main` |
| HEAD | `9cfe075` (INV-10 docs; meters work **uncommitted**) |
| Linked project | `klowacuvufknbrkayjhz` |
| Destructive top-level DML in MTR migrations | **None** (`DELETE`/`TRUNCATE`/`DROP TABLE` absent at migration top level) |
| Historical row rewrite in migration apply | **None** — `UPDATE` only inside correction **RPC bodies** (runtime, authorized) |

### Exact MTR release file set

**A. Migrations (apply order — cloud)**

1. `supabase/migrations/20261109120000_mtr2_electricity_meter_assign_replace.sql`  
2. `supabase/migrations/20261109130000_mtr3_opening_readings_and_safe_corrections.sql`  
3. `supabase/migrations/20261109130100_mtr3_submit_electricity_active_filter.sql`  
4. `supabase/migrations/20261109140000_mtr3f_charged_paid_reading_corrections.sql`  
5. `supabase/migrations/20261109150000_mtr4_utility_balance_payment_rpcs.sql`  
6. `supabase/migrations/20261109151000_mtr4_utility_submit_resolve_packaging.sql`  

**B. Fresh-install package mirrors (commit only; not applied to brownfield cloud)**

- `82_electricity_meter_assign_replace_rpcs.sql`  
- `83_opening_readings_and_safe_corrections.sql`  
- `83f_charged_paid_reading_corrections.sql`  
- `84_utility_balance_payment_rpcs.sql`  
- `87_utility_submit_resolve_packaging.sql`  
- Plus meters packaging touches already local: `MANIFEST.json`, `freshInstallMeterSchema.ts`, `75_utilities_readings_ledgers.sql` (nullable/metadata alignment)

**C. App / i18n / tests (MTR-3 opening wiring + MTR-5 correction UI)**

- `src/components/admin/AdminMeterCorrectionPanel.tsx` (new)  
- `src/components/admin/AdminWater.tsx`  
- `src/app/admin/page.tsx` (electricity correction panel only — stage carefully)  
- `src/lib/utilities.ts` / `src/lib/electricity.ts` / `src/i18n/messages.ts`  
- `src/lib/database.types.ts` (RPC typings)  
- Opening adapters / `metersOpening` / `metersImportCommit` / `moduleCore/index` as required for ENABLED opening path  
- Tests: `moduleCoreMtr2*` … `moduleCoreMtr5*` (+ IS-3 import safety updates if tied to opening ENABLED)

**D. Reports**

- `audit_exports/technical_completion/meters/phase_mtr_*.md` including this file  

### Explicitly **exclude** from this release

| Item | Why |
|------|-----|
| `20261028120000_is9a_…` | Unrelated IS-9a; local-only pending |
| `20261029120000_is9b_…` | Unrelated IS-9b; local-only pending |
| `20261030120000_is10d_…` | Unrelated IS-10d SF cutover neutralize; local-only pending |
| `20261107120000_inv7a1_…` / `20261107120100_inv7a1_…` | Inventory encoding repairs; local-only pending |
| `src/components/admin/AdminInitialSetup.tsx` (and other IS-only churn not required for meters ops) | Brief: do not release unrelated Initial Setup |
| Email Core / debt gate / Rental | Remain OFF / paused |

Working tree is dirty with the above plus audit noise — **nothing must be blindly `git add -A`**.

---

## 2. Production compatibility

### Migration history (linked)

- Remote applied through `20261108120000` (and earlier INV/IS releases).  
- **Local-only pending (not on remote):** IS-9a, IS-9b, IS-10d, INV-7a1×2, **then** MTR `2026110912…151000`.  
- `supabase/config.toml` has `[db.migrations] enabled = false` (IS-10 local isolation).  
  - `db push --dry-run` reports **up to date / migrations skipped** — **do not trust dry-run as “nothing pending”**.  
  - Controlled release must **temporarily enable migrations** *or* apply the six MTR SQL files via an explicit linked procedure that also records `schema_migrations` versions — **without** applying the excluded IS/INV files.

### Live RPC signatures vs pending (read-only)

| RPC | Live today | Pending MTR action |
|-----|------------|--------------------|
| `assign_electricity_meter` / `replace_electricity_meter` | **Present** · signatures match MTR-2 | `CREATE OR REPLACE` (canonical packaging) |
| `assign_water_meter` / `replace_water_meter` | Present | Untouched by MTR-2; used by app |
| `get_water_balance` / `get_electricity_balance` | Present | MTR-4 replace packaging |
| `record_water_payment` / `record_electricity_payment` | Present | MTR-4 replace packaging |
| `submit_water_reading` / `submit_electricity_reading` | Present | MTR-3 filter + MTR-4 Package2 packaging |
| `resolve_utility_tariff(text,date)` | Present (+ separate 3-arg overload) | MTR-4 replaces **2-arg only** (3-arg preserved) |
| `register_water_opening_reading` / `register_electricity_opening_reading` | **Absent** | **New** (MTR-3) |
| `correct_water_reading` / `correct_electricity_reading` | **Absent** | **New** (MTR-3 → MTR-3F) |

### Schema readiness

| Object | Live | MTR-3 adds |
|--------|------|------------|
| `water_readings.status` / reversal cols / idempotency | Present | `reading_kind`, `source_reference`, `corrects_reading_id` (+ indexes) |
| `meter_readings.electricity_meter_id` / idempotency | Present | `status`, `reading_kind`, correction/reversal cols (+ indexes) |

Additive `ADD COLUMN IF NOT EXISTS` + default `'operational'` / `'active'` — compatible with existing rows. No backfill of fake charges.

**Compatibility verdict: PASS** — replaces already-live meter finance/submit RPCs with packaged canonical definitions; adds opening/correction surface; does not invent parallel ledgers.

---

## 3. Financial baseline (read-only · 2026-10-16)

Captured via `npx supabase db query --linked` (SELECT only).

| Metric | Value |
|--------|------:|
| water_meters | 2 |
| electricity_meters | 2 |
| water_readings | 6 |
| meter_readings (day+night) | 16 |
| electricity_charges | 1 · sum total **2.30** |
| water_ledger | 7 · charge 5 · payment 2 · adj 0/0 · sum **189.55** |
| electricity_ledger | 2 · charge 1 · payment 1 · adj 0/0 · sum **4.60** |
| support_fee_ledger | 13 · sum **2204.50** |
| capital_repair_ledger | 7 · sum **1630.00** |
| internet_ledger | 1 |
| properties | 22 |
| `email_core_is_ready()` | **false** |
| `ordinary_debt_gate_enabled` | **false** |

### Module lifecycle (excerpt)

| module_key | state |
|------------|-------|
| water | ACTIVE |
| electricity | ACTIVE |
| support_fee | ACTIVE |
| internet | ACTIVE |
| capital_repair | ACTIVE |
| inventory | ACTIVE |
| rental | DISABLED |
| commercial_rentals | DISABLED |

**Post-release compare must match these counts/sums** (allow only schema_migrations / new function presence — **zero** new ledger/charge/payment/adjustment rows from migration apply).

---

## 4. Release plan (execution — **not** run in MTR-6)

### 4.1 Ordered cloud SQL (only)

Apply **exactly** the six migrations in §1.A, in order.  
**Do not** apply IS-9a / IS-9b / IS-10d / INV-7a1 in this release.

Recommended approach:

1. Confirm linked project = `klowacuvufknbrkayjhz`.  
2. Re-capture baseline (§3).  
3. Temporarily set `[db.migrations] enabled = true` **or** use explicit file apply + insert into `supabase_migrations.schema_migrations` for the six versions only.  
4. Prefer isolating pending non-MTR files (move aside / exclude) so a push cannot swallow them.  
5. Apply MTR-2 → MTR-4 SQL.  
6. Verify RPC presence: opening + correct + submit + balance/payment.  
7. Re-capture baseline — must equal §3.  
8. Restore `config.toml` migrations `enabled = false` if that remains the local IS-10 policy.

### 4.2 App commit / push (after or with DB — prefer DB first)

Stage **only** the MTR file set (§1.A–D). Exclude Initial Setup / IS-9/10 / INV repairs / unrelated audits.

### 4.3 Vercel production deploy

Await Ready alias on https://amadeus11.online.

### 4.4 Post-deploy smoke (read-only + authorized UI)

1. Read-only: baseline equality; RPC `to_regprocedure` checks.  
2. Authenticated admin browser: water/electricity history shows **Correct** for latest active; **do not** submit corrections/payments/charges in smoke unless separately authorized with synthetic property.  
3. Confirm Email Core still OFF · debt gate OFF · Inventory/Support Fee/Internet unchanged.

### 4.5 Rollback strategy

| Layer | Action |
|-------|--------|
| App | Revert/redeploy previous Vercel deployment (UI-only rollback). Opening/correct buttons disappear; live submit/pay continue on DB RPCs. |
| DB function replace | Restore prior function bodies from pre-release `pg_get_functiondef` dump (capture **before** apply). |
| New columns | Leave in place (additive, nullable/defaulted) — do **not** DROP columns in emergency. |
| New RPCs | `DROP FUNCTION` opening/correct if required after app rollback. |
| Data | Migrations do not rewrite history; rollback must **not** DELETE ledger/reading rows. |

### 4.6 Migration risks (accepted / mitigated)

| Risk | Mitigation |
|------|------------|
| Blind `db push` applies IS-9/IS-10d/INV | Isolate files; never push full pending set |
| `migrations enabled=false` hides pending | Use migration list + explicit apply |
| `CREATE OR REPLACE` submit/balance | Canonical packaging; post-check balances unchanged |
| Unique opening indexes | Only constrain `reading_kind='opening'`; existing rows default `operational` |
| Operator runs correction in prod smoke | Smoke = UI visibility only unless synthetic authz test approved |

---

## 5. Validation (this preflight)

| Command | Result |
|---------|--------|
| `npm test` | **403/403 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 6. Data preservation statement

MTR-2…MTR-4 SQL:

- Does **not** `DELETE`/`TRUNCATE` meter or ledger tables.  
- Does **not** seed tariffs, meters, readings, charges, or payments.  
- Does **not** enable Email Core or debt gate.  
- Runtime `UPDATE` of readings exists only inside `correct_*` RPCs (admin/engineer gated) — **not** executed by migration apply.

---

## 7. STOP (MTR-6 boundary)

Preflight report complete. **No** cloud writes, commits, pushes, or deploys performed.

---

## 8. Blockers / gates for the next controlled release authorization

| Pri | Item | Blocks apply? |
|-----|------|---------------|
| P0 | Must not apply IS-9a / IS-9b / IS-10d / INV-7a1 with this release | **Yes** if ignored |
| P0 | Must not rely on `db push --dry-run` while `[db.migrations] enabled=false` | **Yes** if ignored |
| P1 | Commit staging must exclude unrelated Initial Setup / IS working-tree files | **Yes** for clean MTR release |
| P2 | Authenticated browser correction smoke after deploy | No (post-check) |
| — | MTR SQL content defect | **None found** |

**P0 product defect in MTR migrations:** none.

---

## 9. Verdict

**Preflight PASS. Ready for controlled production release: YES** — subject to a **separate explicit authorization** that executes §4 with the exclusion gates in §1 / §8.

Baseline fingerprint for post-check: water_ledger **7 / 189.55** · el_ledger **2 / 4.60** · el_charges **1 / 2.30** · SF **13 / 2204.50** · capital **7 / 1630.00** · email OFF · debt gate OFF.
