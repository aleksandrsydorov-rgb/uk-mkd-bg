# AMADEUS 11 — Migration & update procedure (R1.0 / R1-DIST-3)

App containers **do not** run SQL migrations on boot.

## Fresh install (summary)

See `R1_DIST_CLEAN_INSTALL.md`: empty Supabase project → fresh_install package (`MANIFEST.json` order) → chronological `supabase/migrations` → first-admin bootstrap → start app image.

## Upgrade workflow (existing complex)

1. **Obtain** newer application image tag (record immutable digest).
2. **Backup** Postgres + Storage object manifest (`R1_DIST_BACKUP_RESTORE.md`). Record SHA-256 and row-count baseline.
3. **Apply versioned migrations** from the matching release tag only if new files exist in `supabase/migrations/`:
   - `npx supabase migration up` against the target project, **or**
   - apply new `supabase/migrations/*.sql` in filename order with `ON_ERROR_STOP=1`.
4. If **no new migrations** exist between tags, perform an **application-only** upgrade (replace image, restart). Document that schema-migration upgrade was `NOT_APPLICABLE`.
5. **Start** the updated application container.
6. **Verify** `/api/health`, login, module smoke, financial/ownership totals, Storage downloads.

### Simulated additive upgrade (test-only)

R1-DIST-3 proved a **TEST-ONLY** additive migration outside the canonical package (`tmp/r1dist3_test_migrations/`). That exercise is **simulated migration-upgrade acceptance**, not proof that every future canonical migration is safe. Never commit test-only schemas into `supabase/migrations/`.

## Failed upgrade detection

| Symptom | Operator action |
|---------|-----------------|
| Health `degraded` / `supabase_reachable=false` / HTTP 503 | Fix connectivity; do not re-run financial jobs |
| `psql` / migration exit ≠ 0 with `ON_ERROR_STOP` | Stop upgrade; keep pre-upgrade dump intact |
| App starts but schema expectations fail | Do not “fix forward” blindly — restore dump if incompatible |
| Docker image rollback alone | **Insufficient** if migrations already applied |

## Rollback procedure

1. Stop upgraded app container.
2. Restore **pre-upgrade** Postgres dump into a compatible Supabase target (or replace DB from verified backup).
3. Restore Storage bytes from manifest; verify SHA-256.
4. Start the **previous** application image.
5. Confirm login, counts, and health.

No automatic remote updates. No ALSYD CONTROL in R1.0.

## Rules

- One Supabase project per complex; one app container.
- Never auto-push to cloud from developer workstations.
- Never enable Meetings/Rental, Debt Gate, or Email sending as part of a routine image update unless release notes require it.
- Rolling back an image does **not** reverse migrations — restore a verified pre-upgrade dump instead.
- Prefer additive, idempotent migrations; never ship destructive down-migrations as the recovery path.

## Health & smoke

```bash
curl -fsS http://127.0.0.1:<port>/api/health
# Expect: ok, email_sending_enabled=false, supabase_reachable=true
```

Login as installation administrator; confirm Meetings/Rental absent; spot-check BG/RU/EN.

## Operator checklist (future VPS + new empty Supabase)

1. Provision VPS + empty managed Supabase (PG 17-compatible).
2. Apply fresh_install + migrations per `R1_DIST_CLEAN_INSTALL.md`.
3. Bootstrap first admin; complete Initial Setup (no sample customer data from ALSYD).
4. Configure app env; run single container; verify health.
5. Establish backup schedule (DB dump + Storage manifest) before first go-live data entry.
6. For upgrades: backup → migrate (if any) → new image → verify; on failure restore dump + prior image.
