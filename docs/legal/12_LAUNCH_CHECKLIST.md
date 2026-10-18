# 12 — First-Launch Legal / Compliance Checklist

Chronological — **zero → production**. Items marked **(L)** need counsel; **(P)** need product/ops work.

1. **Customer qualification** — entity type (УК / condominium / other); KYC-lite of signer **(L)**  
2. **Verify signer authority** — extract / protocol **(L)**  
3. **Contract** — Master SaaS + Order Form signed  
4. **DPA** + subprocessor annex signed  
5. **Service recipient data** — billing entity, VAT ID, contacts  
6. **Domain ownership / authorization** — Domain Management Authorization  
7. **Infrastructure provisioning** — Supabase project, Vercel, env, backups named  
8. **Administrator provisioning** — named `администрация` accounts; MFA **(P)**  
9. **Privacy configuration** — notices URLs live on domain **(P)**  
10. **Policy versions loaded** — ToU / Privacy / Cookie version IDs **(P)**  
11. **End-user invitation** — Book emails accurate; invite process  
12. **First-login acceptance** — A1/A2 enforced **(P)** — currently **MISSING**  
13. **Processing records** — RoPA filled for this complex **(L/ops)**  
14. **Subprocessor disclosures** — customer + end-user notices  
15. **Billing setup** — accounting invoices path (not only app rows) **(L/accountant)**  
16. **Support channel activation** — Platform Support; Master mode honesty  
17. **Security checks** — RLS smoke, admin access review, secrets  
18. **Launch approval** — written go-live (ALSYD + customer)  
19. **Handover protocol** — credentials, runbooks  
20. **Ongoing compliance calendar** — renewals, DPA reviews, policy updates, meeting retention  

**Do not treat Meeting Core as legally production-ready until `needs_legal_signoff` items cleared.**
