-- =============================================================================
-- Package-phase stub. Internet package_30 + day tariffs and paid periods.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130190000_r1_rc8_internet_package_day.sql
-- Does not rewrite historical month-only charges or rename old month versions.
-- =============================================================================

do $notice$
begin
  raise notice '123_r1_rc8_internet_package_day: package stub — apply via chronological migration 20261130190000';
end;
$notice$;
