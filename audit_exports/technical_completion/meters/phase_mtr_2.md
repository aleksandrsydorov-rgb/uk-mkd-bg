# AMADEUS 11 — MTR-2  
## Electricity Meter Assignment & Replacement — Fresh-Install Packaging

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** `klowacuvufknbrkayjhz` (read-only; **no writes**)  
**Local:** `amadeus11-is10a-local` · `127.0.0.1:54322`  
**Mode:** Local packaging + validation · **no** cloud migration · **no** commit/push/deploy  

**Reference:** `audit_exports/technical_completion/meters/mtr_1_acceptance.md`  
**Canonical source:** live cloud definitions matching `supabase/legacy/DO_NOT_RUN/electricity_meter_hotfix.sql` (assign/replace bodies only)

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Canonical production signatures | See §1 |
| 2 | Missing dependency root cause | See §2 |
| 3 | Migration/package file(s) | See §3 |
| 4 | Electricity assignment | **PASS** |
| 5 | Electricity replacement | **PASS** |
| 6 | Authorization / RLS | **PASS** |
| 7 | Historical preservation | **PASS** |
| 8 | No financial side effects | **PASS** |
| 9 | Fresh-install compatibility | **PASS** |
| 10 | Tests / build | **381/381** · `tsc` PASS · `build` PASS |
| 11 | Cloud data unchanged | **YES** |
| 12 | Remaining blockers | See §8 |
| 13 | Ready for MTR-3 | **YES** |

---

## 1. Canonical production signatures

| RPC | Identity arguments | Returns | Security |
|-----|--------------------|---------|----------|
| `assign_electricity_meter` | `p_property_id bigint, p_meter_number text, p_initial_day_reading numeric, p_initial_night_reading numeric, p_installed_at date` | `SETOF public.electricity_meters` | `SECURITY DEFINER`, `search_path = ''` |
| `replace_electricity_meter` | `p_property_id bigint, p_new_meter_number text, p_initial_day_reading numeric, p_initial_night_reading numeric, p_installed_at date, p_replacement_reason text` | `SETOF public.electricity_meters` | same |

**Roles:** `администрация` **or** `инженер` via `public.has_staff_role`; requires non-empty `auth.email()`.  
**Grants:** `EXECUTE` → `authenticated`; `REVOKE` from `public` / `anon`.  
**Local post-apply:** identity args match production / `database.types.ts` exactly.

---

## 2. Missing dependency root cause

Electricity **assign/replace** existed only as:

1. Live hotfix on cloud AMADEUS, and  
2. `supabase/legacy/DO_NOT_RUN/electricity_meter_hotfix.sql`

They were **never** added to chronological `supabase/migrations/` or the fresh-install package. Water assign/replace were packaged in `20260925010000_water_role_exact_match_hardening.sql`; electricity was not.

**Prerequisites (fail-closed in MTR-2 SQL):**

- `public.electricity_meters`
- `public.properties`
- `public.has_staff_role(text)`

No unavailable production-only objects required for these two RPCs.

---

## 3. Migration / package file(s)

| Path | Role |
|------|------|
| `supabase/migrations/20261109120000_mtr2_electricity_meter_assign_replace.sql` | Chronological additive `CREATE OR REPLACE` + grants |
| `supabase/packages/fresh_install/82_electricity_meter_assign_replace_rpcs.sql` | Same body in distributive package |
| `src/lib/moduleCore/freshInstallMeterSchema.ts` | Ordered files + gap `electricity_balance_payment_rpcs` + dependency order |
| `supabase/packages/fresh_install/MANIFEST.json` | Ordered files, required functions, gaps; **IS-10d package id preserved** |
| `tests/security/unit/moduleCoreMtr2ElectricityAssignReplace.test.ts` | Packaging / signature / no-finance assertions |

**Not rewritten:** any previously applied production migration. Legacy `DO_NOT_RUN` left untouched as reference only.

---

## 4–8. Local validation (`amadeus11-is10a-local`)

Applied migration via `docker cp` + `psql -f` (UTF-8; PowerShell pipe corrupts Cyrillic).

| Check | Result |
|-------|--------|
| Assign to apartment (`property_id=5`, meter `MTR2-ELEC-001`) | **PASS** |
| Duplicate active assignment rejected | **PASS** (`An active electricity meter is already assigned.`) |
| Unauthorized caller denied | **PASS** (`Not authorized.`) |
| Wrong / missing property rejected | **PASS** (`Property not found.`) |
| Replace retires old, inserts new (`MTR2-ELEC-002`) | **PASS** |
| Reading stays on retired `electricity_meter_id` | **PASS** |
| `electricity_ledger` / `electricity_charges` stay 0 | **PASS** |
| Water `assign_water_meter` still works; water ledger 0 | **PASS** |
| No published tariff versions created | **PASS** (count = 0) |

Disposable local rows only (`MTR2-*` apartments/meters). No cloud operations.

---

## 9. Fresh-install compatibility

- Package file `82_…` ordered after `20_electricity_meters.sql` and `05_auth_staff_helpers.sql`.
- `requiredFunctionsAfterPackage` includes both electricity RPCs.
- Package-path re-apply of `82_…` succeeded (`assign_ok` / `replace_ok`).
- IS-10d financial-safety correction preserved (`packageId` / `phase` / `86_distributive_block_…`).
- No production meter seed; no published utility prices; no business data import in MTR-2 SQL.
- Remaining explicit gap added: `electricity_balance_payment_rpcs` (submit gap retained for package-only path).

Full empty-DB clean-install **not** re-run twice; package ordering + local apply of `82` + unit coverage prove the changed path.

---

## 10. Tests / build

| Command | Result |
|---------|--------|
| Targeted MTR-2 + IS-7a fresh-install tests | PASS |
| `npm test` | **381/381** PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS |

---

## 11. Cloud data unchanged

**YES** — no cloud SQL, no dashboard writes, no `db push`, no meter assign/replace on `klowacuvufknbrkayjhz`.

---

## 12. Remaining blockers (post-MTR-2)

| Priority | Item |
|----------|------|
| P1 | Package / migration for `get_electricity_balance` / `record_electricity_payment` (`electricity_balance_payment_rpcs`) |
| P1 | Opening `meter_readings` / `water_readings` inventarisation rows still charge-gated (IS-3 / MTR-1) |
| P2 | `water_electricity_submit_operational_rpcs` still outside package body (present in chronological Package2 migrations) |
| P2 | Publish tariff / capital bulk gaps unchanged |

Email Core and debt gate remain **OFF** (unchanged). Rental Management untouched.

---

## 13. Ready for MTR-3

**YES** — electricity assign/replace are distributively packaged and locally proven without altering live production behavior.

**STOP** — no commit, push, deploy, or cloud migration performed.
