# AMADEUS 11 — Guest Chat 42501 Fix

**Date:** 2026-10-14  
**Production:** https://amadeus11.online  
**Supabase:** `klowacuvufknbrkayjhz`  
**Released commit (pre-fix):** `1f58ecc`  
**Scope:** Guest chat INSERT authorization only  
**DB apply:** **NOT applied** (ready for release)

---

## 1. Exact root cause

Guest chat INSERT uses RLS policy `chat_messages_owner_guest_insert` (from `20261021120000_guest_mode_completion.sql`).

For guest rows the WITH CHECK required:

```sql
EXISTS (
  SELECT 1
  FROM public.property_guest_accesses AS g
  WHERE g.id = guest_access_id
    AND g.property_id = property_id
    …
)
```

`property_guest_accesses` has **no SELECT grant** for `authenticated` (by design — assignments are exposed only via SECURITY DEFINER RPCs). PostgreSQL evaluates policy subqueries as the invoking role, so the EXISTS fails with:

| Code | Message |
|------|---------|
| `42501` | `permission denied for table property_guest_accesses` |
| Hint | `GRANT SELECT ON public.property_guest_accesses TO authenticated` |

`has_active_guest_access(property_id)` already works (SECURITY DEFINER). Guest **requests** succeeded because that policy does not inline-scan the table. Chat failed only on the attribution EXISTS.

Observed in Final Guest Session E2E: POST `/rest/v1/chat_messages` → 403 / 42501; UI «Ошибка отправки сообщения».

---

## 2. Fix implemented

**YES**

Smallest safe change: add narrow SECURITY DEFINER helper and rewrite the chat insert policy to call it. **No** `GRANT SELECT` on `property_guest_accesses`.

### Helper

`public.guest_access_matches_caller(p_access_id uuid, p_property_id bigint) → boolean`

- `STABLE` + `SECURITY DEFINER` + `search_path = ''`
- Returns true only when the access row matches **(id, property_id, auth.email())**, status `active`, and temporal window
- `EXECUTE` granted to `authenticated` only
- Does **not** return assignment rows

### Policy

`chat_messages_owner_guest_insert` guest branch now:

```sql
public.has_active_guest_access(property_id)
AND sender = 'guest'
AND guest_access_id IS NOT NULL
AND public.guest_access_matches_caller(guest_access_id, property_id)
```

Owner branch unchanged (`owns_property` + `sender = 'owner'` + `guest_access_id is null`). Admin UK insert policy untouched.

### Privileges

Migration **re-revokes** ALL on `property_guest_accesses` from `public` / `anon` / `authenticated`. No UPDATE/DELETE/SELECT grants added.

### Recursion / list safety

Migration does **not** modify:

- `trg_property_guest_accesses_enforce`
- `guest_access_expire_stale`
- `owner_list_guest_accesses`

Prior hotfix `20261021130000` remains authoritative for stack-depth / read-only UPDATE issues.

### App mirror

`src/lib/guestMode.ts`: `guestAccessMatchesCaller()` + optional `accessMatchesCaller` on `canGuestInsertChat()`.

---

## 3. Migration filename

`supabase/migrations/20261021140000_guest_chat_access_match_fix.sql`

---

## 4. RLS security

**PASS** (design / static review)

| Check | Result |
|-------|--------|
| No table SELECT for authenticated | **PASS** — revoke reaffirmed |
| Guest attribution still bound to access id + property + email | **PASS** — via definer helper |
| Cross-apartment mismatch denied (108 access ≠ 109 write) | **PASS** — helper requires `g.property_id = p_property_id` |
| Unauthorized property 110 | **PASS** — no matching active access → false |
| Owner / admin insert paths preserved | **PASS** |
| Policy recursion / expire_stale reintroduced | **PASS** — not touched |
| Broad assignment disclosure | **PASS** — boolean helper only |

Live DB verification deferred until migration apply + guest chat re-probe.

---

## 5. Regression tests

**PASS**

File: `tests/security/unit/guestModeAuthz.test.ts` — new block «chat 42501 access-match fix»:

- Guest chat property **108** match + insert allow
- Guest chat property **109** match + insert allow
- Unauthorized property **110** deny
- Cross-apartment isolation (108 access on 109 / reverse) deny
- Owner insert compatibility
- No policy-direct table scan; EXECUTE-only helper grant
- No redefinition of expire trigger / list RPC; expire hotfix still documented

Validation:

| Gate | Result |
|------|--------|
| `npm test` | **PASS** — 180 tests (24 in guestModeAuthz) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 6. Existing data unchanged

**YES**

- Migration is DDL only (function + policy + REVOKE)
- No DML on grants, requests, chat, finance, or properties
- Migration **not applied** to linked DB in this run

---

## 7. Ready for DB release

**YES**

Next release step (out of scope here): apply `20261021140000` to linked Supabase, then re-probe guest chat on 108 and 109 as `zoomconf0001+test2@gmail.com`.

---

## Return summary

| Item | Value |
|------|--------|
| Exact root cause | Chat insert RLS EXISTS on `property_guest_accesses` without SELECT for `authenticated` → 42501 |
| Fix implemented | **YES** |
| Migration filename | `20261021140000_guest_chat_access_match_fix.sql` |
| RLS security | **PASS** |
| Regression tests | **PASS** |
| Existing data unchanged | **YES** |
| Ready for DB release | **YES** |

## STOP

Implementation + report complete. No DB apply, commit, push, or deploy.
