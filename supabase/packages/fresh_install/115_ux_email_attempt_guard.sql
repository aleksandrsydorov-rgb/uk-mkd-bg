-- =============================================================================
-- Package-phase stub for the Email Core attempt guard.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129180000_email_core_lettermint_attempt_guard.sql
-- Do not replace functions or change constraints here.
-- =============================================================================

do $notice$
begin
  raise notice '115_ux_email_attempt_guard: package stub — apply via chronological migration 20261129180000';
end;
$notice$;
