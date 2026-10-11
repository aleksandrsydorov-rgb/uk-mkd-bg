# PKG-XFER Browser UI Smoke Checklist

**Environment:** TEST Supabase only  
**Do not use apartment 99501 or Owner A/B accounts.**  
**Prereq:** Migrations 140000–140400 applied; post-verify PASS.  
**Auth:** Real login sessions only (see `pkg_xfer_authenticated_session_test_plan.md`). No JWT GUC spoofing.

## Owner cabinet

| # | Step | Expected | Pass |
|---|------|----------|------|
| O1 | Open apartment as current Book co-owner | Ownership panel visible | ☐ |
| O2 | Submit multi-owner transfer (shares=100%, ideals match) | Request status pending; no co-owner consent required | ☐ |
| O3 | Cancel own pending request | Status cancelled; pending slot free | ☐ |
| O4 | Attempt submit while another pending exists | Rejected (one pending) | ☐ |
| O5 | Generate extract PDF BG/RU/EN | Loading → success; archive shows 3 locales; `PDF ready` only after attach | ☐ |
| O6 | Download BG PDF | Real PDF opens; informational/unsigned; BG authority notice | ☐ |
| O7 | Request certified extract | Status requested; admin notified | ☐ |
| O8 | View ownership history | Structured rows (not raw JSON); no document storage paths | ☐ |
| O9 | Guest Mode occupant (inheritance grant) | Requests/security/services/chat OK; no ownership ops / voting / finance ownership | ☐ |

## Admin

| # | Step | Expected | Pass |
|---|------|----------|------|
| A1 | Pending counter | Matches pending transfers | ☐ |
| A2 | Open approve with overdue debt (gate OFF) | Warning visible; approve still allowed | ☐ |
| A3 | Approve with documents uploaded via Documents Core | Book roster replaced; notifications created | ☐ |
| A4 | Reject with empty reason | Blocked | ☐ |
| A5 | Reject with reason | Status rejected; owners notified | ☐ |
| A6 | Stale baseline: change Book then approve old request | Rejected with stale baseline error | ☐ |
| A7 | Inheritance approve with overdue debt | Succeeds | ☐ |
| A8 | Pending inheritance + death docs | voting_eligible false; guest grant/revoke works | ☐ |
| A9 | Legal entity representative change | Entity remains owner; former invite expired; docs required | ☐ |
| A10 | Inherited liability record + confirm | Manual amounts; finance ledgers unchanged | ☐ |
| A11 | Certified fulfill | Status fulfilled; `is_signed=false`; no fake stamp | ☐ |
| A12 | Admin correction | Book updated; audited; not a sale | ☐ |
| A13 | Linked correction of approved transfer | New pending op; `corrects_transfer_id` set; original unchanged | ☐ |
| A14 | PDF attach via `/api/ownership/attach-extract-pdf` | Server verifies magic+SHA; `has_pdf` true only after success | ☐ |

## Former owner

| # | Step | Expected | Pass |
|---|------|----------|------|
| F1 | Login as removed former owner | No current apartment ownership access | ☐ |
| F2 | Call history/extract for former apt (if UI exposed) | Denied | ☐ |

## Negative / failure

| # | Step | Expected | Pass |
|---|------|----------|------|
| N1 | Interrupt PDF after HTML generate (close tab) | Extract rows may exist with `has_pdf=false`; UI must not claim PDF ready | ☐ |
| N2 | Retry generate | New extract numbers; old rows retained | ☐ |
| N3 | Free-text supporting path without upload | Approve blocked / upload required | ☐ |
