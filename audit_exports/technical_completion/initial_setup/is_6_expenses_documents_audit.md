# AMADEUS 11 — IS-6 Initial Financial Documents & Expenses  
## Targeted Technical Audit (READ ONLY)

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg  
**Branch:** main (`c54547b` tip; IS-5 feat `e1d17e2`)  
**Supabase:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Mode:** READ ONLY — no code, migration, data, module, email, or debt-gate changes  

**Baseline:** IS-1–IS-5 released · 250 tests · Email OFF · Debt gate OFF  

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Audit status | **PARTIAL** |
| 2 | Separate Initial Setup adapter for supplier AP / payables | **NOT REQUIRED now — BLOCKED by missing domain** |
| 3 | Canonical supplier directory / invoices / AP payments | **ABSENT** |
| 4 | Canonical MC expenses (`uk_expenses`) | **PRESENT** (operational register, not AP) |
| 5 | Budget plan/fact | **PRESENT** (`budget_*`; fact from published expenses) |
| 6 | Platform SaaS invoices | **PRESENT** (`platform_billing_invoices`) — unrelated to supplier payables |
| 7 | Reuse IS-4 / IS-5 opening RPCs | **FORBIDDEN / not applicable** |
| 8 | Historical `uk_expenses` inventarisation adapter | **REQUIRED if inventarisation is in product scope**; else **NOT REQUIRED** (Admin day-2 path enough) |
| 9 | Live data (read-only) | `uk_expenses` **0**; budget year **1** / lines **7**; platform invoices **0** |
| 10 | Recommended next step | Product decisions Q1–Q12 (§10); then IS-6a (expenses) and/or IS-6b (AP domain) — **no impl until locked** |
| 11 | Independent explore pass | Confirmed same PARTIAL verdict ([IS-6 explore](a20a65cb-d0d7-43be-a728-5059270a2c39)) |

---

## 1. What exists today (canonical inventory)

### A. Management expenses (operational transparency)

| Object | Role |
|--------|------|
| `uk_expenses` | MC expense rows: date, amount, title, status (`на проверке` / `опубликован`), photos, optional `budget_category_id` |
| Admin UI | Direct `insert` / `update` / `delete` on `uk_expenses` in `src/app/admin/page.tsx` |
| Publish gate | `canApproveUkExpenses` → role `администрация` only (`src/lib/finance.ts`) |
| Owner view | Published expenses only |
| Module key | **No** dedicated `expenses` module — UI under admin finance/expenses section |

**Not modeled:** supplier identity, invoice number, due date, partial payment, payable balance, payment allocation.

### B. Budget (plan vs actual)

| Object | Role |
|--------|------|
| `budget_categories` | Cost catalog (maintenance, cleaning, …) |
| `budget_years` | Calendar year lifecycle: draft → published → adopted → closed |
| `budget_lines` | Planned EUR per category |
| `budget_adjustments` | Manual execution adjustments |
| Execution | Published `uk_expenses` + adjustments (`admin_budget_execution`) |
| Module key | `budget` (`finance` category; UX toggle) |

**Explicit non-goal in migration:** “No owner billing.”

### C. Platform billing (operator → installation)

| Object | Role |
|--------|------|
| `platform_billing_invoices` | SaaS / platform invoices for the installation |
| Module | `platform_support` |

**Not** supplier AP for building operations.

### D. Related but not expense AP

| Object | Note |
|-------|------|
| Tariff Core `external_supplier` / `supplier_notice` | Tariff governance basis — not a supplier master or AP ledger |
| Module stub `contractors` | Catalog key only; **not implemented** as AP |
| Support Fee / Internet ledgers | Owner receivables — **must not** be reused for supplier payables (IS-4 / IS-5) |

### E. Confirmed absent (live schema probe)

| Table | Present |
|-------|---------|
| `suppliers` | **NO** |
| `supplier_invoices` | **NO** |
| `accounts_payable_ledger` | **NO** |
| `expense_payments` | **NO** |

---

## 2. Are these entities already supported?

| Business need | Supported today? | How |
|---------------|------------------|-----|
| Record new MC expenses after go-live | **YES** | Admin `uk_expenses` workflow |
| Publish expenses to owners | **YES** | Status + admin approve |
| Annual budget plan / adoption | **YES** | Budget module RPCs |
| Budget fact from published expenses | **YES** | `admin_budget_execution` |
| Supplier master data | **NO** | — |
| Supplier invoices (open / partial / paid) | **NO** | — |
| Payments to suppliers / allocations | **NO** | — |
| Opening AP / outstanding payables | **NO** | — |
| Historical paid supplier documents as AP history | **NO** | — |
| Platform SaaS invoice history | **YES (empty)** | `platform_billing_invoices` (Master Control sync path) |

**Conclusion:** The platform supports **expense transparency + budget**, not **accounts payable inventarisation**.

---

## 3. Distinctions (critical for Initial Setup)

| Kind | Meaning in AMADEUS today | Opening inventarisation? |
|------|--------------------------|---------------------------|
| Operational expenses after launch | New `uk_expenses` rows via normal admin UI | **No adapter** — use product UI |
| Historical invoices for reference | No AP document store | **Cannot inventarise safely** without new domain |
| Unpaid obligations at transition | No payable balance SoT | **BLOCKED** — would require new AP ledger |
| Previously paid invoices | No payment/AP history | **BLOCKED** — do not fake payments into SF/Internet ledgers |
| Opening financial balances (AP) | No canonical opening payable | **BLOCKED** |
| Historical published MC expenses (transparency / budget fact) | Could map to `uk_expenses` published rows | **CONDITIONAL** thin import only |
| Opening budget plan lines | `budget_lines` + year status | **CONDITIONAL** separate from AP; may be manual setup |

---

## 4. How inventarisation would map (if attempted)

### 4.1 Supplier AP / documents / payables

```
Desired: suppliers → invoices → payments → opening payable
Actual:  (tables missing)
```

Any “import unpaid supplier invoices” path would require **new schema + RPCs** (not an Initial Setup adapter on top of existing SoT).  
**Do not** map supplier debt onto:

- `support_fee_*` / `import_support_fee_opening_state`
- `internet_*` / `import_internet_opening_state`
- `properties.debt` / `properties.overpayment`

Those are **owner receivables**, not AP.

### 4.2 Thin historical `uk_expenses` (optional)

```
XLSX row → uk_expenses (published) + budget_category_id
         → appears in budget execution fact
```

| Concern | Assessment |
|---------|------------|
| Feasibility | **YES** with narrow audited insert RPC or controlled admin import |
| Idempotency | Need natural key (date+title+amount+source_ref) — **not present today** |
| Conflict | Duplicate expenses inflate budget fact |
| Photos / receipts | Optional; historical may lack media |
| Synthetic payments | N/A if rows are expenses-only (no payment table) |
| Risk | Publishing historical amounts that were never board-approved; budget plan/fact distortion |

### 4.3 Budget year opening

Budget can be set via existing `admin_create_budget_year` / `admin_upsert_budget_line` / status RPCs.  
That is **operational setup**, not inventarisation of payables. Metadata adapter may mark `budget` as `requiresInitialSetup` later — still not an AP adapter.

---

## 5. Module lifecycle / Initial Setup registry

| Module | Initial Setup adapter today |
|--------|-----------------------------|
| `budget` | **None** (not registered in `bootstrap.ts`) |
| expenses | **No module key** |
| `contractors` | Stub only |
| `platform_support` | Unrelated SaaS invoices |
| `support_fee` / `internet` | IS-4 / IS-5 — **do not extend** |

---

## 6. Security / data risks (if forced early)

1. **Fake AP via wrong ledger** — contaminates owner finance D1–D7.  
2. **Client-side `uk_expenses` insert without opening RPC** — weaker audit than IS-4/IS-5 pattern; duplicates easy.  
3. **Budget fact inflation** from duplicate historical imports.  
4. **Confusing platform invoices with supplier invoices.**  
5. **No RLS-hardened opening path** for expenses inventarisation yet (admin table DML today).

---

## 7. Live read-only snapshot (`klowacuvufknbrkayjhz`)

| Metric | Value |
|--------|-------|
| `uk_expenses` | **0** |
| Budget categories | 7 |
| Budget years / lines / adjustments | 1 / 7 / 0 |
| `platform_billing_invoices` | 0 |
| Supplier / AP tables | **absent** |

Existing business receivable data (SF/Internet) was **not** modified by this audit.

---

## 8. Verdict

### Separate Initial Setup adapter for “financial documents / supplier expenses / opening payables”?

**NOT REQUIRED as an IS-6 implementation phase right now.**

**Reason:** There is **no canonical AP / supplier-document domain** to inventarise into. Building an adapter would invent a parallel financial system or misuse owner ledgers — both forbidden by Initial Setup standards and IS-4/IS-5 isolation rules.

### What *is* in scope later (product-dependent)

| Option | When |
|--------|------|
| **A. Close IS-6 (adapter NOT REQUIRED)** | Q2 = post-go-live Admin only; no historical inventarisation; AP deferred |
| **B. IS-6a — expenses inventarisation** | Need audited historical published expenses (opening markers, idempotency, XLSX) — **after** Q1–Q7, Q9–Q11 |
| **C. IS-6b — new AP domain + adapter** | True supplier invoices & opening payables — **new schema first**, then inventarisation (Q8 = yes) |

Bulk Admin inserts are **not** Initial Setup discipline (no preview/confirm, natural key, conflict rules, or inventarisation RPC).

---

## 9. Recommended sequence

1. **STOP implementation** until product answers §10.  
2. If Q2 = Admin-only → document adapter **NOT REQUIRED**; close IS-6.  
3. If expenses inventarisation (IS-6a): DDL opening markers + `import_uk_expense_opening_row` + Module Core adapter + tests — **never** SF/Internet opening/payment RPCs.  
4. If payables (IS-6b): suppliers / invoices / payments / opening payable ledger **before** any adapter.  
5. Keep Email Core OFF / debt gate OFF; no migration apply from this audit.

---

## 10. Required product decisions (Q1–Q12)

| # | Decision | Options (illustrative) |
|---|----------|------------------------|
| **Q1** | Scope: historical UK expense transparency only, and/or AP/opening payables? | Expenses · AP · both · neither (skip) |
| **Q2** | Is Initial Setup inventarisation required, or is post-go-live Admin entry enough? | Adapter · Admin only (NOT REQUIRED) |
| **Q3** | Do imported expenses count in budget execution, or exclude via opening marker / separate year? | Include · exclude |
| **Q4** | Import as `опубликован` vs `на проверке` + approve? | Published · pending |
| **Q5** | Natural key / idempotency (external ref, title+date+amount, …)? | Define unique key |
| **Q6** | Photos/receipts at inventarisation? | Required · optional · deferred |
| **Q7** | Must `budget` be ACTIVE + categories assigned before expense import? | Yes · no |
| **Q8** | If payables in scope: greenlight full supplier + invoice + payment schema now? | IS-6b · defer AP |
| **Q9** | Lifecycle: register under `budget`, new module key, or platform-service setup entry? | Choose key |
| **Q10** | Who may run inventarisation? | Admin-only · accountant |
| **Q11** | Conflict policy (SKIP identical / CONFLICT mismatch / never overwrite)? | Mirror IS-4-style |
| **Q12** | Opening cash/bank in AMADEUS? | In · out (no cash book today → likely out) |

---

## 11. Safety observed this audit

- No migrations applied  
- No imports / RPC business writes  
- No module / email / debt-gate changes  
- No commit / push / deploy  

---

## STOP

IS-6 READ-ONLY audit complete.  
**Do not implement** until Q1–Q12 are decided; if AP (Q8), a canonical payable domain must exist first.

