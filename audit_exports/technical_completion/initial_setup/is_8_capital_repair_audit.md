# AMADEUS 11 — IS-8 Capital Repair Initial Data Adapter  
## Targeted Technical Audit (READ ONLY)

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg · **Branch:** main (`15a7184` tip; feat `ba8f89f`)  
**Supabase:** `klowacuvufknbrkayjhz` (read-only probe)  
**Production:** https://amadeus11.online  
**Mode:** READ ONLY — no code, migration, import, module, email, or debt-gate changes  

**Baseline:** IS-1–IS-7a released · 276 tests · Email OFF · Debt gate OFF  

**References:** `is_7_remaining_modules_inventory.md` · IS-4 `import_support_fee_opening_state` · Finance D1–D7 · live Capital RPCs/UI  

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Audit status | **PARTIAL** — architecture clear; opening inventarisation **not supported today**; safe path requires **new opening RPC** + product locks (not BLOCKED) |
| 2 | Canonical Capital Repair architecture | Independent ledger module (`capital_repair_*`); annual fixed €/apt via Tariff Core; **not** Support Fee twin |
| 3 | Paid-period opening feasibility | **REQUIRES NEW OPENING RPC** |
| 4 | Opening debt feasibility | **REQUIRES NEW OPENING RPC** |
| 5 | Opening credit feasibility | **REQUIRES NEW OPENING RPC** (must attach to assessment — see risks) |
| 6 | Finance D1–D7 compatibility | **PARTIAL / compatible by analogy** — D1 SF-specific; capital uses ledger balance (D-adjacent); D2/D3/D5 apply where relevant |
| 7 | Property Book compatibility | **PASS** — apartment-level ledger; Book for apt match + subject_kind; no Book duplication |
| 8 | XLSX adapter feasibility | **PASS** (design) — IS-4-shaped workbook; implement later |
| 9 | Critical financial/security risks | Ownership-debt JOIN drops unallocated payments; one-charge uniqueness; no void/reverse; fund totals ≠ bank cash; SF RPC not reusable |
| 10 | Fresh-install gaps | Capital tables/RPCs only in legacy `DO_NOT_RUN`; not in `packages/fresh_install` |
| 11 | Product decisions requiring approval | §10 (3 required, 2 optional) |
| 12 | Recommended implementation sequence | §12 |

**Live probe (read-only):** assessments **4** (all `active`) · ledger **7** (`charge` 6 / `payment` 1) · opening imports table **absent** · `import_capital*` / `void_capital*` / `reverse_capital*` **absent** · tariff `capital_repair` active with published version · Email OFF · debt gate OFF.

---

## 1. Approved product scope (confirmed)

| In scope (apartment obligations) | Out of scope |
|----------------------------------|--------------|
| Opening outstanding debt | Condominium **cash/bank fund** balance |
| Opening overpayment/credit | Fake/synthetic operational payments |
| Previously paid periods | Automatic new operational charges on import |
| Partially paid periods (if model supports) | Rewriting existing ledger history |
| Transition date + source reference | Confusing apartment obligations with cash reserves |

Canonical reporting already separates capital **ledger fund totals** (obligation net) from bank cash (not modeled). Opening must keep that separation explicit in UI copy.

---

## 2. Canonical Capital Repair architecture

### 2.1 Module identity

| Item | Value | Location |
|------|-------|----------|
| Module key | `capital_repair` | `src/lib/modules.ts` |
| Catalog | implemented, utilities grouping | migrations `20260925230000_*`, `20260926180000_*` |
| Initial Setup adapter | **None** | `src/lib/moduleCore/bootstrap.ts` |
| Tariff gate | billing needs published `capital_repair`; import not blocked by tariff alone | `src/lib/moduleCore/tariffSetupGate.ts` |

### 2.2 Schema (SoT)

| Object | Role |
|--------|------|
| `capital_repair_assessments` | **Building-level** campaign/year container (`title`, `decision_date`, `due_date`, `status`) — **not** per-apartment |
| `capital_repair_ledger` | Immutable per-apartment journal: `property_id`, `assessment_id` (nullable), `kind`, `amount_eur`, `idempotency_key` |
| Tariff Core | `tariff_key = capital_repair` — fixed € / apartment / **year** (`billing_period=year`) |

**Kinds (operational):** `charge` · `payment` · `adjustment_debit` · `adjustment_credit`  

**Balance (derived, not on `properties.debt`/`overpayment`):**

```
balance = (charge + adj_debit) − (payment + adj_credit)
```

RPC: `get_capital_repair_balance(p_property_id)` · building: `get_capital_repair_fund_totals()`.

### 2.3 Key RPCs (files)

| RPC | Role | Source |
|-----|------|--------|
| `resolve_capital_tariff_for_year` / `get_applicable_capital_tariff` | Published annual amount (+ subject_kind) | `supabase/migrations/20260926194000_*`, `20260927180000_*` |
| `ensure_capital_repair_year_assessment` | Assessment titled `Капитальный ремонт {year}` | `20260926196000_*` |
| `charge_capital_repair` / `_bulk` / `_year_bulk` | Operational charge from tariff (no client amount post-cutover) | same |
| `record_capital_repair_payment` | Payment with **`assessment_id = null`** (unallocated) | Legacy `supabase/legacy/DO_NOT_RUN/capital_repair_rpc.sql` (typed; live) |
| `create_capital_repair_assessment` | Manual assessment create | Legacy RPC |
| `get_capital_repair_balance` / `get_capital_repair_fund_totals` | Derived balances | Legacy + `…196000` |

**Absent:** `import_capital_*` · capital void/reverse · allocation table · opening imports table.

### 2.4 UI / portal

| Surface | File |
|---------|------|
| Admin Capital | `src/components/admin/AdminCapital.tsx` |
| Admin Tariffs (annual capital) | `src/components/admin/AdminTariffs.tsx` |
| Reports | `src/components/AdminReports.tsx` + `src/lib/financeReporting.ts` (`ledger_balance`) |
| Owner | `OwnerOverview.tsx` / `OwnerUtilities.tsx` |

### 2.5 vs Support Fee (critical)

| | Support Fee | Capital Repair |
|-|-------------|----------------|
| Assessment grain | Per **property × year** | **Building** year/campaign; many apts share one assessment |
| Pricing | €/m² + annual policies (early/late) | Fixed €/apt·year; **no** annual policy table |
| Payments | Allocations → `remaining_due` | Unallocated payments (`assessment_id` null) |
| Portal cache | Mutates `properties.debt` / `overpayment` | **Ledger only** |
| Void/reverse | Yes (E2.3) | **No** |
| Opening | `import_support_fee_opening_state` + `opening_*` kinds | **None** |

**Do not reuse** `import_support_fee_opening_state` — it rejects `obligation_type ≠ 'support_fee'` (covered by IS-4 tests).

### 2.6 Ownership / transfer

`ownership_change_overdue_debt` nets capital ledger **JOIN assessments** by `due_date` (`20261011140200_*`).  
**Quirk:** rows with `assessment_id IS NULL` (canonical operational payments) are **excluded** from that join. Opening design must attach obligation/settlement/credit to year assessments or transfer gate will understate capital debt.

---

## 3. Opening balance feasibility

| Case | Verdict | Notes |
|------|---------|-------|
| **A. Fully paid historical periods** | **REQUIRES NEW OPENING RPC** | Represent as opening obligation + historical settlement (not `payment` kind). Link both to year assessment. |
| **B. Partially paid historical periods** | **REQUIRES NEW OPENING RPC** | Same triple: assessed / historically paid / remaining; identity `assessed = paid + remaining` (IS-4 Q3 pattern). |
| **C. Outstanding debt** | **REQUIRES NEW OPENING RPC** | Opening obligation for remaining; no operational charge RPC (would look like new billing). |
| **D. Opening credit/overpayment** | **REQUIRES NEW OPENING RPC** | Opening credit kind; **must** set `assessment_id` for transfer-gate consistency (unlike operational payments). |
| **E. Periods with no obligation** | **SUPPORTED / NOT APPLICABLE** | Omit row; no inventarisation needed. |
| **F. Transition-date financial state** | **REQUIRES NEW OPENING RPC** | Store `transition_date` + source ref on import audit; forbid future transition dates. |

**Operational RPCs alone:** **BLOCKED** for inventarisation — `charge_*` creates operational charges; `record_capital_repair_payment` creates synthetic-looking payments and leaves `assessment_id` null.

**Consistency:** After opening, `get_capital_repair_balance` / fund totals / reports (`ledger_balance`) must equal declared apartment nets without touching bank cash or SF portal debt.

---

## 4. Financial safety checklist (design constraints for IS-8)

| Requirement | Design implication |
|-------------|-------------------|
| No synthetic payment records | Use dedicated `opening_*` ledger kinds — never `payment` |
| No duplicate assessments/charges | Scope unique on `(property_id, billing_year)`; respect one-charge-per-(property,assessment) |
| No double-counting credits | Single opening_credit path; mutual exclusion vs remaining_debt (IS-4 style) |
| No mutation of derived caches | Do **not** write `properties.debt` / `overpayment` |
| No overwrite of existing ledger | CONFLICT if operational charge/payment already exists for scope; SKIP only identical prior opening import |
| No auto penalty/discount | Capital has no early/late policy — N/A; do not invent |
| No ownership-level reassignment | Apartment ledger only (D5 / transfer preserves apt ledger) |
| No billing on preview/import | Preview client-side; write only admin-confirmed RPC; do not call `charge_*_year_bulk` |
| One-time finalization | Import audit table + idempotency_key + scope unique |
| Concurrency | Lock property row; unique indexes |

Preserve Finance invariants by analogy:

- **D1** — SF remaining_due SoT; capital SoT remains **ledger balance** (already in `financeReporting.ts`).
- **D2** — no historic reprice of opening snapshots.
- **D3** — publish tariff ≠ rewrite opening rows.
- **D5** — no ideal-parts split of capital opening.
- Transfer — apartment ledger preserved; opening rows must remain visible to overdue JOIN.

---

## 5. Property Book compatibility

| Topic | Finding |
|-------|---------|
| Apartment matching | Resolve `apartment_number` → `property_id` via Book (same as IS-3/4/5) |
| Ownership changes | Balances stay on property; transfer does not reassign ledger |
| Apt vs owner | **Apartment-level** only |
| Multi-owner / ideal parts | Irrelevant to capital charge grain (fixed per apt); subject_kind from Book for **future ops** charges only |
| Isolation | Installation/complex = single DB project model |
| Duplication | Do not create parallel apt tables |

---

## 6. Recommended XLSX design (no importer yet)

**Sheet:** `opening_balances`  
**Schema version:** `1.0` (proposed)

| Column | Required | Rules |
|--------|----------|-------|
| `apartment_number` | yes | Book lookup |
| `billing_year` | yes | 2000–2100; capital period = calendar year |
| `obligation_type` | yes | Constant `capital_repair` |
| `assessed_amount` | yes | ≥ 0; money |
| `historically_paid_amount` | yes | ≥ 0 |
| `remaining_debt` | yes | ≥ 0; **assessed = paid + remaining** |
| `opening_overpayment` | no (default 0) | ≥ 0; if > 0 then remaining_debt must be 0 (recommended) |
| `transition_date` | yes | ISO date ≤ Sofia today |
| `source_reference` | yes | Non-blank audit/doc id |
| `notes` | no | Free text |

**Instructions sheets:** `instructions_bg` / `instructions_ru` / `instructions_en`  

**Rejected columns:** bank fund balance, owner share %, tariff override (unless product unlocks Q-AMOUNT), `property_id` (untrusted).

**Validation (preview):** unknown apt · duplicate apt+year in file · amount identity · future transition · wrong obligation_type · conflict with existing operational charge for year assessment · conflict with prior opening import mismatch.

---

## 7. Initial Setup integration

| Topic | Recommendation |
|-------|----------------|
| Module key | `capital_repair` |
| Dependencies | `property_book` ready/verified |
| Tariff readiness | Published applicable `capital_repair` for **billing activation**; inventarisation may proceed with declared historical amounts if product allows (Q-AMOUNT) — gate already separates import vs billing |
| Roles | Opening commit: **администрация** only (stricter than day-to-day accountant charge/pay) |
| Activation | No auto ACTIVE; setup complete → READY only after admin confirm |
| Existing data | SKIP identical opening import; CONFLICT if operational charge/ledger exists for scope |
| Bootstrap | New `capitalRepairOpeningAdapter` registered like IS-4 |

---

## 8. Fresh-install compatibility

| Gap | Status |
|-----|--------|
| `CREATE` for `capital_repair_assessments` / `_ledger` | Only in `supabase/legacy/DO_NOT_RUN/water_capital_schema.sql` |
| Payment/balance RPCs in migrations | Partially; create/payment/balance still legacy-origin |
| `packages/fresh_install/` | Meters/properties only — **capital not packaged** |
| Opening kinds / import RPC | Do not exist yet |

**Do not** execute incomplete package or legacy DO_NOT_RUN in IS-8 implementation phase without a dedicated packaging decision.

---

## 9. Test coverage (recommendations — do not write yet)

**Existing:** No capital finance/opening suite. Only IS-7a tariff-gate fixtures and IS-4 rejection of `obligation_type=capital_repair`.

**Recommended IS-8 tests:**

1. Fully paid year → opening kinds; balance = 0; **no** `payment` kind  
2. Partial pay → remaining matches identity  
3. Debt-only → positive balance  
4. Credit-only → negative balance; assessment_id set  
5. Duplicate scope → SKIP / CONFLICT  
6. Reconciliation with `get_capital_repair_balance` / fund totals  
7. Authz: admin-only import; accountant denied  
8. Cross-apartment isolation  
9. Ownership overdue JOIN includes opening-linked assessments  
10. No call to `charge_*` / `record_capital_repair_payment` from opening path  
11. Idempotent retry (same key / same payload)  
12. Preview does not write  

---

## 10. Product decisions requiring approval

### Q-CR-1 — Inventarise Capital Repair opening? (**REQUIRED**)

| Option | Consequence | Risk |
|--------|-------------|------|
| **A. Yes — adapter + opening RPC (recommended default)** | Enables true transition inventarisation; matches approved apartment-obligation scope | Implementation cost; conflict rules vs existing 4 assessments / 7 ledger rows |
| B. No — start empty / ops-only | Faster; historical apt obligations absent until manual charge/pay | Transfer gate / owner balances incomplete for go-live |

**Financial consequence:** A produces ledger-accurate apt nets without bank inventarisation. B leaves capital history blank.

### Q-CR-2 — Opening amounts vs published tariff (**REQUIRED**)

| Option | Consequence | Risk |
|--------|-------------|------|
| **A. Declared historical amounts (recommended default)** | Matches paper books; like IS-4 assessed≠current tariff | Ops charge later may differ from opening assessed |
| B. Force assessed = current published tariff for year | Stronger tariff coupling | Wrong for truly historical years |

### Q-CR-3 — Assessment linkage for opening rows (**REQUIRED**)

| Option | Consequence | Risk |
|--------|-------------|------|
| **A. Always attach to year assessment (`ensure`/`create` opening-safe) (recommended default)** | Transfer overdue JOIN + one-charge uniqueness work | Must CONFLICT if operational charge already exists for that year assessment |
| B. Allow null assessment_id like ops payments | Matches payment RPC | **Breaks** ownership capital overdue calculation |

### Q-CR-4 — Multi-year workbook rows (**OPTIONAL**)

| Option | Default |
|--------|---------|
| **A. Many years as separate rows** (recommended) | One row = one apt × year |
| B. Single “transition net” only | Loses period history |

### Q-CR-5 — Bank/cash fund inventarisation (**OPTIONAL — already out of scope**)

Confirm remains **out of scope**. Do not add columns or RPCs for cash reserves in IS-8.

---

## 11. Critical risks (summary)

1. **Reuse of SF opening RPC** — incorrect domain; hard reject.  
2. **Operational charge/pay for inventarisation** — synthetic payments / new billing appearance.  
3. **Unallocated opening credits/payments** — invisible to `ownership_change_overdue_debt`.  
4. **One charge per (property, assessment)** — clash with existing live charges (4 assessments / 6 charges today).  
5. **No capital void/reverse** — bad opening hard to unwind; prefer strict CONFLICT + no overwrite.  
6. **Fund totals ≠ bank cash** — UI must not label opening as “fund cash”.  
7. **Fresh-install DDL gap** — distributive still PARTIAL for capital tables.

---

## 12. Recommended implementation sequence

1. **Lock Q-CR-1/2/3** (and confirm Q-CR-5 out of scope).  
2. **Design-only sign-off** on XLSX + opening ledger kinds + import audit table.  
3. **DB:** migration for `opening_*` kinds on `capital_repair_ledger`, `capital_repair_opening_imports`, `import_capital_repair_opening_state` (admin-only, idempotent, no `payment`/`charge_*`).  
4. **App:** `capitalRepairOpeningAdapter` + AdminInitialSetup wiring + BG/RU/EN copy (tariff gate already present).  
5. **Tests** (§9) → DB Release → Safe Release.  
6. **Later distributive:** package capital baseline DDL into `supabase/packages/fresh_install/` (separate from inventarisation).  
7. **Defer:** capital void/reverse, bank cash, ideal-parts split, SF shared opening tables.

---

## STOP

Audit complete. **No** implementation, migrations, imports, module changes, commits, or package execution.  
Email sending remains OFF · debt gate remains OFF.
