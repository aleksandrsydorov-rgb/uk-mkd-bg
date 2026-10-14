# AMADEUS 11 — IS-4 Support Fee Initial Data Adapter  
## Targeted Technical Audit (READ ONLY)

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (`b4ef6a0` tip; IS-3 feat `fced28f`)  
**Supabase:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Mode:** READ ONLY — no code, migration, data, module, email, or debt-gate changes  

**Baseline:** IS-1 Core · IS-2 Property Book · IS-3 Water/Electricity · 227 tests · Email OFF · Debt gate OFF  

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Audit status | **PARTIAL** |
| 2 | Canonical Support Fee architecture | Assessment + ledger + portal cache; apartment-level; Tariff Core rates |
| 3 | Opening tariff import feasibility | **YES** (via Tariff Core + annual policy RPCs) |
| 4 | Paid-period import feasibility | **CONDITIONAL** — full paid history not safe without product policy; prefer skip or audited opening markers |
| 5 | Outstanding debt import feasibility | **YES with new audited opening RPC** — not safe via fake charges/payments alone |
| 6 | Overpayment import feasibility | **YES with new audited opening credit** — cannot mutate `properties.overpayment` directly |
| 7 | Finance D1–D7 compatibility | **PASS** if opening path preserves D1 SoT and append-only ledger |
| 8 | Critical security/data risks | Fake payments; dual-balance drift; owner-level debt; unauthorized finance writes; double finalize |
| 9 | Required product decisions | 5 (see §10) |
| 10 | Recommended IS-4 sequence | Design → opening RPC → adapter preview → dry-run → Safe Release |

---

## 1. Existing Support Fee architecture

### Domain model (canonical)

```
tariff_catalog (support_fee)
  → tariff_versions → tariff_rate_items (natural | legal)
       ↓ resolve_support_tariff_for_year(year, subject)
support_fee_annual_policies (early/late % + deadline per billing_year)
  → finalize_support_fee_assessment / finalize_support_fee_year
support_fee_assessments  ←── support_fee_allocations ──→ support_fee_ledger
       ↓ remaining_due (D1 SoT)
properties.debt / properties.overpayment   (RPC-maintained portal cache/credit)
```

| Concern | Tables / objects | Notes |
|---------|------------------|-------|
| Tariffs | `tariff_catalog`, `tariff_versions`, `tariff_rate_items` | Key `support_fee`; subject `natural`/`legal` |
| Apartment rate subject | `property_tariff_subject_kind(property_id)` | From Property Book entity_kind |
| Billing periods | Calendar `billing_year` on assessments + policies | No monthly SF invoice grain in SoT |
| Charges / assessments | `support_fee_assessments` + ledger `kind=charge` | Unique active `(property_id, billing_year)` |
| Payments / allocations | `support_fee_ledger` (`payment`) + `support_fee_allocations` | Oldest-year allocation |
| Outstanding | `sum(remaining_due)` on non-void/corrected | D1 — `src/lib/supportFeeBalance.ts` |
| Overpayments / credits | `properties.overpayment`; allocations `credit` | Surplus payment → overpayment |
| Voids / reversals / restore | `void_support_fee_assessment`, `reverse_support_payment`, `restore_support_fee_assessment` | Append-only; E2.3-B/D |
| Corrections | `record_support_fee_assessment_correction` | `adjustment_debit` / `adjustment_credit` |
| Historical records | Assessments + ledger rows keyed by `property_id` | Survive ownership transfer |
| Audit | Ledger kinds + assessment void/restore/correction stamps; `idempotency_key` | |

### Key repository files

| Layer | Paths |
|-------|-------|
| Client types / annual | `src/lib/supportFeeAnnual.ts` |
| D1 balance contracts | `src/lib/supportFeeBalance.ts` |
| D2/D3/D5 policy mirrors | `src/lib/financePolicy.ts` |
| Void/reverse/restore mirrors | `src/lib/supportFeeReversal.ts` |
| Money helpers | `src/lib/finance.ts` |
| Admin UI | `src/components/admin/AdminSupportFeeAnnual.tsx`, `AdminTariffs.tsx`, SF pay paths in `src/app/admin/page.tsx` |
| Owner UI | `src/components/account/OwnerSupportFee.tsx`, `src/app/account/page.tsx` |
| Module key | `support_fee` in `src/lib/modules.ts` |
| Types | `src/lib/database.types.ts` (`support_fee_*`, finance RPCs) |

### Key migrations / RPCs

| Area | Migration / RPC |
|------|-----------------|
| Tariff Core | `20260926030000_tariff_core_schema_rpc.sql`, `20260927180000_tariff_subject_kind.sql` |
| SF cutover / charge | `20260926060000_support_fee_tariff_core_cutover.sql`, `20260926195000_*` |
| Payment integrity | `20260924233500_sh2c2_integrity_hardening.sql` → `record_support_payment(_internal|_for_year)` |
| Subject + balance | `20261017120000_phase_e2_3_a_finance_subject_and_balance.sql` → `finalize_*`, `charge_support_fee` |
| Reverse / void | `20261018120000_phase_e2_3_b_reversal_and_void.sql` |
| Restore / void guard | `20261019120000_*`, `20261020120000_*` |
| Auth helper | `can_manage_support_fees()` — admin **or** accountant (`20260924183000_*`) |
| Setup meta (empty shell) | `module_opening_data_meta` in `20261022120000_initial_setup_module_core.sql` |

### UI routes (admin)

| Surface | Section / component |
|---------|---------------------|
| Support Fee annual | `AdminSupportFeeAnnual` (такса / finance workspace) |
| Tariffs publish | `AdminTariffs` (`support_fee` catalog) |
| Pay desk / apt debt | `admin/page.tsx` apartment finance |
| Ownership debt gate | Stage3 transfers — gate **OFF** |

**Prior audits (do not re-run full E2):**  
`audit_exports/technical_completion/phase_e2/finance_inventory.md`, `finance_contract_matrix.md`, `phase_e2_2/decision_matrix.md`, `phase_e2_3_a/approved_rules_implementation.md`.

---

## 2. Existing finance rules (D1–D7)

| ID | Rule (approved) | Status for IS-4 |
|----|-----------------|-----------------|
| **D1** | Canonical outstanding = `sum(remaining_due)` on active assessments; overpayment separate; portal `debt` is cache | **Must preserve** — opening import must leave D1 consistent |
| **D2** | Mid-year / subject change = future periods only; no invented proration | Opening must not silently reprice historic years |
| **D3** | Tariff publish does not auto-reprice; charge does not auto-reprice; staff reprice explicit | Opening tariff ≠ rewrite of settled assessments |
| **D4** | Reverse payment + void unpaid assessment (append-only); no invented reallocation | Do not use reverse/void as import path |
| **D5** | Joint apartment billing; Book shares do **not** split amounts | Opening balances on `property_id` only |
| **D6** | Inherited liabilities manual / explicit post — not auto | Opening must not auto-move debt across owners |
| **D7** | SF reports separate from capital/utilities; D1 labels | Opening SF only — never fold other modules |

### Verified mechanics

| Topic | Behaviour |
|-------|-----------|
| Balance calculation | D1 `canonicalSupportOutstanding` |
| Remaining due | Per assessment `remaining_due`; updated by finalize, payment allocation, correction, void/restore |
| Paid / unpaid periods | Status `paid` / `open`; unique active year per apartment |
| Payment allocation | Oldest billing year first (`record_support_payment_internal`) |
| Overpayments | Payment surplus → `properties.overpayment`; next charge consumes credit first |
| Historical correction | Correction RPC + reprice (open unpaid only); reverse/void/restore append-only |
| Direct mutations | Portal debt/overpayment blocked outside SF RPCs |
| Debt gate | `ordinary_debt_gate_enabled` — **OFF**; LEGAL_WAITING to enable |

**Hard constraint:** Do **not** introduce a second ledger or balance SoT. Any opening path must feed `support_fee_assessments` + `support_fee_ledger` (+ portal cache via the same RPC).

---

## 3. Opening data requirements

### Candidate fields

| Field | Classification | Notes |
|-------|----------------|-------|
| Existing tariff (€/m²/year natural & legal) | **A** | Tariff Core publish / list |
| Tariff effective / billing year | **A** | Version `valid_from` / year resolve |
| Annual policy (early/late % + deadline) | **A** | `upsert_*` / `publish_support_fee_annual_policy` |
| Transition date | **B** | Store in `module_opening_data_meta.effective_transition_date` |
| Source document / reference | **B** | Meta + ledger `note` / idempotency |
| Opening outstanding debt (per apt, optionally per year) | **B** + **C** | Needs dedicated opening RPC; product: year grain |
| Opening overpayment | **B** + **C** | Audited credit; not raw UPDATE |
| Already fully paid periods | **C** / prefer **D** for deep history | Reconstructing paid years risks fake payments |
| Partially paid periods | **C** | Either opening remaining only, or assessment+allocation design |
| Per-owner balances | **D** | Forbidden under D5 |
| Fake bank payment rows as “history” | **D** | Must not invent cash events |
| Direct `properties.debt` edits | **D** | Forbidden |
| Capital / water / elec opening via SF | **D** | Separate modules |

### A / B / C / D summary

- **A — Supported today:** Tariff Core rates; annual policy; finalize current year (operational, not inventarisation); corrections/void/restore for ops mistakes.  
- **B — Needs adapter + likely new SECURITY DEFINER opening RPC:** Transition metadata; opening outstanding; opening overpayment; preview/idempotency; Book apartment match.  
- **C — Product decisions:** Whether to import multi-year history; how to represent partial pays; early/late pricing on opening years; natural vs legal for opening snapshots.  
- **D — Must not import:** Owner-personal AR; synthetic ordinary `payment` rows without cash; other-module balances; overwrite of settled assessments without void/correction rules.

---

## 4. Financial safety

### Can opening balances be represented without dirty tricks?

| Anti-pattern | Verdict |
|--------------|---------|
| Fake payment records | **Unsafe** — pollutes allocation/reverse semantics |
| Duplicate charges via `charge_support_fee` / blind finalize | **Unsafe** — unique year + double debt risk |
| Rewriting historical invoices | **Forbidden** — append-only model |
| Artificial ordinary financial transactions | **Unsafe** unless clearly typed as opening |
| Direct edit of calculated balances | **Forbidden** |

### Dedicated opening-balance mechanism — **YES, necessary**

Prior E2.2 already called for append-only opening/adjustment events to close portal↔ledger gaps (FIN-P1-5). IS-4 should **not** overload `record_support_payment` or casual `finalize` for inventarisation.

**Recommended shape (design only — not implemented):**

1. New SECURITY DEFINER RPC(s), e.g. `import_support_fee_opening_position`, staff-only (`can_manage_support_fees` **and** `admin_assert_module_setup` / администрация for Initial Setup).  
2. Inputs: `property_id` (resolved from Book), transition date, optional `billing_year`, `opening_remaining_due`, `opening_overpayment`, `source_ref`, idempotency key.  
3. Effects (atomic per apartment):  
   - Ensure at most one **opening** assessment or adjustment package for that year/transition.  
   - Set D1 `remaining_due` via an open assessment snapshot **or** `adjustment_debit` linked to an opening assessment — product chooses grain.  
   - Set credit via `adjustment_credit` / dedicated opening credit that updates `properties.overpayment` through the same portal rules as payment surplus.  
   - Ledger `note` / kind clearly `opening_*` (extend check constraint if needed).  
4. Never create ordinary `payment` rows for “already paid historically” unless product explicitly requires reconstructive history.  
5. Portal cache updated **only** inside the RPC so D1 ≈ portal after import.  
6. `module_opening_data_meta` + `module_import_batches` for approval audit.

Reuse of `record_support_fee_assessment_correction` alone is **insufficient** (expects an existing assessment; not inventarisation-first).

---

## 5. Property Book integration

| Topic | Finding |
|-------|---------|
| Apartment matching | Use `apartment_number` → Book/`properties` (same as IS-2/IS-3); forbid client-supplied `property_id` |
| Ownership relationships | Subject kind from Book (`legal_entity` → legal tariff); amounts still apartment-level |
| Transfer-history compatibility | Ledgers stay on `property_id`; transfers do not wipe SF history |
| Balance ownership | **Apartment obligation**, not person AR (D5) |
| Ownership change during imported periods | Do **not** assign opening debt to a specific past/future owner; do not “transfer” opening debt between people |

**Never assume** opening debts move with sellers/buyers — continuity is property-bound; access follows current Book owners.

**Dependency:** IS-4 adapter `dependencies: ['property_book']` (and ready Book data / verified existing).

---

## 6. XLSX adapter design (recommendation only)

### Sheets

| Sheet | Purpose |
|-------|---------|
| `tariff` | Building-level SF rates (natural/legal), effective year, optional notes |
| `policy` | Optional annual policy row(s): year, early/late %, deadline |
| `opening_balances` | Per-apartment opening positions |
| `instructions_bg` / `instructions_ru` / `instructions_en` | Safety rules |

### Suggested `opening_balances` columns

`apartment_number`, `billing_year` (or blank = transition year), `opening_remaining_due`, `opening_overpayment`, `source_reference`, `notes`  
Optional later: `pricing_rule` — **C**.

### Validation / preview / commit

| Control | Rule |
|---------|------|
| Validation | Apt exists in Book; non-negative money; at most one active open year conflict → SKIP/FAIL; tariff years coherent |
| Preview | Dry-run only; show CREATE / SKIP_EXISTING / FAIL; show projected D1 vs portal after apply |
| Duplicate detection | Existing open assessment for year → SKIP (default) or FAIL — **C** |
| Idempotency | `(installation, module, apartment, billing_year, source_ref)` + ledger idempotency key |
| Approval | Admin confirm; Initial Setup batch; no auto-commit on upload |
| Partial failure | Per-row outcomes like IS-3 (`CREATED` / `SKIPPED_EXISTING` / `FAILED` / `NOT_PROCESSED`); stop or continue — prefer continue for finance with reconcile |
| Error workbook | Row, field, code, message |
| Audit | `module_import_batches` + opening meta + ledger notes |

**No uploads/writes in this audit phase.**

---

## 7. Authorization and isolation

| Control | Detail |
|---------|--------|
| Setup UI | `admin_assert_module_setup` → `has_staff_role('администрация')` |
| Finance writes | `can_manage_support_fees()` → администрация **or** бухгалтер |
| Recommendation | Opening import: require **администрация** (stricter than day-to-day cashier), reuse finance RPC assert inside |
| RLS | Ledger/assessments staff-scoped; owners via `owns_property` for read paths (post E2.1) |
| Installation isolation | `platform_installations` + `module_*` rows; property_id within installation |
| Unauthorized writes | No direct table grants for debt/overpayment; opening must be DEFINER with asserts |
| Reuse correction workflows | Ops reverse/void/correction remain for mistakes **after** go-live — not substitute for opening import |

---

## 8. Future clean installation

| Need | Notes |
|------|-------|
| Migrations | Opening RPC + optional ledger kind constraint extension; **not** legacy DO_NOT_RUN |
| Seed / config | Tariff catalog `support_fee`; module catalog `support_fee`; optional draft annual policy |
| Cross-module deps | Property Book ready; area_sqm on properties; Tariff Core published |
| AMADEUS-specific data | None required — greenfield uses same RPCs; live legacy portal↔ledger Δ is a **separate** reconcile topic (FIN-P1-5), not IS-4 scope to “fix” by rewriting history |

Do **not** repair unrelated migration gaps in IS-4.

---

## 9. Test coverage

### Existing (reuse, do not duplicate full E2E)

| File | Focus |
|------|-------|
| `tests/finance/unit/supportFeeMoneyMath.test.ts` | annual/monthly, pay/charge/overpay |
| `tests/finance/unit/supportFeeBalancePolicy.test.ts` | D1–D3, D5, FIN-P1-7 |
| `tests/finance/unit/supportFeeAdminDisplayConsistency.test.ts` | admin/owner/PDF parity |
| `tests/finance/unit/supportFeeReversalVoid.test.ts` | D4 reverse/void |
| `tests/finance/unit/supportFeeAssessmentRestore.test.ts` | restore |
| `tests/finance/unit/financeReportingSeparation.test.ts` | D7 |
| `tests/security/unit/financeAccessAuthz.test.ts` | authz / debt gate off |

### Recommended IS-4-focused tests (future)

1. Preview resolves Book apartments; rejects spoofed `property_id`.  
2. Opening RPC sets D1 outstanding + overpayment without ordinary `payment` kinds.  
3. Idempotent re-import → SKIP / no double remaining_due.  
4. Conflict with existing open assessment → SKIP/FAIL per policy.  
5. Concurrent opening attempts → unique active year / idempotency.  
6. Unauthorized role denied.  
7. Cross-installation isolation.  
8. Post-import `hasSupportBalanceDiscrepancy` false for imported rows.  
9. No charge generation for water/elec; capital untouched.  
10. Debt gate / email flags unchanged.

---

## 10. Product decisions (only genuine blockers)

### Q1 — Opening grain for outstanding debt

| | |
|--|--|
| **Recommended default** | Single **transition-year** opening remaining_due per apartment (+ separate overpayment); do **not** reconstruct multi-year paid history |
| **Alternative** | Per-year opening assessments for N prior years |
| **Impact** | Default minimizes fake history; alt improves year-level AR aging |
| **Risk** | Default: less historic detail; Alt: high complexity / double-charge risk |

### Q2 — Representation of “already paid” years

| | |
|--|--|
| **Recommended default** | **Omit** paid years (implicitly settled by absence) |
| **Alternative** | Create `status=paid` assessments with `remaining_due=0` and opening audit note — **no** fake payments |
| **Impact** | Statements show fewer historic lines vs explicit paid markers |
| **Risk** | Alt without payments may confuse reverse/allocation tools |

### Q3 — Partial payments at transition

| | |
|--|--|
| **Recommended default** | Import **only remaining_due** (and overpayment); do not import original invoice + paid amount pairs |
| **Alternative** | Import final_amount + applied + remaining (requires full assessment synthesize) |
| **Impact** | Default matches D1 SoT; alt richer audit |
| **Risk** | Alt easy to desync portal vs remaining |

### Q4 — Early/late pricing on opening year

| | |
|--|--|
| **Recommended default** | Opening uses **standard** (or explicit `final_amount` / remaining only); ignore early/late qualification for inventarisation |
| **Alternative** | Run full `finalize_support_fee_assessment` semantics (deadline checks) |
| **Impact** | Default avoids false discounts; alt may mis-apply early window on backdated transition |
| **Risk** | Alt high if transition date ≠ “today” |

### Q5 — Existing open assessment conflict policy

| | |
|--|--|
| **Recommended default** | **SKIP_EXISTING** (never overwrite remaining_due / tariff snapshots) |
| **Alternative** | FAIL row; or staff-approved correction path outside IS-4 |
| **Impact** | Protects AMADEUS live data (111/112 assessments etc.) |
| **Risk** | Silent skip if operators expect replace — mitigate with preview counts |

---

## Critical risks (summary)

1. Using `record_support_payment` to “seed” debt clearance → fake cash history.  
2. Blind `finalize_support_fee_year` on populated buildings → duplicate unique-year failures or unexpected charges.  
3. Direct SQL/`UPDATE properties` → breaks RPC invariants (FIN dual-truth).  
4. Owner-level opening columns → violates D5.  
5. Import without admin confirm → unauthorized finance write.  
6. Ignoring existing assessments → baseline overwrite.

---

## Recommended IS-4 implementation sequence

1. **Lock product defaults** for Q1–Q5 (or accept recommended defaults in writing).  
2. **Design + migrate** audited opening RPC(s) + ledger kind/note convention + grants.  
3. **Unit tests** for RPC policy mirrors (no live money).  
4. **Adapter** (`support_fee` moduleKey): XLSX templates, preview, per-row outcomes, Book match — patterned on IS-3 safety.  
5. **Wire AdminInitialSetup** (download / preview / confirm / retry); no auto-activation of UX module flags.  
6. **Dry-run** against fixtures; optional staging; **no** AMADEUS import until Safe Release brief.  
7. **IS-4 Safe Release** (code + docs) with gates still OFF.

---

## Audit limitations

- No live SQL probe in this pass (architecture from code + prior E2 read-only inventories).  
- Full Finance E2E not re-executed (per scope).  
- Opening RPC does **not** exist yet → status **PARTIAL**, not BLOCKED.

---

## Safety observed this phase

- No code / migration / data / module / email / debt-gate changes  
- No commit / push / deploy  

**STOP.**
