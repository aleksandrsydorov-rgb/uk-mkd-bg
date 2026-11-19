# AMADEUS 11 — Supabase Auth email templates (Bulgarian only)

Auth mail (invite, confirmation, recovery, magic link, email change, reauthentication, security notifications) is **GoTrue / Supabase Auth SMTP**, not Email Core → Lettermint.

Platform UI stays RU/BG/EN. Outbound Auth copy is Bulgarian only.

## Local files (this repo)

| Flow | Subject (config.toml) | HTML |
|------|------------------------|------|
| invite | `AMADEUS 11: покана за профил` | `supabase/templates/invite.html` |
| confirmation | `AMADEUS 11: потвърдете имейла` | `supabase/templates/confirmation.html` |
| recovery | `AMADEUS 11: възстановяване на парола` | `supabase/templates/recovery.html` |
| magic_link | `AMADEUS 11: връзка за вход` | `supabase/templates/magic_link.html` |
| email_change | `AMADEUS 11: потвърдете новия имейл` | `supabase/templates/email_change.html` |
| reauthentication | `AMADEUS 11: код за потвърждение {{ .Token }}` | `supabase/templates/reauthentication.html` |
| password_changed | `AMADEUS 11: паролата е променена` | `supabase/templates/password_changed_notification.html` |
| email_changed | `AMADEUS 11: имейлът е променен` | `supabase/templates/email_changed_notification.html` |
| phone_changed / MFA / identity_* | BG subjects in `config.toml` | matching `*_notification.html` |

Required GoTrue variables are preserved (`ConfirmationURL`, `Token`, `Email`, `NewEmail`, `OldEmail`, `Phone`, `OldPhone`, `FactorType`, `Provider`, `SiteURL`). OTP length / expiry stay in `[auth.email]` (`otp_length`, `otp_expiry`).

## Apply on a local Supabase stand (no DB reset)

Templates load only when Auth is started from a workdir whose `supabase/config.toml` points at these files. Files alone are not enough.

```powershell
# From the Supabase workdir that owns the running project (example for :3078 firstrun):
#   C:\Users\aleks\Desktop\uk-mkd-bg-r1-rc8-firstrun
Copy-Item -Recurse -Force <repo>\supabase\templates\* .\supabase\templates\
# Merge the [auth.email.template.*] / [auth.email.notification.*] blocks into .\supabase\config.toml

# Impact: brief Auth API downtime; Postgres volume is kept (NOT a reset).
npx supabase stop
npx supabase start
```

Verify without sending mail:

```powershell
docker exec supabase_auth_<project> printenv |
  Select-String -Pattern 'GOTRUE_MAILER_SUBJECTS_|GOTRUE_MAILER_TEMPLATES_|GOTRUE_MAILER_NOTIFICATIONS_'
# Subjects must be Bulgarian; template values must contain Cyrillic / AMADEUS 11 BG copy.
```

## Future VPS / hosted (do not apply in this task)

1. **Hosted Supabase Dashboard** → Authentication → Email Templates: paste each BG subject + HTML body.
2. **Self-hosted GoTrue**: set `GOTRUE_MAILER_SUBJECTS_*` and `GOTRUE_MAILER_TEMPLATES_*` (URL reachable from Auth) per [self-hosting custom email templates](https://supabase.com/docs/guides/self-hosting/custom-email-templates).
3. Do **not** route Auth mail through Email Core outbox / Lettermint Project API token settings.

## Stand mapping for app :3078

| Piece | Value |
|-------|--------|
| Next app | `http://127.0.0.1:3078` |
| Auth API | `http://127.0.0.1:55021` |
| CLI workdir | `uk-mkd-bg-r1-rc8-firstrun` (`project_id = amadeus11-rc8-firstrun-e2e`) |
| Mail catcher | Mailpit `http://127.0.0.1:55024` (local SMTP only) |
