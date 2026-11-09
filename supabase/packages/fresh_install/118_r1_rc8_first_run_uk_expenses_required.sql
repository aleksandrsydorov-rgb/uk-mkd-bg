-- =============================================================================
-- Package-phase stub. UK expenses are a required first-run module.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130140000_r1_rc8_first_run_uk_expenses_required.sql
-- An empty expense list stays valid. No expense rows are created here.
-- =============================================================================

do $notice$
begin
  raise notice '118_r1_rc8_first_run_uk_expenses_required: package stub — apply via chronological migration 20261130140000';
end;
$notice$;
