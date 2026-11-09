-- =============================================================================
-- Package-phase stub. Complex budget articles and opening expense totals.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130170000_r1_rc8_first_run_budget_opening.sql
-- Import does not create charges or move opening cash.
-- Already completed installations are not rewritten.
-- =============================================================================

do $notice$
begin
  raise notice '121_r1_rc8_first_run_budget_opening: package stub — apply via chronological migration 20261130170000';
end;
$notice$;
