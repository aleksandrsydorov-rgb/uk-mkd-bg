-- =============================================================================
-- Package-phase stub for R1-RC8 first-run tariff period readiness.
-- Full DDL/RPC lives in chronological migration
--   supabase/migrations/20261125200000_r1_rc8_first_run_tariff_period_ready.sql
-- Package runs BEFORE platform_installations / tariff surfaces; do not ALTER here.
-- =============================================================================

do $notice$
begin
  raise notice '108_r1_rc8_first_run_tariff_period_ready: package stub — apply via chronological migration 20261125200000';
end;
$notice$;
