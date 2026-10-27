# AMADEUS 11 — RC8 portable DB install

**Audience:** empty Supabase project + new VPS.
**Never** run against production, and do not use on TEST/VPS until an explicit gate.
**Secrets:** host file only (`/etc/amadeus11/rc8-db-install.env`) — not git, not Docker image.

Canonical operator doc inside the portable zip: `distribution/rc8-db-install/README.md` (copied to zip root as `README.md`).

## Build zip

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\r1-rc8-pack-db-install.ps1
```

## Install

```bash
node bin/r1-rc8-db-install.mjs \
  --env-file /etc/amadeus11/rc8-db-install.env \
  --confirm-project <supabase-project-ref> \
  --bundle-root .
```

See `R1_DIST_CLEAN_INSTALL.md` for the conceptual order (package → migrations → First Boot). This installer automates the SQL portion with empty-DB and project-ref guards.

History rows use Supabase CLI shape: `version` (14 digits), `name` (slug), `statements text[]`. DB password is passed only via `PGPASSWORD`, never on the `psql` argv.

Exact VPS checklist: `distribution/rc8-db-install/README.md` → **VPS requirements**.
