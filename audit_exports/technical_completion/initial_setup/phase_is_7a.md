# AMADEUS 11 — Phase IS-7a  
## Fresh Installation Readiness — Meter DDL Packaging + Tariff Setup Gate

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg · **Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (not modified)  
**Production:** https://amadeus11.online (not deployed)  
**Mode:** Local implementation + tests + report only  

**Baseline:** IS-1–IS-6a released · Email Core sending OFF · Debt gate OFF  

**References:**  
- `is_7_remaining_modules_inventory.md`  
- `is_3_migration_packaging_proposal.md`  
- Live schema probe: `tmp/is7a_schema_probe_out.json` (read-only)

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Fresh-install DDL packaging implemented | **PARTIAL** |
| 2 | Meter schema dependencies covered | **YES** (properties FK + `water_meters` / `electricity_meters` + indexes + conditional RLS) |
| 3 | Existing-installation compatibility | **PASS** (`CREATE IF NOT EXISTS` / no destructive DML; not applied) |
| 4 | Tariff setup gate implemented | **YES** |
| 5 | Support Fee tariff readiness | **PASS** (blocks import when published applicable tariff missing) |
| 6 | Internet tariff readiness | **PASS** (existing classify + shared gate panel) |
| 7 | Meter inventory independence | **PASS** (water/electricity inventarisation not blocked by missing billing tariffs) |
| 8 | Remaining greenfield migration gaps | See §4 |
| 9 | Migration/package filenames | See §2 |
| 10 | Tests/build results | **276/276** PASS · `tsc --noEmit` PASS · `npm run build` PASS |
| 11 | Existing business data unchanged | **YES** (no migrations applied; no domain DML) |
| 12 | Ready for DB/Safe Release | **YES** (companion migration is no-op on live schema; tariff gate is UI/logic only) |

---

## 1. Scope completed

### A. Fresh-install DDL packaging (PARTIAL)

- Documented bootstrap package under `supabase/packages/fresh_install/` for **empty** future projects (apply **before** chronological `supabase/migrations/`).
- Companion idempotent migration for the existing chain (safe no-op when tables already exist).
- Explicitly **does not** claim full greenfield readiness from `migrations/` alone.
- Did **not** execute `supabase/legacy/DO_NOT_RUN/*`.
- Did **not** apply migrations to `klowacuvufknbrkayjhz`.

### B. Tariff setup gate

- Shared evaluator `src/lib/moduleCore/tariffSetupGate.ts` (extensible rule registry).
- Separates **import / inventarisation** readiness vs **billing / activation** readiness.
- Initial Setup UI panel (BG/RU/EN) showing status per gated module.
- Support Fee classify now errors with `tariff_not_configured` when `supportFeeTariffConfigured === false`.
- Internet continues to require published tariff for import.
- Water/electricity inventory remains independent of billing tariffs (billing readiness flagged separately).
- Property Book prerequisite message for property-dependent modules.
- **No** automatic tariff publish, version create/modify, or module lifecycle activation.

---

## 2. Artifacts

### Package (empty-project bootstrap)

| File | Role |
|------|------|
| `supabase/packages/fresh_install/README.md` | Apply order + gaps |
| `supabase/packages/fresh_install/MANIFEST.json` | Ordered file list + gap list |
| `supabase/packages/fresh_install/00_properties_baseline.sql` | Minimal `public.properties` |
| `supabase/packages/fresh_install/10_water_meters.sql` | Canonical `water_meters` |
| `supabase/packages/fresh_install/20_electricity_meters.sql` | Canonical `electricity_meters` |
| `supabase/packages/fresh_install/30_meter_rls_enable.sql` | RLS enable + conditional SELECT policies |

### Companion migration (existing chain; not applied)

| File | Role |
|------|------|
| `supabase/migrations/20261026120000_is7a_fresh_install_meter_baseline_ddl.sql` | Idempotent CREATE IF NOT EXISTS + conditional RLS |

### App / tests

| File | Role |
|------|------|
| `src/lib/moduleCore/freshInstallMeterSchema.ts` | Ordering / safety / schema assertions (no `node:fs`) |
| `src/lib/moduleCore/tariffSetupGate.ts` | Tariff readiness evaluator |
| `src/lib/moduleCore/adapters/supportFeeOpening.ts` | SF tariff import gate |
| `src/components/admin/AdminInitialSetup.tsx` | Tariff panel + SF/Internet/meters messaging |
| `src/i18n/messages.ts` | BG/RU/EN `is7a*` strings |
| `tests/security/unit/moduleCoreIs7aFreshInstallTariffGate.test.ts` | Focused IS-7a tests (15) |

---

## 3. Live schema preflight (read-only)

Probe confirmed on `klowacuvufknbrkayjhz`:

- `properties`, `property_registry_people`, `water_meters`, `electricity_meters`, `water_readings`, `meter_readings`, ledgers, `tariff_catalog` exist.
- `assign_water_meter`, `list_tariffs` exist.
- `water_meters` / `electricity_meters` column sets match packaged DDL shape.

Therefore companion migration is expected **no-op** on production when later applied in a DB Release.

---

## 4. Remaining greenfield migration gaps (PARTIAL)

Package + companion **do not** make a blank Supabase fully ready via chronological migrate alone. Still missing / incomplete:

1. `property_registry_people` (+ full Book tables beyond minimal `properties`)
2. `meter_readings` / `water_readings`
3. `water_ledger` / `electricity_ledger`
4. Full Property Book RPC baseline for an empty project
5. Auth helpers (`owns_property`, `has_staff_role`, `is_owner`) — expected earlier in platform history; policies are conditional
6. Tariff Core catalog seed / publish workflow (manual Admin Tariffs — no auto-publish)
7. Complex-specific `module_catalog` / `building_modules` seed for a new installation
8. Chronological migrate **without** package pre-apply still fails early migrations that assume meter/property tables exist

**Verdict:** Fresh-install readiness for meters/properties baseline = **PARTIAL**. Future distributive work must keep package-first bootstrap until gaps are closed.

---

## 5. Tariff gate behavior

| Module | Import inventarisation | Billing / activation |
|--------|------------------------|----------------------|
| `support_fee` | Requires published applicable `support_fee` | Same |
| `internet` | Requires published applicable `internet` | Same |
| `water` | **Not** blocked by missing water tariff | Billing needs published `water` |
| `electricity` | **Not** blocked by missing electricity tariff | Billing needs published `electricity` |
| `capital_repair` | Not inventarised in IS-7a | Billing needs published `capital_repair` |

Property Book must be established before property-dependent setup (UI warning).

---

## 6. Safety checklist

| Action | Status |
|--------|--------|
| Apply migrations | **NOT DONE** |
| New Supabase project | **NOT DONE** |
| Reset existing Supabase | **NOT DONE** |
| Import data | **NOT DONE** |
| Modify meter/property/tariff rows | **NOT DONE** |
| Change module states | **NOT DONE** |
| Trigger billing | **NOT DONE** |
| Commit / push / deploy | **NOT DONE** |
| Enable Email Core sending | **NOT DONE** |
| Enable debt gate | **NOT DONE** |

---

## 7. Tests / build

```
npm test          → 26 files, 276 tests PASS
npx tsc --noEmit  → PASS
npm run build     → PASS (Next.js 16.3.2 Turbopack)
```

Covered: migration ordering · canonical meter DDL · RLS compatibility · existing no-op safety · missing/published tariffs · SF/Internet readiness · meter inventory independence · BG/RU/EN messages · no auto activation · data preservation statements.

---

## 8. Ready for DB / Safe Release?

**YES** — with constraints:

- **DB Release (later):** apply only `20261026120000_is7a_fresh_install_meter_baseline_ddl.sql` after approval; expect no-op on current live schema; verify `to_regclass` for meter tables unchanged.
- **Safe Release (later):** ship tariff gate UI + SF classify gate with app; no Email/debt changes.
- **Do not** treat full greenfield distributive install as ready until §4 gaps are closed.

---

## STOP

Local implementation, tests, and this report complete.  
**No** migrations applied, **no** commit/push/deploy.
