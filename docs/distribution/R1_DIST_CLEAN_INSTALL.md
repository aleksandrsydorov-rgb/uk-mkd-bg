# AMADEUS 11 — Clean installation (Distribution R1.0)

**Scope:** Empty Supabase project per complex. App is a separate Docker image.
**Never** apply these steps to production cloud without an explicit release gate.
**Never** destroy an existing development database to “prove” clean install.

## Prerequisites

- Empty PostgreSQL 17 database (local disposable or new Supabase project)
- Extension capability for `pgcrypto`
- Repository checkout containing:
  - `supabase/packages/fresh_install/` (MANIFEST order)
  - `supabase/migrations/` (chronological)

## Ordered procedure

1. **Confirm empty** — no business tables populated (`properties` / `staff` rows = 0 if present); `supabase_migrations.schema_migrations` absent or 0 rows.
2. **Apply package** — every file in `MANIFEST.json` → `orderedFiles`, in order, via `psql -v ON_ERROR_STOP=1`.
3. **Apply migrations** — apply **all** `supabase/migrations/*.sql` in **filename order** with `ON_ERROR_STOP=1` **or** `npx supabase migration up` against that empty DB.
   - Operator inventory (local, no DB writes): `node scripts/r1-migration-inventory.mjs`
   - RC8 expected count: `MANIFEST.expectedChronologicalMigrationCount` (**140**; must equal disk file count).
   - Portable VPS/empty-project installer: `docs/distribution/R1_DIST_RC8_DB_INSTALL.md` / `scripts/r1-rc8-db-install.mjs`.
4. **Verify migration history** — after a successful apply only:
   - `schema_migrations` row count **must equal** `expectedChronologicalMigrationCount`.
   - Every version from `node scripts/r1-migration-inventory.mjs` must be present.
   - **Never** insert history rows for SQL that was not applied. Incomplete history after a successful SQL apply is a **FAIL** for clean-install acceptance.
5. **Do not** publish tariffs, enable Debt Gate, enable Email sending, or activate Meetings/Rental.
6. **Auth SMTP preflight** — configure Supabase Auth custom SMTP (cloud) or confirm local Inbucket/Mailpit. Run `smtp-preflight` before First Boot. Missing SMTP is an **installation blocker** (`AUTH_SMTP_BLOCKER`); there is no manual invitation-file fallback. See `R1_DIST_FIRST_BOOT.md`.
7. **First admin** — use the installer CLI (no Dashboard Auth table edits):
   See `R1_DIST_FIRST_BOOT.md` (`scripts/r1-first-boot.ps1` / `scripts/r1-first-boot.mjs`).
   Flow: SMTP preflight → provision Email → Auth SMTP invitation Email → `/auth/first-admin` password + claim → Initial Setup.
   Installer refuses when `--base-url` serves a mismatched Auth host (e.g. obsolete local Docker on `:3080`). Invitation URLs are never printed or written to disk.
8. **Start app container** with that project’s URL/anon key (**rebuild image** when `NEXT_PUBLIC_*` change — public values are build-time). Align Auth Site URL + redirect allow list with the same origin (`http://127.0.0.1:…` local, `https://…` production).
9. Complete Initial Setup in admin UI (lifecycle for included modules). Meetings/Rental stay excluded.

## Explicit non-goals

| Must not happen on clean install | Control |
|----------------------------------|---------|
| Sample residents / payments | Package has no business seeds |
| Auto-published financial tariffs | Tariffs UI only; cutover neutralized |
| Auto charges | No boot-time charge jobs |
| External email | `EMAIL_SENDING_ENABLED=false`, DB `email_enabled=false` |
| Debt Gate ON | Remain OFF |
| Meetings / Rental active | `implemented=false` + disabled |

## Local RC disposable proof

Use a **separate** Postgres container (example port `54432`) so `amadeus11-is10a-local` is untouched:

```powershell
# See scripts/r1dist1-clean-install-disposable.ps1
```

Evidence belongs in `audit_exports/technical_completion/release_1/`.
