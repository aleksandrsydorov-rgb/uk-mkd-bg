# 04 — End-User First Login / Acceptance Matrix

## Current flow (repository fact)

| Step | What exists | Evidence |
|------|-------------|----------|
| Admin creates invite | IMPLEMENTED | `property_access_invites`, admin Property Book |
| User opens `/auth/invite?token=` | IMPLEMENTED | `src/app/auth/invite/page.tsx` |
| Sets password + OTP | IMPLEMENTED | Same |
| Marks invite accepted | IMPLEMENTED | RPC `accept_property_invite` |
| Terms / Privacy checkboxes | **MISSING** | No UI |
| Policy version stored | **MISSING** | No table/RPC found |
| Cookie consent | **MISSING** | Auth session cookies only |
| Account login later | IMPLEMENTED | `/account` — no re-acceptance |
| Guest access | PARTIAL | `guest_mode` module / docs |
| User Activation heartbeat | IMPLEMENTED | Activity touch — not consent |

Home footer shows privacy/rules **labels** as non-clickable text — **MISSING** linked policies (`src/app/page.tsx`).

---

## Proposed appearance points

| Moment | What should appear (pending counsel) |
|--------|--------------------------------------|
| Invitation email / link landing | Link to Privacy + Terms (read-only) |
| Registration / first set-password | Acceptance matrix below |
| First successful login | Confirm if not completed at invite |
| Later policy update | Re-acceptance or notify+continued use (lawyer) |

---

## Checkbox / acceptance matrix

> Do **not** invent unnecessary consent. Prefer contract / legitimate interest / legal obligation where counsel so advises.

| ID | Item | Mandatory? | Lawful basis candidate | Consent actually required? | Bundleable? | Timestamp | Policy version | IP / UA | Withdrawal | Re-accept | Audit log | Repo today |
|----|------|------------|------------------------|----------------------------|-------------|-----------|----------------|---------|------------|-----------|-----------|------------|
| A1 | Terms of Use acceptance | Likely yes | Contract / ToU | Acceptance ≠ GDPR consent | With A2 often | Yes | Yes | Optional (counsel) | N/A (stop using) | On material change | Yes | **MISSING** |
| A2 | Privacy Notice acknowledgement | Likely yes | Transparency Art. 13/14 | Acknowledgement ≠ consent | With A1 | Yes | Yes | Optional | N/A | On material change | Yes | **MISSING** |
| A3 | Cookie consent (non-essential) | If non-essential cookies | Consent ePrivacy | Only if non-essential | Separate | Yes | Cookie Policy ver | Optional | Cookie settings | On change | Yes | **MISSING** (essential Auth cookies: **LAWYER** if banner needed) |
| A4 | Electronic communication (service) | **LAWYER** | Contract / L.I. / consent | Often not if service msgs | Separate from marketing | Yes | Yes | Optional | Preference centre | — | Yes | **MISSING** |
| A5 | Email notification preferences | Recommended UI | Preference | Not always legal consent | Soft prefs | Soft | — | No | Yes | — | Optional | **MISSING** |
| A6 | Push notification preferences | If push used | Consent typically | Often yes for push | Separate | Yes | — | Optional | OS + in-app | — | Yes | **NOT APPLICABLE** until push exists |
| A7 | Marketing consent | Optional | Consent | **Yes** if marketing | **Never** bundle with A1/A2 | Yes | Yes | Optional | Easy opt-out | — | Yes | **MISSING** |
| A8 | Personal data processing consent | Only if basis = consent | Consent | Avoid if other basis fits | Never as “force” | Yes | Yes | Optional | Art. 7(3) | — | Yes | **LAWYER** — likely **not** primary basis for account |
| A9 | Building / house rules acknowledgement | **LAWYER** / complex policy | Contract with complex | Often acknowledgement | Separate | Yes | Rules ver | Optional | — | On rules change | Yes | **MISSING** |
| A10 | Administrator / УК identity notice | Recommended transparency | Transparency | Info notice | With A2 | Yes | — | No | — | On change | Yes | **MISSING** |
| A11 | Meeting / e-voting terms | If user votes online | **LAWYER** / ЗУЕС | May be rules acceptance | Separate module gate | Yes | Meeting ruleset ver | Optional | — | Per ruleset | Yes | **PARTIAL** (product rules; no end-user legal accept UI) |
| A12 | Electronic delivery acknowledgement | **LAWYER** (ЗУЕС notices) | Contract / consent / law | Critical open question | Separate | Yes | Yes | Optional | — | — | Yes | **MISSING** |
| A13 | Guest account terms | If guest_mode on | Contract | Acceptance | Guest-specific | Yes | Yes | Optional | End access | — | Yes | **MISSING** |
| A14 | Tenant account terms | If tenants onboarded | Contract | Acceptance | Tenant-specific | Yes | Yes | Optional | — | — | Yes | **MISSING** / tenant model **PARTIAL** |
| A15 | Proxy / representative declaration | Meeting proxies | **LAWYER** / ЗУЕС | Declaration of authority | Meeting flow | Yes | Form ver | Optional | Revoke proxy | Per meeting | Yes | **PARTIAL** (proxy RPCs; legal form **LAWYER**) |
| A16 | Accuracy declaration (user data) | Recommended | Contract | Soft warranty | With A1 | Yes | — | No | Rectify | — | Optional | **MISSING** |

---

## Implementation guidance (not implemented)

1. Store `subject_id`, `document_key`, `version`, `accepted_at`, `locale`, optional `ip_hash`, `user_agent`.  
2. Block cabinet until A1+A2 (if counsel requires).  
3. Marketing A7 default **off**.  
4. Do not treat invite “accepted” (property access) as ToU acceptance.

**First-login requirements mapped:** YES (design)  
**Product implementation:** MISSING
