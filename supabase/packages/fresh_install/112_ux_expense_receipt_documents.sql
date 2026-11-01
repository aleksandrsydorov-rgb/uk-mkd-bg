-- =============================================================================
-- Package-phase stub for UK expense receipt PDF MIME.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261129150000_uk_expense_receipt_documents.sql
-- Bucket uk-expense-receipts is created by 20261122120000; do not update it here.
-- =============================================================================

do $notice$
begin
  raise notice '112_ux_expense_receipt_documents: package stub — apply via chronological migration 20261129150000';
end;
$notice$;
