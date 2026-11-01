-- =============================================================================
-- Package-phase stub for Support Fee tariff lifecycle.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129120000_support_fee_tariff_lifecycle_policy.sql
-- Package runs before publish_tariff_version exists; do not replace it here.
-- =============================================================================

do $notice$
begin
  raise notice '109_ux_support_fee_tariff_lifecycle: package stub — apply via chronological migration 20261129120000';
end;
$notice$;
