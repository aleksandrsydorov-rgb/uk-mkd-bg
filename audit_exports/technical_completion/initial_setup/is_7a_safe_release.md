# AMADEUS 11 — Phase IS-7a · Safe Release  
## Tariff Readiness Gate + Fresh-Install DDL Packaging

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz` (companion migration already applied in DB release — **not reapplied**)  
**Production:** https://amadeus11.online  
**Previous tip:** `bbdf52a` (IS-6a docs)  
**This release:** `ba8f89f82104e656cc87753c048db42b9612e0d0`

**References:**
- `phase_is_7a.md`
- `is_7a_db_release.md`
- `is_7_remaining_modules_inventory.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Commit hash / push | **`ba8f89f`** pushed `main` → `origin/main` (`bbdf52a..ba8f89f`) |
| 2 | Vercel deployment | **`dpl_8heny4WsnVx9zPGpVoVLGT5uCpwf`** · **Ready** · alias **https://amadeus11.online** · URL `uk-mkd-bg-8soe-5vwn71r5z` · ~57s |
| 3 | Tests / build | **PASS** — `npm test` **276/276**; `npx tsc --noEmit` PASS; `npm run build` PASS |
| 4 | Tariff readiness panel (Initial Setup) | **PASS** — «Готовность тарифов (Tariff Core)» visible; import vs billing columns |
| 5 | Support Fee / Internet tariff readiness | **PASS** — both show published applicable tariff found (готово) |
| 6 | Meter inventory independence | **PASS** — Water card: inventory does not require billing tariff; template download available |
| 7 | BG/RU/EN prerequisite messages | **PASS** — RU verified in production UI; EN/BG covered by unit tests (`dictionaries`) |
| 8 | Existing modules / pages smoke | **PASS** — Initial Setup, Property Book, Support Fee (Такса); Internet/Water via setup cards. Guest Mode interactive **BLOCKED** after accidental logout (🚪) — session ended; no re-auth |
| 9 | Data / gates unchanged | **YES** — fingerprints identical; email OFF; debt OFF |
| 10 | Fresh-install package not executed | **YES** — package remains PARTIAL / not ready for E2E clean install |
| 11 | Migration not reapplied | **YES** — dry-run up to date before/after |
| 12 | Ready for next Initial Setup phase | **YES** |

---

## Preflight (at publish)

| Check | Result |
|-------|--------|
| Branch `main` == `origin/main` before push | **PASS** (at `bbdf52a`) |
| IS-7a change review | **PASS** — tariff gate, AdminInitialSetup, i18n, SF classify, packaging, companion migration, tests, phase/db docs |
| Local companion vs applied remote | **PASS** — remote has `20261026120000`; SHA256 `DD8465EF…44AAAC`; dry-run **up to date** |
| Unrelated / secrets excluded | **PASS** — staged only IS-7a paths; excluded other `audit_exports/*`, `tmp/`, unrelated doc edits |
| Tariff checks read-only | **PASS** — `list_tariffs` + pure evaluators; no publish RPCs |
| Tariff Core sole SoT | **PASS** |
| SF / Internet require published tariffs for import | **PASS** |
| Meter inventory independent of billing tariffs | **PASS** |
| Import vs billing readiness separated | **PASS** |
| No auto tariff publish / module activation | **PASS** |
| Package marked PARTIAL / not E2E ready | **PASS** — README + `phase_is_7a.md` |
| No other migrations pending | **PASS** |
| STOP conditions | none |

---

## Validation (at publish)

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 26 files, 276 tests |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — Next.js 16.3.2 |

---

## Release

### Commit

```
feat: add Initial Setup tariff readiness gate and fresh-install meter DDL packaging (IS-7a)
ba8f89f82104e656cc87753c048db42b9612e0d0
```

Staged paths (only):
- `src/components/admin/AdminInitialSetup.tsx`
- `src/i18n/messages.ts`
- `src/lib/moduleCore/adapters/supportFeeOpening.ts`
- `src/lib/moduleCore/index.ts`
- `src/lib/moduleCore/freshInstallMeterSchema.ts`
- `src/lib/moduleCore/tariffSetupGate.ts`
- `supabase/migrations/20261026120000_is7a_fresh_install_meter_baseline_ddl.sql`
- `supabase/packages/fresh_install/*`
- `tests/security/unit/moduleCoreIs7aFreshInstallTariffGate.test.ts`
- `audit_exports/technical_completion/initial_setup/phase_is_7a.md`
- `audit_exports/technical_completion/initial_setup/is_7a_db_release.md`
- `audit_exports/technical_completion/initial_setup/is_7_remaining_modules_inventory.md`

### Push

```
bbdf52a..ba8f89f  main -> main
```

### Vercel

| Field | Value |
|-------|-------|
| Deployment id | `dpl_8heny4WsnVx9zPGpVoVLGT5uCpwf` |
| URL | `uk-mkd-bg-8soe-5vwn71r5z-aleksandrsydorov-rgbs-projects.vercel.app` |
| readyState | **READY** |
| Aliases | `amadeus11.online`, `uk-mkd-bg-8soe.vercel.app`, … |
| Duration | ~57s |

Migration **not** reapplied.

---

## Production UI smoke (admin session)

| Check | Result |
|-------|--------|
| Initial Setup → tariff panel | **PASS** — heading «Готовность тарифов (Tariff Core)» |
| support_fee / internet readiness | **PASS** — Импорт + Биллинг = готово; published tariff found |
| water / electricity panel rows | **PASS** — готово (published tariffs present on this install) |
| Water module card inventory note | **PASS** — «Инвентаризация водомеров не требует тарифа биллинга…» |
| No auto-publish copy | **PASS** |
| Property Book page | **PASS** — «Книга этажной собственности» |
| Support Fee (Такса) page | **PASS** — «Такса поддержки» |
| Internet / meters ops pages | **PARTIAL** — Internet/Water exercised via Initial Setup cards; full ops nav interrupted |
| Guest Mode page | **BLOCKED** — accidental click of logout (🚪) ended session; no credential bypass / re-login |

---

## Data safety postcheck

| Metric | Pre (Safe Release) | Post (after deploy smoke) |
|--------|--------------------|---------------------------|
| tariff_versions / published | 8 / 8 | 8 / 8 |
| support_fee_annual_policies | 2 | 2 |
| water_meters / electricity_meters | 2 / 2 | 2 / 2 |
| properties | 22 | 22 |
| support_fee_ledger | 13 | 13 |
| internet_subscriptions / ledger | 1 / 1 | 1 / 1 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) | identical |
| building_modules_fp | `e7aeb778…` | identical |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |
| migration `20261026120000` | present | present |

No tariff publish, module activation, import, or billing triggered.

---

## Fresh-install safety

| Check | Result |
|-------|--------|
| Package files present under `supabase/packages/fresh_install/` | **YES** |
| Remaining DDL/RPC/seed gaps documented | **YES** — README + `phase_is_7a.md` §4 |
| Package execution in this release | **PROHIBITED / NOT DONE** |
| Claim of end-to-end clean-install readiness | **NOT MADE** — status remains **PARTIAL** |

---

## Remaining limitations

- Greenfield chronological migrate without package-first bootstrap remains incomplete.
- Guest Mode interactive smoke after logout **BLOCKED** (session ended).
- Missing-tariff UI paths not live-forced on production (all applicable tariffs already published); covered by unit tests.

---

## STOP

Safe Release complete.  
**No** package execution, **no** migration reapply, **no** tariff/module mutations, **no** email/debt enable.
