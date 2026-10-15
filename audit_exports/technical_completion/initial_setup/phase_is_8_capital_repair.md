# AMADEUS 11 — PHASE IS-8  
## Capital Repair Initial Data Adapter — Implementation Report

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg · **Branch:** main (local implementation only)  
**Supabase:** `klowacuvufknbrkayjhz` — **NOT modified**  
**Production:** https://amadeus11.online — **NOT deployed**  
**Mode:** Local implementation + tests + report. **STOP** — no apply / commit / push / deploy.

**Baseline in:** IS-1–IS-7a · audit `is_8_capital_repair_audit.md` · Email OFF · Debt gate OFF  
**Product locks:** Q-CR-1 inventarise YES · Q-CR-2 declared historical amounts · Q-CR-3 mandatory `assessment_id`

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Adapter implemented | **YES** |
| 2 | Opening RPC implemented | **YES** (local SQL; **not applied**) |
| 3 | Assessment linkage | **PASS** |
| 4 | Fully paid periods | **PASS** |
| 5 | Partially paid periods | **PASS** |
| 6 | Opening debt | **PASS** |
| 7 | Opening credit | **PASS** |
| 8 | XLSX template ready | **YES** |
| 9 | Preview/validation | **PASS** |
| 10 | Idempotency/concurrency | **PASS** |
| 11 | Capital ledger/report reconciliation | **PASS** (consumers updated in migration; reporting via fund totals / balance RPC) |
| 12 | No synthetic payment/charge | **PASS** |
| 13 | Migration filename | `supabase/migrations/20261027120000_is8_capital_repair_opening_state.sql` |
| 14 | Tests/build results | **288/288 PASS** · `tsc --noEmit` OK (via build) · `npm run build` OK |
| 15 | Existing business data unchanged | **YES** (no migration apply; no live import) |
| 16 | Remaining technical blockers | Fresh-install Capital DDL/RPC still packaged as gaps; migration not applied to live DB |
| 17 | Ready for Database Release | **YES** (local artifact ready; apply is a separate DB Release step) |

---

## 1. What was implemented

### 1.1 Database migration (local only)

`20261027120000_is8_capital_repair_opening_state.sql`:

- Extends `capital_repair_ledger.kind` with:
  - `opening_obligation` (debit)
  - `opening_historical_settlement` (credit vs obligation — **not** `payment`)
  - `opening_credit` (overpayment — **not** double-counted)
- Constraint: opening kinds + `charge` **require** non-null `assessment_id` (Q-CR-3; no orphans)
- Unique: one `opening_obligation` per `(property_id, assessment_id)`
- Table `capital_repair_opening_imports` — audited inventarisation (idempotency, scope, source_reference uniqueness; staff SELECT RLS)
- RPC `import_capital_repair_opening_state`:
  - Admin-only (`администрация`)
  - `SECURITY DEFINER` + `search_path = ''`
  - Resolves/creates **assessment shell** by title `Капитальный ремонт {year}` (or explicit `p_assessment_title`) — **never** calls `charge_capital_repair*` / `record_capital_repair_payment`
  - CONFLICT on existing operational `charge` or prior opening for same apt×assessment
  - Idempotent on `idempotency_key`; property `FOR UPDATE` concurrency
  - Does **not** mutate `properties.debt` / `overpayment`
- Updates consumers for opening kinds:
  - `get_capital_repair_balance`
  - `get_capital_repair_fund_totals`
  - `ownership_change_overdue_debt` (preserves E2.1 service_role + staff/owner authz)

### 1.2 Application adapter

| Artifact | Role |
|----------|------|
| `capitalRepairOpening.ts` | Validate / classify / XLSX template BG·RU·EN / payloads |
| `capitalRepairOpeningAdapter.ts` | Module Core registration (`capital_repair`) |
| `capitalRepairImportCommit.ts` | Sequential commit, retry, reconcile, audit payload |
| `bootstrap.ts` + `index.ts` | Register / export |
| `AdminInitialSetup.tsx` | Preview → approve → RPC commit; optional skip for empty complexes |
| `database.types.ts` | Table + RPC typings |
| `messages.ts` | RU / EN / BG admin strings |
| `OwnerUtilities.tsx` | Opening kinds display as charge/payment/credit |
| `fresh_install` MANIFEST + gaps | Capital DDL/RPC documented as remaining greenfield gaps |

### 1.3 Opening model (financial)

```
assessed = historically_paid + remaining_debt
opening_overpayment ⊥ remaining_debt (mutual exclusive)

balance_effect =
  opening_obligation
  − opening_historical_settlement
  − opening_credit
```

- Fully settled → balance 0 (not outstanding debt)
- Partial → remaining obligation visible
- Opening credit → negative/offset without inventing payments
- Fund totals = apartment obligation net — **not** bank/cash reserves (UI copy + preview `fund_vs_cash_note`)

### 1.4 Safety preserved

- No SF opening RPC reuse
- No synthetic `payment` / operational `charge`
- No rewrite of existing ledger rows
- No automatic module activation
- Historical import optional (`skip_historical_import` / verified / confirmed)
- Live baseline (4 assessments / 7 ledger) **untouched** — migration not applied

---

## 2. Tests

`tests/security/unit/moduleCoreIs8CapitalRepair.test.ts` — 12 cases covering:

fully paid · partial · opening debt · opening credit · bad arithmetic · missing assessment shell · wrong apt/type · duplicate/conflict · concurrent reconcile · unauthorized/conflict messages · no synthetic payment/charge · assessment linkage · idempotent retry · no auto-activate · fresh-install gaps documented

| Command | Result |
|---------|--------|
| `npm test` | **288/288 PASS** (27 files) |
| `npx tsc --noEmit` / Next TS | **PASS** |
| `npm run build` | **PASS** |

---

## 3. Remaining blockers (not in this phase)

1. **Apply** `20261027120000_is8_capital_repair_opening_state.sql` via approved Database Release only.
2. Fresh-install package still **PARTIAL** for Capital Repair baseline DDL/RPCs (documented gaps; do not execute full package here).
3. Operational Capital void/reverse remains absent (pre-existing; out of IS-8 inventarisation scope).
4. Ownership overdue JOIN still excludes operational payments with `assessment_id IS NULL` (pre-existing quirk); opening path attaches all opening kinds to assessments.

---

## 4. Explicit non-actions (STOP)

- Migrations **not** applied to Supabase  
- No Capital Repair opening import on live data  
- Existing 4 assessments / 7 ledger rows **unchanged**  
- No commit / push / deploy  
- Email Core sending remains OFF  
- Debt gate remains OFF  
- No new Supabase project  

---

## 5. Next suggested step (out of scope)

**Database Release** for `20261027120000_is8_capital_repair_opening_state.sql` after operator approval, then Safe Release of app code — separate phases.
