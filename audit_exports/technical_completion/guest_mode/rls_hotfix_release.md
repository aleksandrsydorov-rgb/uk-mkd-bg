# AMADEUS 11 — Guest Mode · RLS Hotfix Safe Release

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main  
**Supabase:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Prior release:** `2445f15`  
**Hotfix migration:** `20261021130000_guest_mode_expire_recursion_fix.sql`  
**Method:** Commit already-applied migration + docs only — **no remigrate**

---

## Scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Migration history | **PASS** — local+remote `20261021120000` + `20261021130000`; `db push --dry-run` → up to date |
| 2 | Root-cause fixes confirmed | **YES** |
| 3 | Security regression | **PASS** |
| 4 | Property 110 expiration justified | **YES** |
| 5 | Commit / push | _(filled after push)_ |
| 6 | Vercel Ready | _(filled after deploy)_ |
| 7 | Tests / build | **PASS** — 172/172; tsc; build |
| 8 | Unrelated data unchanged | **YES** — props 22 / debt 920 / over 163.30; gates OFF; no guest mutations this release |
| 9 | Ready for final guest-session E2E | **YES** |

---

## Preflight

| Check | Result |
|-------|--------|
| `main` / `origin/main` before release | Both at `2445f15` |
| Migration exists locally | **YES** |
| Already applied remotely | **YES** (history row `20261021130000`) |
| Dry-run empty | **YES** — will not reapply |
| Destructive SQL | **PASS** — `CREATE OR REPLACE FUNCTION` only; no DROP TABLE / TRUNCATE / DELETE / data rewrite |
| App code changes required | **NO** — DB-only; app already compatible |

### SQL diff (exact intent)

1. **`trg_property_guest_accesses_enforce`** — remove `perform guest_access_expire_stale()`; keep NEW-row expiry + max-2 active check; `SECURITY DEFINER` + `search_path=''`.
2. **`owner_list_guest_accesses`** — remove `expire_stale` side effect (list stays `STABLE` / read-only safe); keep auth + `owns_property` gates; revoke anon / grant authenticated.

### Root causes fixed

| Bug | Fix verified on live DB |
|-----|-------------------------|
| Create `54001 stack depth exceeded` | Trigger body has **no** `perform public.guest_access_expire_stale` (comment-only mention remains) |
| List `25006` read-only UPDATE | List function has **no** expire/UPDATE; volatility `s` (STABLE) |

Expiry remains in `owner_create_guest_access` / revoke / explicit `guest_access_expire_stale()` — not in list or enforce trigger.

---

## Security regression (non-mutating)

| Control | Result |
|---------|--------|
| Trigger max-2 intact | **YES** |
| List / create require `owns_property` | **YES** |
| Revoke updates only rows where `owns_property(g.property_id)` | **YES** |
| DEFINER `search_path=''` on trg / list / create / revoke | **YES** |
| anon EXECUTE list/create/revoke | **denied** |
| authenticated EXECUTE list/create/revoke | **allowed** |
| Request/chat INSERT policies present; `((A)OR(B)) AND C` paren | **YES** |
| Unguarded list bypass (expire in STABLE RPC) | **removed** |

No guest create/list/revoke/invite executed in this release.

---

## Incident follow-up — property 110 (apt 99404)

Read-only verification only. **No reactivate / delete / modify.**

| Grant ID | Email | Status now | valid_until | Justification |
|----------|-------|------------|-------------|---------------|
| `5ae08f4c-a0e2-4222-af73-8f136c5d6516` | `zoomconf0001+test2@gmail.com` | **expired** | `2026-10-13T20:11:10.495+00:00` | **Legitimate.** Time-bounded grant; `valid_until` was already **before** `guest_access_expire_stale()` ran during multi-apt E2E (~2026-10-14). Helper correctly sets `active → expired` when `valid_until < now()`. |
| `2e3e1258-9904-4597-979e-e2ad3e10679a` | same | **revoked** | `2026-10-14T20:10:39.082+00:00` | Unchanged revoked historical row; not expired by the helper (`status` was not `active`). |

**Verdict:** property 110 expiration justified **YES**.

---

## Validation

| Command | Result |
|---------|--------|
| `npm test` | **172/172 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

---

## Release

| Field | Value |
|-------|--------|
| Staged | Migration `20261021130000` + this report only |
| Excluded | Unrelated audit_exports, phase_e2_3_d edits, fixtures, tmp, secrets |
| Remigrate | **NO** |

_(Commit hash, push, and Vercel ID completed in live release steps below.)_

---

## Postcheck (non-mutating)

| Check | Expected |
|-------|----------|
| Migration history sync | PASS |
| Gates | email_core_is_ready=false; ordinary_debt_gate_enabled=false |
| Finance fingerprint | n=22, debt=920.00, over=163.30 |
| No new guest mutations this release | YES |

---

## STOP

RLS hotfix Safe Release complete when push + Vercel Ready confirmed. Next track: guest-session E2E only (no remigrate).
