# AMADEUS 11 — Phase IS-8 · Database Release  
## Capital Repair Opening State — Financial Safety

**Date:** 2026-10-15  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261027120000_is8_capital_repair_opening_state.sql`  
**Method:** `npx supabase db push --linked --yes` (dry-run showed only this migration)  
**App commit / push / deploy:** none (DB release only)  
**Opening import / inventarisation:** **not invoked**  
**Fresh-install package:** **not executed**

**References:** `is_8_capital_repair_audit.md` · `phase_is_8_capital_repair.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Migration applied | **YES** |
| 2 | Migration history synchronized | **YES** — local = remote `20261027120000`; post dry-run: up to date |
| 3 | RPC authorization/RLS | **PASS** |
| 4 | Assessment linkage | **PASS** |
| 5 | Capital ledger/report reconciliation | **PASS** — existing net balance identical; consumers include opening kinds |
| 6 | Idempotency/concurrency | **PASS** — unique indexes + property `FOR UPDATE` in RPC |
| 7 | Existing Capital Repair data unchanged | **YES** |
| 8 | Support Fee / Internet / Book data unchanged | **YES** |
| 9 | Tests/build | **PASS** — `npm test` **288/288** · `tsc --noEmit` PASS · `npm run build` PASS |
| 10 | Email/debt gates OFF | **YES** — `email_core_is_ready()=false` · `ordinary_debt_gate_enabled=false` |
| 11 | Remaining blockers | App Safe Release; live opening-import E2E not claimed; fresh-install Capital DDL still PARTIAL |
| 12 | Ready for IS-8 Safe Release | **YES** |

---

## Preflight

| # | Check | Result |
|---|-------|--------|
| 1 | Linked project exactly `klowacuvufknbrkayjhz` | **PASS** — MKD AMADUES 11 linked; `.env.local` URL matches |
| 2 | Local / remote migration history | **PASS** — remote through `20261026120000`; only `20261027120000` pending |
| 3 | Complete SQL review | **PASS** — opening kinds, imports table, RPC, balance/fund/ownership consumers |
| 4 | Independent of SF / Internet ledgers | **PASS** — no DML/DDL on `support_fee_*` / `internet_*` |
| 5 | Opening rows require `assessment_id` | **PASS** — CHECK + RPC always sets assessment |
| 6 | Assessment building/year linkage | **PASS** — resolve/create shell by title `Капитальный ремонт {year}` |
| 7 | No double-count vs operational | **PASS** — CONFLICT on existing `charge` / opening obligation |
| 8 | Paid/partial/debt arithmetic | **PASS** — `assessed = paid + remaining`; credit ⊥ debt |
| 9 | Opening credit in consumers | **PASS** — balance / fund totals / ownership overdue updated |
| 10 | No NULL assessment_id for opening | **PASS** — constraint + JOIN-safe kinds |
| 11 | No overwrite of existing assessments | **PASS** — shell create only if missing; no UPDATE of live assessments |
| 12 | Admin authz + isolation | **PASS** — `has_staff_role('администрация')`; property lock |
| 13 | RLS + SECURITY DEFINER `search_path=""` | **PASS** |
| 14 | Idempotency / concurrency | **PASS** — idempotency unique; scope unique; `FOR UPDATE` |
| 15 | No synthetic payment/charge | **PASS** — opening kinds only; no `charge_*` / `record_*_payment` |
| 16 | No direct UPDATE of derived balances | **PASS** — no portal debt mutation |
| 17 | No historical backfill / destructive ops | **PASS** |
| 18 | No unrelated migrations | **PASS** — dry-run: only IS-8 |

**STOP gate:** no critical failure → apply proceeded.

---

## Apply

```
Would push / Applying: 20261027120000_is8_capital_repair_opening_state.sql
Finished supabase db push.
```

Post dry-run: **Remote database is up to date.**  
Local = remote for `20261027120000`.

`import_capital_repair_opening_state` was **not** invoked with business data.  
No new assessments or ledger rows created by this release.

---

## Baseline → postcheck (business data)

| Metric | Pre | Post |
|--------|-----|------|
| capital_repair_assessments n / status | 4 (active 4) | 4 (active 4) |
| assessments ids fingerprint | `96c20e8a142abf1c5c92dd2097e0b0a4` | **identical** |
| assessments titles fingerprint | `5f51ad680bc192ef49ac231ce7abc389` | **identical** |
| capital_repair_ledger n / sum | 7 / 1630 | 7 / 1630 |
| ledger ids fingerprint | `9b8740d868d335652d9cfbe805db8c88` | **identical** |
| ledger by kind | charge 6, payment 1 | **identical** |
| ledger net balance | 1430 | 1430 |
| null assessment_id ledger rows | 1 (operational payment) | 1 |
| opening_* ledger rows | 0 | **0** |
| capital_repair_opening_imports | absent | present, **0 rows** |
| import_capital_repair_opening_state | absent | **present** |
| support_fee assessments / remaining_due | 4 / 920 | 4 / 920 |
| support_fee_ledger n / sum | 13 / 2204.5 | 13 / 2204.5 |
| internet_subscriptions / ledger | 1 / 1 (sum 15) | 1 / 1 (sum 15) |
| properties | 22 | 22 |
| registry people / book extracts | 46 / 4 | 46 / 4 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) | **identical** |
| building_modules fp | `58a3f7b1d1d49eddd66e6a32c96002cb` | **identical** |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |

Audit baseline (4 assessments / 7 ledger) **confirmed live** and unchanged.

---

## Postcheck — schema & security

| Object / check | Result |
|----------------|--------|
| `capital_repair_opening_imports` | present; RLS enabled |
| Kind CHECK includes opening_* + prior kinds | **PASS** |
| Opening/charge require `assessment_id` CHECK | **PASS** (`IS NOT NULL`) |
| Unique: one opening_obligation per apt×assessment | **PASS** |
| Unique: imports idempotency / scope / source_ref | **PASS** |
| Policy | `capital_repair_opening_imports_staff_select` (admin or accountant) |
| Table grants | authenticated **SELECT** only; no INSERT to clients |
| RPC SECURITY DEFINER + `search_path=""` | **PASS** |
| RPC EXECUTE | authenticated; anon denied |
| Admin role gate in RPC | **PASS** |
| `get_capital_repair_balance` includes opening kinds | **PASS** |
| Fund totals / ownership overdue `search_path=""` | **PASS** |

---

## Validation

| Command | Result |
|---------|--------|
| `npm test` | **288/288 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Live Capital Repair opening-import E2E: **not claimed** (outside this stage).

---

## Not done (by design)

- No opening balance / debt / credit / historical paid import  
- No synthetic payments or operational charges  
- No module activation  
- No commit / push / app deploy  
- No Email Core / debt gate enable  
- No Supabase reset / new project / fresh-install package  

---

## Remaining blockers

1. **IS-8 Safe Release** — git commit + push + Vercel deploy of adapter UI (separate phase).  
2. Staged dry-run inventarisation before any production opening import.  
3. Fresh-install Capital Repair DDL/RPC packaging remains PARTIAL (documented gaps).

**Ready for IS-8 Safe Release: YES**
