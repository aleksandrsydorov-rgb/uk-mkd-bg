# AMADEUS 11 — Phase IS-4 · Database Release  
## Support Fee Opening-State Migration (Security First)

**Date:** 2026-10-14  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261023120000_is4_support_fee_opening_state.sql`  
**Method:** `npx supabase db push --linked --yes` (dry-run showed only this migration)  
**App commit / push / deploy:** none (DB release only)  
**Opening imports / RPC business calls:** none

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Migration applied | **YES** |
| 2 | Migration history synchronized | **YES** |
| 3 | Financial invariants | **PASS** |
| 4 | RPC authorization / RLS | **PASS** |
| 5 | Idempotency and double-finalize protection | **PASS** |
| 6 | Existing financial data unchanged | **YES** |
| 7 | Existing ownership/module states unchanged | **YES** |
| 8 | Tests / build | **PASS** — `npm test` 238/238; `tsc --noEmit` PASS; `npm run build` PASS |
| 9 | Email / debt gates OFF | **YES** |
| 10 | Remaining blockers | App Safe Release (commit/push/deploy) + staged dry-run inventarisation (not this phase) |
| 11 | Ready for staged dry-run | **YES** |

---

## Preflight

| # | Check | Result |
|---|-------|--------|
| 1 | Linked project exactly `klowacuvufknbrkayjhz` | **PASS** — projects list: MKD AMADUES 11 linked; Velvet / ALSYD / bulgarian-platform not linked |
| 2 | Local / remote migration history | **PASS** — remote through `20261022120000`; only `20261023120000` pending |
| 3 | Full SQL review | **PASS** — opening columns + `support_fee_opening_imports` + ledger kind extend + single RPC |
| 4 | Compatibility with assessments / ledger / allocations / D1 | **PASS** — writes via assessed `remaining_due`; no allocation path; additive kind CHECK |
| 5 | Opening obligation/credit not double-counted | **PASS** — unique scope `(property_id, billing_year, obligation_type)`; D1 uses assessment remaining_due |
| 6 | Historical paid ≠ payment / allocation | **PASS** — ledger kind `opening_historical_settlement` only; no `support_fee_allocations` DML |
| 7 | One-time finalization + idempotency at DB | **PASS** — unique `idempotency_key`; unique scope; conflict on existing assessment/charge |
| 8 | Concurrent double-finalize blocked | **PASS** — `properties … FOR UPDATE` + unique scope index + conflict checks |
| 9 | Append-only audit + balance reconciliation | **PASS** — opening_* ledger rows; assessment opening_* audit columns; portal cache only inside RPC |
| 10 | Billing year + transition date validation | **PASS** — year 2000–2100; `transition_date` required |
| 11 | Ownership transfer / apartment accounting | **PASS** — keyed by `property_id` (apartment ledger survives ownership changes) |
| 12 | SECURITY DEFINER hygiene | **PASS** — `search_path=''`; schema-qualified refs; EXECUTE → authenticated only |
| 13 | RLS / authz enforced by DB | **PASS** — RLS on opening_imports; RPC requires `has_staff_role('администрация')` |
| 14 | No unrestricted finance writes | **PASS** — table INSERT/UPDATE revoked from clients; only SELECT for staff; writes via RPC guards |
| 15 | No backfill / bulk financial UPDATE / trigger recalc | **PASS** — DDL + CREATE FUNCTION only; no data DML outside RPC body |
| 16 | No unrelated pending migrations | **PASS** — dry-run: only IS-4 |

**STOP gate:** no critical failure → apply proceeded.

---

## Apply

```
Would push / Applying: 20261023120000_is4_support_fee_opening_state.sql
Finished supabase db push.
```

Post dry-run: **Remote database is up to date.**  
Local = remote for `20261023120000`.

RPC `import_support_fee_opening_state` was **not** invoked with business data.

---

## Baseline → postcheck (unchanged)

| Metric | Pre | Post |
|--------|-----|------|
| properties | 22 | 22 |
| debt_sum | 920.00 | 920.00 |
| over_sum | 163.30 | 163.30 |
| remaining_due_active (D1) | 920.00 | 920.00 |
| assessments n / status | 4 (open 3, void 1) | 4 (open 3, void 1) |
| ledger n / sum | 13 / 2204.50 | 13 / 2204.50 |
| ledger by kind | charge 4, payment 4, void 2, restore 1, adj_credit 1, rev 1 | **identical** |
| opening_* ledger rows | 0 | 0 |
| allocations n / sum | 2 / 80.00 | 2 / 80.00 |
| payment ledger n / sum | 4 / 236.50 | 4 / 236.50 |
| opening_imports rows | n/a (absent) | **0** |
| assessments.opening_import=true | n/a | **0** |
| registry people n / active | 46 / 26 | 46 / 26 |
| book extracts | 4 | 4 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) | 27 (ACTIVE 19 / DISABLED 8) |
| building_modules n / enabled | 27 / 19 | 27 / 19 |
| building_modules fingerprint | `e7aeb778f1bbe55ae4692e514b679403` | `e7aeb778f1bbe55ae4692e514b679403` |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |

---

## Postcheck — schema & security

| Object / check | Result |
|----------------|--------|
| `support_fee_opening_imports` | present |
| Assessment `opening_*` columns | 6 present |
| Kind CHECK includes opening_obligation / opening_historical_settlement / opening_credit | **PASS** (prior kinds retained) |
| Unique idempotency + scope indexes | **PASS** |
| Amounts CHECK (`assessed = paid + remaining`) | **PASS** |
| RLS enabled on opening_imports | **PASS** |
| Table grants | authenticated **SELECT** only; no INSERT/UPDATE/DELETE to clients |
| Policy | `support_fee_opening_imports_staff_select` (admin or accountant) |
| RPC SECURITY DEFINER + `search_path=""` | **PASS** |
| RPC EXECUTE | authenticated; anon denied |
| RPC admin role gate | `has_staff_role('администрация')` |

---

## Validation

| Command | Result |
|---------|--------|
| `npm test` | **238/238 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Live opening-state import E2E: **not claimed** (outside this stage).

---

## Not done (by design)

- No opening balance / debt / credit / historical paid import  
- No synthetic payments  
- No module activation  
- No commit / push / app deploy  
- No Email Core / debt gate enable  
- No Supabase reset / new project  

---

## Remaining blockers

1. App Safe Release (git commit + push + Vercel deploy of IS-4 adapter UI) — separate phase.  
2. Staged dry-run inventarisation on non-production or controlled admin preview before production opening import.

**Ready for staged dry-run: YES**
