# E2.3-D P0 — Wrong-apartment void guard · Safe Release

**Date:** 2026-10-14  
**Baseline:** `016c848`  
**Supabase:** klowacuvufknbrkayjhz  
**Production:** https://amadeus11.online  

## Precheck
- Branch `main` == `origin/main` at `016c848`
- Only P0 guard files + migration reviewed
- Frozen client target includes assessmentId, propertyId, apartmentNumber, billingYear, amounts
- Confirm UI shows apt / year / final / remaining / ID; apt typed confirm + distinct submit label
- RPC requires `p_expected_property_id` and rejects mismatch **before** ledger insert
- Old 3-arg overload dropped; anon/public cannot EXECUTE

## Database
- Applied: `20261019120000_phase_e2_3_d_void_target_guard.sql` via `supabase db push --linked --yes`
- Dry-run before push: only this migration
- History: `20261018120000` + `20261019120000` present
- Signature: `(uuid, text, uuid, bigint)` SECURITY DEFINER; EXECUTE → authenticated (+ postgres owner)
- Old `(uuid, text, uuid)`: **gone** (`to_regprocedure` null)
- Financial snapshot unchanged after push: props=22, debt=692, over=163.30, rem=692, led_n=11, led_sum=1712.50
- 99405 `e85d923f…` remains void; 99408 `20781d03…` remains open 132
- Email / debt gate: OFF

## Application
- See git commit on main after push
- No Finance E2E mutations; no 99405 restore
