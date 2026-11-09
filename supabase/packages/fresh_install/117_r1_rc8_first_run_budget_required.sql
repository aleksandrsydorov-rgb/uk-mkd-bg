-- =============================================================================
-- Package-phase stub. The UK budget is a required first-run module.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130130000_r1_rc8_first_run_budget_required.sql
-- =============================================================================

do $notice$
begin
  raise notice '117_r1_rc8_first_run_budget_required: package stub — apply via chronological migration 20261130130000';
end;
$notice$;
