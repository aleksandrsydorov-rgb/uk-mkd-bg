# AMADEUS 11 — Phase IS-1 · Database Release

**Date:** 2026-10-14  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261022120000_initial_setup_module_core.sql`  
**App commit / push / deploy:** none (DB release only)

---

## Verdict

| # | Item | Result |
|---|------|--------|
| 1 | Migration applied | **YES** |
| 2 | Migration history synchronized | **YES** |
| 3 | RLS / security checks | **PASS** |
| 4 | Existing module states unchanged | **YES** |
| 5 | Existing business data unchanged | **YES** |
| 6 | Tests / build | **PASS** |
| 7 | Ready for Safe Release | **YES** |

---

## Preflight

| Check | Result |
|-------|--------|
| Correct linked project | **PASS** — `klowacuvufknbrkayjhz` linked; other projects not linked |
| Migration history | **PASS** — remote through `20261021140000`; only `20261022120000` pending |
| Dry-run (pre) | **PASS** — would push only `20261022120000_initial_setup_module_core.sql` |
| No destructive SQL | **PASS** — no DROP TABLE / TRUNCATE / DELETE of business data; no UPDATE of `building_modules.enabled` |
| Compatible with module gates | **PASS** — adjacent to `building_modules` / `module_catalog`; seed mirrors enabled → ACTIVE / else DISABLED without mutating toggles |
| No auto-change of module UX toggles | **PASS** — seed `on conflict do nothing`; transitions explicitly do not update `building_modules` |
| Lifecycle transitions require admin | **PASS** — `admin_assert_module_setup()` → `has_staff_role('администрация')`; assert not granted EXECUTE to authenticated |
| Setup / import isolated by installation | **PASS** — FKs + unique keys on `(installation_id, module_key)`; RPCs resolve `installation_key = 'default'` |
| Import preview does not write business data | **PASS** — `admin_create_module_import_batch` inserts status `'preview'` into `module_import_batches` only |
| Import commit cannot bypass module validation | **PASS** — `admin_commit_module_import_batch` only flips batch metadata (`preview` → `committed`); no properties / ledger / owner DML |
| RLS / SECURITY DEFINER / search_path / grants | **PASS** (see Postcheck) |
| No unrelated migrations | **PASS** — dry-run and apply listed only IS-1 |

### Compatibility fix before apply

First `db push` failed: existing Support Module table `platform_installations` (from `20261008010000`) lacks `installation_key` / `display_name`, so `CREATE TABLE IF NOT EXISTS` was a no-op and the unique index failed.

Migration updated to **extend** the existing singleton row (ADD COLUMN + backfill `installation_key='default'`) without creating a second installation or rewriting Support FKs (`installation_id`, `deployment_id`, etc.). No business data touched. Re-push succeeded.

**STOP gate:** no critical security failure → proceed.

---

## Apply

```
Applying migration 20261022120000_initial_setup_module_core.sql...
Finished supabase db push.
```

Only this migration was applied. Post dry-run: **Remote database is up to date.**

Local = remote for `20261022120000`.

---

## Postcheck

### Schema

| Object | Present |
|--------|---------|
| `module_lifecycle` | yes |
| `module_lifecycle_audit` | yes |
| `module_setup_progress` | yes |
| `module_import_batches` | yes |
| `module_opening_data_meta` | yes |
| `platform_installations.installation_key` | `default` (existing Support row extended) |
| Lifecycle seed | 27 rows — ACTIVE 19 / DISABLED 8 (matches `building_modules.enabled`) |
| Import batches | 0 (committed 0) |
| Setup progress / opening meta / audit | 0 / 0 / 0 |

### Security

| Check | Result |
|-------|--------|
| RLS enabled on all IS-1 tables + `platform_installations` | **PASS** |
| Table grants to `authenticated` / `anon` / PUBLIC | **none** |
| Admin RPCs `SECURITY DEFINER` + `search_path=''` | **PASS** |
| `admin_assert_module_setup` EXECUTE for authenticated | **revoked** (callable only inside DEFINER chain) |
| Admin RPCs EXECUTE → authenticated; anon denied | **PASS** |
| Transition does not `UPDATE building_modules` | **PASS** |
| Create batch status is preview-only | **PASS** |
| Commit RPC does not write business tables | **PASS** |

### Data unchanged (pre → post)

| Metric | Pre | Post |
|--------|-----|------|
| `building_modules` n / enabled | 27 / 19 | 27 / 19 |
| `building_modules` fingerprint | `e7aeb778f1bbe55ae4692e514b679403` | `e7aeb778f1bbe55ae4692e514b679403` |
| properties | 22 | 22 |
| debt / overpayment | 920.00 / 163.30 | 920.00 / 163.30 |
| property_book_extracts | 4 | 4 |
| property_guest_accesses | 9 | 9 |
| chat_messages | 16 | 16 |
| requests | 7 | 7 |
| general_meetings | 6 | 6 |
| import batches committed | n/a | **0** |

### Gates

| Gate | Value |
|------|-------|
| `email_core_is_ready()` | **false** (OFF) |
| `ordinary_debt_gate_enabled` | **false** (OFF) |

No modules activated or configured beyond lifecycle seed mirroring existing UX toggles. No historical import. No finance transactions.

---

## Validation

| Command | Result |
|---------|--------|
| `npm test` | **PASS** — 19 files, 194 tests |
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** — Next.js 16.3.2 compiled |

---

## Explicit non-actions

- No new Supabase project  
- No DB reset / clean  
- No change to `building_modules.enabled`  
- No historical data import / no committed import batches  
- No financial transactions; no apartment/owner mutations  
- Email Core sending and debt gate left OFF  
- No unrelated migrations  
- No git commit, push, or Vercel deploy  

---

## Ready for Safe Release

**YES** — schema installed, history synced, security PASS, business data and module UX gates unchanged, gates OFF, tests/build PASS. Next step is app Safe Release (out of scope for this DB release).
