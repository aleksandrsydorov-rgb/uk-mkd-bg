# AMADEUS 11 — Guest Mode · Database Release

**Date:** 2026-10-14  
**Supabase:** `klowacuvufknbrkayjhz` (linked · MKD AMADUES 11)  
**Migration:** `20261021120000_guest_mode_completion.sql`  
**Method:** `npx supabase db push --linked --yes`  
**App commit:** not created (no commit / push / deploy)

---

## Preflight

| Check | Result |
|-------|--------|
| Linked project | **PASS** — `klowacuvufknbrkayjhz` (not Velvet / ALSYD / bulgarian-platform) |
| Migration history | Remote through `20261020120000`; local pending only `20261021120000` |
| Dry-run | Would push **only** `20261021120000_guest_mode_completion.sql` |
| Destructive SQL | **PASS** — no DROP TABLE / TRUNCATE / DELETE / data rewrite |
| Unique-index blockers | **PASS** — no duplicate active (property, email) |
| Over max-2 active | **PASS** — none |
| Security role values | **PASS** — only `owner` present; safe to extend chk to include `guest` |
| Existing guests | 2 rows (1 active, 1 revoked); fingerprint `c1ec5bd3e248dbd9e585a57c12200c7c` |
| Email / debt gate | **OFF** / **OFF** (`email_core_is_ready=false`, `ordinary_debt_gate_enabled=false`) |

### Preflight fix before apply

RLS `WITH CHECK` operator precedence for request/chat INSERT was corrected so status / `read_by_uk` gates apply to **both** owner and guest branches (`((A) OR (B)) AND C`). Applied file includes this fix.

### Authz review (migration text)

| Concern | Verdict |
|---------|---------|
| Max-2 + uniqueness | DB trigger + unique partial index |
| Expiry / revoke | `has_active_guest_access` date+status; expire helper; revoke RPC unchanged |
| Guest INSERT scoped | `has_active_guest_access(property_id)` + access_id/email match |
| Finance / meters / voting / Book | Unchanged owner-only RPCs; guest finance scrub intact; `cast_poll_vote` owner-only |
| SECURITY DEFINER | `search_path=''`; EXECUTE to `authenticated` only (anon denied) |
| Module gate | `guest_mode_module_enabled()` in `owner_create_guest_access` |

**Preflight decision:** proceed.

---

## Apply

```
Applying migration 20261021120000_guest_mode_completion.sql...
Finished supabase db push.
```

Post dry-run: **Remote database is up to date.**

---

## Baseline → postcheck (unchanged business data)

| Metric | Pre | Post |
|--------|-----|------|
| guest fingerprint | `c1ec5bd3…` | `c1ec5bd3…` |
| guests total / active / revoked | 2 / 1 / 1 | 2 / 1 / 1 |
| properties n / debt / over | 22 / 920.00 / 163.30 | 22 / 920.00 / 163.30 |
| SF assessments n / rem | 3 / 920.00 | 3 / 920.00 |
| SF ledger n / amt | 13 / 2204.50 | 13 / 2204.50 |
| book people | 46 | 46 |
| meetings | 6 | 6 |
| email_core_ready | false | false |
| ordinary_debt_gate_enabled | false | false |

---

## Object / security verification

| Object | Present |
|--------|---------|
| Columns `chat_messages.guest_access_id`, `sender_email` | YES |
| Columns `requests.created_by_role`, `created_by_email` | YES |
| Index `property_guest_accesses_one_active_email_uidx` | YES |
| Trigger `property_guest_accesses_enforce_biu` | YES |
| Policies `requests_owner_guest_insert`, `chat_messages_owner_guest_insert`, `chat_messages_admin_insert` | YES |
| RPCs `guest_mode_module_enabled`, `get_my_active_guest_access`, `list_my_guest_access_contexts` | YES |
| History `20261020120000` + `20261021120000` | YES |

| Grant / source check | Result |
|----------------------|--------|
| anon EXECUTE on new guest RPCs / create | **denied** |
| authenticated EXECUTE | **allowed** |
| Module gate + short-term until in create RPC | YES |
| `has_active_guest_access` checks `valid_until` | YES |
| Security create stamps `guest` role | YES |
| Guest finance scrub on `list_my_guest_properties` | YES |
| Poll vote owner-only | YES |
| Security role CHECK includes guest | YES |

No guests created, no invites sent, no guest assignment mutations, no finance writes.

---

## Application regression

| Check | Result |
|-------|--------|
| `npm test` | **172/172 PASS** |
| `npx tsc --noEmit` / build TypeScript | **PASS** |
| `npm run build` | **PASS** |

---

## Scorecard

| Item | Result |
|------|--------|
| Migration applied | **YES** |
| Migration history synchronized | **YES** |
| Guest security checks | **PASS** |
| Existing data unchanged | **YES** |
| Regression tests | **PASS** |
| Ready for Safe Release | **YES** (app commit/push/deploy of Guest Mode code next; no further DB migration for this track) |

## Not done

- No commit / push / app deploy  
- No guest creation / invite / E2E writes  
- Email sending and debt gate remain **OFF**
