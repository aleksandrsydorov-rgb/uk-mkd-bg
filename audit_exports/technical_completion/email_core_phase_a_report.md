# AMADEUS 11 — Email Core Phase A Report

**Date:** 2026-10-12  
**Project:** uk-mkd-bg  
**Shared Supabase:** `klowacuvufknbrkayjhz` — **migration NOT applied** (per safety rules)  
**Live email:** none  
**Auth SMTP:** unchanged  

---

## Verdict

**Phase A foundation implemented in repo.**  
Sending remains disabled (`email_enabled=false`, `EMAIL_SENDING_ENABLED=false`, `email_core_is_ready()=false`).  
No commit / push / deploy / remote `db push`.

---

## Changed files

| Path | Role |
|------|------|
| `supabase/migrations/20261012120000_email_core_phase_a.sql` | Schema, RLS, RPCs, XFER notify bridge |
| `supabase/email_core_phase_a_smoke.sql` | Isolated-DB smoke (BEGIN/ROLLBACK) |
| `src/lib/emailCore.ts` | Health, idempotency, Phase A provider stub, enqueue client |
| `src/lib/emailCoreAdapters.ts` | PB1 / UA / PKG-XFER / Meeting adapters |
| `src/lib/userActivation.ts` | Best-effort Email Core enqueue (honesty preserved) |
| `src/lib/database.types.ts` | Tables + RPC typings |
| `src/components/admin/AdminEmailSettings.tsx` | Admin UI section |
| `src/app/admin/page.tsx` | Wired under Настройки |
| `src/i18n/messages.ts` | RU / EN / BG strings |
| `.env.example` | Documents `EMAIL_SENDING_ENABLED=false` |
| `package.json` | `test` / `test:unit` / `test:email-core` scripts |
| `tests/email-core/unit/emailCore.test.ts` | Config, idempotency, honesty, security static checks |
| `tests/pkg-xfer/unit/transferStatusAndSole.test.ts` | Fixed prior broken import |
| `audit_exports/technical_completion/email_core_phase_a_report.md` | This report |

---

## Migration prepared (not applied)

**File:** `supabase/migrations/20261012120000_email_core_phase_a.sql`

### Tables
- `complex_email_settings` (singleton, defaults: `email_enabled=false`, `mail_provider=resend`)
- `email_verified_senders` (ops/service_role seed only)
- `email_outbox` (unique `idempotency_key`)
- `email_delivery_attempts`
- `email_delivery_events`

### RPCs
- `admin_get_email_settings` / `admin_update_email_settings`
- `admin_list_verified_email_senders` / `admin_list_email_diagnostics` (masked To)
- `email_core_enqueue` / `email_core_is_ready` / `email_core_module_fallback_status`
- `email_core_ops_upsert_verified_sender` / `email_core_ops_set_domain_metadata` (**service_role only**)
- `ownership_change_notify` updated to use Email Core readiness + outbox intent (Stage-4 privacy preserved)

### Phase A hard stops in SQL
- `email_core_is_ready()` always `false`
- `admin_update_email_settings` refuses `email_enabled=true`
- Enqueue writes `blocked_not_ready` + attempt `skipped_phase_a`

---

## Security model

| Rule | Implementation |
|------|----------------|
| No secrets in DB | API keys only via host env (documented in `.env.example`) |
| No client API keys | Not in `NEXT_PUBLIC_*`; adapter never reads key in UI |
| Admin settings | SELECT/update via staff role `администрация` RPCs |
| No arbitrary From domain | Sender must exist in `email_verified_senders` with `verified` |
| Domain metadata | `service_role` ops RPCs only |
| Outbox raw To | No `authenticated` SELECT grant; diagnostics return masked email |
| Cross-user log read | No owner policies on outbox/events |
| Enable before verify | Blocked in `admin_update_email_settings` |
| No hardcoded Amadeus/ALSYD From | Asserted in unit test against `emailCore.ts` |

---

## UI coverage

**Admin → Настройки → Электронная почта**
- Sender name  
- Verified sender email (dropdown; empty until ops seeds senders)  
- Reply-To  
- Default locale BG/RU/EN  
- System status + Phase A note  
- Delivery diagnostics (masked)  
- Save (cannot enable sending)  
- If migration absent: honest “migration pending” panel (`isMissingRpcError`)

---

## Adapter coverage

| Consumer | Adapter | Honesty when not ready |
|----------|---------|------------------------|
| PB1 invites | `emailCoreNotifyPb1Invite` | `COPY_LINK` |
| User Activation | `emailCoreNotifyUserActivation` (+ wired in `createUserActivationReminder`) | `PROVIDER_NOT_CONFIGURED` / existing UA status |
| PKG-XFER | DB `ownership_change_notify` + `emailCoreNotifyPkgXfer` | `NOT_CONFIGURED` / in-app |
| Meeting | `emailCoreNotifyMeeting` | `in_app_only` |

Fallbacks **COPY_LINK / LOCAL_ONLY / PROVIDER_NOT_CONFIGURED / in-app** remain the live behavior until Phase B.

---

## Test / validation results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run test:unit` | **PASS** — 30 tests (12 email-core + 18 pkg-xfer unit) |
| `npm run build` | **PASS** |
| SQL smoke on shared Supabase | **NOT RUN** (blocked by policy) |
| Live RLS against DB | **BLOCKED** until isolated apply — static security model tests cover intent |
| Real email send | **NONE** |

---

## Manual setup remaining

1. **Approve** applying `20261012120000_email_core_phase_a.sql` to a target DB (not automatic).  
2. Isolated smoke: `supabase/email_core_phase_a_smoke.sql` on disposable DB.  
3. Resend account + DNS (SPF/DKIM/DMARC) — human.  
4. Set host secrets (`RESEND_API_KEY`, webhook secret) — never Git.  
5. `email_core_ops_set_domain_metadata` + `email_core_ops_upsert_verified_sender` via service role.  
6. Supabase Auth custom SMTP — Dashboard only, not this phase.  
7. Phase B: worker, webhook, flip `email_core_is_ready` logic, allow enable after verify.  
8. Update legal subprocessors when Resend goes live.

---

## Explicit non-actions

- No shared Supabase migration apply  
- No Auth SMTP change  
- No real emails  
- No `email_enabled=true`  
- No commit / push / deploy  
