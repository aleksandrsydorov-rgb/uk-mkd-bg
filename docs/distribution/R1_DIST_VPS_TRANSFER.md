# AMADEUS 11 — VPS image transfer (R1 test)

Transfer an **immutable** local image to the VPS without GitHub credentials on the server.

## Verified artifacts (ops workstation)

### RC7 (historical — do not overwrite)

| Artifact | Purpose |
|----------|---------|
| `amadeus11-app:1.0.0-rc7` | Local tag (Release 1.0 RC7) |
| Digest (see `r1_distribution_rc7.md`) | Immutable identity |
| `amadeus11-app-1.0.0-rc7.tar` | `docker save` archive |
| `amadeus11-app-1.0.0-rc7.tar.sha256` | SHA-256 of the archive |

Local prepare path: `tmp/r1_rc7_transfer/` (gitignored via `tmp/`).

### RC8 (Meetings restored for Initial Setup; Rental still excluded)

| Artifact | Purpose |
|----------|---------|
| `amadeus11-app:1.0.0-rc8` | Local tag (Release 1.0 RC8) |
| Digest (see `r1_distribution_rc8.md`) | Immutable identity |
| `amadeus11-app-1.0.0-rc8.tar` | `docker save` archive |
| `amadeus11-app-1.0.0-rc8.tar.sha256` | SHA-256 of the archive |
| `docker-compose.r1-rc8-local.yml` | Local smoke Compose (is10a) |
| `docker-compose.r1-rc8-vps.yml` | **TEST VPS** Compose bind `127.0.0.1:3080` (do not use RC7 `docker-compose.r1-vps.yml`) |
| `distribution/rc8-db-install/` + zip | Portable DB install (MANIFEST + 140 migrations) |

Local prepare path: `tmp/r1_rc8_transfer/` (gitignored via `tmp/`).

**TEST complex:** Supabase `rkiahcmemyocoyznfohc`, site `https://check.amadeus11.online`.
Build image with `scripts/r1-rc8-build-test-image.ps1` from closed `%USERPROFILE%\.amadeus11\rc8-test-build.env` (anon + URLs only).

**Packaging note:** `NEXT_PUBLIC_*` are baked at **image build** time. One image targets one Supabase project. Rebuild for each independent complex. Old localhost-baked images are not valid for this TEST.

## Build (ops workstation only)

```powershell
# Public keys only as build-args. Never pass service_role / DB password / Resend.
docker build -t amadeus11-app:1.0.0-rc7 `
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://zcecvbjjmbhwfjtlyjkt.supabase.co `
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> `
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3080 `
  .
docker save amadeus11-app:1.0.0-rc7 -o amadeus11-app-1.0.0-rc7.tar
Get-FileHash -Algorithm SHA256 amadeus11-app-1.0.0-rc7.tar
```

## Transfer (SCP)

```powershell
scp -i "$env:USERPROFILE\.ssh\alsyd_vps_ed25519" `
  amadeus11-app-1.0.0-rc3.tar `
  amadeus11-app-1.0.0-rc3.tar.sha256 `
  docker-compose.r1-vps.yml `
  alsyd@37.120.174.103:/opt/alsyd/amadeus11/
```

Host-only env file (never in the image or git):

```powershell
# Create on VPS as root/ops: /etc/amadeus11/env mode 0600 owner root:alsyd
# Copy from .env.docker.r1-test.example and fill secrets on the VPS only.
```

## Load + verify on VPS (future phase)

```bash
cd /opt/alsyd/amadeus11
sha256sum -c amadeus11-app-1.0.0-rc3.tar.sha256
docker load -i amadeus11-app-1.0.0-rc3.tar
docker image inspect amadeus11-app:1.0.0-rc3 --format '{{.Id}}'
# Expect: sha256:0df442898b25821309488f0da82bfec83041404b977f133615d730b26a2c8fa3
```

## Compose up (future phase)

```bash
export AMADEUS_ENV_FILE=/etc/amadeus11/env
chmod 0600 /etc/amadeus11/env
docker compose -f docker-compose.r1-vps.yml --env-file /etc/amadeus11/env up -d
docker compose -f docker-compose.r1-vps.yml ps
curl -fsS http://127.0.0.1:3080/api/health
```

Confirm publish is **127.0.0.1:3080** only (`ss -lntp | grep 3080`).

## SSH tunnel (Windows → VPS)

```powershell
ssh -N -L 3080:127.0.0.1:3080 -i "$env:USERPROFILE\.ssh\alsyd_vps_ed25519" alsyd@37.120.174.103
```

Browser: `http://localhost:3080`
This origin must match Supabase Auth **Site URL** `http://localhost:3080` and redirect allowlist paths under that origin.

## Compatibility

| Component | Target |
|-----------|--------|
| OS | Debian 13.7 x86_64 |
| Docker | 29.9.1 |
| Compose | 5.6.0 |
| App dir | `/opt/alsyd/amadeus11` |

Image is linux/amd64 Node 22 bookworm-slim — compatible with the VPS architecture above.
