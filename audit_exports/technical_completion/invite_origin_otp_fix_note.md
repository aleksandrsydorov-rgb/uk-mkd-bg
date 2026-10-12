# Invite origin + unconfirmed OTP fix (pre-release note)

**Status:** code ready · no commit/deploy yet · gates remain OFF  
**Date:** 2026-10-13

## Root cause addressed

1. Invite links used `window.location.origin` → localhost when admin used local Next against production DB.
2. Existing unconfirmed Auth users did not reliably reach OTP resend UI.
3. UI mixed PB1 copy-link with Email Core send status.

## Installation URL

Set per complex:

```
NEXT_PUBLIC_SITE_URL=https://amadeus11.online
```

Required on Vercel Production before release (code throws if missing in production).

## Localhost outbox row (id=1) — will it auto-send?

**No.** Worker claims only `status='queued'`. Row is `blocked_not_ready` and stays there while `email_core_is_ready()` is false.

Additionally, new PB1/UA adapters **strip** localhost `invite_link` from payloads (`isNonPublicInviteUrl`).

### Optional operator-approved SQL (DO NOT RUN without approval)

```sql
-- Point-fix: cancel blocked localhost invite payload so it can never be claimed.
update public.email_outbox
   set status = 'cancelled',
       last_error_code = 'cancelled_localhost_invite_link',
       updated_at = now()
 where id = 1
   and status = 'blocked_not_ready'
   and coalesce(payload->>'invite_link', '') ilike '%localhost%';
```

## Ops after release

1. Set `NEXT_PUBLIC_SITE_URL` on Vercel Production.
2. Redeploy.
3. From https://amadeus11.online/admin → Resend invite for affected owners (new token; production URL).
4. Unconfirmed Auth users use invite page OTP / Resend Auth code.
