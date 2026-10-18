# AMADEUS 11 — Production Migration + Git Reconciliation

**Date:** 2026-10-18  
**Scope:** Phases 1–4 + proposed commit plan  
**Production:** `https://amadeus11.online` · Supabase `klowacuvufknbrkayjhz` · Vercel `uk-mkd-bg-8soe`  
**TEST (untouched):** `zcecvbjjmbhwfjtlyjkt` · VPS `37.120.174.103`

---

## Authorization status

| Gate | Status |
|------|--------|
| **Gate A — production DB writes** | **STOP — awaiting explicit authorization** |
| **Gate B — commit / push** | **STOP — awaiting explicit authorization** |
| Phase 5 apply migrations | **Not started** |
| Phase 7 production redeploy | **Not started** (current Settings UI deploy retained) |

**No production schema/data writes performed in this cycle.**  
**No commit / push performed.**  
**No TEST VPS / TEST Supabase changes.**

---

## 1. Production migration history (live, read-only)

| Metric | Value |
|--------|--------|
| Project ref confirmed | `klowacuvufknbrkayjhz` (via `supabase/.temp/project-ref` + query) |
| Applied versions | **120** |
| Earliest applied | `20260924160000` |
| Latest applied | `20261109151000` (`mtr4_utility_submit_resolve_packaging`) |
| Orphan remote versions (not on disk) | **0** |
| Evidence | `tmp/r1_prod_recon/prod_migrations.json` · `tmp/r1_prod_recon/inventory.json` |

Production history is continuous through MTR-4. Post-MTR R1/Email/First Boot migrations are **not** recorded as applied.

---

## 2. Repository migration history

| Metric | Value |
|--------|--------|
| Disk chronological SQL files | **138** |
| MANIFEST `expectedChronologicalMigrationCount` | **138** |
| Pending vs production (timestamp match) | **18** |
| Fresh-install package files | **35** (`orderedFiles`) — **clean-install only** |

---

## 3. Schema drift assessment

| Probe | Production finding | Drift vs pending SQL |
|-------|--------------------|----------------------|
| `properties` | **22** | Live business data — never reset |
| `auth.users` | **13** | Live Auth |
| `module_catalog.internet/cleaning/inventory/security.implemented` | **true** | Catalog parity largely **already satisfied** for these keys |
| `module_catalog.general_meeting.implemented` | **true** | **DRIFT** vs R1 intent (`false`) |
| `building_modules.general_meeting.enabled` | **true** | **DRIFT** — Meetings currently active |
| `building_modules.rental.enabled` | **false** | Aligned |
| `complex_email_settings.email_enabled` | **false** | Aligned (Email Sending OFF) |
| `install_bootstrap_state` | **absent** | First Boot SQL cannot alter missing table |
| `email_notification_module_settings` | **absent** | EML-3 not applied |
| `admin_list_notification_policy` RPC | **absent** | Notification Policy UI not supported yet |
| Debt gate column on `building_settings` | Query for `ordinary_debt_gate_enabled` → **column missing** | Naming/path differs from distribution assumptions — **PARTIAL** |

**Overall:** Application code and Settings UI on Vercel are ahead of Git; DB is behind 18 repo migrations, with **important behavioral drift** on Meetings (still implemented+enabled).

---

## 4. Pending migration list (18)

### A. DO NOT APPLY to populated production (fresh-install DDL)

| Version | File | Reason |
|---------|------|--------|
| `20261028120000` | `is9a_fresh_install_book_auth_capital_tariff_ddl.sql` | Fresh-install companion; can overwrite catalog seeds / brownfield risk |
| `20261029120000` | `is9b_fresh_install_complete_dependencies_ddl.sql` | Fresh-install companion |
| `20261030120000` | `is10d_distributive_neutralize_amadeus11_sf_cutover.sql` | Distributive neutralize — not a brownfield must |

### B. Blocked / missing prerequisite

| Version | File | Reason |
|---------|------|--------|
| `20261118120000` | `r1_first_boot_bootstrap_invite.sql` | Requires `public.install_bootstrap_state` — **table absent** on production. Applying as-is will fail. Not needed for brownfield with existing admins. |

### C. HIGH RISK — intentional product behavior change (needs Gate A product approval)

| Version | File | Effect on production |
|---------|------|----------------------|
| `20261117130000` | `r1_mt_hide_general_meeting.sql` | Forces `general_meeting` `implemented=false`, `building_modules.enabled=false`, lifecycle DISABLED, DML/email gates |
| `20261120120000` | `r1_module_catalog_implemented_parity.sql` | Upserts catalog flags; **forces** `general_meeting`/`rental` implemented=false and **disables** those `building_modules` if enabled |

**Live impact if applied today:** Meetings module (currently **enabled**) would be **turned off**. Internet/cleaning/inventory/security implemented flags already true — mostly no-op for those keys. Does **not** auto-enable Email/Debt Gate.

### D. Candidate incremental (review before Gate A)

| Version | File | Class | Notes |
|---------|------|-------|-------|
| `20261107120000` | `inv7a1_is_staff_encoding_repair.sql` | INV repair | Replaces `is_staff()` — additive RPC repair |
| `20261107120100` | `inv7a1_staff_property_directory_repair.sql` | INV repair | Staff directory repair |
| `20261116120000` | `eml3_notification_policy.sql` | Email | Creates notification policy tables/RPCs |
| `20261116130000` | `eml4_system_enqueue_authz.sql` | Email | Enqueue authz |
| `20261116140000` | `eml5_cleaning_schedule_and_ticket_authz.sql` | Email | Cleaning/ticket authz |
| `20261117120000` | `r1_close_residence_status_catalog.sql` | R1 UI | Catalog close for residence status |
| `20261117140000` | `r1_ui_polls_announcements_grants.sql` | R1 UI | Grants |
| `20261117150000` | `r1_ui_cyrillic_role_literal_repair.sql` | R1 UI | Role literal repair |
| `20261117160000` | `r1_ui_admin_list_property_book_floor_cast.sql` | R1 UI | Floor cast fix |
| `20261117170000` | `r1_ui_poll_votes_owner_select.sql` | R1 UI | Owner poll vote select |
| `20261117180000` | `r1_dist_bootstrap_digest_extensions.sql` | R1 UI | Digest extensions |
| `20261119120000` | `r1_auto_expose_off_api_grants.sql` | Data API | service_role + authenticated catalog SELECT; **no anon table grants**; does not enable Email/Debt/Meetings |

---

## 5. Migration safety classification (summary)

| Class | Count | Gate A stance |
|-------|------:|---------------|
| DO_NOT_APPLY_FRESH_INSTALL_DDL | 3 | **Refuse** |
| Missing prerequisite / brownfield N/A | 1 (First Boot) | **Refuse as-is** |
| HIGH RISK behavior change (Meetings OFF) | 2 | **Explicit product authorization required** |
| Candidate incremental | 12 | **Review + backup + isolated dry-run**, then authorize subset |

Meetings/Rental must not be **activated** by this work. Current issue is the inverse: Meetings is already active; R1 migrations would **deactivate** it.

Email Sending remains OFF (`email_enabled=false`). Debt Gate column probe incomplete (**PARTIAL**).

---

## 6. Proposed SQL changes (for Gate A — not executed)

**Recommended authorization menu (choose explicitly):**

### Option 0 — Database hold (default recommendation until product decision)
- Apply **nothing**.
- Keep production Vercel Settings UI as deployed.
- Proceed only with Git organization (Gate B) of code/docs.

### Option 1 — Safe additive repairs only
Candidate versions (still need isolated validation):  
`20261107120000`, `20261107120100`, plus selected R1 UI grant/cast fixes (`20261117140000`–`20261117180000`, `20261117120000`) and optionally `20261119120000` if Auto Expose OFF requires service_role GRANTs.

### Option 2 — Enable Notification Policy backend (required before shipping main-tree Settings `notify` tab)
Add: `20261116120000` → `20261116130000` → `20261116140000`.

### Option 3 — R1 Meetings hide + catalog parity (product decision)
Add: `20261117130000` then `20261120120000` (or parity alone, which also disables GM/rental).  
**Warn:** disables live Meetings (`enabled=true` today).

**Never:** fresh-install package SQL · `is9a`/`is9b`/`is10d` · First Boot invite SQL until bootstrap baseline exists and is intentionally desired.

---

## 7. Validation and test evidence

| Check | Result |
|-------|--------|
| Live production migration inventory | **PASS** (read-only) |
| Live schema probes (modules, email, bootstrap) | **PASS** (read-only) |
| Isolated representative DB clone of production | **PARTIAL / NOT RUN** |
| Dry-run apply of pending subset on disposable DB | **PARTIAL / NOT RUN** |
| RC7 unit tests (prior cycle) | Focused suites PASS; not re-proven against prod schema |
| Financial invariant regression on pending SQL | **PARTIAL** — Meetings hide does not rewrite ledgers; still needs approval |

Treat any production apply as requiring Gate A after Option selection.

---

## 8. Backup / recovery evidence

| Item | Status |
|------|--------|
| Fresh verified production backup taken this cycle | **NOT VERIFIED** |
| Documented rollback image (app) | `dpl_8mmo6H6YSb6FMujhRXhVEkawBXNt` (pre–Settings UI) |
| Current production app | `dpl_BjBZgNKerMXbYPT61kxBsRuQibVR` |
| DB rollback plan | Point-in-time / Supabase backup restore — **must be confirmed before Gate A Option 1–3** |

**Gate A prerequisite:** operator confirms usable backup/recovery point for `klowacuvufknbrkayjhz`.

---

## 9. Git working-tree status

| Item | Value |
|------|--------|
| Branch | `main` @ `22f7d1b` = `origin/main` (0 ahead / 0 behind) |
| Working tree | **Heavily dirty** (modified + untracked R1/Email/Settings/distribution) |
| Commit/push | **None** |
| Secrets / env files present locally | `.env.local`, `.env.docker`, `.env.r1fb.local`, `.env.inv7a1.local` — **must never be committed** |
| Docker archive | `tmp/r1_rc7_transfer/amadeus11-app-1.0.0-rc7.tar` — **exclude from Git** |

---

## 10. Production Settings UI reconciliation

### Five files published to production (CLI worktree deploy)

Worktree: `C:\Users\aleks\Desktop\uk-mkd-bg-settings-ui-deploy` · branch `settings-ui-prod-deploy`

1. `src/app/admin/page.tsx`  
2. `src/components/admin/AdminInitialSetup.tsx`  
3. `src/i18n/messages.ts`  
4. `src/components/admin/AdminModuleCatalogPanel.tsx` (new)  
5. `src/components/admin/AdminSettingsHub.tsx` (new)

### Vs main development tree

| File | main vs worktree | Notes |
|------|------------------|-------|
| All five | **DIFF** (content hashes differ) | Main includes fuller R1 surface |
| `AdminSettingsHub` | Main imports **`AdminNotificationPolicyPanel`** | Worktree/prod deploy **omitted** Notification Policy (prod lacks EML-3 RPCs) |
| Module catalog | Main uses R1 exclusions (`r1_unavailable`) | Prod worktree sanitized for live DB states |

### Deployed but absent from tracked Git history

- Entire Settings UI redesign content is **uncommitted**.
- Production Vercel deployment `dpl_BjBZgNKerMXbYPT61kxBsRuQibVR` was created by **Vercel CLI from worktree**, not from `git push` of `origin/main`.
- Therefore: **production app ≠ origin/main** for Settings UI.

### Preference (Phase 7)

**Retain current production deployment** until Gate A decides on EML-3 and Meetings hide. Blind redeploy of main tree Settings would call missing Notification Policy RPCs → regression risk.

---

## 11. Proposed commit sequence (Gate B — not executed)

Logical commits (ordered). Exact file lists are proposals; stage carefully after review.

### Commit A — Settings UI redesign + localization
**Message:** `feat(admin): add Settings hub, module catalog UI, and Initial Setup wizard`

**Include:**
- `src/components/admin/AdminSettingsHub.tsx`
- `src/components/admin/AdminModuleCatalogPanel.tsx`
- `src/components/admin/AdminInitialSetup.tsx` (wizard)
- `src/app/admin/page.tsx` (settings routing)
- `src/i18n/messages.ts` (RU/EN/BG settings keys)
- Related presentation-only helpers if required (`src/lib/adminNav.ts` only if Settings-dependent)

**Caution:** Main-tree hub embeds Notification Policy. Either:
- (A1) commit prod-compatible hub (no Notification Policy panel) matching live deploy, **or**
- (A2) commit full hub and **block production redeploy** until EML-3 applied (Gate A Option 2).

### Commit B — Module catalog parity (code + migration file)
**Message:** `fix(modules): align catalog implemented flags for R1 mandatory modules`

**Include:**
- `src/lib/modules.ts`
- `supabase/migrations/20261120120000_r1_module_catalog_implemented_parity.sql`
- `supabase/packages/fresh_install/60_module_catalog_baseline.sql`
- `supabase/packages/fresh_install/96_r1_module_catalog_implemented_parity.sql`
- `supabase/packages/fresh_install/MANIFEST.json` (parity entries)
- `src/lib/moduleCore/freshInstallMeterSchema.ts`
- `tests/security/unit/r1ModuleCatalogImplementedParity.test.ts`
- `docs/architecture-cores.md` (if limited to catalog notes)

**Note:** Committing ≠ applying. Production apply is Gate A Option 3.

### Commit C — First Boot / Auth fixes (application)
**Message:** `fix(auth): harden callback OTP mapping, JWT errors, and First Boot installer`

**Include:**
- `src/app/auth/callback/page.tsx`
- `src/app/auth/update-password/page.tsx`
- `src/app/auth/first-admin/**`
- `src/lib/auth/otpTokenTypes.ts`
- `src/lib/auth/jwtAuthErrors.ts`
- `src/lib/auth/emailConfirmation.ts`
- `src/lib/firstBoot.ts`
- `src/lib/supabase/env.ts` (+ client/server/proxy/admin only if Auth-related)
- `scripts/r1-first-boot.mjs` / `.ps1`
- `tests/security/unit/otpTypeForTokenHash.test.ts`
- `tests/security/unit/jwtAuthErrors.test.ts`
- `tests/security/unit/r1FirstBoot.test.ts`
- Migration **file** `20261118120000_…` + package `95_…` as distribution artifacts (not for prod apply)

### Commit D — Distribution packaging / docs / Docker
**Message:** `chore(dist): add R1 Docker packaging, Compose, and install docs for RC7`

**Include:**
- `Dockerfile`, `.dockerignore`, `docker-compose.r1-vps.yml`, `docker-compose.yml` (if canonical)
- `docs/distribution/**`
- `src/app/api/health/**`
- `scripts/r1-migration-inventory.mjs`
- `tests/security/unit/r1MigrationInventory.test.ts`
- `audit_exports/technical_completion/release_1/r1_distribution_rc7.md` (optional docs commit)

**Exclude:** `tmp/**`, `*.tar`, `.env*`, `scripts/_inv*` scratch, disposable compose variants unless intentionally kept.

### Commit E — Remaining production-candidate schema migrations (files only)
**Message:** `feat(db): add R1 UI, email notification policy, and Data API grant migrations`

**Include:** EML-3/4/5, R1 UI migrations, INV-7a1, auto_expose grants, MT-hide (if not in B), package mirrors under `fresh_install/`.

Split further if review prefers Meetings-hide as its own commit.

### Do not mix into these commits
- Unrelated audit markdown churn under older `audit_exports/**` unless intentionally curated  
- `tmp/`, Docker archives, local env files, `$null`  
- TEST-only disposable compose/env files without docs purpose  

---

## 12. Secret scan result

| Check | Result |
|-------|--------|
| High-confidence leaked JWT/service_role literals in candidate source roots | **No committed secret values found** in this scan (hits were **identifier/docs references** in `admin.ts`, first-boot scripts, compose var names) |
| Local env / tar artifacts | Present on disk — **must stay untracked** |
| Recommendation | Pre-commit: `git status` + deny `.env*`, `*.tar`, `tmp/` |

---

## 13. Production deployment compatibility

| Surface | Compatible with current prod DB? | Notes |
|---------|----------------------------------|-------|
| Live Settings UI (worktree deploy) | **YES** | No Notification Policy RPC dependency |
| Main-tree Settings hub + Notification Policy | **NO** until EML-3 | Would regress notify tab |
| Module catalog R1 exclusions in main | **OK** for display | Does not change DB enabled flags |
| Catalog parity migration | **Behavior change** | Disables Meetings |
| RC7 Docker image | Targets TEST Supabase bake | **Not** for amadeus11.online |
| Blind full RC7 app redeploy to Vercel | **NO** | Would pull uncommitted main mix + Notification Policy risk |

**Recommendation:** Keep `dpl_BjBZgNKerMXbYPT61kxBsRuQibVR` until Gate A + Gate B complete and a deliberate, minimal deploy plan is approved.

---

## 14. Unresolved risks

1. **Meetings is live-enabled** — R1 hide/parity migrations would disable it.  
2. **Settings source split** — prod worktree ≠ main tree ≠ `origin/main`.  
3. **No verified DB backup attestation** this cycle.  
4. **No disposable brownfield clone** validation of pending SQL.  
5. **Debt gate column naming** incomplete on production probe.  
6. **First Boot SQL** incompatible with current prod schema (missing bootstrap table).  
7. Large dirty tree increases risk of accidental staging of secrets/artifacts.

---

## 15. Required authorization checkpoints

### Gate A — reply with one of:
- `AUTHORIZE DB: NONE`  
- `AUTHORIZE DB: OPTION1` (+ exact version list if narrowed)  
- `AUTHORIZE DB: OPTION2`  
- `AUTHORIZE DB: OPTION3`  
- Custom explicit version list  

Plus confirmation: **backup exists for `klowacuvufknbrkayjhz`**.

### Gate B — reply with:
- `AUTHORIZE COMMIT PLAN` (as proposed A–E or amended file lists)  
- Whether Settings commit uses **A1 prod-compatible hub** or **A2 full hub**  
- `AUTHORIZE PUSH` only if commits should go to `origin/main` (separate from commit-only)

### Deploy
- Explicit: `AUTHORIZE PROD DEPLOY` — otherwise retain current Vercel deployment.

---

## 16. Final readiness status

| Area | Status |
|------|--------|
| Production migration inventory | **PASS** |
| Pending classification | **PASS** |
| Git/Settings reconciliation understanding | **PASS** |
| Safe to apply all 18 pending | **FAIL** (must not) |
| Safe to apply fresh-install DDL | **FAIL** |
| Ready for Gate A decision | **YES** |
| Ready for Gate B decision | **YES** (plan proposed; files unstaged) |
| Ready for unsupervised prod migrate/commit/push/redeploy | **NO** |

---

## Evidence paths

- `tmp/r1_prod_recon/inventory.json`  
- `tmp/r1_prod_recon/prod_migrations.json`  
- `tmp/r1_prod_recon/prod_schema_probe.json`  
- `audit_exports/technical_completion/release_1/r1_distribution_rc7.md`  
- Prior Settings deploy: `tmp/r1_test_reset/settings_ui_prod_deploy_report.md`
