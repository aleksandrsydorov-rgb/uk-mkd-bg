# Email Core — Verified Sender Setup

**Project:** `klowacuvufknbrkayjhz`  
**Date:** 2026-10-13  

## Evidence for domain verification

- Operator/task attestation: Resend domain `amadeus11.online` = **VERIFIED**, region `eu-west-1`.  
- Local `RESEND_API_KEY` was **absent** — no live Resend API probe performed.  
- Sender email domain matches verified domain (`no-reply@amadeus11.online`).  
- Registration used ops RPCs `email_core_ops_set_domain_metadata` + `email_core_ops_upsert_verified_sender` under `service_role` JWT claim (not client session).

## Configured values

| Field | Value |
|-------|-------|
| sender_name | Amadeus 11 |
| sender_email | no-reply@amadeus11.online |
| verified_domain | amadeus11.online |
| domain_status | verified |
| provider_domain_id | resend:eu-west-1:amadeus11.online |
| mail_provider | resend |
| template_locale | bg |
| reply_to_email | **null** (no-reply cannot receive) |
| email_enabled | **false** |

## Checks

| Check | Result |
|-------|--------|
| Admin UI payload sees verified sender | YES (`verified_senders[0].email=no-reply@amadeus11.online`) |
| Authenticated EXECUTE on ops domain/sender RPCs | **false** / **false** |
| `admin_update_email_settings` args | no domain/verify params |
| `email_core_is_ready()` | **false** |
| delivery_status | paused |
| outbox sent | **0** (total outbox 0) |
| Business counts | properties 20, transfers 19 unchanged |
| EMAIL_SENDING_ENABLED | not enabled |
| Auth SMTP | unchanged |
| Secrets in tables | none |

## Return checklist

- Sender configured: **YES**
- Domain verified: **YES** (`amadeus11.online` / verified)
- Admin UI: **YES** (sender + verified_senders visible via `admin_get_email_settings`)
- RLS: **PASS** (ops RPCs not executable by authenticated)
- email_enabled: **false**
- is_ready: **false**
- Outbox sent: **0**
- Business data unchanged: **YES**
- Next required manual secrets/configuration:
  1. Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_WORKER_SECRET`, `RESEND_WEBHOOK_SECRET` (if not already)
  2. Resend webhook → `https://amadeus11.online/api/email/resend-webhook`
  3. Keep `EMAIL_SENDING_ENABLED=false` until controlled test email approval
  4. Deploy Phase B app routes if not yet on Production
