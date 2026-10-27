# AMADEUS 11 RC8 — release kit (empty Supabase + VPS TEST)

Target TEST: Supabase `rkiahcmemyocoyznfohc`, VPS `37.120.174.103`, site `https://check.amadeus11.online`.
Secrets only in host closed files — never git, never image layers.

## Kit contents

| Path | Purpose |
|------|---------|
| `bin/r1-rc8-db-install.mjs` | DB installer (PATH `psql`, strict project ref, Supabase history) |
| `env.example` | Closed DB install secrets template |
| `env.docker.r1-rc8-test.example` | Closed VPS app env template |
| `docker-compose.r1-rc8-vps.yml` | RC8 Compose bind `127.0.0.1:3080` (not RC7 compose) |
| `supabase/packages/fresh_install/` | MANIFEST + 37 SQL |
| `supabase/migrations/` | 142 chronological SQL |
| `R1_DIST_*.md` | DB install + First Boot / SMTP docs |

## DB install (empty project)

```bash
sudo cp env.example /etc/amadeus11/rc8-db-install.env && sudo chmod 0600 /etc/amadeus11/rc8-db-install.env
# fill CONFIRM_PROJECT=rkiahcmemyocoyznfohc, DATABASE_URL, SUPABASE_URL, keys

node bin/r1-rc8-db-install.mjs \
  --env-file /etc/amadeus11/rc8-db-install.env \
  --confirm-project rkiahcmemyocoyznfohc \
  --bundle-root . \
  --require-path-psql
```

Guards: project ref must match `SUPABASE_URL` host **and** DB user/host; password via `PGPASSWORD` only; refuse non-empty / partial DB; stop on first SQL error; `schema_migrations` = 142 Supabase-format rows; 6 private buckets; Meetings `implemented=true` / `enabled=false`; Rental false; Email OFF; setup adapters `property_book`/`uk_expenses` implemented; shared NP+LE Book ownership allowed.

## App image + Compose

Build on ops workstation (closed build env, public args only):

```powershell
# %USERPROFILE%\.amadeus11\rc8-test-build.env  (anon + URLs only)
.\scripts\r1-rc8-build-test-image.ps1
```

On VPS:

```bash
sudo cp env.docker.r1-rc8-test.example /etc/amadeus11/env && sudo chmod 0600 /etc/amadeus11/env
# fill runtime keys; NEXT_PUBLIC_* must match image build
docker load -i amadeus11-app-1.0.0-rc8.tar
sha256sum -c amadeus11-app-1.0.0-rc8.tar.sha256
docker compose -f docker-compose.r1-rc8-vps.yml --env-file /etc/amadeus11/env up -d
curl -fsS http://127.0.0.1:3080/api/health
```

## First Boot / SMTP

See `R1_DIST_FIRST_BOOT.md`. Cloud Auth SMTP must be configured before invite; missing SMTP is `AUTH_SMTP_BLOCKER`.

## VPS requirements (exact)

1. Empty Supabase project `rkiahcmemyocoyznfohc` (storage present, no business rows, no `schema_migrations`).
2. Host closed files:
   - `/etc/amadeus11/rc8-db-install.env` (DB URL/password + keys)
   - `/etc/amadeus11/env` (app runtime; public URL/anon match image)
3. Node.js 20+ and `psql` on PATH (installer `--require-path-psql`).
4. Docker + Compose; image `amadeus11-app:1.0.0-rc8` built for this project/domain.
5. Compose `docker-compose.r1-rc8-vps.yml` with bind `127.0.0.1:3080`.
6. Reverse proxy / TLS for `check.amadeus11.online` → `127.0.0.1:3080`.
7. Supabase Auth Site URL + redirects = `https://check.amadeus11.online`.
8. Auth custom SMTP configured before First Boot.
9. SSH deploy access to `37.120.174.103` for the ops key that owns `/opt/alsyd/amadeus11`.

## Verify commands

```bash
# DB
psql "$DATABASE_URL" -c "select count(*) from supabase_migrations.schema_migrations;"   # 142
psql "$DATABASE_URL" -c "select count(*) from storage.buckets where public=false and id in ('request-photos','chat-files','uk-expense-receipts','poll-images','building-documents','inventory-documents');"  # 6

# App
curl -fsS https://check.amadeus11.online/api/health
# expect release=1.0.0-rc8 and supabase_host containing rkiahcmemyocoyznfohc
```
