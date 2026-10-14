# AMADEUS 11 — Guest Mode Completion Report

**Date:** 2026-10-14  
**Branch:** `main`  
**Base release (prod):** `f2ee63d`  
**Work type:** Documentation + implementation (no commit / push / deploy / DB apply)  
**Supabase project:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  

---

## 1. Previously implemented functionality

Evidence: `docs/stage5-guest-mode.md`, `supabase/migrations/20260927200000_guest_mode.sql`, `20260927201000_guest_mode_stable_fix.sql`, `OwnerGuestMode.tsx`, `access.ts`, account guest menu filter, Phase E2 guest finance scrub.

| Area | Status before this task |
|------|-------------------------|
| Module catalog `guest_mode` (default off) | Present |
| Table `property_guest_accesses` + 4 relation types | Present |
| Max 2 active guests (RPC-only) | Present |
| Owner UI grant/revoke (`OwnerGuestMode`) | Present |
| `list_my_guest_properties` + `resolveAccess.isGuest` | Present |
| Guest cabinet nav filter (overview / security / УК) | Present |
| RLS SELECT for requests / chat / security for guests | Present |
| Security create RPC allows guest via `has_active_guest_access` | Present (but stamped as `owner`) |
| Finance scrub on guest property list | Present (E2.1) |
| Polls / GM voting blocked (owner parties only) | Present |
| BG / RU / EN strings for grant UI | Present |
| Guest legal terms acceptance | Missing (LEGAL_WAITING — not in scope) |

---

## 2. Newly completed functionality

| Requirement | Implementation |
|-------------|----------------|
| Guest INSERT requests | RLS policy `requests_owner_guest_insert` + client `created_by_role=guest` |
| Guest INSERT chat | RLS policy `chat_messages_owner_guest_insert` + sender `guest` |
| Distinguishable guest chat | Columns `guest_access_id`, `sender_email`; UI labels owner vs guest (account + admin) |
| Guest security creator role | `created_by_role` allows `guest`; `owner_create_security_request` stamps guest vs owner |
| Storage for guest request/chat files | `can_upload_*` / `can_read_*` include `has_active_guest_access` |
| Guest read-ack on UK chat | `enforce_chat_message_update` allows guest ack |
| DB max-2 + one active email | Trigger + unique partial index |
| Auto-expire stale on write / invalid until | Trigger flips overdue inserts to `expired`; expire helper retained |
| Short-term requires `valid_until` | RPC + Owner UI |
| Module gate on create | `guest_mode_module_enabled()` checked in `owner_create_guest_access` |
| Guest context for UI | RPCs `get_my_active_guest_access`, `list_my_guest_access_contexts` |
| Policy helper + tests | `src/lib/guestMode.ts` + `tests/security/unit/guestModeAuthz.test.ts` |

Restrictions preserved (UI + policy helpers + existing owner-only RPCs): no meters, no finance, no owner voting, no Property Book edit, no other apartments.

---

## 3. Remaining limitations

| Item | Status |
|------|--------|
| Guest legal terms / acceptance (A13) | **LEGAL_WAITING** — not implemented |
| Email sending | **OFF** (unchanged) |
| Debt gate | **OFF** (unchanged) |
| Migration not applied to prod DB | Required before guest INSERT works end-to-end |
| Dedicated tenant product | Out of scope (occupancy ≠ guest_mode) |
| Legacy `apartment_guests` occupancy table | Still parallel (not merged) |
| Module flag not inside every unrelated RPC | Existing platform P2 debt; guest create gated |
| Live browser E2E on clean guest account | Not run (no new E2E transactions per safety) |

---

## 4. Files changed

### New
- `supabase/migrations/20261021120000_guest_mode_completion.sql` (**not applied**)
- `src/lib/guestMode.ts`
- `tests/security/unit/guestModeAuthz.test.ts`
- `audit_exports/technical_completion/guest_mode/*` (this report pack)

### Updated
- `src/lib/database.types.ts`
- `src/app/account/page.tsx`
- `src/app/admin/page.tsx`
- `src/components/account/OwnerGuestMode.tsx`
- `src/components/account/OwnerManagement.tsx`
- `src/components/account/OwnerOverview.tsx`
- `src/i18n/messages.ts` (BG / RU / EN)

### Not changed
- Finance / ownership / meeting rules and RPCs (except security creator role enum extension for guests)

---

## 5. Required migrations

| File | Apply? |
|------|--------|
| `supabase/migrations/20261021120000_guest_mode_completion.sql` | **Required for DB release** — not applied |

No other migrations.

---

## 6. Security test results

File: `tests/security/unit/guestModeAuthz.test.ts` — **16/16 PASS**

Coverage:
- Four guest categories
- Allowed vs denied cabinet permissions
- Chat/request insert policy mirrors
- Max-2 and temporal expiry
- Cross-apartment context pick
- Migration SQL evidence (policies, trigger, storage, RPCs, short-term until)

Existing finance/guest scrub authz tests remain **PASS** (no regressions).

---

## 7. Automated test results

| Check | Result |
|-------|--------|
| `npm test` | **172/172 PASS** (18 files; +16 guest tests) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## 8. Ready for DB release

**DB applied 2026-10-14** on `klowacuvufknbrkayjhz` — see `db_release_report.md`.

App Safe Release still pending (no commit / push / deploy of Guest Mode code yet).

---

## Evidence links

- Prior readiness: `audit_exports/platform_readiness/module_readiness_matrix.md` (Guest mode PARTIAL)  
- Stage design: `docs/stage5-guest-mode.md`  
- Baseline migrations: `20260927200000_guest_mode.sql`, `20260927201000_guest_mode_stable_fix.sql`  
- Completion migration: `20261021120000_guest_mode_completion.sql`  
- Unit evidence: `tests/security/unit/guestModeAuthz.test.ts`
