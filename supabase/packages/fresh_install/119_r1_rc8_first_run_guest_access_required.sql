-- =============================================================================
-- Package-phase stub. Guest access is a required first-run module.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130150000_r1_rc8_first_run_guest_access_required.sql
-- Enabling the module does not create guests, invitations or permissions.
-- =============================================================================

do $notice$
begin
  raise notice '119_r1_rc8_first_run_guest_access_required: package stub — apply via chronological migration 20261130150000';
end;
$notice$;
