# Lettermint via complex settings — one-time VPS / Auth notes

This is operator documentation for the UI connection path (sender + Project API token).
It does **not** configure Supabase Auth SMTP.

## One-time host env (VPS)

Generate a 32-byte encryption key (hex, 64 chars):

```bash
openssl rand -hex 32
```

Set in `/etc/amadeus11/env` (example):

```
EMAIL_SETTINGS_ENCRYPTION_KEY=<hex>
EMAIL_SENDING_ENABLED=true
EMAIL_WORKER_SECRET=<long-random>
EMAIL_MAIL_PROVIDER=lettermint
LETTERMINT_WEBHOOK_SECRET=
```

- `EMAIL_SETTINGS_ENCRYPTION_KEY` — required to store Project API tokens from the UI. Changing it invalidates stored ciphertext (re-enter token in UI).
- `EMAIL_SENDING_ENABLED=true` — host kill-switch must be on for UI enable to send. Set `false` only for emergency stop.
- Optional ops fallback: `LETTERMINT_PROJECT_TOKEN` if DB token missing (not required when UI token is saved).

Apply migration `20261130343000_email_core_lettermint_ui_connection.sql` before relying on the UI.

Compose (`docker-compose.r1-rc8-vps.yml`) includes `amadeus11-email-worker` (~60s loop → `POST /api/email/worker`).

## Lettermint webhook (manual)

Webhook is optional for sending. Without it, statuses stay at «accepted by service», never «delivered».

1. Dashboard → Webhooks → create endpoint: `https://<public-host>/api/email/lettermint-webhook`
2. Events: `message.delivered`, `message.hard_bounced`, `message.soft_bounced`, `message.spam_complaint`, `message.failed`, `message.sent`
3. Copy signing secret (`whsec_…`) into `LETTERMINT_WEBHOOK_SECRET` (not the Project token).
4. Redeploy/restart app container so the env is loaded.

Signature scheme: https://lettermint.co/docs/platform/webhooks/signing

## What uses Email Core vs Auth

| Message | Path |
|--------|------|
| Property Book invites, UA reminders, ownership notices, meetings, fees, meters, controlled test | Email Core → Lettermint/Resend adapter |
| First-admin invite, password reset, signup OTP / magic link | **Supabase Auth SMTP** (Dashboard / GoTrue) — separate |

Auth is **not** switched by saving a Project API token in complex settings.
