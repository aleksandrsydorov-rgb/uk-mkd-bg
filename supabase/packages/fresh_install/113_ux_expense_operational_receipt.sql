-- =============================================================================
-- Package-phase stub for the operational UK expense receipt requirement.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129160000_uk_expense_operational_receipt_required.sql
-- Do not create the trigger or the origin table here. The bucket and the
-- opening RPC exist only after the chronological migrations.
-- =============================================================================

do $notice$
begin
  raise notice '113_ux_expense_operational_receipt: package stub — apply via chronological migration 20261129160000';
end;
$notice$;
