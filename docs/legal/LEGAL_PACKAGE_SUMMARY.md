# ALSYD / AMADEUS 11 — Legal Package Summary

**Status:** Draft inventory for Bulgarian counsel review  
**Date:** 2026-10-08  
**Repo audited:** `uk-mkd-bg` (residential complex installation / Amadeus-class deployment)  
**Operator (commercial context):** ALSYD EOOD, Bulgaria  

> **Disclaimer:** This package does **not** constitute legal advice or a compliance certification.  
> Draft structures are for lawyer review only. No claim of GDPR, DSA, ЗУЕС, or tax compliance is made.

---

## Totals

| Metric | Count |
|--------|------:|
| **TOTAL DOCUMENTS IDENTIFIED** | **72** |
| **MANDATORY** (commercial launch blockers if counsel confirms) | **28** |
| **RECOMMENDED** | **26** |
| **LAWYER DECISION REQUIRED** | **18** |

*(Counts from `00_MASTER_LEGAL_REGISTER.md`. “Mandatory” here means “likely required before commercial go-live pending counsel confirmation,” not a self-certified legal obligation.)*

---

## SYSTEM GAPS REQUIRING IMPLEMENTATION

1. **No Terms of Use / Privacy Notice pages** — home footer privacy/rules labels are non-linked text (`src/app/page.tsx`).
2. **No first-login / invite acceptance** of policies — invite flow is password + OTP only (`src/app/auth/invite/page.tsx`).
3. **No policy version / acceptance audit store** (timestamp, version, IP, subject).
4. **No cookie banner / Cookie Policy** — session cookies via Supabase Auth exist; no consent UI.
5. **No DPA / subprocessors disclosure** surfaced to customer or end users in-product.
6. **Platform billing documents** are local commercial records (`platform_billing_invoices`), mode `awaiting_master` — **not** validated Bulgarian invoices.
7. **Email delivery** for invites/reminders often `LOCAL_ONLY` / `PROVIDER_NOT_CONFIGURED` — honest UX, but legal “proper notice” for ЗУЕС is unresolved.
8. **Meeting Core** marks multiple items `needs_legal_signoff` before production (`docs/meeting-core.md`).
9. **Domain / infrastructure handover** protocols not in product or ops pack.
10. **DSAR / breach / retention** workflows not implemented as product features.
11. **ALSYD Control (Master)** adapter not live — support/billing sync incomplete for multi-complex ops.
12. **Guest / tenant / proxy** legal terms not separated in UX acceptance.

---

## TOP 10 LEGAL DECISIONS REQUIRED BEFORE FIRST COMMERCIAL LAUNCH

1. Exact **legal classification** of ALSYD EOOD for this product (SaaS / information-society / intermediary / other).
2. Whether **“aggregator”** is usable commercially or is a regulated category — **do not treat as established**.
3. **Controller vs processor** mapping per data flow (book, auth, meetings, chat, billing).
4. Who may **sign** for condominium (етажна собственост) vs management company (УК).
5. **ЗУЕС** sufficiency of in-app / electronic invitation, placement protocol, hybrid/online quorum and voting.
6. Whether **consent** is needed for account processing vs contract / legitimate interest / legal obligation.
7. **Invoice / VAT / accounting** form of ALSYD→customer charges vs current platform “commercial document.”
8. **Domain ownership** model (ALSYD-held vs customer-held) and handover liability.
9. **Retention / deletion** periods for book, meetings, chat, support, billing.
10. **DPIA / DPO** necessity and any Bulgarian registrations/notifications.

---

## PROPOSED LEGAL CLASSIFICATION OF ALSYD

**Working hypothesis (not a conclusion):**  
ALSYD EOOD primarily acts as a **software / SaaS provider** of an isolated residential-complex management application, and — for personal data processed **on behalf of** the complex/management customer under documented instructions — likely a **processor** (with possible **controller** roles for its own CRM, platform billing, and ALSYD support accounts).

**Not established without counsel:** “aggregator,” “online platform” under DSA, “property-management service provider,” payment intermediary.

**CONFIDENCE:** Low–medium (product facts clear; legal mapping unresolved)  
**LAWYER VALIDATION REQUIRED:** **YES**

See `01_COMPANY_LEGAL_CLASSIFICATION.md` and section **“IS ALSYD AN AGGREGATOR?”**.

---

## Repository snapshot (factual)

| Area | Status |
|------|--------|
| Auth invite (password + OTP) | IMPLEMENTED |
| Policy acceptance checkboxes | MISSING |
| Privacy / Terms pages | MISSING (footer labels only) |
| Cookie consent banner | MISSING |
| Property Book | IMPLEMENTED (product) |
| Guest mode | PARTIAL (module) |
| General Meeting Core | PARTIAL (needs legal sign-off) |
| Platform Support + local invoices | PARTIAL (`awaiting_master`) |
| User Activation | IMPLEMENTED (admin metrics) |
| Confirmed processors in deps/config | Supabase; Vercel env refs |
| Email/SMS provider wired | MISSING / PARTIAL (honest non-delivery statuses) |
| `docs/legal/` prior content | MISSING (this package creates it) |

---

## Package index

| File | Topic |
|------|--------|
| `00_MASTER_LEGAL_REGISTER.md` | Full document register |
| `01_COMPANY_LEGAL_CLASSIFICATION.md` | Classification memo + aggregator |
| `02_CUSTOMER_CONTRACT_PACKAGE.md` | ALSYD ↔ customer contracts |
| `03_DOMAIN_INFRASTRUCTURE_HANDOVER.md` | Domains / infra |
| `04_END_USER_FIRST_LOGIN_MATRIX.md` | Acceptance matrix |
| `05_GDPR_DATA_MAP.md` | GDPR inventory |
| `06_SUBPROCESSORS.md` | Third parties |
| `07_END_USER_TERMS_PACKAGE.md` | End-user terms set |
| `08_GENERAL_MEETING_LEGAL_DOCS.md` | Meetings / ЗУЕС |
| `09_PROPERTY_BOOK_LEGAL_DOCS.md` | Ownership book |
| `10_BILLING_ACCOUNTING_DOCS.md` | Billing |
| `11_SECURITY_OPERATIONAL_POLICIES.md` | Security / ops |
| `12_LAUNCH_CHECKLIST.md` | Chronological launch |
| `13_LAWYER_QUESTIONS.md` | Counsel questionnaire |
| `14_IMPLEMENTATION_GAPS.md` | Product gaps vs legal needs |
