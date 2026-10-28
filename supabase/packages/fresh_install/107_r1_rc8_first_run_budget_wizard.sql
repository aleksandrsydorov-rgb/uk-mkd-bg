-- =============================================================================
-- Package-phase stub for R1-RC8 first-run budget wizard.
-- Full DDL/RPC lives in chronological migration
--   supabase/migrations/20261125190000_r1_rc8_first_run_budget_wizard.sql
-- Package runs BEFORE platform_installations / budget surfaces; do not ALTER here.
-- =============================================================================

do $notice$
begin
  raise notice '107_r1_rc8_first_run_budget_wizard: package stub — apply via chronological migration 20261125190000';
end;
$notice$;
