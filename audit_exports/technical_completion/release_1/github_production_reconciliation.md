# AMADEUS 11 — GitHub Consolidation & Production Database Reconciliation

**Date:** 2026-10-18  
**Main repo:** `C:\Users\aleks\Desktop\uk-mkd-bg`  
**Production:** `https://amadeus11.online` · Supabase `klowacuvufknbrkayjhz`  
**TEST (untouched):** VPS `37.120.174.103` · Supabase `zcecvbjjmbhwfjtlyjkt` · RC7

---

## Authorization status

| Gate | Status |
|------|--------|
| **Git commit + push (integration branch)** | **DONE** (see hashes below) |
| **Merge to `main` / production Vercel deploy** | **HOLD** — do not merge until compatibility verified |
| **Gate A — production DB writes** | **STOP — awaiting explicit authorization** |
| TEST VPS / TEST Supabase | **Untouched** |

---

## 1. Git branch and pushed commits

| Item | Value |
|------|--------|
| Integration branch | `integration/r1-github-consolidation` |
| Base | `origin/main` @ `22f7d1b` |
| Why not `main` | Vercel project `uk-mkd-bg-8soe` tracks production; push to `main` risks automatic production deploy of unapproved app+DB-dependent UI |
| Settings UI source of truth | **Main working tree** (newer than `settings-ui-prod-deploy` worktree by ~6 lines on hub; keep main) |
| Prod Settings deploy origin | CLI deploy from worktree `settings-ui-prod-deploy` (`dpl_BjBZgNKerMXbYPT61kxBsRuQibVR`) — **not** a git push |

### Commit sequence (A–F)

| ID | Hash | Summary |
|----|------|---------|
| A | `9a52818` | Settings Hub + Initial Setup + nav redesign |
| B | `42830bc` | Module catalog parity, residence status, Meetings hide |
| C | `f64f7d6` | First Boot Auth SMTP invite + OTP/JWT helpers |
| D | `2db467d` | EML-3..5 + R1 UI grants + Auto Expose OFF SQL |
| E | `773d96f` | Docker packaging + distribution runbooks |
| F | `3e813bd` (+ tip `41b233d` hash pin) | Documentation + reconciliation evidence |

---

## 2. Included vs excluded

### Included
- Settings Hub / Module catalog / Notification panels / Initial Setup
- RC3–RC7 Auth/First Boot, health route, OTP type mapping
- 11-module parity + Meetings hide SQL (repo artifacts; **not applied to prod**)
- Email notification policy code + migrations
- Fresh_install package updates + MANIFEST
- Dockerfile / Compose / `docs/distribution/*`
- Focused unit tests for the above

### Excluded (intentionally untracked / ignored)
- `.env*` and `supabase/.temp/**` (contains local JWTs)
- `tmp/**` (invite URLs, transfer archives, private RC7 deploy paths)
- `scripts/_inv*` / `_mtr*` scratch artifacts
- `$null` junk file
- Docker image tarballs / generated archives
- Large source-bundle `.txt` dumps under `audit_exports/`
- Force-push / history rewrite: **not done**

### Secret scan
- Confirmed `.env*` gitignored
- Confirmed `supabase/.temp/start-secrets/**` not staged
- Remaining `service_role` / `token_hash` hits are code/docs identifiers, not leaked credentials

---

## 3. Production migration inventory (live recheck)

| Metric | Value | Evidence |
|--------|------:|----------|
| Project ref | `klowacuvufknbrkayjhz` | `supabase/.temp/project-ref` + linked query |
| Applied count | **120** | `select count(*) from supabase_migrations.schema_migrations` |
| Latest applied | **20261109151000** (`mtr4_utility_submit_resolve_packaging`) | Linked query |
| Disk migrations | **138** | `supabase/migrations/*.sql` |
| Pending (timestamp gap) | **18** | Confirmed |

Pending versions (unchanged classification from prior recon):

### Never apply on populated production
- `20261028120000` is9a fresh-install DDL  
- `20261029120000` is9b fresh-install DDL  
- `20261030120000` is10d distributive neutralize  

### Blocked / N/A brownfield
- `20261118120000` First Boot invite — needs `install_bootstrap_state` (**absent** on prod); not required for existing admins  

### High risk (product decision) — would disable live Meetings
- `20261117130000` r1_mt_hide_general_meeting  
- `20261120120000` r1_module_catalog_implemented_parity  

Live: `building_modules.general_meeting.enabled=true`, `implemented=true`. Applying either turns Meetings **off**. Rental stays off.

### Candidate incremental (after backup + isolated dry-run)
- `20261107120000`, `20261107120100` — INV staff repairs  
- `20261116120000` → `20261116130000` → `20261116140000` — EML notification policy (required before shipping Settings `notify` tab against prod)  
- `20261117120000`, `20261117140000`–`20261117180000` — R1 UI grants/casts/digest  
- `20261119120000` — Auto Expose OFF grants  

**Never** run fresh_install package on production.

---

## 4. Exact SQL proposed for production (Gate A menu)

### Option 0 — HOLD (recommended until product + backup)
Apply **nothing**. Keep current production DB + current Vercel Settings UI deployment.

### Option 1 — Additive repairs only
```
20261107120000_inv7a1_is_staff_encoding_repair.sql
20261107120100_inv7a1_staff_property_directory_repair.sql
20261117120000_r1_close_residence_status_catalog.sql
20261117140000_r1_ui_polls_announcements_grants.sql
20261117150000_r1_ui_cyrillic_role_literal_repair.sql
20261117160000_r1_ui_admin_list_property_book_floor_cast.sql
20261117170000_r1_ui_poll_votes_owner_select.sql
20261117180000_r1_dist_bootstrap_digest_extensions.sql
20261119120000_r1_auto_expose_off_api_grants.sql   # optional
```

### Option 2 — Notification Policy backend (for full Settings notify tab)
Option 1 plus:
```
20261116120000_eml3_notification_policy.sql
20261116130000_eml4_system_enqueue_authz.sql
20261116140000_eml5_cleaning_schedule_and_ticket_authz.sql
```

### Option 3 — Hide Meetings (explicit product approval required)
```
20261117130000_r1_mt_hide_general_meeting.sql
20261120120000_r1_module_catalog_implemented_parity.sql
```
**Effect:** disables Meetings. Does **not** enable Rental, Email Sending, or Debt Gate.

---

## 5. Dependency and compatibility analysis

| Topic | Analysis |
|-------|----------|
| Settings UI on production today | Works without EML-3 tables (deployed subset). Main-tree Settings `notify` tab expects Notification Policy RPCs → **needs Option 2 before merging main app**. |
| Meetings | Preserve unless Option 3 authorized |
| Finance / tariffs | Candidate migrations do not publish tariffs; Meetings hide does not rewrite ledgers |
| Auth / Storage | First Boot SQL not for brownfield; no Storage wipe in candidates |
| RLS/GRANT | Option 1/2 add grants/RPCs — review on clone before apply |
| Fresh-install only | is9a/is9b/is10d + package orderedFiles |

---

## 6. Backup verification

| Item | Status |
|------|--------|
| Fresh verified backup this cycle | **NOT VERIFIED — BLOCKER for any Gate A Option 1–3** |
| App rollback deployment | `dpl_8mmo6H6YSb6FMujhRXhVEkawBXNt` (pre–Settings UI) |
| Current app | `dpl_BjBZgNKerMXbYPT61kxBsRuQibVR` |

**Do not apply SQL until operator confirms a usable Supabase backup/PITR recovery point for `klowacuvufknbrkayjhz`.**

---

## 7. Risks and rollback

| Risk | Mitigation |
|------|------------|
| Accidental Meetings disable | Exclude Option 3 unless product signs off |
| Settings notify tab vs missing RPCs | Do not merge integration→main for production deploy until Option 2 applied (or notify tab feature-flagged) |
| Fresh-install DDL on brownfield | Refused |
| Auto Vercel production deploy | Push only to `integration/r1-github-consolidation`, not `main` |
| Rollback DB | Supabase backup restore; app rollback to prior deployment id |

---

## 8. Expected effects on Meetings and modules

| Module | If Option 0/1/2 | If Option 3 |
|--------|-----------------|-------------|
| Meetings | **Unchanged (enabled)** | **Disabled** |
| Rental | Remains disabled | Remains disabled |
| Internet/Cleaning/Inventory | Unchanged (already implemented on prod) | Parity upsert mostly no-op |
| Email Sending | Remains OFF | Remains OFF |
| Debt Gate | Not auto-enabled | Not auto-enabled |

---

## 9. Production application compatibility

| Surface | Status |
|---------|--------|
| Current production Settings UI | Compatible with current DB (no EML-3 required) |
| Integration branch full app | Requires Option 2 before safe production cutover of notify tab |
| RC7 TEST | Untouched; remains acceptance reference |

---

## 10. Recommendation

| Decision | Recommendation |
|----------|----------------|
| Git | **KEEP** on `integration/r1-github-consolidation`; **do not merge to main** yet |
| Production DB | **HOLD (Option 0)** until backup confirmed + product chooses Option 1/2/3 |
| Overall | **APPLY = NO** for database; **PUSH = YES** for integration branch only |

### Gate A — reply with one of
- `OPTION 0` hold  
- `OPTION 1` additive  
- `OPTION 2` + notification policy  
- `OPTION 3` + Meetings hide  

Plus: **backup confirmed for `klowacuvufknbrkayjhz`**.

### Merge to main — reply separately when ready
Only after DB compatibility path chosen and Vercel production deploy plan is explicit.

---

## 11. Tests run this cycle

Focused security/auth suites (prior + this consolidation): First Boot, OTP, JWT, module parity, Meetings hide, migration inventory — run before push (see CI/local log in session).

---

## 12. Pending tasks retained from RC7 browser audit

Tracked for follow-up on integration branch / later PRs (not blocking this Git push):
1. Hide `example_opening_roster` from admin Initial Setup  
2. Adapter↔catalog parity for `property_book` / `uk_expenses`  
3. Operator-facing copy (remove ALSYD/`building_modules` jargon)  
4. Ownership Transfer presence in Initial Setup inventory  
5. Install branding not hard-coded Sunny Beach  

---

## Production readiness

| Area | Status |
|------|--------|
| Source on GitHub (integration) | Ready after push |
| Production DB incremental path | Documented; **not applied** |
| Backup | **Blocker** until verified |
| Blind RC7 production deploy | **Forbidden** |
