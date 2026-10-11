# PKG-XFER Remaining Test Matrix

**Project:** uk-mkd-bg  
**Branch:** main  
**Supabase TEST (linked):** `klowacuvufknbrkayjhz` (MKD AMADUES 11)  
**Mode:** planning / read-only verification only — no mutations executed in this pass  
**Companion plans:** `pkg_xfer_authenticated_session_test_plan.md`, `pkg_xfer_authenticated_ui_scenario_matrix.md`  
**SQL smokes:** `supabase/pkg_xfer_stage{2,3,4,5b}_smoke.sql`, `pkg_xfer_cross_stage_smoke.sql`

---

## Naming bridge (campaign vs session plan)

Campaign labels used in A1–A4 execution **differ** from IDs in the authenticated session plan:

| Campaign (executed) | Meaning | Session-plan ID |
|---------------------|---------|-----------------|
| **A1** | Submit + cancel | Session **A1** |
| **A2** | Full 1→1 transfer (submit + admin approve) | Session **A1 submit** + **A6 approve** |
| **A3** | 1→2 transfer | Session **A2** (1→many) |
| **A4** | 2→1 transfer | Session **A3** (many→1) |

Session-plan **A4** (many→many / 2→2) is **not** the same as campaign A4 and remains unverified.

---

## Read-only fixture snapshot (2026-10-11)

| Check | Result |
|-------|--------|
| Linked project | `klowacuvufknbrkayjhz` ✓ |
| Apt 99401 | `property_id=107`, `ownership_type=sole`, ideal 1% |
| Active Book sole owner | `zoomconf0001+test2@gmail.com` 100% / 1% (registry id 110) |
| Pending transfers on 107 | **0** |
| Recent transfers | 29 `отменена`; 30–32 `утверждена` (A2–A4 path history) |
| `ordinary_debt_gate_enabled` | **false** |
| Forbidden apt 99501 / Owner A/B | Do not touch |
| Migrations | `20261011140000` … `20261011140500` applied |

Disposable Auth identities (reuse only with genuine login):

- `zoomconf0001+test1@gmail.com`
- `zoomconf0001+test2@gmail.com` (current sole owner of 99401)
- `zoomconf0001+test3@gmail.com`

---

## The 38 deferred assertions

**Composition:** 36 `*-AUTH-*` SKIPPED markers + 2 Stage-3 DB fixture SKIPPEDs (`S3-DB-01`, `S3-DB-03`).

| # | SQL ID | Session-plan map | Package | Covered by campaign A1–A4? | Still needs |
|---|--------|------------------|---------|----------------------------|-------------|
| 1 | S2-AUTH-01_owner_submit_1to1 | A1 | P1/P2 | **YES** (A1 submit + A2 1→1) | Optional re-run only if regression suspected |
| 2 | S2-AUTH-02_duplicate_pending_rpc | A8 | P2 | NO | Owner session + one pending |
| 3 | S2-AUTH-03_cancel_own_pending | A1 | P2 | **YES** (A1 cancel) | — |
| 4 | S2-AUTH-04_admin_approve_reject | A6/A7 | P2 | **PARTIAL** (approve in A2–A4; reject not done) | Admin reject with reason |
| 5 | S2-AUTH-05_stale_baseline_approve | A9 | P2 | NO | Admin Book mutate + approve |
| 6 | S2-AUTH-06_former_owner_owns_property | X1 | P3 | **PARTIAL** (A4 removed co-owners; formal X1 not logged) | Explicit former-owner session check |
| 7 | S2-AUTH-07_direct_status_update_as_owner | — | P2 | NO | Authenticated owner negative DML |
| 8 | S2-AUTH-08_approve_without_docs | A6 gate | P2/P6 | **PARTIAL** if A2–A4 used docs; else NO | Confirm docs-required gate |
| 9 | S2-AUTH-09_linked_correction_behavior | A10/A11 | P3 | NO | Admin linked correction |
| 10 | S3-AUTH-01_admin_set_inheritance_pending | I1 | P4 | NO | Admin Stage3 |
| 11 | S3-AUTH-02_guest_grant_revoke | I3 | P4 | NO | Admin guest UI |
| 12 | S3-AUTH-03_inherited_liability_rpc | I4 | P5 | NO | Admin liability UI |
| 13 | S3-AUTH-04_inheritance_approve_with_debt | F2 | P4/P5 | NO | Inheritance + overdue fixture |
| 14 | S3-AUTH-05_ordinary_approve_blocked_gate_on | F3 | P5 | NO | Temporary gate ON window + restore |
| 15 | S3-AUTH-06_le_representative_change | L1 | P5 | NO | LE Book owner + admin |
| 16 | S3-AUTH-07_submit_approve_transfer_dml | A1/A6 | P1/P2 | **YES** (A1–A4 path) | — |
| 17 | S4-AUTH-01_generate_multi_locale | D2 | P6 | NO | Owner extract generate |
| 18 | S4-AUTH-02_attach_pdf_via_api | D3/D4 | P6 | NO | Owner/admin + local API |
| 19 | S4-AUTH-03_notification_privacy | N2 | P6 | NO | Two owner sessions |
| 20 | S4-AUTH-04_honest_email_status | N3 | P6 | **PARTIAL** if observed on A2–A4 | Explicit NOT_CONFIGURED assert |
| 21 | S4-AUTH-05_history_hides_storage_paths | N4 | P3/P6 | NO | Owner history RPC/UI |
| 22 | S4-AUTH-06_certified_fulfill_unsigned | D5 | P6 | NO | Admin certified |
| 23 | S4-AUTH-07_former_owner_denied | X3 | P3/P6 | NO | Former-owner session |
| 24 | S4-AUTH-08_pending_counter | N1 | P6 | **PARTIAL** if seen during A1–A4 | Explicit admin counter check |
| 25 | S4-AUTH-09_owner_generate_rpc | D2 | P6 | NO | Owner RPC auth |
| 26 | S5B-AUTH-01_representative_only_no_tariff | L2 | P5 | NO | LE rep change |
| 27 | S5B-AUTH-02_linked_correction_flow | A10 | P3 | NO | Admin |
| 28 | S5B-AUTH-03_original_transfer_immutable | A11 | P3 | NO | After linked correction |
| 29 | S5B-AUTH-04_pdf_storage_object_matrix | D3/D4 | P6 | NO | Storage + API |
| 30 | S5B-AUTH-05_former_owner_attach_denied | X3 | P3/P6 | NO | Former owner |
| 31 | S5B-AUTH-06_admin_submit_linked_correction_rpc | A10 | P3 | NO | Admin |
| 32 | SX-AUTH-01_submit_approve_history | A1/A6/N4 | P3/P6 | **PARTIAL** (submit/approve done; history privacy not) | History strip paths |
| 33 | SX-AUTH-02_generate_extracts | D2 | P6 | NO | Owner |
| 34 | SX-AUTH-03_pending_counter | N1 | P6 | **PARTIAL** | Explicit N1 |
| 35 | SX-AUTH-04_pdf_attach_path | D3 | P6 | NO | API |
| 36 | SX-AUTH-05_owner_transfers_dml | A1/A8/A10 | P2 | **PARTIAL** (A1 path; A8/A10 open) | Duplicate + correction DML |
| 37 | S3-DB-01_overdue_vs_future_due | F1 fixture | P5 | NO | Valid Finance Core assessment (schema-correct) |
| 38 | S3-DB-03_gate_on_blocks_ordinary | F3 fixture | P5 | NO | Overdue + temporary gate ON |

### Coverage summary

| Bucket | Count | IDs |
|--------|------:|-----|
| Fully covered by campaign A1–A4 | 3 | S2-AUTH-01, S2-AUTH-03, S3-AUTH-07 |
| Partially covered (need formal close-out) | 8 | S2-AUTH-04, S2-AUTH-06, S2-AUTH-08, S4-AUTH-04, S4-AUTH-08, SX-AUTH-01, SX-AUTH-03, SX-AUTH-05 |
| Still unverified | 27 | Remaining AUTH + S3-DB-01 + S3-DB-03 |

**Total:** 3 + 8 + 27 = **38**.

---

## Package scenario matrix (remaining work)

### PACKAGE 1 — Multi-owner and partial shares

| Scenario | Session ID | Status | Apt strategy | Actors | Auto? |
|----------|------------|--------|--------------|--------|-------|
| 2→2 (many→many) | A4 | UNVERIFIED | Prefer isolated apt; or rebuild multi on 99401 then transfer | Owner2 + Buyer/co-owner + Admin | Semi (browser) |
| Partial share transfer | A5 | UNVERIFIED | 99401 or isolated | Current sole → retained + buyer | Semi |
| Retained owners | A5 / A3 follow-on | UNVERIFIED | After partial or 1→2 keep one | Owner + Admin | Semi |
| Share validation (≠100%) | A5 negative | UNVERIFIED | Any disposable | Owner | Auto UI assert |
| Ideal parts validation | A5 / A2 negative | UNVERIFIED | Any disposable | Owner | Auto UI assert |

**Prerequisite from A1–A4:** sole Owner2 on 99401; no pending.  
**Does not re-run:** campaign A1 cancel, A2 1→1, A3 1→2, A4 2→1.

### PACKAGE 2 — Request lifecycle and concurrency

| Scenario | Session ID | Status | Notes |
|----------|------------|--------|-------|
| Reject with reason | A7 | UNVERIFIED | Empty reason blocked; non-empty → `отклонена` |
| One pending per property | A8 / S2-AUTH-02 | UNVERIFIED | Second submit fails |
| Stale baseline protection | A9 / S2-AUTH-05 | UNVERIFIED | Mutate Book then approve |
| Admin-initiated request | Admin UI submit | UNVERIFIED | `AdminOwnershipTransfers` init roster |
| Unauthorized request | S2-AUTH-07 + non-owner | UNVERIFIED | Former/non-owner cannot submit/status-update |
| Approve without docs gate | S2-AUTH-08 | PARTIAL | Confirm fail-closed |

### PACKAGE 3 — Corrections and history

| Scenario | Session ID | Status |
|----------|------------|--------|
| Owner data correction (admin Book) | browser A12 | UNVERIFIED |
| Linked correction of approved transfer | A10 / S2-AUTH-09 / S5B-AUTH-02/06 | UNVERIFIED — use transfer 30–32 |
| Immutable original operation | A11 / S5B-AUTH-03 | UNVERIFIED |
| Owner-visible filtered history | N4 / S4-AUTH-05 / SX-AUTH-01 | UNVERIFIED |
| Former-owner denial | X1 / X3 / S2-AUTH-06 / S4-AUTH-07 / S5B-AUTH-05 | PARTIAL → close formally |

### PACKAGE 4 — Inheritance and guest access

| Scenario | Session ID | Status | Isolation |
|----------|------------|--------|-----------|
| Pending inheritance | I1 / S3-AUTH-01 | UNVERIFIED | **Isolated apt required** |
| Death documents | I1 | UNVERIFIED | Isolated |
| Voting restrictions | I1 | UNVERIFIED | Meeting Core |
| Quorum preservation | I2 | UNVERIFIED | Ideal parts unchanged |
| Multiple heirs | inheritance multi-target | UNVERIFIED | Isolated |
| Inheritance despite debt | F2 / S3-AUTH-04 | UNVERIFIED | Needs overdue + inheritance kind |
| Temporary guest access + expiration | I3 / S3-AUTH-02 | UNVERIFIED | Grant/revoke; no ownership ops |

**Do not run on 99401 if it would block Package 1 ownership chain** — use synthetic apt.

### PACKAGE 5 — Finance and legal entities

| Scenario | Session ID | Status | Safety |
|----------|------------|--------|--------|
| Overdue vs future-due | F1 / S3-DB-01 | UNVERIFIED | Finance Core UI/RPC only; valid enums |
| Debt gate OFF | F1 | UNVERIFIED | Confirm warning; approve allowed |
| No history rewriting | F4 | UNVERIFIED | Assessments unchanged post N↔L |
| Manual inherited liability | I4 / S3-AUTH-03 | UNVERIFIED | Ledgers untouched |
| Representative changes | L1 / S3-AUTH-06 | UNVERIFIED | Needs LE Book owner |
| Natural/legal tariff transitions | F4 / L2 / S5B-AUTH-01 | UNVERIFIED | Prospective only |
| Gate ON ordinary block | F3 / S3-AUTH-05 / S3-DB-03 | UNVERIFIED | **Restore OFF immediately** |

### PACKAGE 6 — Notifications and documents

| Scenario | Session ID | Status |
|----------|------------|--------|
| Admin pending count | N1 / S4-AUTH-08 / SX-AUTH-03 | PARTIAL → formalize |
| Co-owner notifications | N2 / S4-AUTH-03 | UNVERIFIED |
| Email NOT_CONFIGURED truthfulness | N3 / S4-AUTH-04 | PARTIAL → formalize |
| Supporting document access | D1 | UNVERIFIED |
| BG original extract | D2 / S4-AUTH-01/09 / SX-AUTH-02 | UNVERIFIED |
| RU/EN informational extracts | D2 | UNVERIFIED |
| Real PDF generation + private attach | D3 / S4-AUTH-02 / S5B-AUTH-04 / SX-AUTH-04 | UNVERIFIED |
| Immutable archive | D2/D3 follow-on | UNVERIFIED |
| Certified extract requests | D5 / S4-AUTH-06 | UNVERIFIED |

---

## Authenticated session availability (this pass)

| Surface | Observation |
|---------|-------------|
| Browser tab `/#resident-login` | No Supabase Auth keys in `localStorage`; not a confirmed owner session |
| Browser tab `/admin?section=смены` | No Auth keys in `localStorage`; not a confirmed admin session |
| Invite tab | Open invite URL present — **do not log tokens**; treat as unused until human completes invite |
| API automation | Blocked until human logs in Owner2 / Admin (and optionally test1/test3) |

**Conclusion:** no verified live authenticated sessions for automated mutation. Planning only.

---

## Identities / apartments still needed

| Need | Why |
|------|-----|
| Genuine Admin Auth login | P2–P6 approvals, Stage3, LE, certified |
| Genuine Owner2 login (`…+test2@`) | P1 submit from 99401 |
| Genuine test1 / test3 logins | Co-owner / buyer / former-owner checks |
| LE contact Auth user | P5 L1/L2 |
| Guest/occupant Auth user | P4 I3 |
| Isolated synthetic apartments (recommend `9941x`–`9943x` or prior `9935x`–`9938x`) | P2 concurrency, P4 inheritance, P5 finance/LE — avoid colliding with 99401 P1 chain |
| Valid Support Fee overdue assessment fixture | P5 F1–F3 (not raw smoke insert) |

---

## Do-not-repeat list

Already PASS — skip unless regression:

- Campaign A1 submit + cancel  
- Campaign A2 1→1 approve  
- Campaign A3 1→2 approve  
- Campaign A4 2→1 approve  
- SQL DB smokes 33 PASS assertions (re-run only after schema change)
