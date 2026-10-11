# PKG-XFER — Six-Package Final Report

**Project:** `klowacuvufknbrkayjhz` (TEST)  
**App:** `http://localhost:3001`  
**Completed:** 2026-10-11 / 2026-10-12  
**Verdict:** **ALL PACKAGES PASS** (P1–P6)

No commit / push / deploy was performed in this run. Below: package results, open fixtures, and **repository items still to commit**.

---

## Package verdicts

| Package | Focus | Verdict |
|---------|--------|---------|
| **1** | Partial + 2→2 ownership (99401) | **PASS** |
| **2** | Reject / duplicate / stale / admin-init / negatives | **PASS** |
| **3** | Corrections + history immutability + privacy | **PASS** (raw SELECT privacy note in P3 file) |
| **4** | Inheritance + guest | **PASS** (P4.5 closed in P5) |
| **5** | Finance overdue / LE / tariffs / debt gate | **PASS** |
| **6** | Notifications + extracts + PDF + certified | **PASS** |

Per-package detail: `audit_exports/pkg_xfer_package{1..6}_progress.md`.

---

## Package highlights

### Package 1 — Ownership change happy path
- #33 partial Owner2→Owner2/Owner3; #34 2→2 Owner1/Owner3 on **99401**
- Former Owner2 denied after exit

### Package 2 — Controls
- Reject with reason; duplicate pending blocked; stale baseline on **99402**; admin-initiated #39; security negatives

### Package 3 — Corrections / history
- XFER.16 correction + linked correction #41 → 60/40 on **99402**; #39 immutable

### Package 4 — Inheritance / guest
- Pending inheritance, multi-heir #42 on **99403**, guest on **99404**
- Guest nav render-loop fix in `src/app/account/page.tsx`
- Later: guest MobileBottomNav filter via `MENU_ITEMS` (guest mode PASS)

### Package 5 — Finance / legal entity
- Overdue + future-due fixtures (**99405** / **99406**)
- F1 ordinary approve with debt warning, gate OFF (#43)
- Assessments unchanged (F4); inherited liability confirmed
- LE representative change (no tariff flip); N↔L #44 prospective tariff only
- F3 gate ON block (#46) + **mandatory restore OFF**
- P4.5 inheritance with overdue (#45) not debt-blocked

### Package 6 — Notify / documents
- Pending counter matches SQL (#47 kept pending)
- Notification privacy Owner1/Owner2
- Honest `NOT_CONFIGURED` email skip
- Private supporting docs
- BG/RU/EN extracts on **99403** (#3–5); PDF attach; immutability
- Certified #6 fulfilled **`is_signed=false`**
- Forged attach rejected (401/404/400)

---

## Safety invariants (end of run)

| Check | Status |
|-------|--------|
| `ordinary_debt_gate_enabled` | **false** |
| Protected apt **99501** | untouched for PKG-XFER goals |
| Pending transfer **#47** (99406) | still `ожидает` (intentionally retained) |
| RLS not bypassed from app clients | yes (staff RPCs / linked SQL only for TEST repairs) |

---

## Isolated fixtures used

| Apt | Property | Role in test |
|-----|----------|--------------|
| 99401 | 107 | P1–P2 shared ownership (protected from further P5/P6 mutation) |
| 99402 | 108 | P2–P3 corrections |
| 99403 | 109 | P4 inheritance; P6 extracts/certified |
| 99404 | 110 | P4 guest / deceased Owner2 |
| 99405 | 111 | P5 finance / ordinary / inheritance+debt |
| 99406 | 112 | P5 LE/N↔L; P6 pending #47 |

---

## Migrations / code still to include in the repository

These exist in the working tree and were **applied on TEST** via `supabase db query --linked` where noted. They are **not committed** (per instructions).

### New / updated SQL (commit candidates)

| File | Purpose | Applied on TEST |
|------|---------|-----------------|
| `supabase/migrations/20261011203000_pkg_xfer_sf_early_deadline_stamp.sql` | Stamp `early_deadline_at` on finalize (incl. standard); `admin_backfill_support_fee_early_deadlines` | Yes |
| `supabase/migrations/20261011204500_pkg_xfer_admin_set_ordinary_debt_gate.sql` | Staff RPC to toggle debt gate (F3); direct UPDATE was denied | Yes |
| `supabase/migrations/20261011210000_pkg_xfer_owner_extract_pdf_upload.sql` | Owner storage + `building_documents` INSERT for extract PDFs; read own drafts | Yes |
| `supabase/migrations/20261011211000_pkg_xfer_extract_pdf_snapshot_allow.sql` | Allow PDF metadata on attach; freeze after `has_pdf` | Yes |

Earlier stage migrations (`20261011140000`–`140500`) were already part of the XFER series; treat as already in-repo unless git shows otherwise.

### Application code (commit candidates)

| File | Change |
|------|--------|
| `src/app/account/page.tsx` | Guest mode: management-tab / bottom-nav filtering (guest PASS) |
| `src/components/admin/AdminSupportFeeAnnual.tsx` | Single-apartment finalize UI; removed temp `__lastSfFinalize` debug |
| `src/lib/database.types.ts` | Types for `admin_set_ordinary_debt_gate`, `admin_backfill_support_fee_early_deadlines` |
| i18n keys for SF finalize-one (if present in locale files) | Support admin single-apt finalize labels |

### Recommended follow-up before production

1. Commit the four migrations + app fixes above; run CI / smoke.
2. Confirm migration history on TEST matches repo filenames (linked apply may not have recorded all in `supabase_migrations.schema_migrations` — reconcile with `supabase migration list` / repair if needed).
3. Optionally clear or reject pending **#47** after P6 archival (left open by design).
4. Consider Admin UI control wired to `admin_set_ordinary_debt_gate` (RPC exists; F3 used CDP).
5. P3 note: tighten raw `owner_transfers` SELECT privacy if still open.

---

## Transfers / extracts reference (non-exhaustive)

| ID | Kind | Note |
|----|------|------|
| 33–34 | ordinary | P1 |
| 35–39 | reject/dup/stale/admin | P2 |
| 41 | correction_link | P3 |
| 42 | inheritance | P4 |
| 43 | ordinary + debt warn | P5 F1 |
| 44 | entity_person N↔L | P5.6 |
| 45 | inheritance + overdue | P4.5/P5 |
| 46 | ordinary blocked gate ON | P5 F3 (rejected) |
| 47 | pending | P6.1 fixture **kept** |
| Extracts 3–5 | informational + PDF | P6.5–6.8 on 99403 |
| Extract 6 | certified fulfilled unsigned | P6.9 |

---

## Sign-off

PKG-XFER authenticated UI / RPC suite for Packages **1–6** is **complete on TEST**.  
Debt gate restored OFF. Protected apartments respected for late-package goals.  
**Next human step:** review and commit the pending migrations/code listed above when ready (no deploy from this agent session).
