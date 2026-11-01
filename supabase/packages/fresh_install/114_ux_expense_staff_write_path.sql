-- =============================================================================
-- Package-phase stub for the UK expense staff write path.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129170000_uk_expense_staff_write_path.sql
-- Do not grant or create policies here.
-- =============================================================================

do $notice$
begin
  raise notice '114_ux_expense_staff_write_path: package stub — apply via chronological migration 20261129170000';
end;
$notice$;
