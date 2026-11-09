-- =============================================================================
-- Package-phase stub. Wizard tariffs take effect on complex activation.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130160000_r1_rc8_first_run_activation_tariffs.sql
-- Preparation and publication do not create charges.
-- Already completed installations are not rewritten.
-- =============================================================================

do $notice$
begin
  raise notice '120_r1_rc8_first_run_activation_tariffs: package stub — apply via chronological migration 20261130160000';
end;
$notice$;
