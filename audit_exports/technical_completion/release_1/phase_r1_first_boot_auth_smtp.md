# AMADEUS 11 — First Boot Auth SMTP invitation (dev repo)

**Date:** 2026-10-18  
**Scope:** Main development repository only. No production / TEST VPS / Supabase changes. No deploy, commit, or push.

## Verdict

**READY for local verification** — installer delivers first-admin invitations via Supabase Auth SMTP (`inviteUserByEmail`). Missing SMTP is a hard `AUTH_SMTP_BLOCKER`. Manual invitation-file workflow removed.

## Required SMTP configuration

| Item | Requirement |
|------|-------------|
| Provider | Any SMTP provider supported by Supabase Auth custom SMTP (Dashboard / Management API) |
| Credentials | Dashboard secrets only — never in app env, Docker image, or git |
| Host / port / user / pass / sender | Set under Authentication → SMTP |
| Site URL | App origin (`http://127.0.0.1:<port>` local; `https://<domain>` production) |
| Redirect allow list | `{origin}/auth/callback`, `{origin}/auth/first-admin`, `{origin}/auth/update-password` |
| Disable signup | ON |
| Installer cloud probe | `SUPABASE_ACCESS_TOKEN` with `auth_config_read` → `GET /v1/projects/{ref}/config/auth` |
| Not used | AMADEUS Email Core (`EMAIL_SENDING_ENABLED`), Debt Gate, public signup |

## Implementation changes

| Path | Change |
|------|--------|
| `scripts/lib/firstBootInvite.mjs` | SMTP assess / redact / URL scheme / redirect helpers |
| `src/lib/firstBootInvite.ts` | Typed re-exports for Vitest |
| `scripts/r1-first-boot.mjs` | `smtp-preflight`; provision/resend via `inviteUserByEmail`; delete+reinvite recovery; no secret URL print/write |
| `scripts/r1-first-boot.ps1` | `smtp-preflight` command |
| `docs/distribution/R1_DIST_FIRST_BOOT.md` | Email delivery + SMTP preflight standard |
| `docs/distribution/R1_DIST_CLEAN_INSTALL.md` | SMTP preflight step in universal install order |
| `docs/distribution/R1_DIST_TROUBLESHOOTING.md` | `AUTH_SMTP_BLOCKER` / resend recovery |
| `.env.example` | First Boot / `SUPABASE_ACCESS_TOKEN` comments |

## Security preserved

- Bootstrap approval token + `install_bootstrap_*` RPCs unchanged
- Password set + claim on `/auth/first-admin`
- One-time bootstrap closure unchanged
- Operator output redacted (`action_link`, `token_hash`, approval token omitted from JSON)
- Approval token file retained (`tmp/r1_first_boot_token.txt`) — not an Auth activation URL

## Tests

- `tests/security/unit/r1FirstBoot.test.ts` — CLI contract updated to `inviteUserByEmail`
- `tests/security/unit/r1FirstBootInvite.test.ts` — SMTP assess, redact, scheme, OTP mapping retention

## Explicit non-changes

- Production / TEST VPS / remote Supabase: untouched
- Email Core / Debt Gate: remain OFF
- No commit / push / deploy from this task

## Operator next step (when allowed)

1. Configure Auth SMTP on the target project (or use local Inbucket).
2. `node scripts/r1-first-boot.mjs smtp-preflight --base-url <origin>`
3. `provision` → administrator opens Email → password + claim.
