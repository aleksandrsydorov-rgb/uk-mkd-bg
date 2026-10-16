# AMADEUS 11 — MTR-1  
## Meters Release 1.0 Acceptance — Targeted Audit

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Production:** https://amadeus11.online  
**Cloud:** `klowacuvufknbrkayjhz` (read-only metadata)  
**Local:** `amadeus11-is10a-local` (schema/RPC presence only; no new business seed)  
**Mode:** Targeted acceptance · **no** cloud writes · **no** migrations · **no** commit/push/deploy  

**References:** `phase_is_3_meters.md` · `is_3_meters_adapter_audit.md` · `phase_is_10_clean_install.md` · `phase_is_10c_clean_install_proof.md` · `freshInstallMeterSchema.ts`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Water functionality matrix | See §1 |
| 2 | Electricity functionality matrix | See §2 |
| 3 | Canonical tables/RPCs | See §3 |
| 4 | Admin / Staff / Owner UI | **PASS** / **PASS** / **PASS** (mode-gated) |
| 5 | Meter replacement | **PASS** (water migration-backed; electricity **live** but packaging **PARTIAL**) |
| 6 | Reading and consumption | **PASS** |
| 7 | Tariff / charge / payment boundaries | Tariff+charge on `submit_*`; payments via `record_*_payment` + balances; **no** reading correction/void RPC |
| 8 | Finance safety | **PASS** on operational submit path (prod); opening inventarisation charge-free by design |
| 9 | RLS/security | **PASS** |
| 10 | Initial Setup | **PARTIAL** (assign inventarisation PASS; opening reading **rows** BLOCKED) |
| 11 | Fresh-install compatibility | **PARTIAL** (DDL/RLS + water assign/replace + submit present; electricity assign/replace **missing** from chronological migrations) |
| 12 | Tests/build | **377/377** · `tsc` PASS · `build` PASS |
| 13 | Remaining blockers | See §8 (P0/P1/P2) |
| 14 | Smallest recommended task | Package live `assign_electricity_meter` / `replace_electricity_meter` (+ missing balance/payment RPCs) into a migration from verified cloud definitions |
| 15 | Ready for Release 1.0 acceptance | **PARTIAL** — production AMADEUS operational; greenfield packaging incomplete; correction + opening reading rows still open |

**Browser E2E:** **not claimed** (not exercised in this phase).

---

## 1. Water functionality matrix

| ID | Capability | Verdict | Evidence |
|----|------------|---------|----------|
| A | Meter registry | **PASS** | `water_meters`; unique `meter_number`; one active per property |
| B | Apartment assignment | **PASS** | `assign_water_meter` (migration `20260925010000_…`); AdminWater + IS-3 |
| C | Initial meter readings | **PARTIAL** | Baseline on meter via `initial_reading` + `installed_at` on assign; **opening reading rows** into `water_readings` **BLOCKED** (would charge) |
| D | Meter replacement | **PASS** | `replace_water_meter` retires old + inserts new; Admin UI |
| E | Periodic reading submission | **PASS** | `submit_water_reading` — owner and/or staff by `water_mode` |
| F | Duplicate prevention | **PASS** | Required `idempotency_key`; unique; conflicts rejected; one active meter |
| G | Reading correction/history | **PARTIAL** | History retained (`water_readings`, retired meters); **no** correct/void RPC (schema has `status`/`reversed_*` unused) |
| H | Consumption calculation | **PASS** | `consumption_m3 = current − previous`; rejects lower/negative/future/out-of-order |
| I | Tariff resolution | **PASS** | `resolve_utility_tariff('water', date)` snapshotted on submit |
| J | Charge generation | **PASS** | `water_ledger` charge when amount > 0 |
| K | Charge/payment reporting | **PASS** | `record_water_payment`, `get_water_balance`; Admin finance + AdminReports ledger views |
| L | Administrator UI | **PASS** | `AdminWater.tsx` — assign/replace/submit/pay/history |
| M | Authorized staff UI | **PASS** | Engineer/admin submit via AdminWater when active (`canSubmitWaterStaff`) |
| N | Owner cabinet | **PASS** | `OwnerUtilities` — submit when `owner_and_staff`; balance; staff_only notice |
| O | Audit / historical preservation | **PASS** | Readings keep meter_id; retired meters retained; submitted_by/via; ledger rows |

---

## 2. Electricity functionality matrix

| ID | Capability | Verdict | Evidence |
|----|------------|---------|----------|
| A | Meter registry | **PASS** | `electricity_meters`; day/night initials; one active per property |
| B | Apartment assignment | **PARTIAL** | **Live on cloud** + Admin UI; function source in `legacy/DO_NOT_RUN/electricity_meter_hotfix.sql` — **not** in `supabase/migrations/` chronological path; **absent** on local clean DB |
| C | Initial meter readings | **PARTIAL** | Baseline via `initial_day/night_reading` on assign; opening `meter_readings` rows **BLOCKED** |
| D | Meter replacement | **PARTIAL** | Live `replace_electricity_meter` + Admin UI; same packaging gap as B |
| E | Periodic reading submission | **PASS** | `submit_electricity_reading` in Package2 migrations; day+night pair |
| F | Duplicate prevention | **PASS** | Idempotency on `(idempotency_key, meter_type)`; one active meter |
| G | Reading correction/history | **PARTIAL** | History retained; **no** correction/void RPC |
| H | Consumption calculation | **PASS** | Day/night deltas; UI pairing `src/lib/electricity.ts` |
| I | Tariff resolution | **PASS** | `resolve_utility_tariff('electricity', date)` day/night rates |
| J | Charge generation | **PASS** | `electricity_charges` always; ledger charge if total > 0 |
| K | Charge/payment reporting | **PARTIAL** | Live `record_electricity_payment` / `get_electricity_balance` + `AdminElectricityFinance`; finance RPCs not fully migration-packaged (local missing balance/payment electricity) |
| L | Administrator UI | **PASS** | Admin section `счётчики` + `электроэнергия` finance |
| M | Authorized staff UI | **PASS** | Staff submit under `electricity_mode` gates |
| N | Owner cabinet | **PASS** | `OwnerElectricity.tsx` mode-gated |
| O | Audit / historical preservation | **PASS** | Paired readings keep `electricity_meter_id`; retired meters kept |

---

## 3. Canonical tables / RPCs

### Tables (canonical — do not duplicate)

| Domain | Tables |
|--------|--------|
| Devices | `water_meters`, `electricity_meters` |
| Readings | `water_readings`, `meter_readings` (`electricity_day` / `electricity_night`) |
| Finance | `water_ledger`, `electricity_ledger`, `electricity_charges` |
| Tariff shells / Core | `water_tariffs`, `electricity_tariffs` (legacy); operational resolve via Tariff Core (`tariff_versions` / `resolve_utility_tariff`) |
| Modes | `building_settings.water_mode`, `building_settings.electricity_mode` |

### RPCs (canonical)

| RPC | Water | Electricity | In chronological migrations | On cloud AMADEUS | On local IS-10a |
|-----|-------|-------------|-----------------------------|------------------|-----------------|
| `assign_*_meter` | yes | yes | water **yes**; electricity **no** (legacy hotfix only) | both | water only |
| `replace_*_meter` | yes | yes | water **yes**; electricity **no** | both | water only |
| `submit_*_reading` | yes | yes | yes (Package2) | both | both |
| `record_*_payment` | yes | yes | water yes; electricity packaging weak | both | water only |
| `get_*_balance` | yes | yes | packaging weak for electricity | both | not listed in local water/elec scan |
| `resolve_utility_tariff` | shared | shared | yes | yes | (Tariff Core) |

**Cloud read-only snapshot (2026-10-16):** all listed assign/replace/submit/record/get/resolve functions present; tables present; ~2 water meters, 2 electricity meters, 6 water readings, 19 meter_readings; modules `water`/`electricity` **ACTIVE** + enabled; email/debt gates OFF.

---

## 4. Admin / Staff / Owner UI

| Surface | Status |
|---------|--------|
| Admin Water | **PASS** — `AdminWater.tsx` |
| Admin Electricity meters | **PASS** — `admin/page.tsx` section `счётчики` |
| Admin Electricity finance | **PASS** — `AdminElectricityFinance.tsx` |
| Staff meter reading | **PASS** — admin/engineer staff paths; mode `staff_only` / `owner_and_staff` |
| Owner Water | **PASS** — `OwnerUtilities` |
| Owner Electricity | **PASS** — `OwnerElectricity.tsx` |
| Module gates | **PASS** — `building_modules` + lifecycle ACTIVE on cloud |

---

## 5. Meter replacement

| Utility | Verdict | Notes |
|---------|---------|-------|
| Water | **PASS** | Retire + new meter; readings stay on old meter_id; first post-replace consume uses new `initial_reading` |
| Electricity | **PARTIAL** | Same semantics live; not reproducible from migrations alone on empty local |

Replacement does **not** auto-post a charge (charge only on later `submit_*` with consumption > 0).

---

## 6. Reading and consumption

| Check | Verdict |
|-------|---------|
| Chronology (date ≥ previous, ≥ installed_at) | **PASS** (enforced in submit) |
| Non-decreasing reading | **PASS** |
| No future dates | **PASS** |
| Consumption from previous or meter baseline | **PASS** |
| Day/night electricity pairing | **PASS** |

Overall: **PASS**.

---

## 7. Tariff / charge / payment boundaries

| Boundary | Behavior |
|----------|----------|
| Opening inventarisation (IS-3) | `assign_*` only — **never** `submit_*` — **no operational charges** |
| Operational reading | `submit_*` → resolve tariff → reading row(s) → charge when consumption amount > 0 |
| Payment | Separate `record_*_payment` into canonical ledger (not fake reads) |
| Reading correction / void | **Not supported** as RPC (ledger `adjustment_*` kinds exist unused for meters) |
| Standalone historical reading inventarisation | **Outside** locked IS-3 scope (explicit IS-3 decision) |

---

## 8. Finance safety

| Requirement | Result |
|-------------|--------|
| No duplicate charges (idempotent submit) | **PASS** |
| No fake payments from opening import | **PASS** (IS-3 never submits) |
| Period / chronology guards | **PASS** |
| No unexplained negative consumption | **PASS** (rejected) |
| Historical readings preserved | **PASS** |
| Replacement does not double-charge | **PASS** (no auto charge on replace) |
| Tariff validity respected | **PASS** (`resolve_utility_tariff`) |
| Canonical ledgers | **PASS** (`water_ledger` / `electricity_ledger`) |

**Verdict: PASS** for the implemented operational path on production.  
**Caveat:** greenfield without electricity assign/replace cannot fully exercise electricity lifecycle from migrations alone.

---

## 9. RLS / security

| Check | Result |
|-------|--------|
| Table SELECT policies for owner/staff | **PASS** (fresh_install meter RLS + utilities package) |
| Writes via SECURITY DEFINER RPCs | **PASS** |
| Owner scoped to `owns_property` | **PASS** |
| Staff roles exact-match (admin/engineer/accountant) | **PASS** |
| Mode gates on submit | **PASS** |
| Guest denied meter_readings | Covered by guest authz tests |
| Anon execute revoked on meter RPCs | Pattern PASS |

**Verdict: PASS.**

---

## 10. Initial Setup (IS-3)

| Check | Result |
|-------|--------|
| Empty / new-complex inventarisation | **PASS** (XLSX CREATE/SKIP) |
| Water / electricity templates BG/RU/EN | **PASS** |
| Preview / validation | **PASS** |
| Approved commit → `assign_*` only | **PASS** |
| Idempotency / SKIP existing | **PASS** |
| No charge on opening | **PASS** |
| Opening reading **row** commit | **BLOCKED** (`OPENING_READING_ROW_COMMIT`) |
| Historical standalone reading inventarisation | **Out of scope** (locked) |

**Verdict: PARTIAL.**

---

## 11. Fresh-install compatibility

From IS-9/IS-10 reports + local `amadeus11-is10a-local` probe:

| Layer | Result |
|-------|--------|
| Meter DDL packages (`10_water`, `20_electricity`, `30_meter_rls`, readings/ledgers) | **PASS** |
| Water assign/replace/submit/payment | **PASS** on local |
| Electricity submit | **PASS** on local |
| Electricity assign/replace | **FAIL** on local (functions absent) |
| Electricity payment/balance | **PARTIAL/FAIL** packaging |
| No production-specific meter seed in packages | **PASS** (packages are schema) |
| Documented gap `water_electricity_submit_operational_rpcs` | Partially stale — submit exists in migrations; **assign/replace electricity** remains the critical packaging hole |

**Verdict: PARTIAL.** No new full clean install executed (existing evidence sufficient).

---

## 12. Tests / build

| Command | Result |
|---------|--------|
| `npm test` | **377/377 PASS** (includes `moduleCoreIs3Meters` 12, `moduleCoreIs3ImportSafety` 9) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| Browser E2E meters | **not run** |

---

## 13. Remaining blockers (prioritized)

### P0
1. **Electricity assign/replace not in chronological migrations** — blocks greenfield/Distribution parity; production AMADEUS has functions from legacy hotfix path.

### P1
2. **Opening reading rows BLOCKED** — no charge-free opening-reading API; inventarisation uses meter baseline fields only.  
3. **No reading correction / void RPC** — schema hints exist; product cannot reverse a wrong operational reading safely.

### P2
4. Dedicated meter consumption report suite beyond balances/ledger pulls.  
5. Refresh `REMAINING_GREENFIELD_MIGRATION_GAPS` wording (submit gap partially closed; electricity assign/replace not listed explicitly).  
6. Browser E2E of owner/staff submit paths not proven in this audit.

---

## 14. Smallest recommended implementation task

**MTR-1a — Electricity meter lifecycle packaging**

1. Export verified cloud definitions of `assign_electricity_meter` and `replace_electricity_meter` (and missing `get_electricity_balance` / `record_electricity_payment` if absent from migrations).  
2. Add a single additive migration under `supabase/migrations/` (no behavior change on AMADEUS if `create or replace` matches live).  
3. Prove on disposable local: assign → submit → replace → submit without charges on assign.  
4. Update fresh-install gap list.

Optional follow-on **MTR-1b:** charge-free `import_opening_*_reading` distinct from `submit_*`.

---

## 15. Ready for Release 1.0?

**PARTIAL.**

- **AMADEUS 11 production:** Water and Electricity meters are **operationally acceptable** for Release 1.0 usage (registry, assign/replace, submit, tariff, charge, pay, admin/staff/owner UI, RLS).  
- **Distribution / clean install:** **not** fully ready until electricity assign/replace (and related finance RPC packaging) are migration-canonized.  
- Inventory accepted; Rental still PAUSE; Email/debt OFF (verified).

---

## Explicit non-actions (honored)

- No cloud writes  
- No financial changes in production  
- No migrations applied  
- No commit / push / deploy  
- No Rental Management work  
- No full clean-install re-run  

**STOP** after this targeted acceptance report.
