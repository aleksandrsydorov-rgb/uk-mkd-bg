# 10 — Billing / Commercial Documents (ALSYD ↔ Customer)

## A. Product facts

- Platform Support module stores/lists **`platform_billing_invoices`** locally.  
- Delivery/billing mode includes **`awaiting_master`** — UI must not claim live ALSYD Master sync.  
- Building **support fee / utilities** ledgers are **complex internal accounting**, not ALSYD selling to residents via PSP.  
- No Stripe/PSP dependency in `package.json`.  
- **Do not assume** platform rows are legally valid Bulgarian invoices / данъчни документи.

| Document | Purpose | Status |
|----------|---------|--------|
| Setup charge terms | One-time onboarding fee | Contract — **MISSING** in-app legal form |
| Monthly fee terms | Recurring SaaS | Contract |
| Commercial document (platform) | Local invoice-like row | **PARTIAL** (product) |
| Legally valid BG invoice | Tax/accounting | **OUTSIDE product unless integrated** — **LAWYER + accountant** |
| Payment evidence | Bank transfer proofs | Ops process |
| Overdue notice | Pre-suspension | Template needed |
| Final warning | | Template |
| Suspension notice | Align `SUSPENDED_NONPAYMENT` | Template + product |
| Restoration notice | | Template |
| Cancellation / credit note | | Accountant |
| VAT handling | | **LAWYER + accountant** |
| Billing recipient change | | Contract + admin process |

---

## B. Distinction (critical)

| Type | Meaning |
|------|---------|
| **Internal commercial document** | App record for complex admin visibility |
| **Bulgarian invoice / accounting document** | Must meet Accountancy Act / VAT Act formalities — typically issued from accounting system |

**Billing mapped:** YES  
**Legal invoice compliance claimed:** **NO**
