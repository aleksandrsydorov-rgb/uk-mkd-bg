# Email Core Phase D — Report

**Date:** 2026-10-13  
**Repo:** uk-mkd-bg · **Branch:** main (local changes; not committed)  
**Supabase:** `klowacuvufknbrkayjhz` · **Prod:** https://amadeus11.online  
**Gates:** `EMAIL_SENDING_ENABLED=false` · `email_enabled=false` (unchanged)

## Verdict

| Item | Result |
|---|---|
| Implementation | **PASS** (code + migration prepared) |
| Automatic worker | **READY** (Hobby-safe cron; needs deploy + `CRON_SECRET`) |
| Module integration matrix | See below |
| Tests | **PASS** — 55/55 email-core; `tsc --noEmit`; `next build` |
| Security review | **PASS** (design; migration not yet applied) |
| DB changes required | **YES** — `20261014120000_email_core_phase_d.sql` (not applied) |
| Ready for production release | **NO** until migration apply + `CRON_SECRET` + approved deploy |
| Remaining blockers | See bottom |

---

## D1 — Event-to-channel matrix

| MODULE | EVENT | RECIPIENT | TEMPLATE | DELIVERY | STATUS | GAP |
|---|---|---|---|---|---|---|
| PB1 | Invite create | Owner email | `pb1_property_invite` | Email Core enqueue + COPY_LINK UI | Integrated | Cancel on revoke needs Phase D migration |
| PB1 | Invite resend | Owner email | `pb1_property_invite` | Enqueue (new invite id) + COPY_LINK | Integrated | — |
| PB1 | Invite revoke/expire | — | — | Cancel queued/blocked outbox | Partial → D migration + UI hook | Expired links rejected at accept; no auto-email |
| PB1 | Activation / accept | Auth user | Supabase Auth OTP/SMTP | Auth channel (separate) | Verified live | Not Email Core |
| UA | Activation nudge / invite resend | Owner email | `ua_*` | Enqueue; honesty QUEUED/SENT/FAILED | Integrated | Recipient language not stored (uses UI/install default) |
| PKG-XFER | ownership_change_* notify | Affected emails at event | `ownership_change_*` | DB `ownership_change_notify` → enqueue | Integrated | No email on rejected/invalid (by design) |
| Meeting | Notices | Owners | `meeting_*` | **in_app_only** (no enqueue) | Corrected in D | Email only if future `allowEmail` |
| Email test | Admin controlled test | Typed address | `email_test` | Enqueue | Live E2E PASS | — |
| System | — | — | — | — | Audit only | No new invented types |

Honesty when gates OFF: PB1 → COPY_LINK; UA/XFER → PROVIDER_NOT_CONFIGURED / blocked_not_ready; Meeting → in_app_only.

---

## D2 — Automatic worker

- `vercel.json`: 4× daily UTC slots → `/api/email/cron` (Hobby-compatible ~6h cadence).
- Auth: `CRON_SECRET` (Vercel-injected) or `EMAIL_WORKER_SECRET`.
- Bounded batch ≤10; dual gates; stale reclaim; permanent failure handling.
- Ops doc: `email_core_phase_d_worker_ops.md`.

---

## D3–D5 highlights

- Meeting adapter no longer enqueues unless `allowEmail=true`.
- PB1 revoke cancels matching outbox rows (RPC after migration).
- Locale helper `resolveEmailLocale` + BG/RU/EN templates; admin/UA pass UI locale.
- Admin Email Settings: queue summary, filters, retry eligibility, latest webhook event, cron note.
- No second email admin module.

---

## D6 — Security

- Worker/cron: secret bearer only; no public arbitrary-recipient send.
- Webhook: Svix signature required.
- RLS unchanged; new RPCs service_role or admin-staff only.
- Secrets never in client bundle / vercel.json schedules.
- Localhost invite links suppressed at enqueue + worker.
- Former-owner XFER: recipients taken at notify time from transfer affected set (unchanged legal rules).

---

## Migrations (prepared, not applied)

`supabase/migrations/20261014120000_email_core_phase_d.sql`

- `email_core_reclaim_stale_sending`
- Permanent failure path in `email_core_complete_outbox_send`
- `email_core_cancel_pb1_invite_outbox`
- Richer `admin_list_email_diagnostics`
- `admin_email_queue_summary`

---

## Deployment / ops requirements (when releasing)

1. Operator approve + apply Phase D migration.
2. Set Production `CRON_SECRET`.
3. Keep both sending gates OFF until a controlled go-live.
4. Deploy so crons register; verify Cron Jobs panel.
5. Do not reuse pre-E2E worker secret values.

---

## Audit follow-up ([Thoroughness: very thorough.](9d05fd38-11b1-45f9-83da-e60e5f837734))

Closed after audit:
- PB1 honesty: blocked enqueue → **COPY_LINK** (TS + migration SQL fallback).
- PKG-XFER: `email_attempted` / `email_delivered` synced from complete + webhook (migration).
- Stale `sending`, cron, meeting `in_app_only`, diagnostics — already in Phase D.

Intentional / deferred:
- **Mass PB1 invite** stays link-batch / no auto-email (not in D3 A invite/resend scope; avoids unreviewed recipient blast).
- Recipient profile language still not stored.
- Bounce keeps outbox status `sent` with `last_error_code` + webhook event (visible in diagnostics); no separate suppress-list table.

## Remaining blockers

1. Phase D migration not applied.
2. `CRON_SECRET` not set / cron not deployed yet.
3. Recipient preferred language not stored on profiles (falls back to install/UI locale).
4. Hobby cadence ≈6h — Pro recommended for near-real-time drain.
5. No commit / push / deploy performed in this phase (per safety).
