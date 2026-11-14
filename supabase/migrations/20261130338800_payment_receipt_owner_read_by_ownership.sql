-- Invited / activated owners may use a cabinet email different from the Book
-- email frozen on payment_receipts.owner_email_at_issue. Current owners who
-- pass owns_property must still be able to open receipts for their apartment.
-- Historical email match remains as a secondary path for the party named at issue.

create or replace function public.can_read_payment_receipt(p_receipt public.payment_receipts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.can_manage_payment_receipts()
    or public.owns_property(p_receipt.property_id)
    or (
      p_receipt.owner_email_at_issue is not null
      and lower(nullif(btrim(auth.email()), '')) = lower(p_receipt.owner_email_at_issue)
    );
$fn$;

revoke all on function public.can_read_payment_receipt(public.payment_receipts) from public, anon;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to authenticated;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to service_role;
