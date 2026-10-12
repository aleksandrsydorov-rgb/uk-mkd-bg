# Email Core Phase A — Database Release

**Project:** `klowacuvufknbrkayjhz` (MKD AMADUES 11)  
**Migration:** `20261012120000_email_core_phase_a.sql`  
**Applied:** 2026-10-12  

## Preflight: PASS

| Check | Result |
|-------|--------|
| Project ID | `klowacuvufknbrkayjhz` linked |
| Destructive SQL (DROP TABLE / TRUNCATE / business DELETE) | None |
| Table name conflicts | None (tables absent before apply) |
| Pending remote gap | Only this migration |
| `email_enabled` default | `false` |
| `EMAIL_SENDING_ENABLED` host env | Not enabled |
| Live send path | `email_core_is_ready()` hard-false; no worker |

Method: applied exact SQL file via `supabase db query --linked -f …`, then `migration repair --status applied 20261012120000` (not bulk `db push`).

## Post-apply verification

| Metric | Before | After |
|--------|-------:|------:|
| properties | 20 | 20 |
| owner_transfers | 19 | 19 |
| property_registry_people | 46 | 46 |
| ordinary_debt_gate_enabled | false | false |
| email_provider_configured | false | false |
| email_outbox sent | — | 0 |
| email_outbox total | — | 0 |

| Gate | Value |
|------|-------|
| email_enabled | **false** |
| email_core_is_ready() | **false** |
| delivery_status | not_configured |
| module_fallback | PROVIDER_NOT_CONFIGURED |
| RLS on all 5 email tables | **true** |
| client INSERT/UPDATE/DELETE grants | **0** |
| admin_get_email_settings / email_core_enqueue | present |
| migration list local=remote `20261012120000` | **YES** |

## Checklist return

- Preflight: **PASS**
- Migration applied: **YES**
- Tables created: `complex_email_settings`, `email_verified_senders`, `email_outbox`, `email_delivery_attempts`, `email_delivery_events`
- RLS verification: **PASS**
- Email sending enabled: **NO**
- Migration history synchronized: **YES**
- Production business data unchanged: **YES**

## Not done (by design)

- Auth SMTP unchanged  
- No API keys inserted  
- No commit / push / deploy  
