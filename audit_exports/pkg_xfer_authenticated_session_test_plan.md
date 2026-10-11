# PKG-XFER Authenticated-Session Test Plan

**Project:** uk-mkd-bg  
**Supabase TEST:** `klowacuvufknbrkayjhz`  
**Rule:** Use genuine Auth logins only. Do **not** spoof JWT via `set_config`.  
**Forbidden:** apartment `99501`, Owner A/B production test accounts.  
**Use:** dedicated smoke users / synthetic apartments (`9935x`–`9938x` range).

Companion SQL (DB-level, no identity spoofing):

- `supabase/pkg_xfer_stage2_smoke.sql` … `pkg_xfer_stage5b_smoke.sql`
- `supabase/pkg_xfer_cross_stage_smoke.sql`
- `supabase/pkg_xfer_stage2_auth_role_security.sql`

UI companion: `audit_exports/pkg_xfer_browser_ui_smoke_checklist.md`

---

## Execution environments

| Env | What can run |
|-----|----------------|
| **Local `next dev` + TEST Supabase** | Owner/admin UI flows, Documents upload, PDF generate/attach API (`/api/ownership/attach-extract-pdf`), notifications in-app |
| **Deployed TEST app** | Same as local, plus any hosting-specific cookie/session behavior; required before production promotion |
| **SQL-only remote** | Privilege catalog + transactional fixtures only (already covered by repaired smokes) |

If genuine sessions are unavailable → mark scenario **BLOCKED**, do not fake PASS.

---

## Ownership transfers

| ID | Scenario | Local app | Deployed app | Notes |
|----|----------|-----------|--------------|-------|
| A1 | 1→1 submit + cancel | YES | YES | Owner session |
| A2 | 1→many (shares 100%, ideals match) | YES | YES | |
| A3 | many→1 | YES | YES | After multi-owner Book |
| A4 | many→many | YES | YES | |
| A5 | Partial share transfer | YES | YES | |
| A6 | Admin approve with Documents Core upload | YES | YES | Admin session |
| A7 | Admin reject (reason required) | YES | YES | |
| A8 | Duplicate pending blocked | YES | YES | |
| A9 | Stale Book baseline reject | YES | YES | Mutate Book then approve |
| A10 | Linked correction of approved transfer | YES | YES | XFER.21 UI |
| A11 | Original approved transfer immutable after link | YES | YES | |

## Finance / debt

| ID | Scenario | Local | Deployed |
|----|----------|-------|----------|
| F1 | Debt gate OFF warning on approve with overdue | YES | YES |
| F2 | Inheritance approve with overdue succeeds | YES | YES |
| F3 | Ordinary approve blocked only if gate ON (do not leave ON) | YES* | YES* | *Restore OFF immediately |
| F4 | Historical assessments unchanged after N↔L ownership | YES | YES | Inspect Tariff Core / assessments |

## Inheritance / voting / guest

| ID | Scenario | Local | Deployed |
|----|----------|-------|----------|
| I1 | Pending inheritance / deceased → voting denied | YES | YES |
| I2 | Quorum ideal parts remain on Book row | YES | YES |
| I3 | Temporary guest grant + revoke | YES | YES |
| I4 | Manual inherited liability record + confirm | YES | YES |

## Legal entity

| ID | Scenario | Local | Deployed |
|----|----------|-------|----------|
| L1 | Representative change with docs | YES | YES |
| L2 | Former rep invite expired; no tariff subject change | YES | YES |

## Notifications / privacy

| ID | Scenario | Local | Deployed |
|----|----------|-------|----------|
| N1 | Admin pending count matches | YES | YES |
| N2 | Owners see only their notifications | YES | YES |
| N3 | Honest email status (not delivered without provider) | YES | YES |
| N4 | History hides supporting document storage paths | YES | YES |

## Documents / PDF

| ID | Scenario | Local | Deployed |
|----|----------|-------|----------|
| D1 | Supporting doc upload via private building-documents | YES | YES |
| D2 | Generate BG/RU/EN extracts; `has_pdf=false` until attach | YES | YES |
| D3 | Attach via `/api/ownership/attach-extract-pdf` | YES | YES** | **Needs app process; SQL migrate alone is not deploy |
| D4 | Reject forged path / foreign document / substitute PDF | YES | YES |
| D5 | Certified request → fulfill unsigned | YES | YES |

## Former owner / cross-apartment

| ID | Scenario | Local | Deployed |
|----|----------|-------|----------|
| X1 | Former owner loses `owns_property` access | YES | YES |
| X2 | Cross-apartment access denied | YES | YES |
| X3 | Former owner cannot generate/attach extract | YES | YES |

---

## SQL smoke ↔ session scenario map

SQL scripts assert **DB-only** constraints and mark auth workflows **SKIPPED** (never PASS).
Behavioral coverage for those SKIPPED IDs lives here:

| SQL ID | Session plan ID | Notes |
|--------|-----------------|-------|
| S2-DB-05 (catalog unique index) | A8 | Duplicate pending behavior |
| S2-DB-07 (corrects_transfer_id schema) | A10 / A11 | Linked correction row behavior |
| S2-DB-08 (insert requires auth) | — | Negative DB boundary only |
| S2-AUTH-01 … S2-AUTH-09 | A1 / A6–A11 / X1 | Transfer RPC + DML |
| S3-AUTH-01 … S3-AUTH-07 | I1 / I3 / I4 / F2 / F3 / L1 / A1 | Inheritance / debt / LE / transfer |
| S4-AUTH-01 … S4-AUTH-09 | D2–D5 / N1–N4 / X3 | Extract / notify / PDF |
| S5B-AUTH-01 … S5B-AUTH-06 | L2 / A10 / A11 / D3 / D4 / X3 | Linked correction / PDF attach |
| SX-AUTH-01 … SX-AUTH-05 | A1 / A6 / A8 / A10 / D2 / D3 / N1 / N4 | End-to-end |

---

## Suggested smoke users (create in TEST Auth only)

| Role | Example email pattern |
|------|------------------------|
| Owner | `smoke.session.owner1@example.com` |
| Co-owner | `smoke.session.owner2@example.com` |
| Buyer | `smoke.session.buyer@example.com` |
| Admin | existing TEST administration staff (not Owner A/B) |

Do not reuse production Owner A/B identities.
