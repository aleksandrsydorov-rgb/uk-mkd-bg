-- =============================================================================
-- Package-phase stub. Building profile / UK / bank accounts.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130200000_r1_rc8_building_profile_uk_bank.sql
-- Does not reopen completed first-run installs.
-- =============================================================================

do $notice$
begin
  raise notice '124_r1_rc8_building_profile_uk_bank: package stub — apply via chronological migration 20261130200000';
end;
$notice$;
