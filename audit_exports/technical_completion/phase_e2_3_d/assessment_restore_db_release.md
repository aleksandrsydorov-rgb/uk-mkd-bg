# E2.3-D — Assessment restore · DB release

**Date:** 2026-10-14  
**Supabase:** klowacuvufknbrkayjhz (linked)  
**Migration:** `20261020120000_phase_e2_3_d_assessment_restore.sql`  
**Method:** `npx supabase db push --linked --yes` (dry-run showed only this migration)

## Preflight
- History before: `20261018120000`, `20261019120000`
- Dry-run: only `20261020120000`
- Migration reviewed: append-only `assessment_restore`; no automatic restore of 99405; property guard fail-closed; SECURITY DEFINER + `search_path=''` + `can_manage_support_fees`; EXECUTE → authenticated

## Baseline → postcheck (unchanged)
| Metric | Pre | Post |
|--------|-----|------|
| props | 22 | 22 |
| debt | 692.00 | 692.00 |
| over | 163.30 | 163.30 |
| rem (non-void/corrected) | 692.00 | 692.00 |
| ledger n / sum | 11 / 1712.50 | 11 / 1712.50 |
| assessment_restore rows | 0 | 0 |
| e85d923f… (99405) | void / rem 0 / prop debt 0 | void / rem 0 / prop debt 0 |
| 20781d03… (99408) | open / 132 | open / 132 |
| ledger 25 / 32 | charge 360 / void 360 | charge 360 / void 360 |
| email / debt gate | OFF / OFF | OFF / OFF |

## Post-install verification
- History: `20261018120000` + `20261019120000` + `20261020120000`; dry-run up to date
- RPC `restore_support_fee_assessment(uuid,text,uuid,bigint)` present; SECURITY DEFINER; guards before insert; anon no EXECUTE
- Void + reverse RPCs still present with prior signatures
- Columns: `restore_reason`, `restored_at`, `restored_by_email`, `restore_ledger_id`; kind chk includes `assessment_restore`
- Restore RPC **not** executed

## Application regression
- `npm test` — **156/156 PASS**
- `npx tsc --noEmit` — **PASS**
- `npm run build` — **PASS**

## Scorecard
| Item | Result |
|------|--------|
| Migration applied | **YES** |
| Migration history synced | **YES** |
| RPC/security checks | **PASS** |
| Regression tests | **PASS** |
| Financial records unchanged | **YES** |
| Incident assessment unchanged | **YES** (still VOID) |
| Ready for Safe Release | **YES** (app commit/deploy + operator restore of 99405 next) |

## Not done
- No restore of 99405
- No commit / push / app deploy
- No Finance E2E
