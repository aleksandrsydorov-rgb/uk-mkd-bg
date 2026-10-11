# PKG-XFER Decisions Evidence Matrix (XFER.1–30)

**Legend**

- **COMPLETE** — Code + SQL drafted to meet requirement; runtime not yet verified on remote.
- **PARTIAL** — Material gap or metadata-only behavior.
- **MISSING** — Not implemented.
- **BLOCKED** — Waiting on legal/product dependency.
- Implementation completeness ≠ remote runtime verification (all rows: runtime **UNVERIFIED** until migrations applied + smokes executed).

| ID | Requirement (summary) | Implementation | Evidence | Status | Security / gaps | Required test |
|----|----------------------|----------------|----------|--------|-----------------|---------------|
| XFER.1 | Property Book is sole ownership SoT; approve replaces Book roster | `admin_approve_owner_transfer` → `admin_replace_property_book_owners`; UI RPCs only | `20261011140000`, `AdminOwnershipTransfers.tsx` | COMPLETE | Depends on PB-1 Book-only `owns_property` | Stage2 smoke approve |
| XFER.2 | Any co-owner may submit; no e-consent of others | `submit_ownership_change` uses `owns_property`; comment XFER.2 | `140000` ~L646 | COMPLETE | Direct INSERT still allowed for Book owners via trigger | Stage2 auth + owner submit |
| XFER.3 | Supporting legal docs required on approval | Approve requires type/number/date/path; UI Documents Core upload | `140000` approve; `AdminOwnershipTransfers` | COMPLETE | Path not cryptographically proven to exist in storage | Approve without upload |
| XFER.4 | Ownership shares must total 100% | `ownership_change_validate_owners` | `140000` validate | COMPLETE | — | Invalid share submit |
| XFER.5 | Ideal parts must match property total | Same validator | `140000` | COMPLETE | — | Invalid ideal submit |
| XFER.6 | Ordinary debt gate OFF until legal signoff | `ordinary_debt_gate_enabled` default false | `ownership_change_settings` | BLOCKED | Switch implemented & defaults OFF; **enabling** blocked on legal signoff | Gate OFF/ON smoke |
| XFER.7 | Overdue blocks (when ON); future-due does not | `ownership_change_overdue_debt` SF+capital | `140000`/`140200` | COMPLETE | Capital branch needs `capital_repair_*` present | Stage3 debt cases |
| XFER.8 | Multi-owner / partial transfer roster | Roster editor + `target_owners` jsonb | UI + RPCs | COMPLETE | — | Multi-owner approve |
| XFER.9 | Inheritance docs + legal effective date | `change_kind=inheritance`; same doc gate | `140000`/`OwnerOwnershipPanel` | COMPLETE | — | Inheritance approve |
| XFER.10 | Notifications; honest email status | `ownership_change_notify`; NOT_CONFIGURED | `140000`/`140300` | COMPLETE | No real provider integration yet | Notify skip_reason |
| XFER.11 | Inheritance never debt-blocked; liabilities manual | Skip debt for inheritance; `ownership_inherited_liabilities` | `140200` | COMPLETE | No auto share allocation (by design) | Inherit+overdue; liability confirm |
| XFER.12 | Pending inheritance; revoke access; voting off; quorum kept | `admin_set_inheritance_pending`; `gm_book_roster_hash`; `gm_write_vote` | `140000`/`140200` | COMPLETE | Invite expire on deceased | Vote cast deny |
| XFER.13 | Temp occupant via Guest Mode only | `admin_grant/revoke_inheritance_guest_access` → `property_guest_accesses` | `140000`/`140200` | COMPLETE | Relies on existing guest capability matrix | Guest grant/expire |
| XFER.14 | LE representative ≠ ownership change | `admin_update_legal_entity_representative` + history table | `140000`/`140200` | COMPLETE | Docs required in Stage3 replace | Rep replace + invite expire |
| XFER.15 | Admin-initiated change | `p_as_admin` / `admin_initiated` | Admin UI initiate | COMPLETE | — | Admin submit |
| XFER.16 | Admin correction ≠ fictitious sale | `admin_record_ownership_correction` | `140000` | COMPLETE | — | Correction smoke |
| XFER.17 | Applicant cancellation | `cancel_ownership_change` | `140000` + owner UI | COMPLETE | — | Cancel smoke |
| XFER.18 | Admin reject + mandatory reason | `admin_reject_owner_transfer` | `140000` | COMPLETE | — | Reject empty/with reason |
| XFER.19 | One pending per apartment | Unique partial index | `owner_transfers_one_pending_per_property_uidx` | COMPLETE | — | Double pending |
| XFER.20 | Stale Book baseline protection | Hash compare on approve | `baseline_roster_hash` | COMPLETE | — | Stale approve fail |
| XFER.21 | Linked correction of approved change | `admin_submit_linked_ownership_correction` | `140000` | PARTIAL | UI for linked correction not exposed in Stage2–4 panels | SQL-only today |
| XFER.22 | Admin pending counter | `admin_pending_ownership_change_count` + UI | `140000`, `AdminOwnershipTransfers` | COMPLETE | — | Counter accuracy |
| XFER.23 | Notification privacy + delivery truth | Payload strip; no false delivered | `140300` notify | COMPLETE | Provider acceptance path unused | Privacy smoke |
| XFER.24 | Owner-accessible filtered history | `owner_list_ownership_history` + UI | `140100`/`140300`, `OwnerOwnershipExtractsPanel` | COMPLETE | Former owner denied via `owns_property` | History + former deny |
| XFER.25 | Automatic PDF extracts | Client jsPDF + attach RPC | `propertyBookExtract.ts`, `140300` | COMPLETE | Server does not verify PDF bytes in storage | PDF verify script + UI |
| XFER.26 | No restricted PII in extracts | Strip email/EIK in snapshot/HTML | `140100` HTML | COMPLETE | — | Snapshot contents |
| XFER.27 | Immutable archive | Trigger + no overwrite; new rows | `property_book_extracts_immutable` | COMPLETE | `has_pdf`/status updates allowed | Second attach fails |
| XFER.28 | BG original + RU/EN linked | `linked_group_id` + locale rows | `owner_generate_property_book_extract` | COMPLETE | — | 3 locales group |
| XFER.29 | Certified request workflow (unsigned) | request/fulfill/reject; `is_signed=false` | `140100`/`140300`, `AdminCertifiedExtracts` | COMPLETE | Legal signing BLOCKED | Certified lifecycle |
| XFER.30 | Unique numbers; frozen download | Sequence numbers; `owner_get_property_book_extract` | `140100`/`140300` | COMPLETE | — | Mutate Book; HTML unchanged |

## Tariff (cross-cutting, often tied to ownership-type change)

| Topic | Status | Notes |
|-------|--------|-------|
| Prospective tariff engine on ownership-type change | **PARTIAL** | Only `tariff_subject_before/after` + `tariff_prospective_only` audit metadata in approve log. **No** call that rewrites or schedules new tariff charges. Existing Tariff Core remains source for future accruals if subject kind changes. |

## Counts (implementation completeness among XFER.1–30)

| Status | Count |
|--------|------:|
| COMPLETE | 28 |
| PARTIAL | 1 (XFER.21 — RPC yes, admin UI no) |
| MISSING | 0 |
| BLOCKED | 1 (XFER.6 — gate enablement pending legal signoff; default OFF is implemented) |

**Cross-cutting (not a numbered XFER id):** Tariff prospective application on ownership-type change is **PARTIAL** (approve logs `tariff_subject_before/after` only; no charge engine call).
