# 05 — GDPR / Privacy Inventory

> Draft map from product architecture. **Controller/processor and lawful bases require Bulgarian counsel.**  
> Repo: **no** published Privacy Notice, **no** DSAR UI, **no** RoPA artifact in `docs/legal` prior to this pack.

---

## A. Document set assessment

| Document | Status |
|----------|--------|
| Privacy Notice — end users | **MISSING** (footer label only) |
| Privacy Notice — customer contacts/admins | **MISSING** |
| Privacy Notice — ALSYD support users | **MISSING** |
| Privacy Notice — website visitors | **MISSING** |
| Employee/contractor privacy (ALSYD) | **NOT IN REPO** — corporate |
| DPA with customer | **MISSING** (contract pack) |
| Record of Processing Activities | **MISSING** — draft table below |
| Controller/processor mapping | **LAWYER DECISION** |
| Lawful-basis matrix | Draft candidates below |
| Subprocessors list | See `06_` |
| International transfers | Supabase/Vercel regions **CONFIRM** |
| Retention / deletion rules | **MISSING** product rules |
| DSAR process | **MISSING** |
| Breach / incident process | **MISSING** product; see `11_` |
| DPIA need | **LAWYER DECISION** (meetings + large book) |
| LIA (legitimate interest) | **LAWYER** if used |

---

## B. Process map (core)

| PROCESS | DATA | DATA SUBJECT | PURPOSE | CONTROLLER (candidate) | PROCESSOR (candidate) | LEGAL BASIS (candidate) | RETENTION (open) | RECIPIENTS | SYSTEM MODULE | LAWYER REVIEW |
|---------|------|--------------|---------|------------------------|----------------------|-------------------------|------------------|------------|---------------|---------------|
| Account auth | email, password hash (Auth), session | Owner, guest, staff | Access control | Complex/УК **or** joint — **open**; Auth infra via Supabase | ALSYD (+ Supabase subprocessor) | Contract / L.I. | Account life + logs | Supabase | Auth | YES |
| Property invite | email, property_id, token hash | Invitee | Onboarding | Complex/УК | ALSYD | Contract / L.I. | Invite TTL 24h + audit | Email provider if any | Invites | YES |
| Property Book | names, emails, phones, shares, entities | Owners, contacts | Condominium registry ops | Complex/УК | ALSYD | Legal obligation? / L.I. / contract — **open** | While ownership + archive rules | Staff admins | Property Book | YES |
| Guest access | guest email, property link | Guest | Temporary access | Complex/УК | ALSYD | Contract / consent? | Guest period | Staff | `guest_mode` | YES |
| Support fee / utilities ledgers | apt, amounts, payments | Owners | Building finance | Complex/УК | ALSYD | Contract / legal duty of manager? | Tax/accounting periods | Staff, accountants | Finance modules | YES |
| Requests / work orders | descriptions, photos, assignees | Residents, staff | Maintenance | Complex/УК | ALSYD | Contract / L.I. | Case life + N years | Engineers | Requests / WO | YES |
| Chat | messages, media | Residents, staff | Communication | Complex/УК | ALSYD | Contract / L.I. | Policy TBD | Participants, admins | Chat | YES |
| Polls | votes, options | Owners | Non-ЗУЕС surveys | Complex/УК | ALSYD | L.I. / consent | Policy TBD | Admins | Polls | YES |
| General meetings | snapshots, proxies, votes, protocols | Owners, proxies | ЗУЕС governance | Complex/УК | ALSYD | Legal obligation / public interest? — **open** | Long (legal evidence) | Admins; municipality? | Meeting Core | YES |
| Building documents | PDFs, metadata | Varied | Document archive | Complex/УК | ALSYD | Contract / legal | Policy TBD | Entitled roles | Documents | YES |
| Platform Support | tickets, notes | Complex admin, ALSYD ops | B2B support | **ALSYD** (likely) for its tickets | — / tools | Contract | Support life | ALSYD staff | `platform_support` | YES |
| Platform billing | invoice rows, amounts | Customer contacts | ALSYD fees | **ALSYD** | — | Contract | Accounting law | ALSYD finance | Platform billing | YES |
| User Activation | emails, activity timestamps | Owners | Adoption metrics for admin | Complex/УК **or** ALSYD — **open** | ALSYD | L.I. / contract | Policy TBD | Complex admin | `user_activation` | YES |
| Website visit | IP, UA (server logs) | Visitors | Security / ops | ALSYD and/or complex site operator | Hosting | L.I. / legal | Short logs | Host | Landing | YES |

---

## C. Rights & processes (product status)

| Right / process | Status |
|-----------------|--------|
| Access / DSAR | **MISSING** |
| Rectification | PARTIAL (admin can edit book; no subject self-service formal DSAR) |
| Erasure | **MISSING** formal; Auth delete not productized |
| Restriction / objection | **MISSING** |
| Portability | **MISSING** |
| Breach notification runbook | **MISSING** in repo |
| DPIA | **LAWYER** — meetings + systematic monitoring of activation |

---

## D. Notes on Auth metadata

Admin User Activation RPCs read **safe** `auth.users` columns (email, created_at, email_confirmed_at) via SECURITY DEFINER — not passwords/tokens. Still personal data → must appear in notices and RoPA.
