# PKG-XFER Package 3 Progress — COMPLETE

**Project:** `klowacuvufknbrkayjhz` · **Local:** http://localhost:3001  
**Depends on:** Package 1 PASS · Package 2 PASS  
**Verdict:** **PASS** (with one privacy defect noted)

## Scenarios

| ID | Scenario | Status |
|----|----------|--------|
| P3.1 | Book data correction (XFER.16) | **PASS** — `ownership_admin_corrections` id **1** |
| P3.2 | Linked correction → #39 (XFER.21) | **PASS** — transfer **#41** `утверждена` |
| P3.3 | Immutable original #39 | **PASS** |
| P3.4 | Correction vs real transfer | **PASS** |
| P3.5 | Owner history / privacy | **PASS** (RPC); raw path SELECT defect noted |

## End state — 99402 / 108
- Active Book: Owner1 **60%/0.6** (122) + Owner3 **40%/0.4** (123)
- #39 `утверждена` immutable (`admin_initiated`/`sale`, `TEST-XFER-P2-39`)
- #41 `утверждена` `correction_link` · `corrects_transfer_id=39` · `TEST-XFER-P3-39-CORR`
- XFER.16 correction_id **1** (not a sale)
- History rows 115–121 deregistered kept
- 99401: still 40/60 · 99501: untouched · pending 0

## P3.1 — XFER.16
- `admin_record_ownership_correction` → correction_id **1**
- Reason: `PKG-XFER P3.1 Book data correction (not a sale) — confirm XFER.16 path`
- Evidence PDF in Documents Core; no new sale transfer created

## P3.2 — Linked correction
- Submit + approve #41 via `admin_submit_linked_ownership_correction` + `admin_approve_owner_transfer`
- Target 60/40; docs `TEST-XFER-P3-39-CORR`

## P3.3 — Immutability
- #39 status/docs/target/decided_at unchanged after #41 + XFER.16

## P3.4 — Distinction
| Op | Kind | Link |
|----|------|------|
| #39 | admin_initiated / sale | — |
| #41 | correction_link / correction | corrects #39 |
| corr #1 | ownership_admin_corrections | — |

## P3.5 — Privacy
- Owner1/Owner3: filtered history OK; emails stripped; `has_supporting_document` only; 99501/fake denied
- Owner2: no apts UI; history/extracts 107/108 → `42501`
- **DEFECT:** direct SELECT of `owner_transfers.supporting_document_path` still visible to current owners (RPC path is clean). No migration applied (restriction). Storage download denied.

## Authenticated roles verified
admin@example.com · test1 · test3 · test2

**Package 3 complete: YES** · **STOP before Package 4 until ADMIN LOGIN**
