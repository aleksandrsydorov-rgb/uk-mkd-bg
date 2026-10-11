# PKG-XFER Six-Package Execution Plan

**Project:** uk-mkd-bg · **Branch:** main · **Supabase:** `klowacuvufknbrkayjhz`  
**Status:** READY FOR AUTHORIZATION — planning complete; **no mutations** until explicit go-ahead  
**Matrix:** `audit_exports/pkg_xfer_remaining_test_matrix.md`

---

## Global preflight (every package, before any mutation)

1. Confirm linked project is `klowacuvufknbrkayjhz` (`npx supabase projects list` → linked:true).  
2. Confirm apt under test: Book owners, pending count = 0 (or expected), not 99501.  
3. Snapshot recoverables (read-only SELECT → save to `tmp/`): active Book rows, last transfer ids, `ordinary_debt_gate_enabled`.  
4. Confirm debt gate remains **OFF** unless inside F3 window.  
5. Confirm genuine Auth sessions for required actors (browser or documented human login).  
6. No JWT spoof, no RLS disable, no Auth user fabrication, no commit/push/deploy.

**Forbidden always:** apt 99501, historical Owner A/B, DB reset, platform-wide finance settings, leaving debt gate ON, rewriting historical assessments/transactions.

---

## Recommended order

1. **PACKAGE 1** first (uses 99401 sole Owner2; no new roles beyond test1/test3 + Admin).  
2. **PACKAGE 2** on same or sister apt (lifecycle; leave Book restorable).  
3. **PACKAGE 6** close-outs that piggyback on P1/P2 notify/docs (N1/N3) + extracts on Owner2.  
4. **PACKAGE 3** using an approved transfer from P1/P2 (linked correction on 30–32 or new approve).  
5. **PACKAGE 5** finance on **isolated** apt (assessment fixture) before LE.  
6. **PACKAGE 4** inheritance/guest last on **isolated** apt (most destructive to voting/guest state).

---

## PACKAGE 1 — Multi-owner and partial shares

### Goal
Verify 2→2, partial/retained roster, share=100% and ideal-parts match rules. Do **not** re-run campaign A1–A4.

### Start state
- 99401 / 107: sole Owner2 (`…+test2@`) 100% / 1%; pending = 0  
- Disposable: test1, test3 Auth accounts  
- Admin Auth required for approve

### Executable steps (when authorized)

| Step | Action | Auto / Human | Pass criteria |
|------|--------|--------------|---------------|
| 1.1 | Owner2 login → submit 1→2 roster (test1 50% + test3 50%, ideals 0.5+0.5) **only if** rebuilding multi for 2→2; else skip if using reverse of A4 history via new transfer | Semi | Pending created |
| 1.2 | Admin approve with docs | Human admin + browser | Book = two co-owners |
| 1.3 | **2→2:** co-owner submits roster BuyerA+BuyerB (or test2+test1 remap) shares/ideals valid | Semi | Approve → Book exactly two targets |
| 1.4 | **Partial:** from sole (restore Owner2 100% first if needed) submit retained Owner2 40% + buyer 60% (or UI-allowed partial_transfer) | Semi | Pending validates; approve → both on Book |
| 1.5 | **Negative shares:** submit totals ≠ 100% | Auto UI | Client + RPC reject |
| 1.6 | **Negative ideals:** ideals sum ≠ property ideal | Auto UI | Reject |

### Automation vs human

| Can automate safely | Needs human |
|---------------------|-------------|
| Preflight SELECTs; pending-count; post-approve Book SELECT | Password login; Documents Core upload; approve clicks |
| Invalid roster submit attempts once session exists | Creating Auth users if invite incomplete |

### Cleanup
Leave 99401 with a known sole or documented co-owner roster; cancel any leftover pending; never touch 99501.

### Readiness
**READY** for execution once Owner2 + Admin sessions exist.  
**SAFE TO START PACKAGE 1 after auth login:** YES (fixture clean).  
**SAFE TO START PACKAGE 1 right now (no sessions):** NO — login blocker.

### Maps deferred IDs
Closes multi-owner gaps beyond A3/A4; does not alone close AUTH table rows (those are mostly P2/P3/P6).

---

## PACKAGE 2 — Request lifecycle and concurrency

### Goal
Reject, one-pending, stale baseline, admin-initiated, unauthorized.

### Start state
Prefer **isolated apt** OR 99401 with pending=0 and recoverable Book snapshot.

### Steps

| Step | Action | Auto / Human | Pass |
|------|--------|--------------|------|
| 2.1 | Owner submit ordinary pending | Semi | `ожидает` |
| 2.2 | **A8:** second submit same property | Auto once session | Error; still one pending → S2-AUTH-02 |
| 2.3 | **A7:** admin reject empty reason → blocked; with reason → `отклонена` | Human | S2-AUTH-04 reject half |
| 2.4 | Resubmit pending; admin mutate Book material field; approve → stale fail | Human | S2-AUTH-05 |
| 2.5 | Cancel/reject cleanup | Semi | pending=0 |
| 2.6 | **Admin-initiated** transfer from admin UI | Human | Pending + notify |
| 2.7 | Non-owner / former-owner submit attempt | Semi | Denied |
| 2.8 | Owner direct status UPDATE (authenticated) | Semi / SQL-as-user if available | Denied → S2-AUTH-07 |
| 2.9 | Approve without required docs | Human | Blocked → S2-AUTH-08 |

### Automation vs human
- Auto: duplicate submit, unauthorized submit, DB asserts after each step.  
- Human: admin reject/approve, Book mutation, document gate.

### Readiness
**READY** after P1 or in parallel on isolated apt. Requires Admin + Owner sessions.

---

## PACKAGE 3 — Corrections and history

### Goal
Admin correction, linked correction, immutability, filtered history, former-owner denial.

### Start state
Approved transfer exists (ids 30–32 on 107, or fresh from P1/P2). Former owner identity available (test1 after sell-away).

### Steps

| Step | Action | Auto / Human | Pass |
|------|--------|--------------|------|
| 3.1 | Admin owner-data correction (not a sale) | Human | Book updated; audit; not sale transfer |
| 3.2 | Linked correction UI → `admin_submit_linked_ownership_correction` | Human | New pending; `corrects_transfer_id` set → S5B-AUTH-02/06 |
| 3.3 | Assert original approved row unchanged | Auto SELECT | S5B-AUTH-03 / A11 |
| 3.4 | Owner history UI/RPC: no storage paths | Semi | S4-AUTH-05 / N4 |
| 3.5 | Former owner: apt absent / `owns_property` false / extract deny | Semi | X1 / X3 / S2-AUTH-06 / S4-AUTH-07 / S5B-AUTH-05 |

### Automation vs human
- Auto: immutability SELECTs, `owns_property` checks.  
- Human: correction forms, former-owner login.

### Readiness
**BLOCKED** until Admin session + at least one approved transfer + former-owner login. Prefer after P1/P2.

---

## PACKAGE 4 — Inheritance and guest access

### Goal
Pending inheritance, death docs, voting, quorum, multi-heir, debt-tolerant inheritance, guest grant/expire.

### Start state
**Mandatory isolated synthetic apartment** (do not use 99401 if P1 chain active). Admin + deceased/heir Auth users.

### Steps

| Step | Action | Auto / Human | Pass |
|------|--------|--------------|------|
| 4.1 | Admin set inheritance pending + death docs | Human | S3-AUTH-01; voting_eligible false |
| 4.2 | Ideal parts unchanged (quorum) | Auto | I2 |
| 4.3 | Attempt vote as deceased/pending party | Semi | Denied |
| 4.4 | Multi-heir target roster inheritance transfer | Human | Approve → multiple Book heirs |
| 4.5 | With overdue (from P5 fixture): inheritance approve succeeds | Human | F2 / S3-AUTH-04 |
| 4.6 | Guest grant → limited `/account` → revoke/expire | Human | S3-AUTH-02; no ownership ops |

### Automation vs human
Almost all human/admin UI; auto for Book/voting_eligible/guest row asserts.

### Readiness
**NOT READY** without isolated apt + Admin + heir/guest identities. Document prerequisites; do not impersonate.

---

## PACKAGE 5 — Finance and legal entities

### Goal
Overdue/future-due, gate OFF warning, no history rewrite, inherited liability, LE rep, N↔L tariff.

### Start state
Isolated apt with Finance Core capability. **Never** leave `ordinary_debt_gate_enabled=true`.

### Steps

| Step | Action | Auto / Human | Pass |
|------|--------|--------------|------|
| 5.1 | Create valid SF assessment overdue + future-due via Finance UI/RPC | Human | Closes S3-DB-01 gap |
| 5.2 | Admin approve ordinary with gate OFF → warning, success | Human | F1 |
| 5.3 | Assert assessments unchanged after ownership change | Auto | F4 |
| 5.4 | Manual inherited liability record + confirm | Human | S3-AUTH-03; ledgers unchanged |
| 5.5 | LE Book owner + representative change + docs | Human | L1 / S3-AUTH-06; no tariff subject flip for rep-only → S5B-AUTH-01 |
| 5.6 | Natural↔legal ownership approve → prospective tariff transition only | Human | F4 / L2 |
| 5.7 | **F3 window:** set gate ON → ordinary approve blocked → **restore OFF** | Human + mandatory restore | S3-AUTH-05 / S3-DB-03 |

### Automation vs human
Auto: debt JSON flags, assessment amount equality, gate restore verify.  
Human: Finance posting, LE setup, gate toggle with dual-check restore.

### Readiness
**NOT READY** without Finance fixture path + (for LE) legal-entity Book owner. Do not hand-insert invalid `support_fee_assessments` rows.

---

## PACKAGE 6 — Notifications and documents

### Goal
Pending counter, co-owner notify privacy, honest email status, docs, BG/RU/EN extracts, PDF attach, archive, certified.

### Start state
Local `next dev` on TEST; Owner2 Book access; Admin; private storage.

### Steps

| Step | Action | Auto / Human | Pass |
|------|--------|--------------|------|
| 6.1 | During any pending: admin counter = SQL count | Semi | N1 / S4-AUTH-08 / SX-AUTH-03 |
| 6.2 | Two owners: each sees only own notifications | Semi | N2 / S4-AUTH-03 |
| 6.3 | Assert email status NOT_CONFIGURED / skip reason honest | Auto SELECT | N3 / S4-AUTH-04 |
| 6.4 | Supporting doc upload private | Human | D1 |
| 6.5 | Generate BG + RU + EN; `has_pdf=false` | Semi | D2 / S4-AUTH-01/09 / SX-AUTH-02 |
| 6.6 | Real PDF → `/api/ownership/attach-extract-pdf` | Semi | D3; has_pdf true; no public URL in report |
| 6.7 | Forged path / foreign doc rejected | Semi | D4 / S5B-AUTH-04 |
| 6.8 | Extract rows immutable after attach | Auto | Archive |
| 6.9 | Certified request → fulfill unsigned (`is_signed=false`) | Human | D5 / S4-AUTH-06 |

### Automation vs human
- Auto: notification row filters, email_skip_reason, has_pdf flags, API 401 without session.  
- Human: logins; file pickers; certified fulfill.  
- **Never print** access tokens, passwords, invite tokens, or private document URLs in reports.

### Readiness
**PARTIAL:** can formalize N1/N3 on next authorized transfer without new apt. Full D*/PDF needs Owner session + local API process.

---

## Per-package readiness board

| Package | Fixture ready | Sessions ready | Isolated apt needed | First auto action after auth | Manual actions |
|---------|---------------|----------------|---------------------|------------------------------|----------------|
| P1 | YES (99401 sole Owner2) | NO | Optional (prefer for 2→2 destructive) | Preflight SELECT + invalid roster | Login Owner2/Admin; approve; docs |
| P2 | YES | NO | Recommended | Duplicate pending RPC | Reject; stale Book; admin init |
| P3 | YES (transfers 30–32) | NO | No | Immutability SELECT | Linked correction; former-owner login |
| P4 | NO | NO | **YES** | — | Inheritance/guest Admin flows |
| P5 | NO (assessment/LE) | NO | **YES** | Gate flag SELECT | Finance post; LE; F3 restore |
| P6 | PARTIAL | NO | No for N1/N3 | Notify/email SELECT | Extracts; PDF; certified |

---

## Expected manual actions (human checklist)

1. Log in Admin on local app (TEST).  
2. Log in Owner2 (`…+test2@`); optionally test1/test3.  
3. Complete any pending invite for disposable buyers if 2→2 needs new emails.  
4. Upload supporting PDFs via Documents Core for approve paths.  
5. For P4/P5: create isolated apartments + LE/heir/guest Auth users in TEST only.  
6. For P5 F3: toggle gate ON only inside timed window; confirm OFF after.  
7. Authorize agent to proceed package-by-package (start with P1).

---

## Authorization gate

```
SAFE TO START PACKAGE 1 (fixture/isolation): YES
SAFE TO START PACKAGE 1 (this moment, sessions): NO — await human Auth logins + explicit execute authorization
```

**STOP** after this plan until the user authorizes mutations for a named package.
