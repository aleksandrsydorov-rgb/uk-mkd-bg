# 14 — Implementation Gaps (Product vs Legal Needs)

**Scope:** Gaps observed in `uk-mkd-bg` relative to the legal inventory.  
**No code changes in this audit.**

| # | Gap | Area | Severity for commercial launch |
|---|-----|------|--------------------------------|
| 1 | No Privacy Notice page / broken footer (text only) | GDPR / transparency | High |
| 2 | No Terms of Use page | End-user contract | High |
| 3 | No acceptance checkboxes / version store at invite or login | First login | High |
| 4 | No Cookie Policy / banner analysis documented in product | ePrivacy | Medium–High |
| 5 | No DSAR / erasure / export self-service | GDPR rights | High |
| 6 | No customer-facing DPA / subprocessors UI or PDF attach | Contracts | High (ops may be offline) |
| 7 | Platform invoices ≠ validated tax invoices | Billing | High if relied on as invoices |
| 8 | Email/SMS provider often absent; LOCAL_ONLY delivery | Notices / ЗУЕС | High for meetings |
| 9 | Meeting Core `needs_legal_signoff` open | Meetings | High |
| 10 | No domain handover protocols in ops pack | Domain | Medium |
| 11 | No breach / IR runbooks in repo | Security | High |
| 12 | No retention jobs / documented schedules | GDPR | High |
| 13 | Guest/tenant/proxy legal acceptances missing | Roles | Medium |
| 14 | Marketing consent absent (OK if no marketing) | GDPR | Low if unused |
| 15 | End-user contracting party unclear in UX (ALSYD vs УК) | Terms | High |
| 16 | Master Control live delivery not on | Support/billing | Medium |
| 17 | Ownership change formal workflow stub | Property Book | Medium |
| 18 | Chat/support export for litigation | Evidence | Medium |
| 19 | No company legal disclosure (ЕИК, seat) on complex site | Commercial disclosure | Medium |
| 20 | Policy update / re-acceptance flow | Compliance ops | Medium |

**Implementation gaps identified:** **20** (primary list; more sub-gaps in memos).

---

## Suggested engineering backlog (for later — not started)

1. Policy CMS or static pages BG/EN/RU + version IDs  
2. `user_policy_acceptances` table + gate on invite/login  
3. Cookie banner if counsel requires  
4. Admin “compliance pack” download (ToU, Privacy, DPA PDF)  
5. Retention workers  
6. DSAR ticket flow to admin/ALSYD  
7. Honest meeting delivery log with channel evidence  

**Do not implement until counsel prioritizes.**
