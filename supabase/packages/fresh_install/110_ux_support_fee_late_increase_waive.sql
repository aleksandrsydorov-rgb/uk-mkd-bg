-- =============================================================================
-- Package-phase stub for Support Fee late-increase waive.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129130000_support_fee_late_increase_waive.sql
-- Package runs before the assessment surface is complete; do not create the RPC here.
-- =============================================================================

do $notice$
begin
  raise notice '110_ux_support_fee_late_increase_waive: package stub — apply via chronological migration 20261129130000';
end;
$notice$;
