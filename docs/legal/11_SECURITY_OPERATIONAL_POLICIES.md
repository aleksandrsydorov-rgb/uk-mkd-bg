# 11 — Security / Operational Documents

**Repo:** technical controls exist (RLS, SECURITY DEFINER RPCs, private storage helpers). **Named corporate policies below are not present as approved policy PDFs in-repo.**

| Policy / procedure | Purpose | Status |
|--------------------|---------|--------|
| Information Security Policy | Control objectives | **MISSING** (corporate draft needed) |
| Access Control Policy | Roles, least privilege | **PARTIAL** (implemented in product roles; policy doc missing) |
| Incident Response Plan | Detect/respond | **MISSING** |
| Breach Response Procedure | GDPR 72h | **MISSING** |
| Backup Policy | RPO/RTO | **MISSING** (rely on Supabase defaults — confirm) |
| Disaster Recovery Plan | | **MISSING** |
| Business Continuity Plan | | **MISSING** |
| Credential Management Policy | Secrets, MFA | **MISSING** |
| Employee/contractor confidentiality | ALSYD staff | **MISSING** in repo |
| Admin access procedure | Complex admins | **PARTIAL** (role gating) |
| Offboarding procedure | Staff leave | **MISSING** |
| Production access register | Who has prod | **MISSING** |
| Change management | Releases | **PARTIAL** (engineering practice) |
| Vulnerability management | Deps/patches | **RECOMMENDED** |

Support / chat / work-order notes:

- Platform Support ≠ resident chat.  
- Attachments via private storage patterns — retention **undefined**.  
- Evidentiary status of chat: **LAWYER**.  
- Export requirements: **MISSING** formal.

Cookie / website:

| Item | Status |
|------|--------|
| Essential Auth cookies | IMPLEMENTED (Supabase SSR cookies) |
| Analytics cookies | **NOT FOUND** |
| Consent banner | **MISSING** |
| Privacy link (working) | **MISSING** |
| Company legal disclosure page | **MISSING** on complex site |

IP topics: see register group M — ALSYD software ownership vs customer data — contract clauses **MISSING** in product.
