# Email Core Phase B — Database Release

**Project:** `klowacuvufknbrkayjhz`  
**Migration:** `20261013130000_email_core_phase_b.sql`  
**Applied:** 2026-10-13  

## Preflight: PASS

| Check | Result |
|-------|--------|
| Project ID | `klowacuvufknbrkayjhz` |
| Phase A present | YES |
| Only pending migration | `20261013130000` |
| Destructive SQL | None |
| Worker RPCs service_role + `search_path=''` | YES |
| SQL auto-send | None |
| `EMAIL_SENDING_ENABLED` host | not enabled |

Method: `db query -f` exact file + `migration repair --status applied` (not bulk `db push`).

## Post-apply

| Metric | Before | After |
|--------|-------:|------:|
| properties | 20 | 20 |
| owner_transfers | 19 | 19 |
| book people | 46 | 46 |
| email_enabled | false | false |
| outbox sent | 0 | 0 |
| is_ready | false | false |

| Gate | Value |
|------|-------|
| claim/complete/event/context RPCs | present |
| client DML grants on email tables | 0 |
| worker RPC grants to anon/authenticated | 0 |
| RLS on email tables | ON |
| history local=remote `20261013130000` | YES |

## Return checklist

- Migration applied: **YES**
- Security verification: **PASS**
- Migration history synced: **YES**
- Business data unchanged: **YES**
- Emails sent: **0**
- Ready for sender setup: **YES** (ops: seed verified domain/sender; keep `EMAIL_SENDING_ENABLED=false` until controlled test)
