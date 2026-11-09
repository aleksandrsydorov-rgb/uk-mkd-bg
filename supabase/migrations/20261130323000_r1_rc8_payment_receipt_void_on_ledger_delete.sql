-- Void receipts when a payment ledger row is deleted in utility/capital modules
-- (those modules have no payment_reversal kind). support_fee continues to void
-- via payment_reversal through trg_payment_receipt_from_support_ledger.

create or replace function public.trg_void_payment_receipt_on_ledger_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_module text;
begin
  if tg_argv[0] is null then
    return old;
  end if;
  v_module := tg_argv[0];

  if old.kind is distinct from 'payment' then
    return old;
  end if;

  perform public.void_payment_receipt_for_ledger(
    v_module,
    old.id::text,
    'Анулиране на плащане (изтриване на запис)'
  );
  return old;
end;
$fn$;

revoke all on function public.trg_void_payment_receipt_on_ledger_delete() from public, anon;

drop trigger if exists trg_void_receipt_water_del on public.water_ledger;
create trigger trg_void_receipt_water_del
  after delete on public.water_ledger
  for each row
  execute function public.trg_void_payment_receipt_on_ledger_delete('water');

drop trigger if exists trg_void_receipt_electricity_del on public.electricity_ledger;
create trigger trg_void_receipt_electricity_del
  after delete on public.electricity_ledger
  for each row
  execute function public.trg_void_payment_receipt_on_ledger_delete('electricity');

drop trigger if exists trg_void_receipt_internet_del on public.internet_ledger;
create trigger trg_void_receipt_internet_del
  after delete on public.internet_ledger
  for each row
  execute function public.trg_void_payment_receipt_on_ledger_delete('internet');

drop trigger if exists trg_void_receipt_capital_del on public.capital_repair_ledger;
create trigger trg_void_receipt_capital_del
  after delete on public.capital_repair_ledger
  for each row
  execute function public.trg_void_payment_receipt_on_ledger_delete('capital_repair');

-- support_fee: also void if a payment row is hard-deleted (reversal path remains primary)
drop trigger if exists trg_void_receipt_support_del on public.support_fee_ledger;
create trigger trg_void_receipt_support_del
  after delete on public.support_fee_ledger
  for each row
  execute function public.trg_void_payment_receipt_on_ledger_delete('support_fee');

comment on function public.trg_void_payment_receipt_on_ledger_delete() is
  'AFTER DELETE on module ledgers: voids linked payment_receipt when a payment row is removed.';
