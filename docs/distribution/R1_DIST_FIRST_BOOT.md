# AMADEUS 11 — First-boot (secure first administrator)

Installer provisions **one** administrator Email on an empty installation.  
Auth sends the invitation Email via **Supabase Auth SMTP**. The invitee sets a password, claims admin via the SQL bootstrap protocol, then enters **Initial Setup**.

No public self-registration. No service-role secrets in the browser. AMADEUS Email Core sending stays **OFF**. Debt Gate stays **OFF**.

Invitation URLs / `token_hash` are **never** printed or written to disk. If Auth SMTP is not configured, First Boot reports `AUTH_SMTP_BLOCKER` and stops — there is **no** silent fallback to manual secret files.

## Prerequisites

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Target project API (prefer over `NEXT_PUBLIC_*` for CLI) |
| `SUPABASE_SERVICE_ROLE_KEY` | Installer authorization (server/ops only) |
| `FIRST_BOOT_CONFIRM_PROJECT` | Must equal `--confirm-project` / `-ConfirmProject` |
| App `NEXT_PUBLIC_SITE_URL` / `--base-url` | Public origin for Auth redirects |
| `SUPABASE_ACCESS_TOKEN` | **Required for cloud** SMTP preflight (Management API `auth_config_read`) |

Optional: `FIRST_BOOT_ALLOW_REMOTE=1` to allow non-localhost API URLs (staging/VPS). Default CLI refuses remote URLs.

PostgreSQL **17** + full Supabase (Auth). Local disposable uses Auth Inbucket/Mailpit. Cloud installs require custom Auth SMTP (not AMADEUS Email Core).

## Auth SMTP configuration (required)

Configure in **Supabase Dashboard → Authentication → SMTP** (or Management API). Do not hardcode credentials in the app or Docker image.

| Setting | Value |
|---------|--------|
| Enable custom SMTP | ON |
| Host / Port | Provider SMTP (e.g. 587 STARTTLS) |
| Username / Password | From the SMTP provider (env / Dashboard secrets only) |
| Sender email / name | Operator-visible From address |
| Site URL | Exact app origin (`http://127.0.0.1:<port>` local, `https://…` production) |
| Redirect URLs | Include `{origin}/auth/callback`, `{origin}/auth/first-admin`, `{origin}/auth/update-password` |
| Disable signup | **ON** (public signup must stay disabled) |

Installer preflight (cloud) reads `GET https://api.supabase.com/v1/projects/{ref}/config/auth` and verifies `smtp_host`, `disable_signup`, and callback scheme alignment. Local `127.0.0.1` / `localhost` Auth is treated as Inbucket/Mailpit-capable.

## Check target + SMTP before provisioning

```powershell
$env:SUPABASE_URL = 'http://127.0.0.1:<api-port>'
$env:SUPABASE_SERVICE_ROLE_KEY = '<service_role>'
$env:FIRST_BOOT_CONFIRM_PROJECT = '<supabase-project-id>'
.\scripts\r1-first-boot.ps1 status
.\scripts\r1-first-boot.ps1 smtp-preflight -BaseUrl 'http://127.0.0.1:<app-port>'
```

Expect `bootstrap_completed=false`, `active_admin_count=0`, `closed=false`, and `SMTP_PREFLIGHT ok=true`.  
Reject if the URL/project is not the intended empty installation, or if `AUTH_SMTP_BLOCKER` is reported.

## Provision

```powershell
.\scripts\r1-first-boot.ps1 provision `
  -Email 'admin@complex.example' `
  -BaseUrl 'http://127.0.0.1:<app-port>' `
  -ConfirmProject '<supabase-project-id>' `
  -DisplayName 'Complex Admin'
```

Or:

```bash
node scripts/r1-first-boot.mjs provision \
  --email admin@complex.example \
  --base-url http://127.0.0.1:<app-port> \
  --confirm-project <supabase-project-id>
```

Effects:

1. Verifies project confirmation + empty/open bootstrap.
2. Runs Auth SMTP preflight (`AUTH_SMTP_BLOCKER` if SMTP missing / signup open / bad scheme).
3. Acquires provision lock (blocks a different concurrent Email).
4. Sets approval token (`install_bootstrap_set_approval`) — service_role only; writes **approval** token only to `tmp/r1_first_boot_token.txt` (not the Auth invite URL).
5. **Base-url Auth host preflight:** fetches `--base-url` `/api/health` (when available) and client JS chunks; refuses if the running app targets a different Supabase Auth host than `SUPABASE_URL`.
6. Sends Auth invite Email (`auth.admin.inviteUserByEmail`) with `redirectTo` → `/auth/callback?next=/auth/first-admin?t=…`.
7. Records pending Email (`install_bootstrap_record_invite`) + audit event `invite_email_sent`.
8. Operator JSON omits all invitation secrets (`redactInviteOperatorPayload`).

The administrator opens the link **from their Email inbox** (Inbucket locally, provider mailbox in cloud).

## Complete as administrator

1. Invitation Email → Auth verify → `/auth/callback` → `/auth/first-admin?t=…`
2. Set password + display name → claims via `install_bootstrap_claim_first_admin`
3. Redirect to Initial Setup (`/admin?section=начальная_настройка`) when property inventory is empty
4. Complete complex identity, apartments, Property Book, modules; leave tariffs unpublished, Email OFF, Debt Gate OFF

## Status / resend / expired recovery

```powershell
.\scripts\r1-first-boot.ps1 status
.\scripts\r1-first-boot.ps1 resend -BaseUrl 'http://127.0.0.1:<app-port>'
```

- **Resend** reuses the pending Email + approval token file; runs SMTP preflight again; sends a fresh Auth invite Email.
- If Auth still has an **unconfirmed** user from a prior invite, the CLI deletes that Auth user and re-invites (expired / unused recovery). Confirmed accounts are refused.
- After claim, `status` shows `closed=true` / `bootstrap_completed=true`. Further provision is rejected.
- Interrupted provision: re-run `provision` with the **same** Email (idempotent) or `resend`.

## HTTP staging vs HTTPS production

| Install | `--base-url` | Auth Site URL / redirects |
|---------|--------------|---------------------------|
| Local / LAN test | `http://127.0.0.1:<port>` or `http://localhost:<port>` | Same origin; allowlisted callback paths |
| Production | `https://<domain>` only | HTTPS Site URL + redirect allow list |

Non-local `http://` base URLs are an installation blocker.

## Recovery from interrupted Initial Setup

Bootstrap closure is independent of Initial Setup progress. Re-login as the same admin; empty inventory still routes to Initial Setup. Module setup drafts remain resume-safe in the existing UI.

## Confirm bootstrap closed

```powershell
.\scripts\r1-first-boot.ps1 status
# closed=true, first_admin_email set, approval_ready=false
```

## Security notes

- Never bake `SUPABASE_SERVICE_ROLE_KEY` or SMTP passwords into Docker images or client bundles.
- Prefer env files outside git (`.env*` is gitignored).
- Never log or paste Auth invitation URLs / `token_hash`.
- Public signup must remain disabled on the Supabase project.
- Do not enable AMADEUS Email Core or Debt Gate for First Boot.

## Windows / UTF-8 SQL apply

On Windows PowerShell, piping `.sql` into `docker exec … psql` can corrupt Cyrillic role literals (`администрация`). Prefer:

```powershell
docker cp supabase/migrations/20261118120000_r1_first_boot_bootstrap_invite.sql <db>:/tmp/mig.sql
docker exec <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mig.sql
```

Same rule for the fresh_install package files when applying on Windows.
