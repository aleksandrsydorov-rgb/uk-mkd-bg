# AMADEUS 11 — Backup & restore (R1.0 / R1-DIST-3)

Distinguishes **Postgres logical backup** from **Supabase Storage** object backup.  
Never restore over production, cloud, or the preserved `amadeus11-is10a-local` development database without an explicit window.

## Version compatibility

| Component | Required for R1.0 local proof |
|-----------|-------------------------------|
| PostgreSQL major | **17** (local Supabase `major_version = 17`; verified **17.11**) |
| Target for recovery proof | **Full local Supabase project** (Auth + Storage + Kong), not bare Postgres |
| App image | Single container `amadeus11-app:<tag>` (standalone Next.js) |

Bare PostgreSQL restore remains insufficient as proof of Supabase recovery: dumps reference roles (`supabase_*`, `pgbouncer`, `dashboard_user`) and extensions (`supabase_vault`) that only exist in a Supabase stack.

## Safety assert (before any destructive command)

Print and verify:

1. Docker / Supabase **project_id** (must be disposable).
2. Database host/port (localhost only).
3. API endpoint (localhost only).
4. Target DB container name.

Reject ambiguous destinations. Forbidden: cloud refs, Vercel, VPS, shared DBs.

## 1. PostgreSQL backup (logical)

Record before backup: Postgres version, migration count (`supabase_migrations.schema_migrations`), timestamp, dump SHA-256.

```bash
docker exec -t <db_container> pg_dump -U postgres -d postgres -Fc -f /tmp/amadeus11.dump
docker cp <db_container>:/tmp/amadeus11.dump ./backups/amadeus11-$(date +%Y%m%d).dump
sha256sum ./backups/amadeus11-*.dump
```

## 2. PostgreSQL restore (Supabase-compatible)

1. Start a **new empty disposable** local Supabase project (same PG major).
2. Copy dump into the DB container.
3. Restore:

```bash
pg_restore --clean --if-exists --no-owner -U postgres -d postgres /tmp/amadeus11.dump
```

4. Expect **non-zero exit** when overlaying a full dump onto an already-initialized Supabase: ownership/grant conflicts on `auth` / `storage` / `realtime`, event-trigger ownership, and duplicate catalog objects are common.
5. **Do not** treat exit code alone as failure. Verify application state:

- Business row counts (`properties`, `property_registry_people`, …)
- `auth.users` present; password login / admin reset if sessions were not restored
- RLS enabled on key tables
- Functions / grants used by the app
- Migration history count unchanged unless you intentionally applied new migrations
- Module registry flags (Email OFF, Meetings/Rental OFF)

6. Reset operator passwords via Auth Admin API if needed after restore (sessions/refresh tokens often do not survive cleanly).

### Known restore warnings (local overlay)

| Class | Effect on app recovery |
|-------|------------------------|
| Grant/owner errors on Auth/Storage system tables | Usually non-blocking if row data landed |
| Cannot drop extensions / `_realtime` | Non-blocking on live Supabase |
| Duplicate `schema_migrations` | Non-blocking if count matches source |
| Orphan `storage.objects` metadata without bytes | **Blocking for files** — restore Storage bytes separately |

Production-equivalent recovery on **managed Supabase** should use the vendor backup/PITR tooling; local `pg_restore` proves disposable disaster recovery, not cloud PITR equivalence.

## 3. Storage backup (object bytes)

`pg_dump` does **not** include Storage object bytes.

1. List private buckets (`inventory-documents`, `chat-files`, `uk-expense-receipts`, …).
2. Download each object with **service_role** (or signed URL).
3. Persist a manifest: `bucket`, `path`, `sha256`, `bytes`.
4. Optionally snapshot Docker volume `supabase_storage_<project>` (layout is implementation-specific).

## 4. Storage restore

1. Recreate buckets / policies on the target project (or rely on restored metadata).
2. If DB restore left orphan object rows without files: **delete via Storage API**, then upload bytes (upsert).
3. Verify SHA-256 of downloaded restored objects equals the pre-backup manifest.
4. Confirm unauthorized (anon / invalid JWT) GET is denied; authorized path via **service_role** or **signed URL**.

A database-only restore does **not** qualify as full recovery.

## 5. Recovery order (failed upgrade / disaster)

1. Stop the unhealthy application container.
2. Keep the last verified dump + Storage manifest **intact** (checksum).
3. Restore Postgres into a **compatible** full Supabase environment (same major PG + matching migrations).
4. Restore Storage object bytes; verify checksums.
5. Start the **compatible** application image tag (previous tag if schema was rolled back via dump).
6. Health + login smoke; financial/ownership counts vs pre-upgrade baseline.

**Image rollback does not reverse migrations.** If schema compatibility is broken, restore the verified pre-upgrade database (and Storage) before starting the older image. Do **not** invent SQL down-migrations.

## 6. Post-recovery checklist

- [ ] `/api/health` → `ok`, `supabase_reachable=true`, `email_sending_enabled=false`
- [ ] Admin/owner login works
- [ ] Property / ownership counts match baseline
- [ ] Private Storage download works; anon denied
- [ ] Meetings / Rental remain disabled; Debt Gate OFF
- [ ] No unexpected financial writes during recovery

ALSYD CONTROL remote orchestration is **out of scope** for R1.0.
