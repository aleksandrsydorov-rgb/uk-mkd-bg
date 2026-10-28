-- =============================================================================
-- Package-phase stub for R1-RC8 multi-meter + opening balance.
-- Full DDL/RPC lives in chronological migration
--   supabase/migrations/20261125130000_r1_rc8_meters_multi_opening_balance.sql
-- Package runs before meter assign/opening helpers may be fully present; apply
-- the chronological migration for the real change.
-- =============================================================================

do $notice$
begin
  raise notice '102_r1_rc8_meters_multi_opening_balance: package stub — apply via chronological migration 20261125130000';
end;
$notice$;
