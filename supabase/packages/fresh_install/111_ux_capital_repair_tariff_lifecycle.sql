-- =============================================================================
-- Package-phase stub for Capital Repair tariff lifecycle.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129140000_capital_repair_tariff_lifecycle_policy.sql
-- Must follow 20261129120000. Package phase does not replace publish_tariff_version.
-- =============================================================================

do $notice$
begin
  raise notice '111_ux_capital_repair_tariff_lifecycle: package stub — apply via chronological migration 20261129140000';
end;
$notice$;
