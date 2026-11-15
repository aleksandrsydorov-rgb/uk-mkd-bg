-- Receipt read ACL for owners:
-- - Staff who can_manage_payment_receipts: all receipts
-- - Current owners (owns_property): all receipts for that apartment, including
--   ones issued before they became owners (property continuity / invitees whose
--   cabinet email differs from Book email at issue)
-- - Former owners lose portal access after ownership change (no orphaned
--   owner_email_at_issue path). Export PDFs before transfer if needed.

create or replace function public.can_read_payment_receipt(p_receipt public.payment_receipts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.can_manage_payment_receipts()
    or public.owns_property(p_receipt.property_id);
$fn$;

revoke all on function public.can_read_payment_receipt(public.payment_receipts) from public, anon;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to authenticated;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to service_role;
