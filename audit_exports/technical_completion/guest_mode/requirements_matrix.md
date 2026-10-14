# Guest Mode — Requirements Matrix (post-completion code)

| # | Approved requirement | Before | After (code + pending migration) | Evidence |
|---|----------------------|--------|----------------------------------|----------|
| 1 | Four guest categories | Done | Done | `property_guest_accesses.relation_type` check; UI |
| 2a | Max 2 active / apartment | RPC only | RPC + **DB trigger + unique email index** | `20261021120000_*` |
| 2b | Validity / status | Date check in `has_active_guest_access` | Same + expire on write/trigger | helpers + trigger |
| 2c | Auto-expire | Soft via date filter | Soft + status flip on stale writes | `guest_access_expire_stale`, trigger |
| 2d | Owner revoke | Done | Done | `owner_revoke_guest_access` |
| 2e | Multi-context account | Done | Done | `mergeAccountProperties` |
| 3a | Maintenance requests | SELECT only | **INSERT + identity columns** | policies + account page |
| 3b | Security / parcel | Create as owner stamp | **Create as `guest` role** | security RPCs |
| 3c | Available services | Overview guestLimited | Overview + relation label | `OwnerOverview` |
| 3d | Guest chat | SELECT only | **INSERT sender=`guest` + labels** | chat policies + UI |
| 4a | No meters | UI hide + owner RPCs | Unchanged deny | guest menu / RPCs |
| 4b | No finance | Scrub + UI | Unchanged | E2.1 + guestLimited |
| 4c | No owner voting | Parties RPC | Unchanged | `cast_poll_vote` |
| 4d | No Property Book edit | UI hide | Unchanged | guest menu |
| 4e | No other apartments | Access list scoped | Unchanged + context pick | `has_active_guest_access(pid)` |
| 5 | Chat distinguishable | Missing | **Done** | `guest` sender + labels |
| 6 | Server-side authz / DB limits | Partial | **Completed for guest paths** | migration |
| 7 | Owner/guest cabinets + i18n | Partial | **Completed** | BG/RU/EN strings |

**Still LEGAL_WAITING:** guest terms acceptance (A13) — not part of this technical completion.
