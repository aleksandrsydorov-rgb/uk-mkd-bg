# AMADEUS 11 — Release 1.0 / RC8  
## Distribution build (Meetings restored)

**Date:** 2026-10-26  
**Branch:** `release/r1-rc8-meetings`  
**Base:** `integration/r1-github-consolidation` @ `3f568d8`  
**Verdict:** **LOCAL PACKAGING PASS**  
**Deployed this cycle:** **NO** (VPS / TEST / production untouched)

RC7 image/tag/archive/report remain historical and were **not** overwritten.

---

## 1. What changed vs RC7

| Area | RC8 |
|------|-----|
| Meetings (`general_meeting`) | `implemented=true`; available in Initial Setup; `enabled=false` until complex opt-in |
| Rental | Still excluded |
| Email sending / Debt Gate | Default OFF |
| Additive migration | `20261121120000_r1_rc8_restore_general_meeting.sql` (+ fresh_install `97_…`) |
| R1-MT-HIDE migration | Retained in history (not edited) |
| Health `release` | `1.0.0-rc8` |

---

## 2. Tests and build

| Suite | Result |
|-------|--------|
| `next typegen` + `tsc --noEmit` | **PASS** |
| Full Vitest | **PASS** — 531 tests / 58 files |
| `npm run build` | **PASS** |
| Docker image build | **PASS** |
| Local health smoke `:3098` | **PASS** — `ok=true`, `release=1.0.0-rc8`, `email_sending_enabled=false`, local Supabase reachable |
| Remote TEST / production | **NOT USED** |

---

## 3. Docker image / archive

| Item | Value |
|------|--------|
| **Tag** | `amadeus11-app:1.0.0-rc8` |
| **Image Id / digest** | `sha256:94a8ebfab4d3475c262a09d6412638f71ab7fc8ceb137271dbbe11e7d2f0240f` |
| **Architecture** | `amd64` |
| **Archive** | `tmp/r1_rc8_transfer/amadeus11-app-1.0.0-rc8.tar` (~102.7 MiB / 107733504 bytes) |
| **Archive SHA-256** | `dcfd069aa2738a730bd9b7c2a6bd708ce0b73c597ad06f2e820a35cfe08cff87` |
| **Release manifest** | `tmp/r1_rc8_transfer/release_manifest.json` |
| **Local smoke Compose** | `docker-compose.r1-rc8-local.yml` (RC7 `docker-compose.r1-vps.yml` unchanged) |
| **RC7 preserved** | `amadeus11-app:1.0.0-rc7` → `sha256:fe667e38daf260880d8bfbdba84ffd3f7eb331120664654fdc3e9638dc69c6c9` |
| **Baked public config** | Local is10a `http://127.0.0.1:54321` · site `http://localhost:3098` |
| **Secrets in image** | **None** |

**Docker packaging note:** `.dockerignore` no longer excludes `scripts/` so `src/lib/firstBootInvite.ts` can resolve `scripts/lib/firstBootInvite.mjs` during image `next build`.

---

## 4. Local health smoke evidence

```json
{"ok":true,"status":"ok","service":"amadeus11-app","release":"1.0.0-rc8","email_sending_enabled":false,"supabase_reachable":true,"supabase_host":"host.docker.internal:54321","checked_ms":12}
```

Container health: `healthy`. Probe used local Supabase via `host.docker.internal` (not TEST/production).

---

## 5. Not verified this cycle

- VPS transfer / deploy  
- Applying migrations to TEST or production  
- Enabling Meetings on any remote DB  
- Full chronological migration apply on bare Postgres (storage stubs) — package + RC8 mig verified in step 2  
- Authenticated browser Initial Setup / Meetings UI E2E  

---

## 6. Ready for next gate

Local RC8 image + transfer archive are prepared under `tmp/r1_rc8_transfer/`.  
**STOP:** Do not deploy / push / touch remote DB from this report.
