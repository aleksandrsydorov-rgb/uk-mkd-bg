-- =============================================================================
-- Package-phase stub for R1-RC8 first-run wizard.
-- Full DDL/RPC lives in chronological migration
--   supabase/migrations/20261125120000_r1_rc8_first_run_wizard.sql
-- Package runs BEFORE IS-1 creates platform_installations; do not ALTER here.
-- =============================================================================

do $notice$
begin
  raise notice '101_r1_rc8_first_run_wizard: package stub — apply via chronological migration 20261125120000';
end;
$notice$;
