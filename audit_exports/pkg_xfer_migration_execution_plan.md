# PKG-XFER Controlled Migration Execution Plan

**Target:** TEST Supabase `klowacuvufknbrkayjhz` first (never production until TEST acceptance).  
**Do not execute until explicit authorization after Stage 5A.**

## Preconditions (STOP if any fail)

1. Backup / point-in-time recovery available.
2. `supabase/pkg_xfer_migration_preflight.sql` → **PASS**.
3. Confirm applied: PB-1 (`owns_property` Book-only), `20261011005000` approve gate, Guest Mode, Finance Core tables.
4. Confirm **not** partially applied: no half-created `ownership_change_settings` / `property_book_extracts` unless intentional resume.
5. Local: `tsc` PASS, `build` PASS, `verify-property-book-extract-pdf.mjs` PASS.
6. `ordinary_debt_gate_enabled` must remain **false** after apply.

## Step sequence

| Step | Action | Verify | STOP if |
|------|--------|--------|---------|
| 1 | Backup / read-only snapshot | Backup ID recorded | No backup |
| 2 | Baseline inspection + preflight SQL | Preflight PASS | Missing deps (esp. approve gate) |
| 3 | Apply `20261011140000_pkg_xfer_ownership_change_core.sql` | `pkg_xfer_post_migration_verify` 140000 section | Any SQL error; debt gate true |
| 4 | Verify 140000 | settings row; RPCs; one-pending index; ACL gate | Function missing / gate writable |
| 5 | Apply `20261011140100_pkg_xfer_extracts_history.sql` | verify 140100 | Extract table/RPC missing |
| 6 | Verify 140100 | generate/list/history RPCs exist | — |
| 7 | Apply `20261011140200_pkg_xfer_stage3_finance_inheritance_entity.sql` | verify 140200 | `gm_write_vote` broken; debt gate flipped |
| 8 | Verify 140200 | debt status RPC; voting eligible; gate OFF | Meeting vote regression |
| 9 | Apply `20261011140300_pkg_xfer_stage4_notify_history_pdf.sql` | verify 140300 | has_pdf column missing |
| 10 | Verify 140300 | attach/fulfill RPCs; notify event constraint | — |
| 11 | Authenticated-role ACL | `pkg_xfer_stage2_auth_role_security.sql` + post-verify ACL | Privilege gaps |
| 12 | Transactional smokes | stage2 → stage3 → stage4 → cross_stage (ROLLBACK) | Any FAIL |
| 13 | Browser smoke | `pkg_xfer_browser_ui_smoke_checklist.md` | Critical UI fail |
| 14 | Residual data | No `smoke.xfer*` apts; no 99501 changes | Residuals remain |
| 15 | Final acceptance | Decision matrix runtime column updated | Open CRITICAL defects |

## Explicit STOP conditions

- Preflight missing `property_book_transfer_approve_gate` → apply `20261011005000` first, re-preflight.
- Any migration error → **do not continue**; restore from backup; open Stage 5B.
- Debt gate becomes true unexpectedly → STOP; investigate settings write path.
- `gm_write_vote` / meeting cast broken in smoke → STOP before 140300.
- PDF attach marks `has_pdf` without file → treat as CRITICAL (5B).

## NOT SAFE indicators (from Stage 5A)

1. Remote dependency presence **not yet confirmed** in this audit (no remote execution).
2. Linked-correction UI missing (non-blocking for core apply).
3. Tariff prospective application is metadata-only (non-blocking; document).
4. Lifecycle smokes still use JWT `set_config` helpers (document; supplement with real browser sessions).
