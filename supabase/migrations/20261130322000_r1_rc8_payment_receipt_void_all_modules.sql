-- Void payment receipts for any module when the linked payment is reversed.
-- Previously only support_fee payment_reversal voided receipts.

create or replace function public.void_payment_receipt_for_ledger(
  p_source_module text,
  p_ledger_id text,
  p_reason text default null
)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
  v_reason text := coalesce(
    nullif(btrim(coalesce(p_reason, '')), ''),
    'Анулиране на плащане'
  );
begin
  if p_source_module is null or nullif(btrim(p_ledger_id), '') is null then
    raise exception 'payment_receipt: invalid void args' using errcode = '22023';
  end if;

  update public.payment_receipts as r
     set status = 'voided',
         voided_at = coalesce(r.voided_at, now()),
         void_reason = case
           when r.status = 'voided' then r.void_reason
           else v_reason
         end,
         updated_at = now()
   where r.source_module = p_source_module
     and r.ledger_id = btrim(p_ledger_id)
  returning * into v_row;

  if not found then
    return null;
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.void_payment_receipt_for_ledger(text, text, text) from public, anon;
grant execute on function public.void_payment_receipt_for_ledger(text, text, text) to authenticated;

-- support_fee: keep existing behavior, route through shared void helper
create or replace function public.trg_payment_receipt_from_support_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_key uuid;
begin
  if new.kind = 'payment' then
    v_email := coalesce(nullif(btrim(coalesce(new.recorded_by, '')), ''), nullif(btrim(auth.email()), ''), 'staff');
    begin
      v_key := nullif(btrim(coalesce(new.idempotency_key::text, '')), '')::uuid;
    exception
      when others then
        v_key := null;
    end;
    perform public.ensure_payment_receipt_for_ledger(
      'support_fee', new.id::text, new.property_id, new.amount, new.note,
      v_email, new.created_at, v_key
    );
  elsif new.kind = 'payment_reversal' and new.reverses_ledger_id is not null then
    perform public.void_payment_receipt_for_ledger(
      'support_fee',
      new.reverses_ledger_id::text,
      coalesce(nullif(btrim(coalesce(new.reversal_reason, new.note, '')), ''), 'Анулиране на плащане')
    );
  end if;
  return new;
end;
$fn$;

-- Generic void RPC for admin/modules that cancel a payment without a dedicated reversal ledger row.
create or replace function public.admin_void_payment_receipt(
  p_source_module text,
  p_ledger_id text,
  p_reason text default null
)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.can_manage_payment_receipts() then
    raise exception 'Not authorized.';
  end if;
  return public.void_payment_receipt_for_ledger(p_source_module, p_ledger_id, p_reason);
end;
$fn$;

revoke all on function public.admin_void_payment_receipt(text, text, text) from public, anon;
grant execute on function public.admin_void_payment_receipt(text, text, text) to authenticated;

comment on function public.void_payment_receipt_for_ledger(text, text, text) is
  'Marks the receipt for a module+ledger as voided. Keeps PDF bytes and history; does not delete.';
comment on function public.admin_void_payment_receipt(text, text, text) is
  'Admin/staff entry point to void a receipt when a payment is cancelled in any module.';
