# AMADEUS 11 — Release 1.0 / RC7  
## Universal Distribution Build & Validation

**Date:** 2026-10-18  
**Branch:** `main` @ `22f7d1b79e0c0e48e99a3a3e1f850fc978eb58ec` (local uncommitted working tree)  
**Verdict:** **READY FOR CLEAN TEST DEPLOYMENT — YES**  
**Deployed this cycle:** **NO** (production, VPS `37.120.174.103`, TEST Supabase `zcecvbjjmbhwfjtlyjkt` untouched)

---

## 1. Source branch and Git status

| Item | Value |
|------|--------|
| Branch | `main` tracking `origin/main` |
| HEAD | `22f7d1b` — docs: record MTR-7 meters Safe Release evidence |
| Working tree | **Dirty** — RC3–RC6 + Settings UI + module parity + First Boot + Email Core + RC7 packaging (preserved; **not** committed / **not** pushed) |
| Settings worktree | `settings-ui-prod-deploy` @ same HEAD (prod-only UI slice earlier); main tree retains full Settings + Notification Policy for distribution |
| Commit/push | **Not performed** (per execution limits) |

Unrelated audit/tmp/script scratch files remain in the tree and are **excluded** from the Docker context via `.dockerignore` (`tmp`, `audit_exports`, `tests`, `scripts`, secrets).

---

## 2. Consolidated changes (RC3–RC6 + local)

| Area | Included in RC7 |
|------|-----------------|
| RC3 image packaging / health / Compose VPS | PASS |
| RC4 ES256 / JWKS / JWT Auth error handling | PASS |
| RC5 invite callback + token_hash mapping | PASS |
| RC6 OTP type mapping (`magiclink` → `recovery`) | PASS |
| Port-collision root cause (localhost:3080 vs cloud Auth) | PASS — installer preflight + health `supabase_host` |
| Module catalog implemented parity (Internet, Cleaning, Inventory, security) | PASS |
| Cleaning Settings deep-link `уборка` | PASS |
| Settings UI redesign (hub / catalog / wizard / i18n) | PASS |
| First Boot bootstrap + invite SQL package | PASS |
| Auto Expose OFF Data API grants migration | PASS |
| Meetings / Rental remain excluded | PASS |
| Email Sending / Debt Gate default OFF | PASS |

---

## 3. All 11 mandatory modules

Evidence basis: `all_11_modules_audit_and_repair.md` + parity package/tests in this tree.

| # | Module | Status |
|---|--------|--------|
| 1 | Property Book | **PASS** |
| 2 | Water & Electricity Meters | **PASS** |
| 3 | UK Budget & Expenses | **PASS** |
| 4 | Internet | **PASS** (catalog `implemented=true`) |
| 5 | Tickets & Chat | **PASS** |
| 6 | Ownership Transfer | **PASS** |
| 7 | Residence Status | **PASS** |
| 8 | Cleaning | **PASS** (catalog + deep-link) |
| 9 | Support Fee | **PASS** |
| 10 | Capital Repair | **PASS** |
| 11 | Inventory | **PASS** (catalog + allowlist) |

| Exclusion | Status |
|-----------|--------|
| Meetings (`general_meeting`) | **PASS** — `implemented=false`, R1-MT-HIDE |
| Rental | **PASS** — excluded |
| Ordinary polls | **PASS** — independent of Meetings |

Authenticated live module smoke: **PARTIAL** (no admin session used this cycle).

---

## 4. Settings UI redesign

| Item | Status |
|------|--------|
| `AdminSettingsHub` tabs: hub / complex / modules / access / notify / finance / security | **PASS** |
| Module catalog search / filters / status kinds | **PASS** |
| Deep-links (incl. cleaning → `уборка`) | **PASS** |
| RU / EN / BG keys (`settingsTabHub` ×3) | **PASS** |
| Existing RPCs / save paths / roles preserved | **PASS** |
| Email Sending / Debt Gate / tariff publish auto-ON | **Not introduced** |

---

## 5. Initial Setup (five-step wizard)

| Step | Content | Status |
|------|---------|--------|
| 1 | Complex details | **PASS** (UI + existing adapters) |
| 2 | Module configuration / lifecycle | **PASS** |
| 3 | Finance & tariff readiness (read-only gates) | **PASS** |
| 4 | Notifications / Email card | **PASS** |
| 5 | Final readiness | **PASS** |

No automatic module enablement, Email ON, Debt Gate ON, or tariff publish.

Browser wizard E2E: **PARTIAL** (requires isolated admin session).

---

## 6. Auth and First Boot

| Check | Status |
|-------|--------|
| ES256 / JWKS session verification | **PASS** (RC4+) |
| Secure `/auth/callback` + `token_hash` | **PASS** (RC5+) |
| OTP type mapping | **PASS** (RC6 + tests) |
| Single-use / closure / repeat bootstrap denied | **PASS** (prior Phase D + unit tests) |
| No public signup | **PASS** |
| Base-url Auth host preflight (bundle scan) | **PASS** |
| RC7 `/api/health` `supabase_host` + installer compare | **PASS** |
| Refuse invite on host/project mismatch | **PASS** (fail closed; does not kill processes) |
| Port 3080 collision guidance | **PASS** (documented + actionable error) |

---

## 7. Migrations and MANIFEST integrity

| Item | Value / Status |
|------|----------------|
| Fresh-install `orderedFiles` | **35** — aligned with `FRESH_INSTALL_ORDERED_FILES` |
| Includes `96_r1_module_catalog_implemented_parity.sql` | **PASS** |
| Chronological tree on disk | **138** SQL files |
| `MANIFEST.expectedChronologicalMigrationCount` | **138** |
| `MANIFEST.chronologicalMigrationTree` | Full ordered inventory (RC7) |
| Packaged critical list includes First Boot, Auto Expose, parity, residence, MT-hide, INV | **PASS** |
| Companion / package / chrono tests | **PASS** (see §9) |

**Operator rule (RC7):** After package apply, apply **all** `supabase/migrations/*.sql` in filename order.  
**History rule:** Never insert `schema_migrations` rows for SQL that was not applied.  
**Verify:** `schema_migrations` count **=== 138** and versions match `node scripts/r1-migration-inventory.mjs`.

Prior TEST install incomplete history (only B1 grant recorded) is **documented as a past defect**; RC7 packaging + inventory script address acceptance criteria for the **next** clean install. This cycle did **not** patch TEST Supabase.

---

## 8. Migration history verification (this cycle)

| Check | Status |
|-------|--------|
| Inventory script vs MANIFEST count | **PASS** (138/138) |
| Applied to TEST / production | **N/A — not executed** (forbidden) |
| Disposable local empty-DB full apply | **PARTIAL** — not re-run this cycle; prior R1-DIST disposable proofs + package tests stand |

---

## 9. Tests and build results

| Suite | Result |
|-------|--------|
| Focused RC7 Vitest (11 files / 69 tests) | **PASS** — inventory, catalog parity, First Boot, OTP, JWT, MT-hide, nav, residence, EML-2/5 |
| Security + email-core unit (46 files) | **PARTIAL** — 419 PASS / 3 FAIL in `publicAppUrl.inviteAuth.test.ts` when suite inherits `.env.local` `NEXT_PUBLIC_SITE_URL=http://localhost:3080`; **isolated re-run 8/8 PASS** |
| `next build` (local) | **PASS** (TypeScript OK) |
| Docker image build | **PASS** |
| Docker health smoke (local `:3097`) | **PASS** — `ok=true`, `release=1.0.0-rc7`, `supabase_host=zcecvbjjmbhwfjtlyjkt.supabase.co`, `email_sending_enabled=false` |
| Lint | **PARTIAL** — not run as a separate gate this cycle (build TypeScript gate used) |
| Authenticated browser Settings / Initial Setup | **PARTIAL** |
| Clean install on prepared VPS/TEST | **NOT RUN** (by design) |

---

## 10–13. Docker image / archive

| Item | Value |
|------|--------|
| **Tag** | `amadeus11-app:1.0.0-rc7` |
| **Digest / Id** | `sha256:fe667e38daf260880d8bfbdba84ffd3f7eb331120664654fdc3e9638dc69c6c9` |
| **Architecture** | `linux/amd64` (VPS-compatible) |
| **Archive** | `tmp/r1_rc7_transfer/amadeus11-app-1.0.0-rc7.tar` (~102.7 MiB) |
| **Archive SHA-256** | `62c624c46bbaeb7b86e1ec0f315cc490bb374e0f22fc6357d161bdeca930400d` |
| **Release manifest** | `tmp/r1_rc7_transfer/release_manifest.json` |
| **Compose** | `docker-compose.r1-vps.yml` → image `1.0.0-rc7` |
| **Baked public config** | TEST ref `zcecvbjjmbhwfjtlyjkt` · `NEXT_PUBLIC_SITE_URL=http://localhost:3080` |
| **Secrets in image** | **None** (service_role / Resend not passed as build-args) |

**Packaging strategy:** Per-installation rebuild required when Supabase URL/anon/site URL change. Documented in `docs/distribution/R1_DIST_DOCKER.md` / `R1_DIST_VPS_TRANSFER.md`.

**Rollback:** Keep prior host tag `amadeus11-app:1.0.0-rc6` (`sha256:7b4a6df6ab64ca2a4cdf1603813db6e574f5d58b15296a38807caa31f20ee01e`) until RC7 clean-install acceptance.

---

## 14. Security checks

| Check | Status |
|-------|--------|
| No production data / apartments / owners / finance seeds in package | **PASS** |
| No credentials in image / transfer archive | **PASS** |
| Meetings / Rental not activated | **PASS** |
| Email sending default OFF | **PASS** (health smoke) |
| Unauthorized anon grants | Not re-probed on live TEST this cycle — package + prior B1 grant migration present (**PARTIAL** until next clean install) |
| Installer refuses Auth host mismatch | **PASS** |

---

## 15. Remaining blockers / caveats

1. **Next clean TEST install not yet executed** — required to prove 138/138 `schema_migrations` history after apply.  
2. **Authenticated Settings Hub / Initial Setup browser review** — PARTIAL until operator login on RC7.  
3. **`publicAppUrl` Vitest env pollution** when `.env.local` sets `NEXT_PUBLIC_SITE_URL` — isolated tests PASS; suite hygiene follow-up recommended.  
4. Working tree still **uncommitted** — RC7 artifacts are local (`tmp/r1_rc7_transfer/`). Git persistence is a separate operator decision.

No release-blocking code defects identified for packaging.

---

## 16. Ready for clean TEST deployment

# **YES**

Prepared for the second clean installation on:

- VPS `37.120.174.103` (application currently removed)  
- Supabase `zcecvbjjmbhwfjtlyjkt` (empty schema / 0 auth / 0 buckets)

**STOP:** Do not deploy from this report. Transfer archive + SHA-256 are ready under `tmp/r1_rc7_transfer/` when an explicit deploy gate is issued.

---

## Installer / operator quick path (future gate only)

1. Verify empty TEST DB + Auth + Storage.  
2. Apply `fresh_install` MANIFEST order → apply all 138 migrations → verify history count.  
3. `sha256sum -c amadeus11-app-1.0.0-rc7.tar.sha256` → `docker load` → Compose `1.0.0-rc7`.  
4. SSH tunnel `3080` → confirm `/api/health` `release=1.0.0-rc7` and `supabase_host=zcecvbjjmbhwfjtlyjkt.supabase.co`.  
5. First Boot provision **only after** base-url preflight PASS (refuse if obsolete local Docker owns `:3080`).
