# AMADEUS 11 — Phase IS-6a · Database Release  
## Historical UK Expenses Opening Migration (Security First)

**Date:** 2026-10-15  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261025120000_is6a_uk_expense_opening.sql`  
**Method:** `npx supabase db push --linked --yes` (dry-run showed only this migration)  
**App commit / push / deploy:** none (DB release only)  
**Expense inventarisation / RPC business calls:** none  
**Approve / publish expenses:** none  

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Migration applied | **YES** |
| 2 | Migration history synchronized | **YES** — local = remote `20261025120000`; dry-run: up to date |
| 3 | RPC authorization / RLS | **PASS** |
| 4 | Pending-review-only import | **PASS** — RPC hardcodes `на проверке`; no `опубликован` in RPC body |
| 5 | Budget execution isolation | **PASS** — live `admin_budget_execution` / `owner_get_budget_year` call helper |
| 6 | Idempotency / concurrency | **PASS** — unique source_ref + idempotency indexes live |
| 7 | Existing expense data unchanged | **YES** — still **0** rows; opening_import true = **0** |
| 8 | Existing financial data unchanged | **YES** — SF / Internet / modules fingerprints match baseline |
| 9 | Tests | **PASS** — `npm test` **261/261** |
| 10 | Email / debt gates OFF | **YES** |
| 11 | Remaining blockers | App Safe Release (commit/push/deploy) + separately authorized staged inventarisation (not this phase) |
| 12 | Ready for IS-6a Safe Release | **YES** |

---

## Preflight

| # | Check | Result |
|---|-------|--------|
| 1 | Linked project exactly `klowacuvufknbrkayjhz` | **PASS** — MKD AMADUES 11 linked |
| 2 | Local / remote migration history | **PASS** — remote through `20261024120000`; only `20261025120000` pending |
| 3 | Full SQL review | **PASS** — opening columns + audit table + guard trigger + budget helper + RPC |
| 4 | Canonical `uk_expenses` SoT | **PASS** — no parallel expenses table |
| 5 | No backfill / rewrite of existing expenses | **PASS** — `ADD COLUMN … DEFAULT false` only; 0 existing rows |
| 6 | Opening marker not client-spoofable | **PASS** — guard trigger requires GUC `app.uk_expense_opening_import=1` |
| 7 | Budget excludes opening without dropping ops expenses | **PASS** — filter only when `opening_import` |
| 8 | Published opening still excluded from ops execution | **PASS** — helper ignores publish state |
| 9 | Pending status enforced by RPC | **PASS** |
| 10 | Publish still via `can_approve_uk_expenses` | **PASS** — function still present; RPC does not publish |
| 11 | source_ref uniqueness / idempotency | **PASS** |
| 12 | Admin-only finalize | **PASS** — `has_staff_role('администрация')` |
| 13 | RLS / SECURITY DEFINER / grants | **PASS** — `search_path=""`; EXECUTE → authenticated; table SELECT only |
| 14 | No metadata privilege escalation | **PASS** — opening identity immutable outside RPC |
| 15 | No AP / SF / Internet ledger ops in migration | **PASS** |
| 16 | No bulk UPDATE / destructive / history rewrite | **PASS** |
| 17 | No unrelated migrations | **PASS** — dry-run: only IS-6a |

**STOP gate:** no critical failure → apply proceeded.

---

## Apply

```
Would push / Applying: 20261025120000_is6a_uk_expense_opening.sql
Finished supabase db push.
```

Post dry-run: **Remote database is up to date.**  
Local = remote for `20261025120000`.

RPC `import_uk_expense_opening_row` was **not** invoked with business data.  
No inventarisation / approve / publish was run in this phase.

---

## Baseline → postcheck (unchanged business data)

| Metric | Pre | Post |
|--------|-----|------|
| uk_expenses n | 0 | 0 |
| uk_expenses opening_import=true | n/a | **0** |
| uk_expense_opening_imports | absent | present · **0** rows |
| import_uk_expense_opening_row | absent | **present** |
| budget years / lines / categories | 1 / 7 / 7 | 1 / 7 / 7 |
| published expense sums | empty | empty |
| SF ledger n | 13 | 13 |
| SF remaining_due active | 0 | 0 |
| internet_subscriptions | 1 | 1 |
| internet_ledger n / sum | 1 / 15 | 1 / 15 |
| module_lifecycle | 27 (ACTIVE 19 / DISABLED 8) | 27 |
| building_modules fingerprint | `58a3f7b1…` | `58a3f7b1…` identical |
| email_core_is_ready() | false | false |
| ordinary_debt_gate_enabled | false | false |

---

## Postcheck — schema & security

| Object / check | Result |
|----------------|--------|
| Opening columns on `uk_expenses` | 8 present (`opening_*` + `source_ref`) |
| `uk_expense_opening_imports` | present · RLS on · authenticated **SELECT** only |
| Unique indexes (source_ref / idempotency) | **PASS** |
| Guard trigger `uk_expenses_guard_opening_biu` | **PASS** |
| RPC SECURITY DEFINER + `search_path=""` | **PASS** |
| RPC EXECUTE | authenticated; anon denied |
| RPC admin gate | **PASS** |
| RPC pending-only / no publish | **PASS** |
| RPC no SF/Internet/payment paths | **PASS** |
| `admin_budget_execution` excludes opening | **PASS** |
| `owner_get_budget_year` excludes opening | **PASS** |
| Category publish trigger exempts opening | **PASS** |
| `can_approve_uk_expenses` retained | **PASS** |

---

## Safety observed

- Applied **only** `20261025120000_is6a_uk_expense_opening.sql`  
- No expense CREATE/IMPORT/APPROVE/PUBLISH  
- No SF / Internet ledger writes  
- No module lifecycle / UX toggle changes  
- Email OFF · Debt gate OFF  
- **No commit / push / deploy**  

---

## Next

**IS-6a Safe Release** — commit app + adapter + docs, then deploy.  
Inventarisation remains separately authorized and optional.

---

## STOP

IS-6a Database Release complete. Ready for Safe Release approval.
