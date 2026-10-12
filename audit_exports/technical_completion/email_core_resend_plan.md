# AMADEUS 11 — Configurable Email Core + Resend

**Mode:** audit + implementation plan only  
**Date:** 2026-10-12  
**Constraints honored:** no migrations applied · no Auth SMTP changes · no real sends · no secrets in Git/report  

**STOP gate:** DNS records + Resend credentials require human ops (listed in §7).

---

## 1. Audit — what exists today

### 1.1 No ESP / no send path

| Area | Finding |
|------|---------|
| `package.json` | No Resend / SendGrid / Nodemailer |
| `src/lib/email.ts` | Only `normalizeEmail` + `escapeIlike` — **not** a mailer |
| Edge Functions | **None** (`supabase/functions` absent) |
| App API routes | Only ownership PDF attach — **no** mail webhook/queue worker |
| Subprocessors doc | Explicitly: dedicated email API **MISSING** |

### 1.2 Honest “not configured” surfaces (reuse these)

| Module | Mechanism | Current behavior |
|--------|-----------|------------------|
| Property Book invites | `property_access_invites.delivery_status` | `COPY_LINK` (comment allows future `SENT`) |
| User Activation | `user_activation_reminders.delivery_status` | `LOCAL_ONLY` / `PROVIDER_NOT_CONFIGURED` / `QUEUED` / `CREATED` / `FAILED` |
| PKG-XFER | `ownership_change_settings.email_provider_configured` default **false** | In-app notify; `email_skip_reason = email_provider_not_configured` |
| PKG-XFER notify | `ownership_change_notifications` | `email_attempted` / `email_delivered` / `email_skip_reason` |
| Meeting Core | `meeting_notifications` + `gm_dispatch_meeting_invitations` | Later migration **in-app only** (email channel removed from live dispatch) |

### 1.3 Settings / branding hardcoding

| Item | Status |
|------|--------|
| `building_settings` | Utility modes / legacy support rate — **no email fields** |
| Admin «настройки» | Water/electricity etc. — **no email section** |
| Footer contact | Hardcoded `info@amadeus11.bg` in `messages.ts` (marketing, not SMTP From) |
| ALSYD | `platformControl.ts` = `awaiting_master` local adapter; support redacts `service_role` keys |

### 1.4 Architectural implication

Email is **designed for honesty without a provider**. A global boolean `email_provider_configured` exists only on PKG-XFER settings — too narrow and not multi-complex ready. There is **no** per-installation sender, domain verification state, queue, webhook, or secret store for ESP.

**Do not** treat `amadeus11.online` / `alsyd.cloud` as mandatory From domains in code.

---

## 2. Target architecture

### 2.1 Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Admin UI «Настройки электронной почты» (staff only)         │
│  — public config: sender_name, sender_email (verified),      │
│    reply_to, status, delivery log (redacted), test send      │
└──────────────────────────┬──────────────────────────────────┘
                           │ RPCs (no secrets)
┌──────────────────────────▼──────────────────────────────────┐
│ Email Core (DB)                                              │
│  complex_email_settings (singleton per installation)         │
│  email_verified_senders                                      │
│  email_outbox (queue + idempotency)                          │
│  email_delivery_events (provider webhooks / status)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ service role / server only
┌──────────────────────────▼──────────────────────────────────┐
│ Email Provider Adapter (server)                              │
│  ResendAdapter implements EmailProvider                      │
│  Secrets: RESEND_API_KEY (+ webhook secret) from env/Vault   │
│  Never exposed to anon/authenticated clients                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Auth SMTP (manual)  App transactional  ALSYD Control
   Supabase Dashboard  invites/UA/XFER    install contract
```

### 2.2 Configuration model (per independent complex = one installation DB)

| Field | Storage | Client-visible | Notes |
|-------|---------|----------------|-------|
| `mail_provider` | DB | yes (read) | enum, v1 = `resend` only |
| `sender_name` | DB | yes (admin R/W) | display name |
| `sender_email` | DB | yes (admin R/W constrained) | must be in verified senders |
| `reply_to_email` | DB | yes (admin R/W) | may differ from From |
| `verified_domain` | DB | yes (read) | set by ops/ALSYD sync, not free-text by admin |
| `provider_domain_id` | DB | yes (read, opaque id) | Resend domain id |
| `email_enabled` | DB | yes (admin toggle) | master switch |
| `template_locale` | DB | yes (admin) | `bg` / `ru` / `en` default |
| `delivery_status` | derived | yes (read) | see §2.3 |
| `RESEND_API_KEY` | **env / Vault only** | **never** | install secret |
| `RESEND_WEBHOOK_SECRET` | env / Vault | **never** | signature verify |

Safe defaults: `email_enabled=false`, `mail_provider='resend'`, empty sender fields, `delivery_status='not_configured'`. **No outbound mail** until sender verified **and** `email_enabled` **and** server secret present.

### 2.3 Derived `delivery_status` (system health)

| Status | Meaning |
|--------|---------|
| `not_configured` | No secret and/or no verified sender |
| `domain_pending` | Domain registered, DNS incomplete |
| `ready` | Secret OK + verified sender + `email_enabled` |
| `paused` | Configured but `email_enabled=false` |
| `degraded` | Provider errors / rate limits recent |
| `disabled_by_platform` | Future ALSYD kill-switch |

Align module honesty enums:

- UA / invites: keep `PROVIDER_NOT_CONFIGURED` when core ≠ `ready`
- When queued: `QUEUED` → worker → `SENT` / `FAILED`
- XFER: derive `email_provider_configured` from Email Core `ready` (single source of truth; stop maintaining a separate manual flag)

### 2.4 Outbox / retries / idempotency

Table `email_outbox`:

- `idempotency_key` unique (e.g. `invite:{uuid}:v1`, `xfer:{transfer_id}:{event}:{email_hash}`)
- `template_key`, `locale`, `to_email_hash` + encrypted/raw to only server-side
- `payload_json` (no secrets; minimize PII in admin views)
- `status`: `queued` / `sending` / `sent` / `failed` / `cancelled`
- `attempts`, `next_attempt_at`, `last_error_code` (no raw provider bodies with PII in admin UI)
- `provider_message_id`

Worker (Next.js Route Handler cron **or** Edge Function with service role):

- Claim rows with `FOR UPDATE SKIP LOCKED`
- Cap burst (`MAX_SEND_PER_TICK`, deploy guard: skip if `email_enabled` false or status ≠ ready)
- Exponential backoff; dead-letter after N attempts

### 2.5 Webhooks

- `POST /api/email/resend-webhook` (server): verify Resend signature; update `email_delivery_events` + outbox
- Events: delivered / bounced / complained / delayed
- Admin history: show event type, template, time, masked recipient (`a***@domain`), error class — **not** full addresses for non-admin-owner contexts; staff admins may see full To for support (policy: staff-only RPC)

### 2.6 Templates + branding (per complex)

- Template keys: `auth_invite_bridge`, `ua_reminder`, `ownership_change_*`, `email_test`, later `meeting_invite_email`
- Store: DB `email_templates` overrides optional; fallback code defaults in `src/lib/email/templates/{bg,ru,en}`
- Branding vars from complex settings (name, optional logo URL) — **not** hardcoded Amadeus/ALSYD From

### 2.7 Security / RLS

- Settings SELECT: staff admin
- Settings UPDATE: staff admin via RPC; **cannot** set `verified_domain` / `provider_domain_id` / secrets
- Verified senders: INSERT only via service role / ALSYD bootstrap RPC
- Outbox: no direct client INSERT; enqueue via security definer RPCs
- Webhook route: signature only; no cookies
- Strip secrets from any Platform Support tech_context (already pattern in platform_support)

### 2.8 ALSYD Control contract (prepare, not implement Master)

Interface sketch (mirror `PlatformControlService` style):

```ts
type InstallationEmailContract = {
  getEmailHealth(): Promise<{ delivery_status; verified_domain; email_enabled }>;
  // Master-only / install-time:
  provisionDomain(input: { domain; provider: 'resend' }): Promise<{ provider_domain_id; dns_records }>;
  markDomainVerified(provider_domain_id: string): Promise<void>;
  injectProviderSecretRef(secret_ref: string): Promise<void>; // never raw key in API response
  listVerifiedSenders(): Promise<{ email; status }[]>;
};
```

Local adapter: read/write local tables; `awaiting_master` for provisionDomain until Master live.

---

## 3. Integration map (reuse existing call sites)

| Consumer | Today | After Email Core |
|----------|-------|------------------|
| PB1 `admin_create/resend_property_invite` | `COPY_LINK` | If ready → enqueue `invite` + status `QUEUED`/`SENT`; else keep `COPY_LINK` / `PROVIDER_NOT_CONFIGURED` |
| UA `admin_user_activation_remind` | `PROVIDER_NOT_CONFIGURED` | Same honesty; enqueue when ready |
| XFER `ownership_change_notify` | skip email | Enqueue when ready; set attempted/delivered from outbox/webhook |
| GM dispatch | in-app only | **Phase 2** optional email channel (legal notice separate) |
| Supabase Auth (magic link / recovery) | default Supabase SMTP | **Manual** custom SMTP → Resend (ops), not app code |

---

## 4. Planned code / DB changes (not created in this pass)

### 4.1 Migrations (future package — do not apply yet)

1. `complex_email_settings` singleton + RLS + `admin_get/update_email_settings` RPCs  
2. `email_verified_senders` (service-role seed)  
3. `email_outbox` + `email_delivery_events` + enqueue RPCs  
4. Bridge: `ownership_change_settings.email_provider_configured` → generated from Email Core health (trigger or replace reads)  
5. Extend invite/UA delivery_status comments/checks to include `SENT` / `QUEUED` consistently  
6. Grants: revoke client writes on all email tables  

### 4.2 Application (future)

- `src/lib/email/` → `types.ts`, `provider.ts`, `resendAdapter.ts`, `outbox.ts`, `templates/*`  
- Expand `src/lib/email.ts` carefully (keep `normalizeEmail` exports)  
- Admin panel under «настройки»: `AdminEmailSettings.tsx`  
- API: `app/api/email/worker/route.ts`, `app/api/email/resend-webhook/route.ts`  
- i18n RU/BG/EN for admin email section  
- Dep: `resend` **server-only**  

### 4.3 Explicitly out of first engineering slice

- Changing Supabase Auth SMTP in Dashboard (manual later)  
- Real DNS  
- Real Resend account keys in repo  
- Mass backfill emails / marketing campaigns  
- Hardcoding `amadeus11.*` or `alsyd.cloud` as From  

---

## 5. Phased implementation plan

### Phase A — Schema + RPCs + adapter (no live send)

1. Land migrations with defaults disabled.  
2. Implement Resend adapter behind `email_enabled` + secret check (dry-run mode: log “would send”).  
3. Admin UI read-only health + editable sender_name / reply_to / locale / enable toggle (enable rejected unless verified sender exists).  
4. Wire XFER/UA/invite to **enqueue** only when `ready`; else unchanged honesty statuses.  
5. Unit tests for status derivation, idempotency keys, template locale pick.  

### Phase B — Worker + webhook (isolated env only)

1. Worker processes outbox against **isolated** Resend test domain.  
2. Webhook signature verification + event persistence.  
3. Test-send RPC: only to allowlisted staff email / verified domain.  
4. Rate limits + deploy guard (`EMAIL_SENDING_ENABLED=0` default in CI).  

### Phase C — Auth SMTP + production domain (ops)

1. Human: DNS + Resend verify (see §7).  
2. Human: Supabase Auth → Custom SMTP (Resend SMTP creds) — **not** in app migrations.  
3. Flip `email_enabled` for AMADEUS 11 pilot.  
4. Update `docs/legal/06_SUBPROCESSORS.md` when Resend is live.  

### Phase D — ALSYD Control

1. Implement contract methods on local adapter.  
2. Master provisions domain + injects secret ref per installation.  
3. White-label: templates/branding per complex without code forks.  

---

## 6. Admin UI behavior (spec)

**Section:** Настройки → «Электронная почта» / Email / Имейл  

**Admin can:**

- Edit `sender_name`  
- Pick `sender_email` from **verified senders dropdown only**  
- Edit `reply_to_email` (validate format; prefer same verified domain)  
- View `delivery_status` + last error class  
- View delivery history (masked PII columns by default)  
- Send **one** test message to own staff email / allowlist  

**Admin cannot:**

- Paste arbitrary From domain  
- Create verified domain  
- View or edit API key / webhook secret  
- Bulk-send or import recipient lists  

---

## 7. MANUAL actions (human / ops) — STOP here for credentials

Do **not** ask the agent to perform these until you provide a disposable/pilot Resend project and confirm DNS ownership.

### 7.1 Resend account (per complex or shared ALSYD tenancy — product decision)

- [ ] Create Resend account / team for this installation  
- [ ] Create API key → store only in host secrets (`RESEND_API_KEY`), never Git  
- [ ] Create webhook signing secret → `RESEND_WEBHOOK_SECRET`  
- [ ] Register domain (e.g. complex’s own mail domain — **not** forced to amadeus11/alsyd)  

### 7.2 DNS (at domain DNS host)

Typical Resend records (exact values from Resend UI — do not invent):

- [ ] SPF TXT  
- [ ] DKIM CNAMEs / TXT  
- [ ] DMARC TXT (org policy)  
- [ ] Optional: MX / return-path if Resend requires  

### 7.3 Supabase Auth custom SMTP (Dashboard — not SQL)

- [ ] Authentication → SMTP settings → Resend SMTP host/port/user  
- [ ] From name/email = verified sender for **this** complex  
- [ ] Send Auth test from Dashboard  

### 7.4 Hosting env (Vercel / server)

- [ ] `RESEND_API_KEY`  
- [ ] `RESEND_WEBHOOK_SECRET`  
- [ ] `EMAIL_SENDING_ENABLED=1` only after verify  
- [ ] Worker cron secret for `/api/email/worker`  
- [ ] Confirm webhook URL publicly reachable  

### 7.5 Product / legal

- [ ] Add Resend to customer subprocessor annex when enabled  
- [ ] Decide whether Auth From and transactional From must match  
- [ ] Allowlist for test-send recipients  

### 7.6 ALSYD (later)

- [ ] Decide: one Resend account per complex vs ALSYD-managed domains  
- [ ] Secret injection channel for new installs  

---

## 8. Deploy / mass-send protection

- Default `email_enabled=false` in migration seed  
- CI/preview: `EMAIL_SENDING_ENABLED` unset/0 → worker no-op  
- Idempotency prevents duplicate invite storms  
- Max recipients per tick + per-template daily cap  
- No send on migration apply / seed scripts  

---

## 9. Exit criteria for “Email Core ready” (engineering)

| Gate | Criteria |
|------|----------|
| Config | Admin can set name/reply/locale; cannot set secrets/domains |
| Honesty | Without verify → all modules still `PROVIDER_NOT_CONFIGURED` / `COPY_LINK` |
| Isolation | Logs/outbox scoped to installation DB |
| Security | No API key in client bundle / RLS / Platform Support context |
| Multi-complex | No hardcoded Amadeus/ALSYD From required in source |
| Live send | **Blocked** until §7 complete |

---

## 10. This session — done / not done

| Done | Not done (by design) |
|------|----------------------|
| Audit of current email surfaces | Migrations |
| Architecture + phased plan | Resend dependency install |
| Manual ops checklist | Auth SMTP change |
| ALSYD contract sketch | Real email sends |
| | DNS / credential handling |

**Next agent/dev step after human confirms domain ownership + Resend project:** implement Phase A migrations + UI against defaults (still no live send until secrets + DNS).
