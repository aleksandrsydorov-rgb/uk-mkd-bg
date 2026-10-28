-- =============================================================================
-- Package-phase stub for R1-RC8 first-run tariffs + budget stage.
-- Full DDL/RPC lives in chronological migration
--   supabase/migrations/20261125180000_r1_rc8_first_run_tariffs_budget.sql
-- Package runs BEFORE platform_installations / Tariff Core surfaces; do not ALTER here.
-- =============================================================================

do $notice$
begin
  raise notice '106_r1_rc8_first_run_tariffs_budget: package stub — apply via chronological migration 20261125180000';
end;
$notice$;
