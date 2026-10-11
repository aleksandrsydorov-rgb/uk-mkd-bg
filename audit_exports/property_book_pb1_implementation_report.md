# PKG-PB1-BOOK-ONLY IMPLEMENTATION REPORT

**Date:** 2026-10-10  
**Branch:** `main`  
**Mode:** Migrations prepared locally — **NOT applied** to remote (this task).

---

## Product decisions (applied)

1. Test DB business data is disposable — no backward compat for portal-only owners.  
2. Property Book is the **only** ownership SoT for access, UA eligibility, and new GM freezes.  
3. `properties.owner_email` / portal `owner_*` are display mirrors only — **never** authorize.  
4. No temporary legacy compatibility flags or cutover RPCs.  
5. Auth, staff, admin, and RLS preserved.  
6. No database reset; no remote migration apply in this task.

---

## Migration status (linked remote)

| Version | Local | Remote | Action |
|---------|-------|--------|--------|
| `20261010120000` | yes | **empty** | Amended in place (Book-only access truth) |
| `20261010120100` | yes | **empty** | Amended in place (invites / import / transfer) |
| `20261010233000` | yes | **empty** | Forward-only UA + GM freeze Book-only readers |

**Strategy:** Confirmed unapplied on linked remote → amend PB-1 files; add forward `20261010233000` for already-applied UA/GM definitions so a single apply sequence reaches Book-only. Do not rewrite older applied migrations (`202609*` / `20261008*`).

---

## What changed

### A. Property access
- `owns_property` = active Book owner + `property_book_owner_row_access_ready` (no `owner_email`).
- `list_my_owned_properties` already filters via `owns_property` → Book-only.
- Incomplete / invalid Book rows denied; sessions re-evaluate each call.

### B. User Activation
- `user_activation_owner_base` Book-only (no portal `owner_email` union) in `20261010233000`.
- Reminder/metrics tables unchanged; UA does not grant cabinet access.

### C. General Meetings
- `gm_freeze_notice_snapshot` / `gm_freeze_voting_snapshot` inner-join Book only.
- Existing snapshot rows not rewritten; voting formulas untouched (`dominant_owner_over_51` preserved).

### D. Admin property UI
- Apartments form: ownership editors replaced with Book-only notice + link to Книга.
- `handleSaveProp` still omits `owner_*` mutation fields.

### E. Transfers / invites
- Owner transfer request `from_*` snapshot from Book.
- Approve path remains `admin_approve_owner_transfer` (Book mutation).
- Invite accept still verifies current Book ownership; registration does not create Book owners.

### F. Legacy runtime
- No `property_book_runtime_flags`; cutover/disable/reconciliation RPCs dropped if present (`20261010233000`).
- Ops audit: `property_book_ownership_audit_report()`.

### G. Columns
- Portal `owner_*` columns kept (readers/mirrors still exist); not dropped.

---

## Files

### Migrations
- `supabase/migrations/20261010120000_property_book_pb1_access_truth.sql` (amended)
- `supabase/migrations/20261010120100_property_book_pb1_invites_import_transfer.sql` (amended)
- `supabase/migrations/20261010233000_property_book_book_only_readers.sql` (new)

### SQL tooling
- `supabase/property_book_pb1_preflight.sql`
- `supabase/property_book_pb1_verify.sql`
- `supabase/property_book_pb1_smoke.sql`
- `supabase/property_book_pb1_legacy_reconciliation.sql` (audit queries; name retained)

### Application
- `src/app/admin/page.tsx`
- `src/app/account/page.tsx`
- `src/i18n/messages.ts`
- `src/lib/database.types.ts`
- `src/lib/access.ts` (already Book RPC; no portal fallback)
- `src/components/admin/AdminPropertyBook.tsx` (prior PB-1)
- `src/app/auth/invite/page.tsx` (prior PB-1)

### Docs
- `audit_exports/property_book_pb1_implementation_report.md` (this file)

---

## How to apply later (ops — NOT done now)

1. Run `property_book_pb1_preflight.sql` on target.  
2. Apply the three migrations in version order.  
3. Run `property_book_pb1_verify.sql`.  
4. Run `property_book_pb1_smoke.sql` (`BEGIN`/`ROLLBACK`).  
5. Optionally run ownership audit SQL / RPC.

**Do not** `supabase db push` / reset / deploy from this task.

---

## Verification (this environment)

| Check | Result |
|-------|--------|
| Linked migration list (120000/20100/233000 remote) | empty → amend OK |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| SQL smoke against linked DB | **NOT RUN** (migrations not applied; no remote push) |
