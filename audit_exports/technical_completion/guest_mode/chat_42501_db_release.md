# AMADEUS 11 — Guest Chat 42501 · Database Release

**Date:** 2026-10-14  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz` (linked: **MKD AMADUES 11**)  
**Migration:** `20261021140000_guest_chat_access_match_fix.sql`  
**App commit:** unchanged (no commit/push/deploy)

---

## Preflight

| Check | Result |
|-------|--------|
| Correct linked project | **PASS** — `klowacuvufknbrkayjhz` linked; other projects not linked |
| Migration history | **PASS** — remote through `20261021130000`; only `20261021140000` pending |
| Dry-run | **PASS** — would push only `20261021140000_guest_chat_access_match_fix.sql` |
| Helper identity check | **PASS** — uses `auth.email()` (guest rows are email-keyed; same as `has_active_guest_access`). Not `auth.uid()` — table has no user_id column |
| Active + property + validity | **PASS** — `status = 'active'`, `g.property_id = p_property_id`, `valid_from` / `valid_until` window |
| `search_path` / schema-qualified | **PASS** — `set search_path = ''`; `public.property_guest_accesses` |
| EXECUTE restricted | **PASS** — revoke public/anon; grant authenticated only |
| No broad SELECT on assignments | **PASS** — revoke ALL on table from public/anon/authenticated |
| Chat INSERT uses helper | **PASS** — policy WITH CHECK calls `guest_access_matches_caller` |
| No recursion / read-only UPDATE | **PASS** — no touch of expire_stale / enforce trigger / owner_list |
| Cross-apt / expired deny (design) | **PASS** — helper requires matching active row for (access_id, property_id, email) |
| No finance / destructive DML | **PASS** — DDL only (function + policy + REVOKE) |

**STOP gate:** no critical security failure → proceed.

---

## Apply

```
Applying migration 20261021140000_guest_chat_access_match_fix.sql...
Finished supabase db push.
```

Only this migration was applied. No unrelated migrations.

---

## Postcheck

### Helper

| Field | Value |
|-------|--------|
| Signature | `guest_access_matches_caller(p_access_id uuid, p_property_id bigint)` |
| SECURITY DEFINER | true |
| Volatility | STABLE (`s`) |
| Config | `search_path=""` |
| Body checks | auth.email, active status, property_id, validity |

### Permissions

| Object | authenticated | anon / PUBLIC |
|--------|---------------|---------------|
| `guest_access_matches_caller` | EXECUTE | none |
| `property_guest_accesses` table | **no grants** | **no grants** |

### Chat INSERT policy

`chat_messages_owner_guest_insert` WITH CHECK includes:

`guest_access_matches_caller(guest_access_id, property_id)`

Owner path (`owns_property` + `sender = 'owner'` + `guest_access_id is null`) preserved.

### Data unchanged (pre → post)

| Metric | Pre | Post |
|--------|-----|------|
| guest_accesses | 9 | 9 |
| chat_messages | 14 | 14 |
| chat 108 / 109 | 0 / 0 | 0 / 0 |
| requests | 7 | 7 |
| properties | 22 | 22 |
| debt / over | 920.00 / 163.30 | 920.00 / 163.30 |
| test2 108 active | `403d84f6…` | `403d84f6…` |
| test2 109 active | `989265fe…` | `989265fe…` |
| test2 108 expired | `a21f07bb…` | `a21f07bb…` |

Finance / Property Book / Meeting: no writes; property finance totals unchanged.

### Gates

| Gate | Value |
|------|--------|
| `email_core_is_ready()` | **false** (OFF) |
| `ordinary_debt_gate_enabled` | **false** (OFF) |

### Migration sync

| Check | Result |
|-------|--------|
| `schema_migrations` has `20261021140000` | **YES** |
| `migration list` local=remote for `20261021140000` | **YES** |
| `db push --dry-run` | **Remote database is up to date** |

### Regression gates

| Gate | Result |
|------|--------|
| `npm test` | **PASS** — 180/180 |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## Out of scope (per instructions)

- No guest chat messages sent  
- No create/revoke guest assignments  
- No commit / push / deploy  
- Guest Mode E2E not restarted  

---

## Return summary

| Item | Value |
|------|--------|
| Migration applied | **YES** |
| Migration history synchronized | **YES** |
| Helper permissions | **PASS** |
| Chat RLS checks | **PASS** |
| Existing data unchanged | **YES** |
| Tests/build | **PASS** |
| Ready for Safe Release | **YES** |

## STOP

DB release complete. Next step (separate run): Safe Release / guest chat re-probe.
