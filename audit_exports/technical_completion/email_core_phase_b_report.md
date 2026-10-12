# AMADEUS 11 — Email Core Phase B Report

**Date:** 2026-10-13  
**Project:** uk-mkd-bg · Supabase `klowacuvufknbrkayjhz` · Vercel `uk-mkd-bg-8soe`  
**Constraints honored:** `EMAIL_SENDING_ENABLED=false` · no Auth SMTP · no real sends · Phase B migration **not applied** · no commit/push/deploy  

---

## Verdict

Phase B **implemented in repo** (adapter, worker, webhook, tests).  
Live send remains **blocked** by host gate + current DB `email_enabled=false`.

**Ready for controlled test email: NO**  
(needs: Phase B migration apply · ops seed verified sender/domain · `EMAIL_WORKER_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` + `RESEND_WEBHOOK_SECRET` · then temporary `EMAIL_SENDING_ENABLED=true` for a single allowlisted test)

---

## Files changed

| Path | Role |
|------|------|
| `supabase/migrations/20261013130000_email_core_phase_b.sql` | Claim/complete/event RPCs; readiness; enable rules |
| `src/lib/email/resendAdapter.ts` | Server Resend HTTP adapter + idempotency header |
| `src/lib/email/outboxWorker.ts` | Bounded worker, auth, gates, backoff helper |
| `src/lib/email/webhookSignature.ts` | Svix/raw-body verify, redact, event normalize |
| `src/lib/email/templates.ts` | BG/RU/EN transactional HTML |
| `src/lib/supabase/admin.ts` | Service-role client (server only) |
| `src/app/api/email/worker/route.ts` | `POST /api/email/worker` |
| `src/app/api/email/resend-webhook/route.ts` | `POST /api/email/resend-webhook` |
| `src/lib/emailCore.ts` | Phase B health/enqueue honesty |
| `src/lib/database.types.ts` | Worker/webhook RPC typings |
| `src/components/admin/AdminEmailSettings.tsx` | Status flags display |
| `.env.example` | Worker/webhook/service-role placeholders |
| `package.json` | `test:email-core:phase-b` |
| `tests/email-core/unit/phaseB.workerWebhook.test.ts` | Mocked Resend / webhook / worker tests |
| `tests/email-core/unit/emailCore.test.ts` | Updated Phase B parse expectations |
| `audit_exports/technical_completion/email_core_phase_b_report.md` | This report |

---

## Migrations prepared (not applied)

**`20261013130000_email_core_phase_b.sql`**
- `email_core_is_ready()` → DB config complete (enabled + verified domain/sender)
- `admin_update_email_settings` may enable only when verified (host gate still required to send)
- `email_core_enqueue` → `queued` when ready else `blocked_not_ready`
- Service-role only:
  - `email_core_worker_get_context`
  - `email_core_claim_outbox_batch` (SKIP LOCKED, max 25, app uses 10)
  - `email_core_complete_outbox_send` (retry backoff / fail after 8)
  - `email_core_record_delivery_event`

Does **not** set `email_enabled=true` and does **not** insert secrets.

---

## Endpoints

| Endpoint | Auth | Behavior |
|----------|------|----------|
| `POST /api/email/worker` | `Authorization: Bearer $EMAIL_WORKER_SECRET` or `x-email-worker-secret` | Claims ≤10; **no-op** if `EMAIL_SENDING_ENABLED≠true` |
| `POST /api/email/resend-webhook` | Svix signature on **raw body** (`RESEND_WEBHOOK_SECRET`) | Records redacted delivery/bounce/complaint/failure events |

---

## Security controls

- Secrets only in env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_WORKER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
- No `NEXT_PUBLIC_*` secrets; client bundle probe asserts forbidden keys
- Worker RPCs revoked from `anon`/`authenticated`
- Webhook rejects missing/invalid/stale signatures
- Payload redaction drops recipient/subject before DB insert
- Per-installation sender/domain from `complex_email_settings` (not hardcoded Amadeus/ALSYD)
- Honesty fallbacks preserved when not ready (`COPY_LINK` / `PROVIDER_NOT_CONFIGURED` / `in_app_only`)

---

## Tests / validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run test:email-core` | **PASS** (24 tests) |
| Worker skip when `EMAIL_SENDING_ENABLED=false` | **PASS** (no RPC claim, no Resend call) |
| Webhook signature + tamper/stale | **PASS** |
| Mocked Resend send + idempotency header | **PASS** |
| Retry backoff helper | **PASS** |
| `npm run build` | **PASS** |
| Shared Supabase Phase B migration | **NOT APPLIED** |
| Real emails | **NONE** |

---

## Remaining manual configuration

1. Approve & apply `20261013130000_email_core_phase_b.sql` to `klowacuvufknbrkayjhz`.  
2. Vercel Production secrets (if missing):  
   - `SUPABASE_SERVICE_ROLE_KEY`  
   - `EMAIL_WORKER_SECRET`  
   - `RESEND_WEBHOOK_SECRET` (from Resend webhook endpoint)  
   - keep `EMAIL_SENDING_ENABLED=false` until controlled test  
3. Service-role seed: verified domain + verified sender for this complex.  
4. Create Resend webhook → `https://amadeus11.online/api/email/resend-webhook` (events: delivered, bounced, complained, failed, delayed).  
5. Cron / manual `POST /api/email/worker` with worker secret (do not enable bulk until test).  
6. Controlled test path (later approval): enable DB `email_enabled`, temporarily set `EMAIL_SENDING_ENABLED=true`, enqueue one allowlisted message, then disable host flag again.  
7. Auth SMTP remains a separate Dashboard step (not Phase B).

---

## Ready for controlled test email

**NO** — code ready; ops gates (migration apply + secrets + verified sender + temporary send flag) still required.
