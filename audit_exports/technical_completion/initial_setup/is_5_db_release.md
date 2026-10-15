# AMADEUS 11 — Phase IS-5 · Database Release  
## Internet Opening-State Migration (Security First)

**Date:** 2026-10-15  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261024120000_is5_internet_opening_state.sql`  
**Method:** `npx supabase db push --linked --yes` (dry-run showed only this migration)  
**App commit / push / deploy:** none (DB release only)  
**Opening imports / RPC business calls:** none  
**Billing cron / WO / tariff publish:** none

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Migration applied | **YES** |
| 2 | Migration history synchronized | **YES** |
| 3 | RPC authorization / RLS | **PASS** |
| 4 | Paid-through / cron safety | **PASS** |
| 5 | Ledger compatibility | **PASS** |
| 6 | Idempotency / concurrency | **PASS** |
| 7 | Existing Internet data unchanged | **YES** |
| 8 | Existing financial data unchanged | **YES** |
| 9 | Tests / build | **PASS** — `npm test` 250/250; `tsc --noEmit` PASS; `npm run build` PASS |
| 10 | Email / debt gates OFF | **YES** |
| 11 | Remaining blockers | App Safe Release (commit/push/deploy) + separately authorized staged inventarisation / opening E2E (not this phase) |
| 12 | Ready for IS-5 Safe Release | **YES** |

---

## Preflight

| # | Check | Result |
|---|-------|--------|
| 1 | Linked project exactly `klowacuvufknbrkayjhz` | **PASS** — MKD AMADUES 11 linked; Velvet / ALSYD / bulgarian-platform not linked |
| 2 | Local / remote migration history | **PASS** — remote through `20261023120000`; only `20261024120000` pending |
| 3 | Full SQL review | **PASS** — opening columns + `internet_opening_imports` + ledger kind extend + balance update + helper + single RPC |
| 4 | Canonical Internet / Tariff / WO compatibility | **PASS** — uses `internet_subscriptions`, `internet_ledger`, `resolve_internet_tariff`, `work_orders.internet_action` |
| 5 | No `request_internet_connect` / WO create | **PASS** — verified in source + live `pg_get_functiondef` |
| 6 | No synthetic payments / allocations / recurring charges | **PASS** — opening path inserts only `opening_debit` / `opening_credit` |
| 7 | Published Internet tariff required | **PASS** — `resolve_internet_tariff(transition_date)`; remote has 1 published internet tariff |
| 8 | Paid-through / next_charge_on / month-end | **PASS** — live: Apr 30 → May 1; Jan 31 → Feb 1; billing_day(Jan 31)=28 |
| 9 | No immediate duplicate cron charge | **PASS** — helper raises when `next_charge_on <= sofia_today` (verified) |
| 10 | First legitimate future charge preserved | **PASS** — schedule set to first unpaid charge date after paid-through |
| 11 | Existing subscriptions not overwritten | **PASS** — `FOR UPDATE` + conflict if any subscription exists |
| 12 | Unfinished Internet WO blocks | **PASS** — open/in_progress + `internet_action IS NOT NULL` |
| 13 | One-time finalization / idempotency / concurrency | **PASS** — unique `idempotency_key`; unique `property_id`; subscription row lock |
| 14 | Admin authz + RLS | **PASS** — `has_staff_role('администрация')`; RLS staff SELECT on opening_imports |
| 15 | SECURITY DEFINER hygiene | **PASS** — `search_path=""`; qualified refs; EXECUTE → authenticated; helper EXECUTE revoked from clients |
| 16 | Opening kinds in balance | **PASS** — `get_internet_balance` includes opening_debit/credit |
| 17 | No backfill / bulk UPDATE / destructive cleanup | **PASS** — DDL + CREATE FUNCTION only; no data DML outside RPC body |
| 18 | No unrelated pending migrations | **PASS** — dry-run: only IS-5 |

**STOP gate:** no critical failure → apply proceeded.

---

## Apply

```
Would push / Applying: 20261024120000_is5_internet_opening_state.sql
Finished supabase db push.
```

Post dry-run: **Remote database is up to date.**  
Local = remote for `20261024120000`.

RPC `import_internet_opening_state` was **not** invoked with business data.  
No inventarisation / opening E2E was run in this phase.

---

## Baseline → postcheck (unchanged)

| Metric | Pre | Post |
|--------|-----|------|
| internet_subscriptions n / status | 1 (inactive 1) | 1 (inactive 1) |
| next_charge fingerprint | `d970e5e8087c5f09bcd12e8110c10f01` | `d970e5e8087c5f09bcd12e8110c10f01` |
| internet_ledger n / sum | 1 / 15.00 | 1 / 15.00 |
| ledger by kind | charge 1 / 15.00 | **identical** |
| opening_* ledger rows | 0 | 0 |
| payments n / sum | 0 / 0 | 0 / 0 |
| internet WO all / pending | 2 / 0 | 2 / 0 |
| opening_imports rows | n/a (absent) | **0** |
| subscriptions.opening_import=true | n/a | **0** |
| published internet tariffs | 1 | 1 |
| properties | 22 | 22 |
| SF remaining_due active (D1) | 920.00 | 920.00 |
| SF ledger n | 13 | 13 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) | 27 (ACTIVE 19 / DISABLED 8) |
| building_modules n / enabled | 27 / 19 | 27 / 19 |
| building_modules fingerprint | `e7aeb778f1bbe55ae4692e514b679403` | `e7aeb778f1bbe55ae4692e514b679403` |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |

---

## Postcheck — schema & security

| Object / check | Result |
|----------------|--------|
| `internet_opening_imports` | present |
| Subscription `opening_*` columns | 5 present |
| Kind CHECK includes opening_debit / opening_credit | **PASS** (prior kinds retained) |
| Unique idempotency + property indexes | **PASS** |
| RLS enabled on opening_imports | **PASS** |
| Table grants | authenticated **SELECT** only |
| Policy | `internet_opening_imports_staff_select` (admin or accountant) |
| RPC SECURITY DEFINER + `search_path=""` | **PASS** |
| RPC EXECUTE | authenticated; anon denied |
| Helper EXECUTE | revoked from anon/authenticated/public |
| RPC admin role gate | `has_staff_role('администрация')` |
| RPC does not call connect / insert WO | **PASS** (live def) |
| Balance includes opening kinds | **PASS** (live def) |
| Paid-through math | Apr30→May1; Jan31→Feb1; immediate cron path blocked |

---

## Validation

| Command | Result |
|---------|--------|
| `npm test` | **250/250 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## Safety observed this phase

- Applied **only** `20261024120000_is5_internet_opening_state.sql`  
- No Internet opening imports  
- No opening write RPC business calls  
- No subscription / ledger / next_charge_on mutations beyond schema defaults  
- No billing cron  
- No work-order create/close  
- No tariff publish/change  
- No module activation changes  
- No Email Core / debt gate enablement  
- No commit / push / deploy  
- No inventarisation E2E claim  

---

## Remaining blockers (for Safe Release / inventarisation, not for DB release close)

1. App Safe Release: commit / push / deploy IS-5 application code (not done here).  
2. Separately authorized staged dry-run inventarisation before production opening import.  
3. Apartments with existing subscriptions/ledger or unfinished Internet WOs require manual reconciliation before inventarisation.  
4. Opening import E2E is **not** claimed PASS in this phase.

---

## STOP

IS-5 database release complete.  
**Do not** commit, push, or deploy from this phase.  
**Do not** run opening inventarisation without a separate authorization.
