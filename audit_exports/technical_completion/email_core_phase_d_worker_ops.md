# Email Core Phase D — Automatic Worker Operations

**Project:** uk-mkd-bg · **Production:** https://amadeus11.online · **Supabase:** `klowacuvufknbrkayjhz`

## Architecture (simplest supported)

| Piece | Role |
|---|---|
| `/api/email/worker` | Manual/ops authenticated batch (`EMAIL_WORKER_SECRET`) |
| `/api/email/cron` | Vercel Cron scheduled drain (`CRON_SECRET` or worker secret) |
| `/api/email/resend-webhook` | Svix-signed delivery events |
| Outbox + claim RPC | Idempotent bounded batches (≤10) |
| Dual gates | Host `EMAIL_SENDING_ENABLED` **and** DB `email_enabled` |

No extra server or paid scheduler. Cron uses existing Vercel Functions.

## Hobby-compatible schedule

Vercel team plan: **Hobby** (once-per-day cron expressions only).

Production schedule in `vercel.json`:

```json
0 6 * * *
```

Path: `/api/email/cron` (06:00 UTC daily; Hobby may fire anytime within that hour).

**Pro (requires operator approval before changing):** a single `*/5 * * * *` (or similar) for near-real-time drain.

## Secrets (never in client / never in vercel.json path config)

| Env | Purpose |
|---|---|
| `CRON_SECRET` | Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron invocations |
| `EMAIL_WORKER_SECRET` | Ops manual worker / cron fallback auth |
| `EMAIL_SENDING_ENABLED` | Host kill-switch (`false` by default) |
| `RESEND_API_KEY` | Provider send |
| `RESEND_WEBHOOK_SECRET` | Svix verify |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker RPCs |

**Note:** Worker secret was rotated during Live E2E — do not reuse old ops-note values.

## Runtime behaviour

1. Cron authenticates via `CRON_SECRET` (preferred) or `EMAIL_WORKER_SECRET`.
2. Reclaims stale `sending` rows older than 15 minutes (`email_core_reclaim_stale_sending` — requires Phase D migration).
3. Runs `runOutboxWorker` with both gates enforced.
4. Permanent provider failures (`invalid_recipient`, bounce/complaint codes, `permanent:*`) terminate without blind retry.
5. Non-public / localhost invite links are not delivered (`invalid_invite_link`).

## Deployment checklist (when releasing Phase D)

1. Apply migration `20261014120000_email_core_phase_d.sql` (separate approval).
2. Set `CRON_SECRET` in Vercel Production (random ≥16 chars).
3. Confirm `EMAIL_SENDING_ENABLED=false` until go-live.
4. Deploy production so `vercel.json` crons register (Project → Settings → Cron Jobs).
5. If Deployment Protection is on, ensure Vercel Cron is allowed.
6. Smoke: unauthorized `/api/email/cron` → 401; with secret + gates off → skipped reason.

## Gates remain OFF until operator-approved live send
