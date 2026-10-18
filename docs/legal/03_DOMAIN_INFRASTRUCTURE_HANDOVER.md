# 03 — Domain & Infrastructure Handover

**Repo status:** Operational/legal protocols **MISSING** in product.  
Env evidence: `NEXT_PUBLIC_COMPLEX_DISPLAY_NAME`, Vercel deployment IDs, Supabase URL/anon key.

---

## A. Domain models to cover

| Model | Description | Risk focus |
|-------|-------------|------------|
| Domain owned by ALSYD | ALSYD registrant; customer uses it | Brand/exit dependency |
| Domain owned by customer | Customer registrant; ALSYD operates DNS/app | Instruction liability |
| New domain registered for customer | Who pays/renews | Expiry orphan |
| Subdomain under ALSYD | e.g. `complex.alsyd…` | Cross-complex isolation perception |
| Transfer into ALSYD control | Auth-code, unlock, 60-day locks | Lost access |
| Transfer out of ALSYD control | Exit package | Continuity |

---

## B. Responsibility matrix (draft)

| Item | ALSYD | Customer | Shared / Lawyer |
|------|:-----:|:--------:|-----------------|
| Registrant / legal owner | □ | □ | **Decision** |
| Registrar account access | □ | □ | |
| DNS zone edit rights | □ | □ | |
| Authorization to modify DNS | Written form | Issues instructions | |
| SSL certificates | Usually ALSYD/host | | |
| Renewal payment | □ | □ | |
| Expiry monitoring | □ | □ | Both recommended |
| Admin contact (WHOIS) | □ | □ | Privacy/GDPR |
| Tech contact | □ | □ | |
| Termination handover | Protocol | Accepts | |
| Liability for wrong customer DNS instructions | Cap / exclusion | Warranty of accuracy | **Lawyer** |

---

## C. Document candidates

### 1. Domain Management Authorization
- Parties, FQDN list, registrar, grant of authority to ALSYD (scope: DNS, SSL, redirects).  
- Duration, revocation, prohibited actions (sale, transfer without consent).  
- **When:** before go-live DNS cutover.  
- **E-sign:** recommended.

### 2. Domain Transfer Protocol
- Auth code handling, unlock window, confirmation screenshots, rollback plan.  
- **When:** inbound or outbound transfer.

### 3. Domain Handover Protocol (exit)
- Credentials checklist, DNS export, TTL notes, SSL CSR/private key policy, WHOIS update.  
- Sign-off that ALSYD no longer controls domain.

### 4. Infrastructure Handover Protocol
- Supabase project ownership, Vercel project, env secrets rotation, backup export, storage buckets.  
- Align with exit annex in Master Agreement.

---

## D. Checklist (ops + legal)

- [ ] Legal owner of each production domain documented  
- [ ] Registrar MFA + break-glass contacts  
- [ ] DNS change ticket process (written instruction from customer)  
- [ ] SSL auto-renew path verified  
- [ ] Renewal calendar + payment method  
- [ ] Subdomain strategy approved by counsel/marketing  
- [ ] Exit transfer SLA in contract (days)  
- [ ] Evidence pack folder (tickets, screenshots) retained  

**Status:** Domain handover mapped as **process design** — **implementation in product: MISSING**.
