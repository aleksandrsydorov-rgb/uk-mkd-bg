-- =============================================================================
-- Package-phase stub for R1-RC8 first-run Support Fee opening.
-- Full DDL/RPC lives in chronological migration
--   supabase/migrations/20261125150000_r1_rc8_first_run_support_fee_opening.sql
-- Package runs BEFORE IS-1 / IS-4 surfaces; do not ALTER here.
-- =============================================================================

do $notice$
begin
  raise notice '103_r1_rc8_first_run_support_fee_opening: package stub — apply via chronological migration 20261125150000';
end;
$notice$;
