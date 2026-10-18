# 08 — General Meetings / Electronic Governance

**Product:** Meeting Core / `general_meeting`  
**Canon:** `docs/meeting-core.md`, `docs/ОПИСАНИЕ_ПРОЕКТА_ДЛЯ_EMAIL.md`  
**Explicit product flag:** `needs_legal_signoff` before production.

> Do **not** claim digital voting, scanned signatures, or in-app notices have full ЗУЕС legal effect until Bulgarian counsel confirms.

---

## A. Inventory (product capability vs legal document)

| Topic | Product status | Legal document / evidence needed | Lawyer |
|-------|----------------|----------------------------------|--------|
| Meeting invitation | IMPLEMENTED / PARTIAL (versioning in roadmap) | Official invitation text (BG), delivery proof | YES |
| Placement protocol | Documented in product brief | Signed placement protocol + photos | YES — electronic sufficiency |
| Attendance / registration | IMPLEMENTED (desk + online windows) | Registration list | YES |
| Proxies | PARTIAL (max 3 enforced in smoke) | Power of attorney form; ID checks | YES |
| Quorum | IMPLEMENTED (rules/stages) | Quorum calculation record (immutable) | YES — % rules vs ЗУЕС |
| Voting | IMPLEMENTED (immutable votes target) | Ballot / vote record | YES — online/hybrid |
| Electronic / hybrid participation | PARTIAL | House rules allowing video; identity procedure | YES |
| Ballots | PARTIAL | Ballot templates | YES |
| Candidate consent | Roadmap / governance terms | Written consent of candidates | YES |
| Minutes / protocol | PARTIAL (WET_SCAN path) | Protocol ОС minimum requisites | YES |
| Decisions | IMPLEMENTED (decisions module) | Decision extracts | YES |
| Document delivery | PARTIAL (in-app; email may be LOCAL_ONLY) | Proof of proper notice under ЗУЕС | YES |
| Acknowledgement | PARTIAL | Read receipts vs legal notice | YES |
| Archiving | PARTIAL | Retention schedule | YES |
| Immutable snapshots | Target / foundation | Notice + voting snapshots | Evidence design OK; legal weight **lawyer** |
| Electronic / scanned signatures | WET_SCAN concept | Whether scan = signed original | YES |
| Printed documents | Supported as uploads | Paper originals policy | YES |
| QR codes | Product mentions in broader docs | Authentication of printouts | Optional / lawyer |

---

## B. Evidence & audit trail requirements (product-aligned)

| Evidence | Why |
|----------|-----|
| Append-only audit log | Challenge defence |
| Invitation version hash | Supersede tracking |
| Quorum check rows | Immutable % |
| Vote insert-only | No silent edits |
| Proxy records + limits | Abuse prevention |
| Protocol file + metadata | Authenticity |
| Delivery log | Notice disputes |

Repo: Meeting Core aims for these; treat as **PARTIAL** pending production sign-off.

---

## C. Lawyer questions (meetings)

1. Is in-app-only invitation sufficient under ЗУЕС?  
2. Is placement protocol via signed PDF + photo board sufficient?  
3. When does online participant enter quorum?  
4. Hybrid meetings — prerequisites in house rules?  
5. Absentee voting limits (elections)?  
6. Non-owner admin candidates?  
7. Municipality / EISES filing pack contents?  
8. Retention period for meeting artifacts?  
9. Admissibility of platform logs in court?  

**Meetings mapped:** YES (inventory) — **legal validity: NOT CONCLUDED**.
