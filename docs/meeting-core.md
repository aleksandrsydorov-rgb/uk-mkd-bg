# Meeting Core (evolve in-place)

Status: **foundation + staged domain landing in repo** — migrations are local only.  
Do **not** `db push` / Vercel / commit without an explicit user command.

Canon: AMADEUS 11 Meeting Core TZ v1.0 + Cursor Prompt. Module key remains `general_meeting`.

## Source of truth

- **Property Book** (`properties`, `property_registry_people`) is the only authoritative ownership registry.
- Meeting Core stores **immutable per-meeting snapshots** only — never a parallel owner registry.
- Generic `polls` are **not** a legal voting source.

## Stage 0 — Gap matrix

| TZ capability | Current GM | Target |
|---------------|------------|--------|
| Versioned ruleset `BG_ZUES_2026_09` | Hardcoded quorum presets in RPC/UI | `meeting_rulesets` + `general_meetings.ruleset_id` |
| Dual snapshots (notice + voting) | Participant ideal-parts copy at insert; live book denominator | `meeting_notice_snapshot*` / `meeting_voting_snapshot*` |
| Ownership drift after invitation | None | `OWNERSHIP_CHANGED_AFTER_INVITATION` + block check-in |
| Invitation versioning / hash | Field lock after publish | `meeting_invitation_versions` + supersede |
| Central state machine | `status` + `operational_phase` soft updates | `legal_state` + `gm_transition` RPC |
| Proxy max 3 | Soft proxy metadata | `meeting_proxies` + enforce max 3 |
| Immutable votes after submit | Upsert while open | Insert-only + unique representable right |
| Quorum immutable audit | `general_meeting_quorum_checks` | Keep + align with ruleset; Stage 3 strengthens |
| Absentee (allowed categories only) | Flags thin | Ruleset gates + declarations table |
| Protocol generate/sign | Minutes file slots | `meeting_protocol_*` + WET_SCAN |
| Governance terms / elections | Decisions only | `governance_terms` / `governance_members` / candidates |
| Municipality / EISES | `external_registry_ref` flag | Filing regime + tracking |
| Challenges / LEGAL_HOLD | None | `meeting_challenges` |
| Notifications delivery log | None | `meeting_notifications` |
| Audit append-only | Partial vote_events | `meeting_audit_log` |
| `complex_id` multi-complex | N/A (single building) | Deferred; RPC authz stays building-scoped |

## Book → snapshot mapping

| Book field | Notice snapshot | Voting snapshot |
|------------|-----------------|-----------------|
| `properties.id` / `apartment_number` / floor/section/block | yes | yes |
| `properties.ideal_parts_percent` (+ source) | yes (object row) | yes (fallback weight) |
| `property_registry_people` active owners (`relation_type=owner`, `deregistered_at is null`) | yes (party rows) | yes (party rows = representable rights) |
| `ownership_share_percent` / party `ideal_parts_percent` | yes | yes (vote weight) |
| `email` / name fields | yes (delivery targets) | yes (identity) |
| Contacts phone | notice only | optional |
| Validity as-of | `frozen_at` | `frozen_at` (= meeting date rights) |

Drift detection: hash or row compare of active owner set + ideal parts between notice freeze and voting freeze / check-in open.

## State compatibility

| Legacy `status` / `operational_phase` | Meeting Core `legal_state` (approx) |
|--------------------------------------|-------------------------------------|
| `draft` | `DRAFT` … `AGENDA_READY` |
| `published` + idle | `INVITATION_LOCKED` … `WAITING_FOR_MEETING` |
| `published` + `registration` | `CHECK_IN_OPEN` / `VOTING_SNAPSHOT_LOCKED` / `QUORUM_CHECK` |
| `published` + `in_progress` | `MEETING_IN_PROGRESS` |
| `held` / phase `closed` | `MEETING_FINISHED` … `PROTOCOL_*` |
| `minutes_ready` | `PROTOCOL_SIGNED` … |
| `archived` | `CLOSED` |
| `cancelled` | `CANCELLED` |
| `rescheduled` | successor meeting; old terminal |

UI may still show legacy labels; transitions for new columns go through `gm_transition`.

## Legal checklist (`needs_legal_signoff` before production)

- [ ] Dominant owner >51% → initial quorum 75% rule text vs product encoding
- [ ] Hybrid only when house rules (`Правилник`) allow videoconference identity procedure
- [ ] Absentee forbidden for management/board elections
- [ ] Next-session weekday/holiday calendar source (BG public holidays)
- [ ] Municipality LEGACY vs EISES filing pack contents
- [ ] BG master invitation/protocol wording

## Security invariants

- Writes via SECURITY DEFINER RPC, `search_path = ''`, `can_manage_building_governance()` or `owns_property`.
- No direct client update of `legal_state`, locked invitation content, submitted votes, quorum %.
- No hard delete of legal artifacts; audit append-only.
- Owners cannot vote outside their voting-snapshot rights.

## Stages in repo

| Stage | Deliverable |
|-------|-------------|
| 0 | This doc |
| 1 | Foundation migration + RPCs + smoke |
| 2–6 | Domain tables/RPCs in follow-on migrations / same package |
| 7 | Admin/owner UX hooks |
| 8 | Smoke pack + implementation report |

## Explicit non-goals until commanded

- Production `supabase db push`
- Vercel deploy
- Git commit/push
