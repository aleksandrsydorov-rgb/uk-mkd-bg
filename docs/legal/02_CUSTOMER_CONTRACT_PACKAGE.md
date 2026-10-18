# 02 — Contract Package: ALSYD ↔ Complex / УК / Condominium

**Status:** Structure for lawyer drafting — not executed terms  
**Repo status of signed contracts in-app:** **MISSING**

---

## A. Agreements to assess

| # | Document | Purpose | Mandatory / Recommended / Lawyer |
|---|----------|---------|----------------------------------|
| 1 | Master SaaS / Platform Service Agreement | Core rights, IP, liability, term | MANDATORY |
| 2 | Order Form / Service Order | Complex ID, fees, start date, domain | MANDATORY |
| 3 | Service specification / scope | Modules in/out; Master vs local | MANDATORY |
| 4 | Setup & implementation terms | Onboarding, data import, training | MANDATORY |
| 5 | Monthly platform service terms | Recurring fee, indexation | MANDATORY |
| 6 | SLA / availability | Uptime targets, credits | RECOMMENDED |
| 7 | Support terms | Channels, hours, severity | MANDATORY |
| 8 | Maintenance / update policy | Releases, breaking changes | RECOMMENDED |
| 9 | **DPA** (Art. 28) | Processor instructions | MANDATORY (if processor) |
| 10 | Security annex | Controls, audits | RECOMMENDED |
| 11 | Subprocessor annex | Supabase, Vercel, email… | MANDATORY (if DPA) |
| 12 | Retention / deletion annex | End of contract + ongoing | MANDATORY |
| 13 | Exit / migration / export | Data export, format, help desk | MANDATORY |
| 14 | Backup / recovery responsibilities | RPO/RTO split ALSYD vs customer | RECOMMENDED |
| 15 | Domain responsibility schedule | See `03_` | MANDATORY if ALSYD touches DNS |
| 16 | Hosting responsibility | Who contracts Supabase/Vercel | MANDATORY |
| 17 | Liability allocation | Caps, exclusions | MANDATORY |
| 18 | IP / licence | ALSYD software; customer data | MANDATORY |
| 19 | Confidentiality | Mutual | MANDATORY |
| 20 | Payment terms | Setup, monthly, currency, VAT | MANDATORY |
| 21 | Overdue / non-payment process | Notice → suspend → terminate | MANDATORY |
| 22 | Termination | Cause / convenience | MANDATORY |
| 23 | Suspension rules | Align with `SUSPENDED_NONPAYMENT` product intent | MANDATORY |
| 24 | Data handover on termination | Book, docs, meetings archives | MANDATORY |
| 25 | Governing law / jurisdiction | Bulgaria (typical) | MANDATORY |
| 26 | Change-control / versioning | Policy & product changes | RECOMMENDED |
| 27 | Condominium vs УК role clause | Who is customer | **LAWYER DECISION** |
| 28 | Signer authority warranty | Board/manager resolution | **LAWYER DECISION** |
| 29 | Administrator provisioning | Named admins, MFA | MANDATORY |
| 30 | Contact persons | Legal, billing, technical | MANDATORY |

---

## B. Contracting scenarios

### Scenario A — Customer = management company / УК

| Question | Draft assumption | Lawyer |
|----------|------------------|--------|
| Who signs | УК legal representative | Confirm |
| Who pays | УК | Confirm pass-through to owners |
| Service recipient | УК (and building users as permitted) | Confirm |
| Controller of resident data | Usually **УК or condominium** — **LAWYER** | Required |
| ALSYD role | Processor for building data; controller for ALSYD billing/support | Confirm |
| Instructions | Written DPA + Order Form | |
| Proof of authority | Commercial register extract | |

### Scenario B — Customer = condominium / етажна собственост

| Question | Draft assumption | Lawyer |
|----------|------------------|--------|
| Who signs | Chair / manager with decision of general meeting? | **Critical** |
| Who pays | Condominium bank account / manager | Confirm |
| Service recipient | Condominium as association | Confirm capacity to contract |
| Controller | Often condominium (or manager as controller) | **LAWYER** |
| ALSYD role | Processor | Confirm |
| Proof of authority | Protocol of meeting / notarised? | **LAWYER** |

### Scenario C — Other legal entity acting for the building

| Question | Draft assumption | Lawyer |
|----------|------------------|--------|
| Who signs | That entity | Mandate chain |
| Risk | Hidden agency; wrong controller | High — require warranty of mandate |

---

## C. Mapping to product

| Contract topic | System location today |
|----------------|----------------------|
| Named admins | Staff roles (`администрация`) |
| Platform Support | Admin section `платформа` |
| Suspension for non-payment | Product intent in Platform Support docs — **PARTIAL** |
| Local invoices | `platform_billing_invoices` — commercial, not tax invoice |
| Module enablement | Module Core toggles; platform-core always on |
| Data export on exit | **MISSING** as formal product feature |

---

## D. Template outline — Master SaaS Agreement (skeleton)

1. Parties & definitions  
2. Scope of Services (software access; exclusions: physical УК duties)  
3. Customer responsibilities (lawful instructions; accuracy of book; lawful meeting use)  
4. Fees & taxes  
5. SLA & support (annex)  
6. Data protection (DPA annex)  
7. Security  
8. Confidentiality  
9. IP & licence (non-exclusive, non-transferable, complex-scoped)  
10. Customer data ownership  
11. Acceptable use  
12. Suspension & termination  
13. Exit assistance  
14. Liability & indemnity  
15. Governing law  
16. Signatures / authority warranty  

**E-signature needed:** **LAWYER DECISION** (qualified vs simple electronic).

---

## E. Open counsel questions (contracts)

1. Can етажна собственост be sole contractual party under Bulgarian law for SaaS?  
2. Minimum evidence of signer authority?  
3. Are limitation-of-liability clauses enforceable for condominium IT services?  
4. Must ALSYD accept instructions only from УК, or also from individual board members?
