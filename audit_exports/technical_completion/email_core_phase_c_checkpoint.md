# Email Core Phase C — Live-configuration checkpoint

**Status:** CODE COMPLETE · STOPPED BEFORE LIVE CONFIG  
**Date:** 2026-10-13  
**Commit:** not pushed (awaiting review)

## What was implemented (code)

- Auth dual-path confirmation: OTP (`verifyOtp` type `email`→`signup`) + magic/confirm link via `/auth/callback`
- Invite `signUp` / `resend` use `emailRedirectTo` → `/auth/callback?next=/auth/invite?token=…`
- Password recovery: login “Forgot password” → `resetPasswordForEmail` → `/auth/update-password`
- BG/RU/EN transactional templates (PB1, UA, XFER, meeting, email_test)
- PB1 create/resend queues Email Core + keeps copy-link honesty
- UA reminder honesty syncs to `QUEUED`/`SENT` when outbox accepts
- Admin Email Settings: sender/domain/locale, `email_enabled` toggle (gated), controlled single-address outbox queue
- Worker/webhook/idempotency/retry coverage retained + Phase C unit tests

## OTP root cause

Default Supabase **Confirm signup** template uses `{{ .ConfirmationURL }}` (magic link). The invite UI expected a 6-digit OTP with `verifyOtp(type: 'signup')`, and there was no `/auth/callback` for links. App now supports both; operator should align Auth templates (see below).

## Required SMTP configuration (operator)

Supabase Dashboard → **Project Settings → Authentication → SMTP**:

| Field | Value |
|---|---|
| Enable custom SMTP | ON |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) or `587` (STARTTLS) |
| Username | `resend` |
| Password | Resend API key (`re_…`) — Auth SMTP only |
| Sender email | `no-reply@amadeus11.online` (verified) |
| Sender name | Complex display name (e.g. Amadeus 11) |

Also add redirect allow-list:

- `https://amadeus11.online/auth/callback`
- `https://amadeus11.online/auth/invite`
- `https://amadeus11.online/auth/update-password`

## Auth email templates (operator)

**Recommended for invite OTP UX:** Confirm signup template includes:

```html
<p>Code: {{ .Token }}</p>
<p>Or open: {{ .ConfirmationURL }}</p>
```

Recovery / Magic Link templates: keep `{{ .ConfirmationURL }}` (app callback handles it). Prefer `verify` type `email` in custom links (`token_hash`).

## Pending operator actions (live E2E)

1. Review Phase C code (no commit/push/deploy until approved).
2. Configure Auth SMTP via Resend (table above).
3. Update Auth email templates (OTP + link dual-path).
4. Confirm Redirect URLs allow-list.
5. Confirm Resend webhook points to `https://amadeus11.online/api/email/resend-webhook`.
6. Identify **one** test recipient address explicitly.
7. Temporarily set Vercel `EMAIL_SENDING_ENABLED=true` (Production).
8. In Admin → Email Settings: keep sender/domain, set `email_enabled=true`, queue **one** test to the allowlisted address.
9. Trigger worker once with `EMAIL_WORKER_SECRET` (single batch).
10. Confirm inbox + webhook delivery event; then **restore**:
    - `EMAIL_SENDING_ENABLED=false`
    - `email_enabled=false`

## Safety restored after test

- Do not leave sending gates on.
- Do not process unrelated pending outbox rows (queue only the controlled test).
- Do not change ownership / finance / billing records.

## Ready for live E2E test

**YES (after operator steps 2–6)** — code path is ready; live SMTP/templates/gates still require explicit confirmation.
