# 01 — Company / Platform Legal Classification Memo

**Audience:** Bulgarian counsel  
**Product:** ALSYD Control (Master) + per-complex installations (e.g. AMADEUS 11 / `uk-mkd-bg`)  
**Operator:** ALSYD EOOD (Bulgaria)  

> Draft for review. Not a legal opinion. Status labels: **MAY APPLY** / **MAY NOT APPLY** / **LAWYER DECISION REQUIRED**.

---

## Product facts (repository-backed)

1. **Isolated complex installation:** one deployment / database / domain class per complex (architecture docs; env `NEXT_PUBLIC_COMPLEX_DISPLAY_NAME`).
2. **ALSYD software:** Nest of modules (finance, utilities, requests, chat, documents, polls, general meeting, platform support, user activation).
3. **Customer use:** complex admin / УК / condominium staff manage owners, invites, fees, meters, meetings, documents.
4. **End users:** owners (Property Book + invites), guests (`guest_mode`), staff roles (admin, engineers, etc.).
5. **Platform Support:** channel between **complex administrator** and **ALSYD** (`platform_support`, pre-Master `awaiting_master`).
6. **Commercial:** setup + monthly platform fees contemplated; platform billing tables/UI exist as **local commercial documents**, Master sync later.
7. **ALSYD does not (in this repo) operate** a multi-seller marketplace, public listing of unrelated third-party goods, or payment acquisition for residents↔ALSYD in production code.
8. **Hosting stack observed:** Next.js app + Supabase (Auth/DB/storage) + Vercel env identifiers.

---

## Classification table

| Classification | May apply — why | May not apply — why | Product functionality creating the issue | Factual question for lawyer | Possible consequence |
|----------------|-----------------|---------------------|------------------------------------------|-----------------------------|----------------------|
| **SaaS provider** | Recurring software access per complex; remote hosted app | If contract framed as “managed condominium service” not software | Isolated deployment, modules, admin portal | Is the primary supply software access? | Standard B2B SaaS contract, SLA, IP licence |
| **Software service provider** | Development + operation of building OS software | If ALSYD also performs physical УК duties | Same | Distinct from property manager role? | Consumer vs B2B regime |
| **Information society service** | Online service at distance for remuneration (EU ISD) | Edge cases if only offline + incidental IT | Web/app access | Does ISD apply to B2B complex SaaS? | ISD / e-commerce disclosures |
| **Intermediary service** | Hosts third-party (resident/admin) content (chat, docs, polls) | Not a general public hosting marketplace | Chat, requests, documents, UGC | DSA “intermediary” / hosting safe harbour fit? | DSA duties if “online platform” |
| **Hosting service** | Stores customer/user content on Supabase | ALSYD may be customer of hosting (Supabase/Vercel) | Storage buckets, messages | Who is “hosting provider” vs customer? | Notice-and-action, liability limits |
| **Online platform** | Brings together users (owners, admins, guests) | Typically means dissemination to public; closed complex | Account cabinet, chat | Is closed condominium app a DSA “platform”? | Transparency, complaint handling |
| **Online intermediation service** (P2B) | If ALSYD intermediates business users to consumers | Complexes are not classic “business users” listing on marketplace | N/A unless marketplace modules | Any P2B Reg. 2019/1150 exposure? | Ranking, T&Cs notice |
| **“Aggregator” / marketplace intermediary** | Commercial wording may describe multi-module hub | No multi-vendor marketplace for goods/services between unrelated sellers in repo | Module Core catalogue | See dedicated section below | Mislabelling risk |
| **Data processor** | Processes owner/resident data for complex customer under instructions | If ALSYD determines purposes for book/meetings alone | Book, invites, meetings, chat on behalf of customer | Per-flow controller/processor? | DPA Art. 28, instructions |
| **Data controller** | Own CRM, platform invoices, ALSYD support tickets, marketing | If all data solely under customer instructions | `platform_support`, billing, ALSYD staff access | Which datasets ALSYD controls? | Privacy notice, lawful basis |
| **Joint controller** | Shared purposes with УК for communications | Prefer clear processor model | Support + resident ops overlap | Any joint determination of purposes? | Art. 26 arrangement |
| **Subprocessor** | ALSYD engages Supabase/Vercel | ALSYD is processor engaging sub-processors | Auth, DB, hosting | Customer authorization to engage? | Annex of subprocessors |
| **Payment intermediary** | If ALSYD collected resident payments | Repo records **internal** fee ledgers; no Stripe/PSP in `package.json` | Support fee / utilities ledgers | Will ALSYD take resident money? | PSD2 / payment licence |
| **Property-management service provider** | If ALSYD acts as УК for the building | Product is software; УК is customer role | Admin “УК” features used by customer staff | Does ALSYD perform ЗУЕС manager duties? | Licensed/regulated УК obligations |
| **Condominium-management service provider** | Same as above under Bulgarian condominium law | ALSYD provides tools; customer manages | Meetings, book, fees | Contractual role vs fact pattern | ЗУЕС manager liability |

**Overall status:** **LAWYER DECISION REQUIRED** for each row before marketing or contract wording is finalized.

---

## IS ALSYD AN AGGREGATOR?

### Status: **NOT CONCLUDED** — commercial hypothesis only

### Facts that *might* support “aggregator” as loose commercial language

- One product surfaces many building processes (finance, utilities, requests, documents, meetings, support).
- Future optional modules/integrations contemplated.
- ALSYD sits between complex administration and end users *technically* (software layer).

### Facts *against* treating ALSYD as a regulated “aggregator / marketplace”

- No repository evidence of a multi-sided marketplace matching buyers to independent third-party sellers of goods/services.
- Resident billing in-app is **complex accounting**, not ALSYD selling apartments/services as marketplace host.
- Platform fees are ALSYD↔customer (complex/УК), independent of enabled modules (product brief).
- Platform Support is B2B support channel, not consumer marketplace dispute resolution.
- “Aggregator” in EU/Bulgarian law is **not** a single clear statutory label for condominium SaaS (counsel to confirm). Often used commercially for comparison sites, booking aggregators, etc.

### Commercial terminology vs legal category

| Use | Risk |
|-----|------|
| Internal/product shorthand “we aggregate building processes” | Low if not in contracts |
| Public marketing “ALSYD is an aggregator” | **Medium–high** if implies regulated intermediary / marketplace |
| Contract clause “aggregator” without definition | Ambiguity; prefer defined roles (Provider / Processor / Licensor) |

### Better legal description candidates (for counsel to pick)

1. **B2B SaaS / Software-as-a-Service provider** for residential complexes.  
2. **Information society service provider** (if ISD applies).  
3. **Processor** of personal data for the complex/УК (+ **controller** for own accounts/billing).  
4. Optionally: **hosting provider** for user content *if* DSA analysis so requires.  

### Lawyer decision required

1. May ALSYD market itself as “aggregator” under Bulgarian/EU law?  
2. If not, what approved short description for website and contracts?  
3. Does any module turn ALSYD into an online platform / intermediation service?

---

## Provisional contracting posture (pending counsel)

Until counsel confirms otherwise, **draft contracts should describe ALSYD as:**

> Provider of software and related technical services for management of a residential complex installation, without transferring to ALSYD the statutory duties of the condominium manager unless expressly agreed in writing.

**Confidence:** Low–medium  
**Lawyer validation required:** YES
