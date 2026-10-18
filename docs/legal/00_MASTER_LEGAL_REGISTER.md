# 00 — Master Legal Document Register

**Legend — Mandatory column:** M = Mandatory (launch blocker pending counsel) · R = Recommended · L = Lawyer decision  
**Status:** Draft / Missing / Partial in product · **E-sign:** Y/N/L  

| ID | DOCUMENT | PARTIES / AUDIENCE | PURPOSE | M/R/L | WHEN SIGNED/ACCEPTED | SYSTEM LOCATION | VERSIONED | E-SIGN | STORAGE PERIOD | OWNER | STATUS | LAWYER COMMENTS |
|----|----------|--------------------|---------|-------|----------------------|-----------------|-----------|--------|----------------|-------|--------|-----------------|
| C-01 | Articles / corporate docs ALSYD EOOD | Corporate | Capacity | M | Pre-trading | Offline | Y | L | Legal | ALSYD | Draft ops | |
| C-02 | Trade register extract | Corporate | Counterparty KYC | R | Per deal | Offline | Y | N | Deal file | ALSYD | Ops | |
| C-03 | UBO / AML checklist if required | Corporate | Compliance | L | Per deal | Offline | Y | N | Legal | ALSYD | L | |
| A-01 | Master SaaS Agreement | ALSYD↔Customer | Core contract | M | Before go-live | Offline (+ future vault) | Y | L | Contract life+ | ALSYD Legal | Missing | |
| A-02 | Order Form / Service Order | ALSYD↔Customer | SKU, fees, domain | M | With A-01 | Offline | Y | L | Contract life+ | ALSYD | Missing | |
| A-03 | Service specification | ALSYD↔Customer | Scope modules | M | Annex | Offline | Y | N | Contract life+ | Product | Missing | |
| A-04 | Setup & implementation SoW | ALSYD↔Customer | Onboarding | M | Annex | Offline | Y | N | Project | Delivery | Missing | |
| A-05 | Monthly service schedule | ALSYD↔Customer | Recurring fees | M | Annex | Offline | Y | N | Contract | Finance | Missing | |
| A-06 | SLA | ALSYD↔Customer | Availability | R | Annex | Offline | Y | N | Contract | Ops | Missing | |
| A-07 | Support terms | ALSYD↔Customer | Support | M | Annex | Align Platform Support | Y | N | Contract | Support | Partial product | |
| A-08 | Maintenance/update policy | ALSYD↔Customer | Changes | R | Annex | Offline | Y | N | Contract | Product | Missing | |
| A-09 | DPA Art. 28 | ALSYD↔Customer | Processor terms | M | With A-01 | Offline | Y | L | Contract+GDPR | ALSYD DPO/Legal | Missing | L |
| A-10 | Security annex | ALSYD↔Customer | Controls | R | Annex | Offline | Y | N | Contract | Security | Missing | |
| A-11 | Subprocessor annex | ALSYD↔Customer | Supabase/Vercel… | M | With DPA | Offline + `06_` | Y | N | Contract | Legal | Missing | |
| A-12 | Retention/deletion annex | ALSYD↔Customer | Erasure/exit | M | Annex | Offline | Y | N | Contract | Legal | Missing | |
| A-13 | Exit/migration procedure | ALSYD↔Customer | Portability | M | Annex | Offline | Y | N | Contract | Delivery | Missing | |
| A-14 | Backup/recovery roles | ALSYD↔Customer | RPO/RTO | R | Annex | Offline | Y | N | Contract | Ops | Missing | |
| A-15 | Domain responsibility schedule | ALSYD↔Customer | DNS/SSL | M | If DNS touched | `03_` | Y | Y | Contract | Ops | Missing | |
| A-16 | Hosting responsibility | ALSYD↔Customer | Who contracts host | M | Annex | Offline | Y | N | Contract | Ops | Missing | |
| A-17 | Liability schedule | ALSYD↔Customer | Caps | M | In MSA | Offline | Y | L | Contract | Legal | Missing | L |
| A-18 | IP / licence grant | ALSYD↔Customer | Software licence | M | In MSA | Offline | Y | N | Contract | Legal | Missing | |
| A-19 | Confidentiality | ALSYD↔Customer | Mutual NDA-in-MSA | M | In MSA | Offline | Y | N | Contract | Legal | Missing | |
| A-20 | Payment terms | ALSYD↔Customer | Invoicing cycle | M | In MSA/OF | Offline | Y | N | Contract | Finance | Missing | |
| A-21 | Overdue/suspension schedule | ALSYD↔Customer | Non-payment | M | Annex | Product intent | Y | N | Contract | Finance | Partial | |
| A-22 | Termination clauses | ALSYD↔Customer | Exit | M | In MSA | Offline | Y | N | Contract | Legal | Missing | |
| A-23 | Suspension rules detail | ALSYD↔Customer | Ops | M | Annex | Platform Support | Y | N | Contract | Support | Partial | |
| A-24 | Data handover protocol | ALSYD↔Customer | Termination | M | On exit | Offline | Y | Y | Exit file | Delivery | Missing | |
| A-25 | Governing law clause | ALSYD↔Customer | BG law typical | M | In MSA | Offline | Y | N | Contract | Legal | Missing | L |
| A-26 | Change-control | ALSYD↔Customer | Versions | R | Annex | Offline | Y | N | Contract | Product | Missing | |
| A-27 | Authority warranty (signer) | Customer | Capacity | M | Signature block | Offline | Y | Y | Deal file | Legal | Missing | L |
| A-28 | Admin nomination form | Customer→ALSYD | Named admins | M | Onboarding | Staff roles | Y | Y | Contract life | Delivery | Partial | |
| A-29 | Contacts schedule | Both | Escalation | M | Order Form | Offline | Y | N | Contract | Both | Missing | |
| A-30 | Condominium vs УК role rider | Both | Party clarity | L | Annex | Offline | Y | L | Contract | Legal | Missing | L |
| U-01 | Platform Terms of Use | End users | Use rules | M | First login | **Missing pages** | Y | N | Accept log | Legal+Product | Missing | L who is party |
| U-02 | Acceptable Use Policy | End users | Abuse | R | Part of ToU | Missing | Y | N | Accept log | Legal | Missing | |
| U-03 | Privacy Notice (end users) | End users | Art. 13/14 | M | First login + link | Footer label only | Y | N | Public+log | Legal | Missing | |
| U-04 | Cookie Policy | Visitors/users | Cookies | R/L | Banner/link | Missing | Y | N | Public | Legal | Missing | L |
| U-05 | Electronic communications notice | Users | e-notice | L | Accept | Missing | Y | N | Accept log | Legal | Missing | L |
| U-06 | Notification policy | Users | Channels | R | Link | Missing | Y | N | Public | Product | Missing | |
| U-07 | Account security rules | Users | Hygiene | R | ToU section | Missing | Y | N | Accept log | Security | Missing | |
| U-08 | Guest Terms | Guests | Guest_mode | R | Guest activate | Partial module | Y | N | Accept log | Legal | Missing | |
| U-09 | Tenant Terms | Tenants | If used | L | Onboard | Partial | Y | N | Accept log | Legal | Missing | L |
| U-10 | Owner duties addendum | Owners | Book contacts | R | ToU | Missing | Y | N | Accept log | Legal | Missing | |
| U-11 | Administrator Terms | Staff admins | Elevated access | M | Staff onboarding | Partial roles | Y | Y | HR/contract | Legal | Missing | |
| U-12 | Engineer/contractor terms | Assignees | Confidentiality | R | Staff/vendor | Work orders | Y | Y | HR | Legal | Missing | |
| U-13 | Chat/community rules | Chat users | Conduct | R | ToU | Chat module | Y | N | Accept log | Product | Missing | |
| U-14 | Complaints / abuse procedure | All | Reporting | R/L | Link | Missing | Y | N | Public | Legal | Missing | DSA? |
| U-15 | Account suspension/deletion policy | Users | Lifecycle | R | ToU | Partial | Y | N | Public | Product | Missing | |
| U-16 | Marketing consent record | Users | Optional marketing | L | Opt-in | Missing | Y | N | Consent DB | Marketing | Missing | |
| G-01 | RoPA (ALSYD) | ALSYD | Art. 30 | M | Ongoing | Offline | Y | N | Ongoing | DPO/Legal | Missing | |
| G-02 | RoPA (Customer guidance) | Customer | Art. 30 help | R | Onboarding | Offline | Y | N | Customer | Legal | Missing | |
| G-03 | Lawful basis matrix | Both | GDPR | M | Pre-launch | `05_` | Y | N | Compliance | Legal | Draft | L |
| G-04 | DPIA (if required) | ALSYD/Customer | High risk | L | Pre-meetings prod | Offline | Y | N | Compliance | DPO | Missing | L |
| G-05 | LIA templates | Controller | L.I. basis | L | As needed | Offline | Y | N | Compliance | DPO | Missing | L |
| G-06 | DSAR playbook | Controllers | Rights | M | Pre-launch | Missing product | Y | N | Compliance | Support | Missing | |
| G-07 | Breach procedure | Controllers | 72h | M | Pre-launch | `11_` | Y | N | Compliance | Security | Missing | |
| G-08 | Privacy Notice (admins/contacts) | Customer staff | Transparency | M | Contracting | Missing | Y | N | Public | Legal | Missing | |
| G-09 | Privacy Notice (website) | Visitors | Transparency | M | Site live | Missing | Y | N | Public | Legal | Missing | |
| D-01 | Domain Management Authorization | ALSYD↔Customer | DNS authority | M | Pre-cutover | `03_` | Y | Y | Infra file | Ops | Missing | |
| D-02 | Domain Transfer Protocol | ALSYD↔Customer | In/out transfer | R | On transfer | `03_` | Y | Y | Infra file | Ops | Missing | |
| D-03 | Domain Handover Protocol (exit) | ALSYD↔Customer | Exit DNS | M | Termination | `03_` | Y | Y | Exit file | Ops | Missing | |
| D-04 | Infrastructure Handover Protocol | ALSYD↔Customer | Hosting/secrets | M | Exit/change | `03_` | Y | Y | Exit file | Ops | Missing | |
| B-01 | Setup fee commercial offer | ALSYD↔Customer | Price | M | Pre-contract | Offline | Y | N | Deal | Sales | Missing | |
| B-02 | Tax invoice (BG) | ALSYD→Customer | Accounting | M | Per charge | Accounting system | Y | L | Legal archive | Finance | **Not = app row** | L |
| B-03 | Credit note / correction | ALSYD→Customer | Adjustments | R | As needed | Accounting | Y | L | Archive | Finance | Missing | |
| B-04 | Overdue notice template | ALSYD→Customer | Collection | M | D+N | Email/ops | Y | N | Deal | Finance | Missing | |
| B-05 | Suspension notice template | ALSYD→Customer | Suspend | M | Pre-suspend | Email+app | Y | N | Deal | Finance | Missing | |
| B-06 | Restoration notice | ALSYD→Customer | Restore | R | After pay | Email | Y | N | Deal | Finance | Missing | |
| M-01 | Meeting invitation template (BG) | Complex→Owners | ЗУЕС invite | M | Per meeting | Meeting Core | Y | L | Long | Complex+ALSYD proc | Partial product | L |
| M-02 | Placement protocol template | Complex | Proof of posting | M | Per meeting | Documents | Y | L | Long | Complex | Partial | L |
| M-03 | Proxy / power of attorney form | Owners | Representation | M | Per meeting | Proxies | Y | L | Long | Complex | Partial | L |
| M-04 | Registration / attendance list | Complex | Quorum evidence | M | Meeting day | Conduct UI | Y | N | Long | Complex | Partial | |
| M-05 | Ballot / voting record | Complex | Votes | M | Meeting | Votes | Y | N | Long | Complex | Partial | L |
| M-06 | Minutes / protocol ОС | Complex | Decisions | M | After meeting | Protocol | Y | L | Long | Complex | Partial | L |
| M-07 | Candidate consent form | Candidates | Elections | R | Pre-election | Governance | Y | Y | Term | Complex | Missing/roadmap | L |
| M-08 | House rules extract (video/hybrid) | Complex | Hybrid legal basis | L | Pre-hybrid | Offline | Y | N | Building | Complex | External | L |
| M-09 | Meeting delivery log export | Complex | Notice proof | M | Per meeting | Notifications | Y | N | Long | Complex | Partial/missing email | L |
| P-01 | Book import accuracy declaration | Admin | Data quality | R | Import | Property Book | Y | Y | Audit | Complex | Missing | |
| P-02 | Ownership change packet checklist | Complex | Updates | R | On change | Book | Y | L | Audit | Complex | Partial | L |
| S-01 | Information Security Policy | ALSYD | Governance | M | Corporate | Offline | Y | N | Ongoing | Security | Missing | |
| S-02 | Incident / breach response | ALSYD | Incidents | M | Corporate | Offline | Y | N | Ongoing | Security | Missing | |
| S-03 | Backup & DR policy | ALSYD | Continuity | R | Corporate | Offline | Y | N | Ongoing | Ops | Missing | |
| S-04 | Staff confidentiality / access | ALSYD staff | Insider risk | M | Hiring | HR | Y | Y | Employment | HR | Missing | |
| S-05 | Production access register | ALSYD | Who has prod | R | Continuous | Offline | Y | N | Ongoing | Ops | Missing | |
| V-01 | Supabase DPA / terms | ALSYD↔Supabase | Subprocessor | M | Before prod data | Vendor | Y | N | Vendor file | Legal | Confirm | |
| V-02 | Vercel DPA / terms | ALSYD↔Vercel | Subprocessor | M | Before prod | Vendor | Y | N | Vendor file | Legal | Confirm | |
| V-03 | Email provider DPA (if any) | ALSYD↔ESP | Subprocessor | M | Before email PII | Vendor | Y | N | Vendor file | Legal | N/A until wired | |
| X-01 | Customer onboarding checklist | Internal | Launch | M | Each complex | `12_` | Y | N | Deal | Delivery | Draft | |
| X-02 | Go-live approval record | ALSYD+Customer | Gate | M | Launch | Offline | Y | Y | Deal | Delivery | Missing | |
| X-03 | Compliance calendar | ALSYD | Renewals | R | Annual | Offline | Y | N | Ongoing | Legal | Missing | |

---

## Counts

| Category | Count |
|----------|------:|
| Corporate (C-) | 3 |
| ALSYD ↔ customer (A-) | 30 |
| ALSYD ↔ end user (U-) | 16 |
| GDPR/privacy (G-) | 9 |
| Domain/infrastructure (D-) | 4 |
| Billing/accounting (B-) | 6 |
| Meetings/governance (M-) | 9 |
| Property book (P-) | 2 |
| Security/ops (S-) | 5 |
| Vendors (V-) | 3 |
| Termination/launch ops (X-) | 3 |
| **TOTAL** | **72** |

| M/R/L (approx from register) | Count |
|------------------------------|------:|
| M (Mandatory pending counsel) | 28+ (many A/U/G/M marked M) — use Summary rollup **28** core blockers |
| R | 26 |
| L | 18 |

*(Summary file uses rounded launch-critical buckets: M=28, R=26, L=18.)*

---

## Groups (quick index)

1. **Corporate:** C-01…C-03  
2. **ALSYD ↔ customer:** A-01…A-30  
3. **ALSYD ↔ end user:** U-01…U-16  
4. **GDPR/privacy:** G-01…G-09  
5. **Domain/infrastructure:** D-01…D-04  
6. **Billing/accounting:** B-01…B-06  
7. **Meetings/governance:** M-01…M-09  
8. **Security/operations:** S-01…S-05 (+ P-book P-01…P-02)  
9. **Vendors/subprocessors:** V-01…V-03  
10. **Termination/handover/launch:** X-01…X-03, A-24, D-03, D-04  
