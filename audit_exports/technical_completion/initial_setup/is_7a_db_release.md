# AMADEUS 11 — Phase IS-7a · Database Release  
## Meter Baseline Compatibility Companion Migration

**Date:** 2026-10-15  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261026120000_is7a_fresh_install_meter_baseline_ddl.sql`  
**Method:** `npx supabase db push --linked --yes` (dry-run showed only this migration)  
**Fresh-install package:** **NOT executed** (`supabase/packages/fresh_install/` left untouched)  
**App commit / push / deploy:** none (DB release only)  
**Module / tariff changes:** none  

**Reference:** `phase_is_7a.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Migration applied | **YES** |
| 2 | Migration history synchronized | **YES** — local = remote `20261026120000`; post dry-run: up to date |
| 3 | Existing-installation no-op verified | **YES** — tables/policies unchanged; CREATE IF NOT EXISTS skipped existing objects |
| 4 | Meter/Property Book data unchanged | **YES** — counts identical (properties 22 · water_meters 2 · electricity_meters 2 · readings unchanged) |
| 5 | Financial data unchanged | **YES** — SF ledger 13 · water_ledger 7 · electricity_ledger 2 · tariff_versions 8 |
| 6 | RLS/security | **PASS** — RLS still on; same SELECT policies; no policy drop/replace |
| 7 | Tests/build | **PASS** — `npm test` **276/276** · `tsc --noEmit` PASS · `npm run build` PASS |
| 8 | Email/debt gates OFF | **YES** — `email_core_is_ready()=false` · `ordinary_debt_gate_enabled=false` |
| 9 | Remaining greenfield gaps | Package-first still required; `property_registry_people`, readings/ledgers, full Book RPC baseline, auth/tariff/catalog seeds (see `phase_is_7a.md` §4) |
| 10 | Ready for IS-7a Safe Release | **YES** |

---

## Preflight

| # | Check | Result |
|---|-------|--------|
| 1 | Linked project exactly `klowacuvufknbrkayjhz` | **PASS** — MKD AMADUES 11 linked |
| 2 | Local / remote migration history | **PASS** — remote through `20261025120000`; only `20261026120000` pending |
| 3 | Exact companion SQL review | **PASS** — CREATE IF NOT EXISTS + index IF NOT EXISTS + conditional policy create |
| 4 | Safe against existing meter/property tables | **PASS** — tables already present; no ALTER/REPLACE definitions |
| 5 | Expected no-op genuine | **PASS** — CREATE TABLE skipped; policies already named `water_meters_select` / `electricity_meters_select` |
| 6 | No replacement of tables/policies/functions | **PASS** — no DROP POLICY / CREATE OR REPLACE function |
| 7 | No destructive DDL / backfill / financial writes | **PASS** — no DELETE/TRUNCATE/UPDATE/INSERT on domain rows |
| 8 | Meter RLS / authz compatibility | **PASS** — helpers present; RLS already enabled; policy create gated on `pg_policies` absence |
| 9 | No unintended effects on readings/meters/ledgers/charges | **PASS** — migration touches DDL only |
| 10 | No unrelated pending migration | **PASS** — dry-run: only IS-7a companion |

**STOP gate:** no critical failure → apply proceeded.

**Note (additive indexes):** Preflight showed missing `properties_apartment_number_idx`, `water_meters_property_id_idx`, `electricity_meters_property_id_idx`. Migration created these via `IF NOT EXISTS` (non-destructive, no row changes). Unique one-active indexes already existed and were not rebuilt.

---

## Apply

```
Would push / Applying: 20261026120000_is7a_fresh_install_meter_baseline_ddl.sql
Finished supabase db push.
```

Post dry-run: **Remote database is up to date.**  
Local = remote for `20261026120000`.

`supabase/packages/fresh_install/` was **not** executed.  
No new Supabase project. No module/tariff mutations. No inventarisation.

---

## Baseline → postcheck (business data)

| Metric | Pre | Post |
|--------|-----|------|
| properties | 22 | 22 |
| water_meters | 2 | 2 |
| electricity_meters | 2 | 2 |
| water_readings | 6 | 6 |
| meter_readings | 19 | 19 |
| water_ledger | 7 | 7 |
| electricity_ledger | 2 | 2 |
| support_fee_ledger | 13 | 13 |
| tariff_versions | 8 | 8 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) | 27 (ACTIVE 19 / DISABLED 8) |
| water_meters columns | 9 canonical | identical |
| electricity_meters columns | 10 canonical | identical |
| meter SELECT policies | water + electricity | identical (no new policies) |
| RLS water/electricity/properties | true | true |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |

**Schema delta (justified):** three additive indexes created (`properties_apartment_number_idx`, `water_meters_property_id_idx`, `electricity_meters_property_id_idx`).

---

## Postcheck — security

| Check | Result |
|-------|--------|
| No DROP / TRUNCATE / CASCADE on domain tables | **PASS** |
| No CREATE OR REPLACE of assign_* / list_tariffs | **PASS** |
| Policies not dropped or redefined | **PASS** — `IF NOT EXISTS` on `pg_policies` skipped |
| Grants: SELECT to authenticated re-asserted | **PASS** — compatible with prior meter SELECT model |
| Tariff records unmodified | **PASS** — `tariff_versions` count unchanged |
| Package files not applied | **PASS** |

---

## Tests / build

```
npm test          → 26 files, 276 tests PASS
npx tsc --noEmit  → PASS
npm run build     → PASS
```

---

## Remaining greenfield gaps (unchanged)

Still **PARTIAL** for empty-project chronological migrate without package pre-apply:

- `property_registry_people` and fuller Book baseline  
- `meter_readings` / `water_readings` / utility ledgers  
- Full Property Book RPC baseline  
- Auth helper bootstrap ordering for brand-new DBs  
- Tariff catalog publish seed  
- Complex catalog / `building_modules` seed  

See `phase_is_7a.md` and `supabase/packages/fresh_install/README.md`.

---

## STOP

Database release complete.  
**No** commit, push, deploy, import, or fresh-install package execution.  
**Ready for IS-7a Safe Release** (app commit/push/deploy) when authorized separately.
