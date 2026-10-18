# AMADEUS 11 — Distribution troubleshooting (R1.0)

## Health returns `misconfigured` / client “Missing Supabase configuration”

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be present as **Docker build-args** (inlined into the client bundle).
- Changing public URL/key requires an **image rebuild**, not only Compose env changes.
- Server-only `SUPABASE_URL` may use `host.docker.internal` for container→host Supabase while the browser keeps `127.0.0.1`.

## Health returns `degraded` / `supabase_reachable: false`

- Check host Supabase API port and `SUPABASE_URL` from inside the container.
- Temporary DB/API outage is expected to degrade health without corrupting data.

## Login works but lands on `/account` instead of `/admin`

- First-admin bootstrap not completed: `install_bootstrap_set_approval` (service_role) then `install_bootstrap_claim_first_admin` (user JWT).

## First Boot: `AUTH_SMTP_BLOCKER`

- Cloud: configure Authentication → SMTP; set `SUPABASE_ACCESS_TOKEN` so `smtp-preflight` can read Management API auth config. Invitation secret URLs are **not** printed as a fallback.
- Ensure **Disable signup** is ON. Align Site URL + redirect allow list with `--base-url` (`http://127.0.0.1:…` local, `https://…` production).
- Expired invite: run `resend` (deletes unconfirmed Auth user, sends a fresh Auth SMTP invite). See `R1_DIST_FIRST_BOOT.md`.

## Compose recreate replaced the wrong container

- Use distinct Compose project names (`COMPOSE_PROJECT_NAME`) and `container_name` overrides when running multiple RC apps on one host.

## Migration / restore errors mentioning roles or `supabase_vault`

- Prefer restore into a full Supabase local stack (R1-DIST-3).
- On bare Postgres, stub roles first; treat remaining extension errors as environment gaps — **not** proof of Supabase recovery.
- Full-dump `pg_restore` onto an initialized local Supabase often exits `1` with grant/owner noise on `auth`/`storage`/`realtime`. Verify business + auth row counts and login before declaring failure.

## Storage object exists in DB but download returns 500

- Dump restored `storage.objects` metadata without file bytes on the Storage volume.
- Delete the object via Storage API, re-upload bytes from the backup manifest, verify SHA-256.

## Failed SQL migration / interrupted upgrade

- Keep `ON_ERROR_STOP=1`; abort leaves prior schema intact for additive failures.
- Restore pre-upgrade dump + prior image; do not invent down-migrations.
- Confirm backup SHA-256 unchanged after the failed attempt.

## Future: ALSYD CONTROL

Remote install orchestration, fleet health, and controlled rollouts are deferred. Local docs remain the source of truth until that phase.
