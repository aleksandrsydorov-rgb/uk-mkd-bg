# AMADEUS 11 — IS-5 Internet Initial Data Adapter  
## Targeted Technical Audit (READ ONLY)

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (tip includes IS-4 `187c67c` / docs `011088f`+)  
**Supabase:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Mode:** READ ONLY — no code, migration, data, module, email, or debt-gate changes  

**Baseline:** IS-1 Core · IS-2 Property Book · IS-3 Water/Electricity · IS-4 Support Fee · 238 tests · Email OFF · Debt gate OFF  

**Reference:** `is_4_safe_release.md`

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Audit status | **PARTIAL** |
| 2 | Canonical Internet architecture | Subscription + ledger + Tariff Core + system WOs; monthly billing; **separate from Support Fee** |
| 3 | Current subscription import feasibility | **YES with new inventarisation RPC** — must **not** call `request_internet_connect` (creates charge + WO) |
| 4 | Paid-period import feasibility | **CONDITIONAL** — no first-class paid-through column; represent via `next_charge_on` schedule + opening AR, **without** fabricating `payment` rows |
| 5 | Opening debt/credit feasibility | **YES with audited opening ledger entries** — extend kind CHECK or reuse `adjustment_*` with clear opening notes; **do not** reuse SF opening RPC |
| 6 | Property Book compatibility | **PASS** — `property_id` / `apartment_number`; one sub per apt; ownership transfers do not wipe internet history |
| 7 | XLSX adapter feasibility | **YES** (design only) — mirror IS-3/IS-4 preview/confirm/idempotency |
| 8 | Fresh-install compatibility | **PASS with gaps** — DDL in migrations; needs published internet tariff + module enable; no AMADEUS-hardcoded IDs found |
| 9 | Critical risks | Double-charge via cron/`request_internet_connect`; fake payments; inventarizing pending WO states; overwriting existing subs |
| 10 | Product decisions requiring approval | **5** (see §9) |
| 11 | Recommended implementation sequence | Design → opening RPC → adapter preview → dry-run → Safe Release |

---

## 1. Internet module architecture (VERIFIED)

### Domain model

```
tariff_catalog (internet) → tariff_versions → tariff_rate_items (month; natural|legal)
       ↓ resolve_internet_tariff(date[, subject_kind])
internet_subscriptions  (unique property_id)
       ↓ status + billing_day / billing_anchor_date / next_charge_on
internet_ledger  (charge | payment | adjustment_debit | adjustment_credit)
       ↓ get_internet_balance = charge+adj_debit − payment−adj_credit
work_orders (internet_action enable|disable, internet_subscription_id)
       ↓ complete_work_order → active / inactive
cron: process_internet_monthly_charges / process_internet_expiry_disconnects
```

| Concern | Canonical object | Notes |
|---------|------------------|-------|
| Module key | `internet` | `modules.ts`, `module_catalog`, `building_modules` |
| Plans / tariffs | Tariff Core `tariff_key=internet` | Month component after `20260926230000`; day prepaid deprecated |
| Apartment subscription | `internet_subscriptions` | **One per apartment** (`unique(property_id)`) |
| Connection status | `status` | `pending_enable` \| `active` \| `pending_disable` \| `inactive` |
| Start / end dates | `period_start` / `period_end` | Legacy prepaid; monthly model keeps start, clears end on enable |
| Billing cycle | `billing_day` (1–28), `billing_anchor_date`, `next_charge_on` | Recurring monthly cron |
| Paid-through | **No column** | Implicit: periods before `next_charge_on` are not re-charged by cron |
| Charges | `internet_ledger.kind=charge` | Connect request + monthly cron |
| Invoices | **None** for residential internet | `platform_billing_invoices` is SaaS/platform — unrelated |
| Payments | `record_internet_payment` → `kind=payment` | Staff admin/бухгалтер |
| Allocations | **None** | Unlike Support Fee |
| Outstanding / credit | `get_internet_balance.balance_eur` | Positive debt; negative credit |
| Connect / disconnect history | Subscription status + WO enable/disable + ledger | Append-only ledger |
| Activation / suspension | WO completion + debt disconnect RPC; service lock can block | Module UX toggle separate from lifecycle |
| Notifications / auto | Cron jobs Sofia 07:00 | Monthly charges; legacy expiry disconnects |

### Key files

| Layer | Paths |
|-------|-------|
| Migrations | `20260926200000_internet_module.sql` … `20260926240000_internet_wo_overload_fix.sql`; subject kind `20260927180000_*` |
| Client | `src/lib/internet.ts`, `src/lib/utilities.ts`, `src/lib/tariffs.ts` |
| Admin UI | `AdminInternet.tsx`, `AdminTariffs.tsx`, admin section `интернет` |
| Owner UI | `OwnerInternet.tsx`, `OwnerUtilities.tsx` finance tab |
| Module Core | **No** internet opening adapter in `bootstrap.ts` yet |
| Types | `database.types.ts` — `internet_subscriptions`, `internet_ledger`, internet RPCs |

### Key RPCs (VERIFIED)

| RPC | Role for IS-5 |
|-----|----------------|
| `request_internet_connect` | **Forbidden for opening** — inserts month `charge` + enable WO |
| `request_internet_disconnect` / `admin_internet_disconnect_debt` | Operational only |
| `cancel_internet_connect_request` | Credits last charge via `adjustment_credit` |
| `record_internet_payment` | Operational cash — **not** historical inventarisation |
| `get_internet_balance` / `get_internet_fund_totals` | Read SoT for preview effect |
| `process_internet_monthly_charges` | Cron — **must not** double-charge after opening |
| `request_internet_extend` | **Removed** (raises `feature_removed`) |
| Opening inventarisation RPC | **Missing** |

### Production snapshot (read-only, 2026-10-14)

| Metric | Value |
|--------|-------|
| Subscriptions | 1 (`inactive`) |
| Ledger rows | 1 (`charge`) |
| Tariff catalog active | true |
| `building_modules.internet` enabled | true |
| `module_lifecycle.internet` | ACTIVE |

### VERIFIED vs proposed

| Item | Status |
|------|--------|
| Separate ledger from Support Fee | **VERIFIED** |
| Monthly billing + cron | **VERIFIED** |
| No residential invoices | **VERIFIED** |
| No IS-5 adapter / opening RPC | **VERIFIED (gap)** |
| Monthly cron uses 1-arg tariff → **natural** rates | **VERIFIED** (2-arg legal exists; cron path natural-only) |
| Exact XLSX columns / opening kinds | **PROPOSED** (this audit) |

**Hard constraint:** Do **not** reuse `import_support_fee_opening_state`. Models differ (assessments/allocations/D1 vs subscription+utility ledger).

---

## 2. Property Book integration

| Topic | Finding |
|-------|---------|
| Link | `internet_subscriptions.property_id` → `properties.id` |
| Canonical apartment id | Book / properties; import match on `apartment_number` (forbid client `property_id`) |
| Ownership changes | Ledger + subscription stay on apartment; new Book owners see history via `owns_property` |
| Multiple subscriptions | **Not supported** — unique `property_id` |
| Cross-installation | Single-building contour (no `installation_id` on internet tables; same as other utilities) |
| Archive | Property archive blocked when internet sub/ledger present |

**Never duplicate** apartment or ownership rows. Dependency: `property_book` readiness (IS-2 pattern).

---

## 3. Required opening data — field classification

Legend: **A** schema supports today · **B** adapter logic · **C** schema/RPC change · **D** product decision · **E** unsupported / forbidden

| Field | Class | Notes |
|-------|-------|-------|
| Apartment number | **A**+**B** | Book match |
| Connection status | **A**+**B**+**D** | Import only `active` / `inactive` recommended; forbid inventarizing `pending_*` with fake WOs |
| Current plan / tariff | **A**+**B** | Resolve published `internet` month rate; snapshot optional `tariff_version_id` on opening charge/credit notes |
| Subscription start date | **A**+**B** | Map to `period_start` / `billing_anchor_date` |
| Current billing period | **A**+**B**+**D** | Encode via `billing_day` + `next_charge_on` |
| Paid-through date | **B**+**C**/`D` | No column; recommend declare `paid_through` → set `next_charge_on` = first unpaid charge date |
| Already paid periods (month list) | **D**/prefer skip | Do not fabricate per-month `charge`+`payment` pairs |
| Existing debt | **B**+**C** | Opening debit into `internet_ledger` (new opening kind or audited `adjustment_debit`) |
| Existing credit/overpayment | **B**+**C** | Opening credit (`opening_credit` or audited `adjustment_credit`); never ordinary `payment` |
| Opening transition date | **B** | Meta / RPC param / note |
| Source document / reference | **B** | Note + import audit table |
| Fake enable/disable work orders | **E** | Forbidden |
| Call `request_internet_connect` for active import | **E** | Creates operational charge + WO |
| Reuse SF opening RPC | **E** | Incompatible SoT |

---

## 4. Historical payment safety

| Anti-pattern | Verdict |
|--------------|---------|
| Fake `payment` rows for past months | **Unsafe** — pollutes cash semantics and `record_internet_payment` |
| Reissuing historical invoices | **N/A** — no residential invoices |
| Generating duplicate charges via connect/cron | **Critical risk** — opening must set future `next_charge_on` and skip connect RPC |
| Altering historical ledger rows | **Forbidden** — append-only |
| Overwriting calculated balances by client UPDATE | **Forbidden** — no direct client DML; SELECT-only RLS |

### Can audited opening state be represented?

**YES — with a dedicated inventarisation RPC**, analogous in *discipline* to IS-4 but on the internet contour:

1. Upsert `internet_subscriptions` for scope `(property_id)` with status + billing schedule (`billing_day`, `billing_anchor_date`, `next_charge_on`, `period_start`).  
2. Append opening ledger row(s) for declared debt and/or credit — **not** `kind=payment`.  
3. Prefer extending `internet_ledger_kind_check` with `opening_debit` / `opening_credit` (clearer than overloading operational `adjustment_*`), **or** product accepts tagged `adjustment_*` with immutable opening notes + import audit table.  
4. Update `get_internet_balance` (and any UI net helpers) to include opening kinds if new kinds are added.  
5. Idempotency key + unique scope finalization; conflict if active/pending sub already exists (default).  
6. Never create system WOs during opening.

**Paid periods without payments:** declare `paid_through` / set `next_charge_on` so cron does not re-bill already-settled months. Do **not** insert historical month charges.

---

## 5. XLSX import design (recommendation only — not implemented)

### Sheets

| Sheet | Purpose |
|-------|---------|
| `subscriptions` | Per-apartment opening subscription + AR |
| `instructions_bg` / `instructions_ru` / `instructions_en` | Rules + examples |

Optional building-level sheet only if product requires tariff inventarisation here; otherwise tariff remains Admin Tariffs (already VERIFIED).

### Proposed `subscriptions` columns

`apartment_number`, `status` (`active`|`inactive`), `billing_day`, `billing_anchor_date`, `paid_through` *or* `next_charge_on`, `opening_debt`, `opening_credit`, `transition_date`, `source_reference`, `notes`

### Controls (mirror IS-3/IS-4)

| Control | Recommendation |
|---------|----------------|
| Apartment matching | Book `apartment_number` only |
| Plan/tariff matching | Use published Tariff Core at transition; do not invent rates in XLSX unless product requires |
| Date / period validation | `billing_day` 1–28; `next_charge_on` ≥ transition; `paid_through` consistency |
| Status validation | Reject `pending_*` in import |
| Duplicates | Unique apt in file; unique DB scope |
| Existing subscription | Default **CONFLICT** (Q5-style); identical prior opening → SKIP |
| Preview | CREATE / SKIP / CONFLICT / ERROR; never write finance |
| Approval | Admin confirm → per-row opening RPC |
| Idempotency | UUID key + scope uniqueness |
| Partial failures | Per-row outcomes; never claim full success |
| Error workbook | Downloadable |
| Import history | `module_import_batches` (+ optional `internet_opening_imports`) |

---

## 6. Security and lifecycle

| Topic | Finding |
|-------|---------|
| Admin-only setup | Initial Setup already admin-gated; opening RPC should require `администрация` (stricter than day-to-day cashier if product agrees) |
| RLS | Subscriptions/ledger: SELECT for owner or admin/бухгалтер; writes via SECURITY DEFINER RPCs only |
| Authz on payments | `record_internet_payment` admin/бухгалтер |
| Installation isolation | Building singleton pattern; no multi-install internet FK |
| Canonical module key | `internet` |
| Dependencies | `property_book` + published internet tariff + finance authz |
| Setup readiness | Register adapter `requiresInitialSetup: true` |
| Activation / suspension | Lifecycle must not auto-toggle `building_modules.enabled` (IS-1 rule) |
| Auto state on page load | Must not inventarise or activate |

---

## 7. Fresh distributive compatibility

| Item | Status |
|------|--------|
| Tables / RPCs / cron DDL | In migration series `20260926200000`–`20260926240000` (+ subject-kind updates) |
| Required config | Publish internet month tariff; enable module when ready |
| Seeds | `module_catalog` / `building_modules` insert-if-missing |
| Hardcoded AMADEUS property IDs | **Not found** in internet migrations |
| Env / external ISP integrations | **None** in schema — connection is operational WO + status |
| Missing for IS-5 inventarisation | Opening RPC + optional opening ledger kinds + adapter registration |

Do **not** package a new project now; document opening DDL in the future IS-5 migration when implementing.

---

## 8. Test coverage

### Existing

| Area | Coverage |
|------|----------|
| Subscription create / connect | **Thin / none** in unit tests |
| Tariff selection | Indirect via Tariff Core tests (not internet-specific) |
| Paid periods | **None** |
| Duplicate protection | **None** (DB unique only) |
| Authorization | **None** dedicated internet RPC tests |
| Ownership changes | Finance reporting separation only |
| Cross-apartment isolation | **None** internet-specific |
| Historical payment safety | **None** |
| Reporting | `financeReportingSeparation.test.ts` — internet outstanding separated from SF |

### Recommended IS-5 tests

1. Active inventarisation sets schedule without charge/WO  
2. Inactive + opening debt / credit  
3. `paid_through` → correct `next_charge_on`  
4. Math: debt/credit nonnegative; mutual exclusion rules if product forbids both  
5. Duplicate / finalization / idempotent retry  
6. Existing subscription CONFLICT  
7. Unauthorized caller  
8. Wrong apartment / spoofed `property_id`  
9. Balance equals `get_internet_balance` after opening kinds  
10. No synthetic `payment` rows  
11. Cron safety: `next_charge_on` not in the past at inventarisation  
12. Ownership transfer still apartment-scoped  

---

## 9. Product decisions (approval required)

Avoid re-asking Lifecycle v1.2 generics (preview before write, admin confirm, no silent overwrite, Property Book SSOT).

### Q1 — Opening contour grain

**Recommend:** One row per apartment: status + billing schedule + opening AR (debt and/or credit).  
**Alternatives:** Deep month-by-month charge reconstruction (reject).  
**Impact:** Matches unique subscription model; avoids fake history.  
**Risk if wrong:** Ledger pollution; cron double-billing.

### Q2 — Representing “already paid” periods

**Recommend:** Import `paid_through` (or explicit `next_charge_on`) **without** payment/charge history rows.  
**Alternatives:** Reconstruct N months of charge+payment (unsafe).  
**Impact:** Cron resumes from first unpaid date.  
**Risk if wrong:** Immediate `process_internet_monthly_charges` charges.

### Q3 — Opening debt/credit ledger representation

**Recommend:** New ledger kinds `opening_debit` / `opening_credit` (extend CHECK; update balance SQL) — parallel to IS-4 clarity.  
**Alternatives:** Tagged `adjustment_debit` / `adjustment_credit` only (no CHECK change; weaker audit separation).  
**Impact:** Balance SoT remains `internet_ledger` sum.  
**Risk if wrong:** Opening confused with cancel/correction adjustments.

### Q4 — Existing subscription conflict

**Recommend:** Default **CONFLICT / ERROR**; never overwrite; identical prior opening import → SKIP.  
**Alternatives:** Force replace (reject for v1).  
**Impact:** Protects live AMADEUS data (currently 1 inactive sub + 1 charge).  
**Risk if wrong:** Lost WO/ledger linkage.

### Q5 — Pending connect/disconnect states

**Recommend:** Import **forbids** `pending_enable` / `pending_disable` (no synthetic WOs). Only `active` / `inactive`.  
**Alternatives:** Allow pending without WO (inconsistent with operational RPCs).  
**Impact:** Opening stays inventarisation, not fake workflow.  
**Risk if wrong:** Stuck pending rows without engineer path.

---

## 10. Critical risks

1. **Double charge** — using `request_internet_connect` or past `next_charge_on` under cron.  
2. **Synthetic payments** — fabricating `kind=payment` for history.  
3. **Wrong SoT** — folding internet into Support Fee opening RPC / portal `properties.debt`.  
4. **Silent overwrite** of existing subscriptions.  
5. **Pending WO inventarisation** without real work orders.  
6. **Legal vs natural** — monthly cron natural-only; opening must not assume legal rate auto-applies on cron.

---

## 11. Recommended implementation sequence

1. **Approve Q1–Q5.**  
2. **Design** narrowly scoped `import_internet_opening_state` (admin, idempotent, conflict-safe, no WO, no payment).  
3. **Prepare migration** (opening kinds if chosen + import audit table + balance function update) — do not apply until DB release.  
4. **Adapter** under module key `internet` (Property Book dependency; XLSX preview/confirm/retry).  
5. **Deterministic tests** (§8).  
6. **Local report** → DB release → Safe Release dry-run (preview only first).  

---

## STOP

Read-only audit complete. No implementation, migration apply, inventarisation, commit, push, or deploy performed.
