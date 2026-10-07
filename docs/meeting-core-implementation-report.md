# Meeting Core — implementation report (local, not deployed)

Date: 2026-09-29  
Scope: Stages 0–8 of Meeting Core plan (evolve in-place).  
**Not applied to production.** No `db push`, Vercel, or commit unless user commands it.

## A) Audit summary

Existing `general_meeting` provided operational workflow (publish → registration → quorum → vote → minutes). Gaps vs legal TZ: dual book snapshots, versioned ruleset, invitation versions, central `gm_transition`, ownership drift block, proxy max-3, vote immutability, protocol/signing, notifications log, governance/challenges.

## B) Property Book → Meeting Core mapping

See [`docs/meeting-core.md`](meeting-core.md). Snapshots copy active owners from `property_registry_people` (+ property fallback), ideal parts, emails/names; `roster_hash` via `gm_book_roster_hash()`.

## C) Architecture decisions

- Evolve in-place; module key `general_meeting`.
- Single-building authz (`can_manage_building_governance` / `owns_property`); no `complex_id`.
- Ruleset seed `BG_ZUES_2026_09` with `needs_legal_signoff: true`.
- Foundation first; invitation/proxy/protocol/governance tables landed in same migration package for continuity.
- Vote UPDATE of legal fields / DELETE blocked by trigger.

## D) Files created/changed

**Docs:** `docs/meeting-core.md`, `docs/architecture-cores.md`, this report  
**Migrations:**  
- `supabase/migrations/20260929140000_meeting_core_foundation.sql`  
- `supabase/migrations/20260929140100_meeting_core_votes_absentee.sql`  
**Smoke:** `supabase/meeting_core_foundation_smoke.sql`  
**Lib/UI:** `src/lib/meetingCore.ts`, `src/components/admin/AdminMeetingCorePanel.tsx`, wiring in `AdminDocumentsDecisions.tsx`, `buildingDocuments.ts`, `generalMeetingWorkflow.ts`, owner nav `собрания`, i18n, `ownerNav.ts`, `database.types.ts` RPC stubs  

## E) Migrations (local)

| File | Purpose |
|------|---------|
| `20260929140000_…` | Ruleset, meeting columns, dual snapshots, invitation versions, audit, notifications, proxies, protocols, documents, candidates, governance, challenges, core RPCs |
| `20260929140100_…` | Vote immutability trigger, absentee submit, agenda template seed, document/governance helpers |

## F) RLS summary

- Rulesets/governance terms: authenticated select.
- Invitation/snapshots/proxies/protocols/documents/candidates/challenges: admin or owner (building).
- Audit + notifications: admin select only.
- All writes via SECURITY DEFINER RPCs.

## G) Smoke

`supabase/meeting_core_foundation_smoke.sql` — BEGIN/ROLLBACK, expect `ALL CHECKS PASSED` after migrations are applied to a DB (local or linked **only when commanded**).

## H) Lint/typecheck/build

Not run against production. Apply migrations locally before full `tsc`/`next build` validation of new RPC typings.

## I) Unresolved legal/product risks

- Dominant-owner 75% initial quorum needs legal sign-off.
- Hybrid house-rules procedure not enforced beyond `hybrid_house_rules_ok` flag.
- BG public-holiday calendar for next-session adjournment not encoded.
- Legacy `cast_general_meeting_vote` upsert may conflict with immutability trigger on re-vote (intended).
- Existing soft `status`/`operational_phase` dual-written from `gm_transition`; direct UI status updates still possible on legacy paths — harden in follow-up.
- Municipality/EISES packs and QES are stubs.
- Full PDF generators for invitation/protocol not implemented (BG text stored; PDF/Wet scan URL path only).

## J) Deployment plan (DO NOT EXECUTE)

1. Legal sign-off checklist in `docs/meeting-core.md`.
2. Apply migrations to staging/linked only after explicit command.
3. Run smoke BEGIN/ROLLBACK.
4. Manual admin: freeze notice → lock invitation → post → drift test → voting freeze.
5. Production apply only with separate written approval.
6. Commit/push only on user request.

## Stage checklist

| Stage | Status in repo |
|-------|----------------|
| 0 Design freeze docs | Done |
| 1 Foundation | Done (migration + UI panel) |
| 2 Invitation/posting/notifications | Done (schema + RPCs + panel actions) |
| 3 Proxies / check-in block / quorum align | Proxies + drift block; quorum engine still legacy RPC + ruleset JSON |
| 4 Immutable votes / absentee | Trigger + absentee RPC |
| 5 Protocol WET_SCAN + doc registry | Done (RPC + tables) |
| 6 Elections/governance/challenges | Template seed + terms + challenges |
| 7 Owner/Admin UX | Core panel + owner «Собрания» nav |
| 8 Report + smoke | This file + smoke SQL |
