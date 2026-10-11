# PKG-XFER STAGE 5A AUDIT REPORT

**Date:** 2026-10-11  
**Project:** uk-mkd-bg  
**Branch / HEAD:** `main` / `f2797a2466397b97599ecc644efc1cc7fc5d8bbf`  
**Supabase:** klowacuvufknbrkayjhz (not written in this stage)

## Working tree status

Dirty / uncommitted PKG-XFER + PB-1 related work:

- Modified: account/admin/invite pages, `access.ts`, `ownership.ts`, `messages.ts`, `database.types.ts`, `pdfDownload.ts`, Admin Property Book, labels.
- Untracked PKG-XFER: migrations `140000`–`140300`, Stage 2–4 smokes, ownership UI components, extract/PDF libs, verify script.
- Also untracked (dependencies): PB-1 migrations, `20261011005000_owner_transfers_transfer_approve_guard.sql`, lifecycle migrations.
- `tmp/` contains local PDF verification artifact.

No reset/revert performed.

---

## 1. Repository and change audit

| Check | Result |
|-------|--------|
| Accidentally deleted functionality | No evidence of mass deletes in PKG-XFER scope; ownership UI additive |
| Duplicate ownership Core | Single path: Book + extended `owner_transfers` RPCs |
| Legacy direct `owner_transfers` INSERT in active UI | **None** (grep clean); UI uses `submit_ownership_change` / admin RPCs |
| Auth via `properties.owner_email` | Client `access.ts` documents Book-only; display still shows portal `owner_email` fields (not auth) |
| Book SoT | Approvals call `admin_replace_property_book_owners` |
| PB-1 / PB-1.8 | Book-only `owns_property` migration present; XFER builds on it |
| Outside features preserved | Meeting/Guest/Finance/Tariff cores referenced, not replaced |

---

## 2. Four-migration preflight

### Order

1. `20261011140000_pkg_xfer_ownership_change_core.sql`
2. `20261011140100_pkg_xfer_extracts_history.sql`
3. `20261011140200_pkg_xfer_stage3_finance_inheritance_entity.sql`
4. `20261011140300_pkg_xfer_stage4_notify_history_pdf.sql`

### Hard dependencies (must exist before 140000)

| Dependency | Source |
|------------|--------|
| `property_book_transfer_approve_gate` | **`20261011005000`** — **140000 does not create this table** |
| `admin_assert_book_admin`, `property_book_set_mutating`, `admin_replace_property_book_owners`, Book-only `owns_property` | PB-1 |
| `guest_access_expire_stale`, `property_guest_accesses` | Guest Mode |
| `support_fee_assessments`, optionally capital repair | Finance Core |
| `property_tariff_subject_kind` | Tariff Core |
| `gm_write_vote` / `property_voting_parties` | Meeting Core (140200 patches) |

### Per-migration assessment

| Migration | Syntax / structure | Conflicts | Verdict |
|-----------|-------------------|-----------|---------|
| 140000 | BEGIN/COMMIT; extends tables; SECURITY DEFINER + revokes | Replaces simpler `admin_approve_owner_transfer(bigint)` from 110050 with multi-arg + wrapper — **intended** | PASS *if deps present* |
| 140100 | Extract archive + generate/history RPCs | Unique `extract_number`; immutable trigger | PASS |
| 140200 | Replaces approve/debt/vote/parties; expands liabilities | Recreates `gm_write_vote` (must stay last meeting patch in chain) | PASS *with caution* |
| 140300 | PDF attach, notify privacy, certified admin, history polish | Extends notify event_kind CHECK | PASS |

### Idempotency

- Settings insert `ON CONFLICT DO NOTHING`.
- `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` used widely.
- Function `CREATE OR REPLACE` — re-runnable with care; triggers dropped/recreated.

### Destructive data risk

- No TRUNCATE/DELETE of business apartments.
- Book replace on approve is intentional ownership mutation (RPC-gated).

**Local SQL execution against remote:** not performed (per restrictions). Use `supabase/pkg_xfer_migration_preflight.sql` before any apply.

---

## 3. Security audit

| Control | Enforcement | Notes |
|---------|-------------|-------|
| Admin-only approval | `admin_assert_book_admin` + approve gate ticket | Gate table zero client grants (110050) |
| Owner-only submission | `owns_property` or admin in submit | Direct INSERT still possible for Book owner via trigger — not used by UI |
| Co-owner permissions | Book `owns_property` | No e-consent required (by design) |
| One pending / apt | Unique partial index | |
| Stale baseline | Roster hash on approve | |
| Share / ideal validation | `ownership_change_validate_owners` | |
| Supporting docs | Required on approve | Storage existence not re-checked server-side |
| Former-owner access | Book replace + PB-1 sync + invite expire + `access_revoked` notify | No Supabase Auth token force-logout |
| No GUC authority for approve | Table gate, not spoofable GUC | Documented in 110050 |
| Documents Core privacy | Private bucket paths; no public URLs in code path | Attach trusts client path/sha |
| Notification privacy | Payload strips paths/rosters (140300) | |
| Former owner history/extracts | `owns_property` gate on RPCs | |
| Authenticated INSERT on extracts/liabilities | Revoked; RPC-only | |

**Authenticated-role note:** Stage 2 auth script checks privileges without JWT spoofing. Lifecycle smokes still use `set_config` JWT claims — **not** equivalent to live session tests.

---

## 4. Finance / inheritance / meeting / guest / LE / tariff

| Area | Finding |
|------|---------|
| Overdue debt | Uses `support_fee_assessments.remaining_due` + `early_deadline_at`; capital net by `due_date` |
| Future-due | Tracked separately; does not set `blocks_ordinary` alone |
| Debt gate default | **OFF** |
| Inheritance vs debt | Skipped for inheritance / correction |
| Inherited liabilities | Manual RPC; no auto % allocation; no finance rewrite |
| Pending inheritance voting | `voting_eligible=false`; filtered from `property_voting_parties`; `gm_write_vote` denies |
| Quorum | `gm_book_roster_hash` keeps deceased/pending rows; not deregistered |
| Meeting snapshots | Not rewritten by XFER |
| Guest | Reuses `property_guest_accesses` |
| LE representative | Entity stays owner; history table; docs required (140200) |
| **Tariff** | **PARTIAL — audit metadata only** (`tariff_subject_before/after`, `tariff_prospective_only`). No prospective charge engine call. |

---

## 5. Notifications and documents / PDF

| Topic | Finding |
|-------|---------|
| Pending counter | RPC + admin UI |
| Co-owner notify | Informational events; no consent |
| Email honesty | `email_delivered=false`; skip `NOT_CONFIGURED` / `NOT_SENT_NO_PROVIDER_ACCEPTANCE` |
| Legal docs | Documents Core private upload in admin/owner flows |
| Extracts | Frozen HTML/snapshot; download via `owner_get_property_book_extract` |
| `has_pdf` | Only after `owner_attach_property_book_extract_pdf` |
| Unique numbers | Sequence + locale suffix |
| BG/RU/EN | `linked_group_id` |
| Immutable | Trigger blocks content mutation |
| Certified | Fulfilled remains `is_signed=false` |
| **PDF pipeline risk** | Generate can succeed (HTML rows) while client PDF/upload fails → orphans with `has_pdf=false` (honest). Retry creates new numbers (OK). **Server does not verify storage object or `%PDF` magic.** Duplicate attach rejected. |

Local PDF verification: **PASS** (`scripts/verify-property-book-extract-pdf.mjs`).

---

## 6. Decision matrix summary

See `audit_exports/pkg_xfer_decision_matrix.md`.

| Status | Count |
|--------|------:|
| COMPLETE | 28 |
| PARTIAL | 1 (XFER.21 linked-correction UI) |
| MISSING | 0 |
| BLOCKED | 1 (XFER.6 production enablement of ordinary debt gate — legal) |

Tariff prospective application: **PARTIAL** (cross-cutting, not a separate XFER id).

Runtime verification for all: **UNVERIFIED** (migrations unapplied).

---

## 7. Test suite prepared

| Script | Purpose |
|--------|---------|
| `supabase/pkg_xfer_migration_preflight.sql` | Read-only dependency checks |
| `supabase/pkg_xfer_post_migration_verify.sql` | Per-step + ACL verify |
| `supabase/pkg_xfer_stage2_smoke.sql` | Lifecycle (JWT helper) |
| `supabase/pkg_xfer_stage2_auth_role_security.sql` | Privilege ACL (no spoof) |
| `supabase/pkg_xfer_stage3_smoke.sql` | Finance/inheritance/vote/guest |
| `supabase/pkg_xfer_stage4_smoke.sql` | Notify/history/PDF/certified |
| `supabase/pkg_xfer_cross_stage_smoke.sql` | Integration + residual notice |
| `audit_exports/pkg_xfer_browser_ui_smoke_checklist.md` | Manual UI |
| `scripts/verify-property-book-extract-pdf.mjs` | Real PDF bytes |

**Not executed remotely** in Stage 5A.

---

## 8. Local validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS |
| `node scripts/verify-property-book-extract-pdf.mjs` | PASS (`%PDF`, content markers) |
| Local Supabase | Not initialized (per instructions) |

---

## 9. Critical / noncritical defects (document only — no code fixes)

### Critical (block remote apply until cleared)

1. **Remote dependency confirmation missing** — especially `property_book_transfer_approve_gate` (110050) and PB-1 RPCs. Run preflight on TEST before apply.
2. **No remote runtime proof** — SQL smokes and browser checklist not executed against TEST.

### Noncritical (Stage 5B candidates; do not block carefully staged TEST apply after preflight)

1. **XFER.21** linked correction RPC exists; **no admin UI**.
2. **Tariff** integration is metadata-only; no prospective accrual wiring.
3. **PDF attach** trusts client `storage_path` + sha; no server-side storage HEAD / magic-byte check.
4. **HTML extract orphans** if PDF step fails mid-flight.
5. Lifecycle smokes use JWT `set_config` — supplement with real browser sessions.
6. `admin_set_inheritance_pending` 3-arg/7-arg overloads — confirm PostgREST resolution.
7. Portal `owner_email` still displayed in unrelated admin UI (not auth path).

### Legal approval dependencies

- Ordinary debt gate must stay **OFF** until Bulgarian counsel signoff (XFER.6/7).
- Certified extract remains **unsigned** until legal signing workflow approved (XFER.29).

---

## 10. SAFE TO APPLY REMOTE MIGRATIONS

### **NO** (not yet)

**Blockers**

1. Execute `pkg_xfer_migration_preflight.sql` on TEST and obtain PASS (confirm 110050 + PB-1).
2. Explicit human authorization to apply on TEST.
3. After apply: post-verify + smokes + browser checklist must PASS before any production consideration.

### Bounded Stage 5B repair plan (after/with TEST apply as needed)

1. Run remote preflight; if gate missing, apply `20261011005000` then re-preflight.
2. Apply 140000→140300 per execution plan with STOP gates.
3. Fix only defects that fail verify/smoke (prefer additive 140301+; do not rewrite applied history).
4. Optional 5B product fixes: linked-correction UI; server-side PDF validation; tariff prospective hook (product decision).
5. Re-run matrix runtime column; only then consider production.

---

## Output files

- `audit_exports/pkg_xfer_stage5a_audit_report.md` (this file)
- `audit_exports/pkg_xfer_decision_matrix.md`
- `audit_exports/pkg_xfer_migration_execution_plan.md`
- `audit_exports/pkg_xfer_browser_ui_smoke_checklist.md`
- `supabase/pkg_xfer_migration_preflight.sql`
- `supabase/pkg_xfer_post_migration_verify.sql`
- `supabase/pkg_xfer_cross_stage_smoke.sql`

**STOP. Wait for explicit authorization.**
