# PKG-XFER Package 2 Progress

**Project:** `klowacuvufknbrkayjhz` (linked ✓) · **Local:** http://localhost:3001  
**Started:** 2026-10-11  
**Mode:** human login checkpoints · Cursor shared cookie jar (one session at a time)  
**Depends on:** Package 1 PASS (CP1–CP9)

## Preflight (read-only)

| Check | Result |
|-------|--------|
| Linked project | `klowacuvufknbrkayjhz` ✓ |
| Apt 99401 / property_id 107 | `ownership_type=shared` |
| Active Book | test1 **40%/0.4** + test3 **60%/0.6** |
| Pending transfers | 0 |
| Debt gate | OFF |
| Forbidden 99501 | untouched |
| Former Owner2 | no Book access (P1 CP9) |

### Starting Book snapshot (99401)

| Email | Share | Ideals | Status |
|-------|-------|--------|--------|
| zoomconf0001+test1@gmail.com | 40 | 0.4 | active |
| zoomconf0001+test3@gmail.com | 60 | 0.6 | active |

## Scenarios

| ID | Scenario | Apt | Status |
|----|----------|-----|--------|
| P2.1 | Rejection with reason | 99401 | **PASS** — #35 `отклонена`; empty reason blocked; Book unchanged; notify OK |
| P2.2 | Duplicate pending | 99401 | **PASS** — #36 pending; duplicate RPC 23505; cancelled; Book unchanged |
| P2.3 | Stale baseline | **99402 / 108** | **PASS** — Book ideals 1→0.99; approve #38 denied stale; Book not 70/30; cleanup reject+restore OK |
| P2.4 | Admin-initiated | **99402 / 108** | **PASS** — #39 `утверждена`; Book Owner1 70%/0.7 + Owner3 30%/0.3 |
| P2.5 | Security negatives | 99401 + sessions | **PASS** — AUTH-08; former Owner2 deny; Owner1 direct UPDATE deny |

## Evidence log

### P2.1a — Owner1 submit
- Session: `zoomconf0001+test1@gmail.com` · Heading № 99401 · Test Owner1
- Submitted `sale` disposable roster Owner1 **50%/0.5** + Owner3 **50%/0.5**
- Comment: `PKG-XFER P2.1 disposable reject test 50/50`
- DB: transfer **id=35** status `ожидает`; pending_n=1
- Active Book unchanged: test1 **40%/0.4** + test3 **60%/0.6**

### P2.1b — Admin reject
- Session: Admin on `/admin?section=смены`
- Empty reason (UI prompt whitespace): **denied** — toast «Укажите причину отклонения.»; pending stayed 1
- Server RPC empty reason: enforced in `admin_reject_owner_transfer` (`reason required`); client gate verified above
- Reject with reason: `PKG-XFER P2.1 reject: disposable test — incomplete documentation`
- DB #35: status **`отклонена`**; reject_reason set; decided_at set; pending_n=0
- Active Book unchanged: test1 **40%/0.4** + test3 **60%/0.6**
- Audit: rejected row retained; reason visible in admin history UI
- Notifications (#35): submitted → owners+admin; rejected → both owners; email_skip_reason=`NOT_CONFIGURED`; in_app_delivered=true

### P2.2 — Duplicate pending
- Session: Owner1 on 99401
- First submit: transfer **id=36** `ожидает` (45/55 disposable); Book still 40/60; UI cancel visible
- Second submit (authenticated RPC `submit_ownership_change`): **DENIED**  
  - message: `submit_ownership_change: property already has a pending ownership-change request`  
  - code: `23505` (unique pending index)
- No new transfer row (only #35 rejected + #36 pending → then cancelled)
- Cleanup: owner cancel → #36 **`отменена`**; pending_n=0; Book unchanged 40/60
- UI after cancel: submit form available again

### Disposable apt provision (APPROVE DISPOSABLE APT)
- Project: `klowacuvufknbrkayjhz` ✓
- Pre-check: **99402 free** (no row)
- Created via admin apartments UI insert: **apt 99402 · property_id=108** · floor 9 · 50 m² · status `в собственности`
- Initial Book via authorized RPCs `admin_upsert_property_book_object` + `admin_replace_property_book_owners`:
  - sole Owner1 `zoomconf0001+test1@gmail.com` **100% / 1%**
  - ownership_type `sole` · ideal_parts_source `document`
  - registry_people id **115** · validation ok
- Transfers on 108: **0**
- **99401 / 107 untouched**: Book still test1 40%/0.4 + test3 60%/0.6
- **99501 untouched**
- Note: apt create ≠ approval to mutate Book mid-P2.3 or approve transfers

### Starting snapshot — 99402 / 108

| Field | Value |
|-------|-------|
| property_id | 108 |
| apartment_number | 99402 |
| ownership_type | sole |
| ideal_parts_percent | 1 |
| Active Book | test1 100% / 1% (id 115) |
| Pending transfers | 0 |
| Transfer history | none |

### P2.3a — Owner1 pending on 99402
- Session: Owner1 · Heading № 99402 · Test Owner1
- Submitted ordinary `sale` target: Owner1 **70%/0.7** + Owner3 **30%/0.3**
- Comment: `PKG-XFER P2.3a stale-baseline pending on 99402`
- DB transfer **id=38** · property_id **108** · status **`ожидает`**
- `baseline_roster_hash`: `bf2a9f3a6415cede33a236acffe304af`
- `baseline_owners`: sole Owner1 100%/1% (registry id 115)
- Active Book after submit: **unchanged** sole Owner1 100%/1%
- 99401 pending: 0 (untouched)
- Snapshot file: `tmp/pkg_xfer_p2_3a_baseline_99402.json`
- Not approved / not cancelled / Book not mutated

### P2.3b — Stale baseline (APPROVE P2.3b BOOK MUTATION ON 99402)
- Pre-check: #38 `ожидает`; baseline_roster_hash **`bf2a9f3a6415cede33a236acffe304af`** ✓
- Book mutate (authorized RPCs): property + owner `ideal_parts_percent` **1 → 0.99** (email unchanged; still sole Owner1 100%)
  - Active owner row id **115 → 116** (replace path: prior row deregistered, history kept)
  - Current hash **`1b69340ffd21109087e4d032e7f0c1b0`** ≠ baseline
- Audit (admin@example.com): property ideal update; owner update deregistered_at; owner insert id 116
- Approve #38 via admin UI + docs → UI «Ошибка утверждения»
- Confirming RPC: `admin_approve_owner_transfer: stale Book baseline — reject and resubmit` (P0001)
- After: #38 still **`ожидает`**; has_doc=false; Book still sole Owner1 **100%/0.99** (not 70/30)
- 99401 / 99501 untouched

### P2.3 cleanup — PASS (`APPROVE REJECT 38` + `APPROVE RESTORE IDEALS 99402`)
- Reject #38 via admin UI (`admin_reject_owner_transfer`) reason: `P2.3b — stale Book baseline, заявка устарела после изменения Книги`
- #38 status **`отклонена`** · decided_by `admin@example.com` · decided_at set · history row retained (baseline/target unchanged)
- Restore ideals via Book RPCs `admin_upsert_property_book_object` + `admin_replace_property_book_owners`:
  - property ideal_parts **0.99 → 1**
  - active owner **116 → 117** (116 deregistered; historical 115/116 kept)
  - Owner1 sole **100% / 1%** · validation ok
- Audit (`property_change_log`): property update 0.99→1; owner deregister 116; owner insert 117 — no backdating
- Checks: pending_n=0; #38 not approved; **99401** still test1 40%/0.4 + test3 60%/0.6; **99501** still sole 100%/0.85

### P2.4 — Admin-initiated — PASS (`APPROVE TRANSFER 39`)
- Pre-check: #39 `ожидает`; Book = baseline Owner1 100%/1% (hash `c3ae76fbf4b1e935110513bcfe27e7d9`); PDF `test_owner.pdf` 24304 B ReportLab fixture, no PII heuristics
- Admin UI approve with Documents Core upload `test_owner.pdf` → `building_documents` id `b5711e2b-…` path `documents/b5711e2b-….pdf`
- Docs: type `Тестовый документ передачи доли` · № `TEST-XFER-P2-39` · dates `2026-10-11`
- #39 status **`утверждена`** · decided_by `admin@example.com`
- Active Book 99402: Owner1 **70%/0.7** (118) + Owner3 **30%/0.3** (119); sums 100% / 1%; ownership_type `shared`
- History: 115–117 deregistered kept; change_log replace_owners + inserts; #38 still `отклонена`
- 99401 / 99501 untouched

### P2.5 — Security negatives — PASS
- **S2-AUTH-08** PASS — disposable #40; approve without docs → `22023`; rejected; Book 99402 still 70/30; pending=0
- **Former Owner2** (`zoomconf0001+test2@gmail.com`) PASS:
  - UI: «нет апартаментов и нет доступа персонала УК»; no 99401 / submit UI
  - `list_my_owned_properties` → `[]`
  - `submit_ownership_change` on 107/108 → `42501` not a current Book owner
  - `admin_approve/reject/upsert` → `42501` admin_book: not allowed
  - Direct `owner_transfers` UPDATE #39 → 0 rows (RLS); no pending created
  - Select Book/properties/transfers for 107/108 → empty (no cross-owner leak)
- **S2-AUTH-07 Owner1** (`zoomconf0001+test1@gmail.com`) PASS:
  - Session UI: `№ 99401 · Test Owner1`; owns 107 + 108
  - Direct UPDATE #39 status→отклонена / #35→ожидает / reject_reason → **0 rows**; statuses unchanged (`утверждена` / `отклонена`)
  - `admin_reject_owner_transfer` → `42501`
  - Book unchanged: 99401 40/60; 99402 70/30; pending 0; 99501 not readable as Owner1

## Package 2 final verdict — PASS

| Scenario | Verdict |
|----------|---------|
| P2.1 Rejection with reason | **PASS** |
| P2.2 Duplicate pending | **PASS** |
| P2.3 Stale baseline | **PASS** |
| P2.4 Admin-initiated | **PASS** |
| P2.5 Security negatives | **PASS** |

**End state**
- 99401 / 107: Owner1 40%/0.4 + Owner3 60%/0.6 · pending 0
- 99402 / 108: Owner1 70%/0.7 + Owner3 30%/0.3 · pending 0 · #39 утверждена · #38 отклонена
- 99501: untouched (Owner1 cannot read)
- No migrations / commit / push / deploy
- **STOP before Package 3**
