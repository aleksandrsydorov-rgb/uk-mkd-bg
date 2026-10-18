# 06 — Subprocessors / Third Parties

**Rule used:** list only providers **confirmed or strongly evidenced** in repository/config. Mark expected-but-unwired providers separately.

---

## A. Confirmed / evidenced

| Service | Evidence | Data likely transferred | Role (candidate) | Region | DPA needed | SCC / transfer | Disclosure |
|---------|----------|-------------------------|------------------|--------|------------|----------------|------------|
| **Supabase** (Auth, Postgres, Storage) | `@supabase/*` deps; `NEXT_PUBLIC_SUPABASE_URL`, anon key | Account identifiers, DB contents, files | Subprocessor (of ALSYD as processor) **or** ALSYD’s processor | **CONFIRM** project region | YES | If outside EEA — **YES question** | Customer annex + privacy notice |
| **Vercel** (hosting/frontend) | `NEXT_PUBLIC_VERCEL_*` env usage in `platformControl.ts`; Next.js deploy practice | Request logs, possibly edge cookies; app binaries | Hosting subprocessor | **CONFIRM** | YES | Region question | Customer annex |

---

## B. Not confirmed in `package.json` / code (do not assume live)

| Service | Status in repo | Notes |
|---------|----------------|-------|
| Dedicated email API (Resend, SendGrid, etc.) | **MISSING** as dependency | Invites/reminders may be link-only; statuses `LOCAL_ONLY` / `PROVIDER_NOT_CONFIGURED` |
| SMS provider | **MISSING** | |
| Payment PSP (Stripe, etc.) | **MISSING** | Building fee ledgers are internal records |
| Product analytics (PostHog, GA) | **MISSING** | No gtag/analytics scripts found |
| Error tracking (Sentry) | **MISSING** | |
| Netcup | **NOT in this repo’s deps** | Mentioned in user brief as possible infra — **verify ops outside repo** |
| CDN beyond host defaults | **UNCLEAR** | Vercel/Supabase defaults |

---

## C. ALSYD Control (Master) — future

When Master syncs billing/support live, treat Master hosting + any ticket bus as additional subprocessors/systems and update annex **before** enabling live delivery (product currently `awaiting_master`).

---

## D. Customer disclosure checklist

- [ ] Written subprocessor list in DPA annex  
- [ ] Notice mechanism for changes (30 days typical)  
- [ ] End-user Privacy Notice names categories of recipients  
- [ ] Confirm Supabase & Vercel data residency in writing  

**Lawyer decision:** whether complex/УК must pre-approve each subprocessor or categories only.
