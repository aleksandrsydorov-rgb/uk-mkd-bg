# PKG-XFER Authenticated UI Scenario Matrix

**Supabase TEST:** `klowacuvufknbrkayjhz`  
**App:** local `next dev` → `.env.local` → `https://klowacuvufknbrkayjhz.supabase.co`  
**Forbidden:** apt `99501`, Owner A/B. Use disposable apts `99401+` and `smoke.session.*@example.com`.  
**Auth:** real Supabase sessions only. No JWT spoof.  
**Status:** PREPARED — not executed. Do not create fixtures until authorized.

## Disposable identity kit (create only after authorization)

| Alias | Email pattern | Role |
|-------|---------------|------|
| Owner1 | `smoke.session.owner1@example.com` | Book sole/co-owner |
| Owner2 | `smoke.session.owner2@example.com` | Co-owner / second natural |
| Buyer1 | `smoke.session.buyer1@example.com` | Incoming owner |
| Buyer2 | `smoke.session.buyer2@example.com` | Incoming co-owner |
| LE | `smoke.session.le@example.com` | Legal-entity owner contact |
| Admin | existing TEST admin (not Owner A/B) | `администрация` |

Cleanup default: cancel/reject pending → linked-correct or re-approve reverse roster → deregister Book owners → mark apt retired/unused; never leave debt gate ON.

## Routes

| Surface | Route |
|---------|-------|
| Owner cabinet | `/account` → apartment → ownership accordion (`OwnerOwnershipPanel`) |
| Owner extracts | same panel → `OwnerOwnershipExtractsPanel` |
| Admin transfers | `/admin?section=смены` (`AdminOwnershipTransfers`) |
| Admin Book | `/admin` Property Book section |
| Admin Stage3 | transfers page → `AdminOwnershipStage3Panel` |
| Certified | transfers page → `AdminCertifiedExtracts` |
| Invite accept | `/auth/invite?token=…` |
| PDF attach API | `POST /api/ownership/attach-extract-pdf` (local Next process) |

---

## Scenarios

### A1 — 1→1 submit + cancel
- **Start:** apt 99401; Book sole Owner1; Owner1 Auth session; no pending transfer
- **Actor:** Owner1
- **UI:** `/account` → ownership → roster Buyer1 100% / ideals match → submit
- **DB:** `owner_transfers` status `ожидает`; baseline hash set; one-pending index holds
- **Security:** only Book co-owner can submit; unauthenticated insert denied
- **Then:** cancel via UI → status `отменена`; pending slot free
- **Cleanup:** leave cancelled row (audit) or ignore after cancel

### A2 — 1→many
- **Start:** A1 apt free of pending; Owner1 sole
- **Actor:** Owner1
- **UI:** roster Buyer1 60% + Buyer2 40%; ideals sum = property ideal
- **DB:** pending with 2 target owners; validate shares=100
- **Security:** no co-owner e-consent required (XFER.2)
- **Cleanup:** cancel or admin reject

### A3 — many→1
- **Start:** Book Owner1+Owner2; either may submit
- **Actor:** Owner1
- **UI:** single Buyer1 100%
- **DB:** baseline lists both; approve replaces Book with Buyer1 only
- **Security:** Owner2 loses `owns_property` after approve (pair with X1)
- **Cleanup:** reverse via linked correction / new transfer after test

### A4 — many→many
- **Start:** Owner1+Owner2 on Book
- **Actor:** Owner1
- **UI:** Buyer1+Buyer2 shares/ideals valid
- **DB:** target_owners length ≥ 2; approve swaps full roster
- **Security:** former owners denied post-approve
- **Cleanup:** as A3

### A5 — partial shares
- **Start:** Owner1 100%
- **Actor:** Owner1
- **UI:** Owner1 retained 40% + Buyer1 60% (if product allows keep-seller) **or** two buyers only — match UI roster rules
- **DB:** shares total 100; ideals match property
- **Security:** invalid totals rejected client+RPC
- **Cleanup:** cancel pending

### A6 — admin approve + Documents Core
- **Start:** pending ordinary transfer; supporting PDF ready
- **Actor:** Admin
- **UI:** `/admin?section=смены` → upload doc → approve with type/number/date
- **DB:** status `утверждена`; Book roster = targets; notify rows; optional tariff transition if N↔L
- **Security:** approve RPC staff-only; path via building-documents
- **Cleanup:** leave approved history; apt becomes buyer-owned for X1/D*

### A7 — admin reject
- **Start:** pending transfer
- **Actor:** Admin
- **UI:** reject; empty reason blocked; non-empty succeeds
- **DB:** `отклонена` + reject_reason; pending free
- **Security:** non-admin cannot reject
- **Cleanup:** none

### A8 — duplicate pending
- **Start:** one pending on apt
- **Actor:** Owner1
- **UI:** second submit
- **DB:** rejected (unique index / RPC); still one `ожидает`
- **Security:** one-pending invariant
- **Cleanup:** cancel first

### A9 — stale baseline
- **Start:** pending with baseline hash H1; admin mutates Book (material hash field) via Book UI
- **Actor:** Admin approve
- **UI:** approve fails stale baseline
- **DB:** transfer remains pending or explicit fail; Book not replaced by stale targets
- **Security:** hash gate (XFER.20)
- **Cleanup:** cancel stale pending; restore Book

### A10 / A11 — linked correction
- **Start:** approved transfer id T
- **Actor:** Admin
- **UI:** linked correction form → docs → `admin_submit_linked_ownership_correction`
- **DB:** new pending with `corrects_transfer_id=T`; original approved immutable
- **Security:** staff-only; docs required
- **Cleanup:** reject/cancel linked pending or approve intentionally

### F1 — debt gate OFF warning
- **Start:** disposable apt with Finance Core overdue SF assessment (`remaining_due>0`, `early_deadline_at < now()`, `status=open`, valid pricing_rule/qualification); `ordinary_debt_gate_enabled=false`
- **Actor:** Admin on approve
- **UI:** warning visible; approve still allowed
- **DB:** approve succeeds; `debt_gate_applied=false`
- **Security:** gate default OFF (XFER.6)
- **Cleanup:** do not leave gate ON; void/correct test assessment per Finance Core rules if needed

### F2 — inheritance + overdue
- **Start:** overdue as F1; pending `change_kind=inheritance`
- **Actor:** Admin approve
- **UI:** succeeds despite overdue
- **DB:** Book updated; debt not blocking
- **Cleanup:** as A6

### F3 — gate ON block (temporary)
- **Start:** overdue; enable gate only inside test window
- **Actor:** Admin approve ordinary
- **UI/DB:** blocked while ON
- **Security:** restore `ordinary_debt_gate_enabled=false` immediately
- **Cleanup:** **mandatory gate restore**

### F4 — historic assessments after N↔L
- **Start:** posted SF assessment; approve natural→legal (or reverse)
- **Actor:** Admin
- **UI/DB:** assessment amounts unchanged; `ownership_tariff_transitions` row prospective-only
- **Cleanup:** none destructive

### I1 / I2 — inheritance pending + voting
- **Start:** Owner1 on Book
- **Actor:** Admin Stage3 panel
- **UI:** set inheritance pending / deceased
- **DB:** `voting_eligible=false`; ideal_parts unchanged (quorum)
- **Security:** vote cast denied for that party
- **Cleanup:** restore active or complete inheritance transfer

### I3 — guest grant/revoke
- **Start:** inheritance pending
- **Actor:** Admin
- **UI:** grant guest → occupant `/account` limited; revoke
- **DB:** `property_guest_accesses`; no ownership ops
- **Cleanup:** revoke guest

### I4 — inherited liability
- **Start:** post-inheritance or Stage3 panel
- **Actor:** Admin
- **UI:** record + confirm manual liability
- **DB:** `ownership_inherited_liabilities`; finance ledgers unchanged
- **Cleanup:** leave audit row

### L1 / L2 — LE representative
- **Start:** Book legal_entity owner
- **Actor:** Admin
- **UI:** representative change + docs
- **DB:** history row; entity remains owner; no tariff subject change; former invite expired
- **Cleanup:** none

### N1–N4 — notifications / history privacy
- **Start:** after submit/approve path
- **Actor:** Admin + Owner1
- **UI:** pending counter; owner notify list; history panel
- **DB:** notify rows; email_skip_reason honest; history RPC strips storage paths
- **Security:** owner sees only own notifications
- **Cleanup:** none

### D1–D5 — documents / PDF / certified
- **Start:** current Book owner session; local Next running
- **Actor:** Owner1 / Admin
- **UI:** generate BG/RU/EN → upload PDF doc → attach via API → certified request/fulfill
- **DB:** extracts `has_pdf=false` until attach; after attach true; certified `is_signed=false`
- **Security:** API 401 without session; forged path / foreign doc rejected; no public URL trust
- **Cleanup:** extracts immutable (retain)

### X1–X3 — former owner
- **Start:** after A6 approve removing Owner1
- **Actor:** Owner1 session
- **UI:** apt absent / denied; extract/history denied
- **DB:** `owns_property` false
- **Cleanup:** none

---

## Finance SQL gaps (S3-DB-01 / S3-DB-03)

Remote `support_fee_assessments` rejects the Stage 3 smoke insert because:
- `pricing_rule` must be `early_full_payment` | `late` | `standard` (smoke used `smoke`)
- `qualification_status` must be `not_checked` | `qualified` | `not_qualified` (smoke used `unknown`)

Consequently no overdue fixture → S3-DB-03 SKIPPED.

**Safe UI/Finance Core validation:** create/post assessment on disposable apt via Support Fee admin RPCs/UI with past `early_deadline_at` and `remaining_due > 0`, then call `admin_get_ownership_debt_status` / exercise F1–F3. Do not hand-insert invalid rows; do not leave gate ON.

---

## Execution order (when authorized)

1. Confirm admin Auth login on local app  
2. Create disposable apt + Book Owner1 + invite/register Owner1  
3. **A1** (first executable ownership scenario)  
4. A2 → A8 → A7 → A6 → X1  
5. A9, A10/A11, F*, I*, L*, D*, N* as dependencies allow  
