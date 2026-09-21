-- Atomic support-fee RPCs and restrictive ledger RLS.
-- Apply after public.is_staff(), public.is_owner(), public.owns_property(bigint).
-- Does not change properties RLS: staff may still UPDATE debt/overpayment via the property form.

begin;

create or replace function public.can_manage_support_fees()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where lower(btrim(s.email)) = lower(btrim(auth.email()))
      and s.active is not false
      and (
        btrim(coalesce(s.role, '')) = ''
        or lower(btrim(s.role)) ~ 'админ|administr|управляющ|директор|председател|управител|менедж|\ymanager\y|(^|[[:space:]])ук([[:space:]]|$)'
        or lower(btrim(s.role)) ~ 'бухгалтер|account|кассир|счетовод'
      )
  );
$$;

revoke all on function public.can_manage_support_fees() from public;
revoke execute on function public.can_manage_support_fees() from anon;
revoke execute on function public.can_manage_support_fees() from authenticated;

create or replace function public.record_support_payment(
  p_property_id bigint,
  p_amount numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_debt numeric;
  v_over numeric;
  v_pay numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_note text;
  v_ledger_id bigint;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'record_support_payment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'record_support_payment: not allowed'
      using errcode = '42501';
  end if;

  if p_amount is null then
    raise exception 'record_support_payment: amount is required'
      using errcode = '22023';
  end if;

  v_pay := round(p_amount, 2);
  if v_pay <= 0 then
    raise exception 'Сумма должна быть больше нуля'
      using errcode = '22023';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'record_support_payment: property not found'
      using errcode = '22023';
  end if;

  if v_pay <= v_debt then
    v_new_debt := round(v_debt - v_pay, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := round(v_over + (v_pay - v_debt), 2);
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if v_note = '' then
    v_note := 'Оплата таксы поддержки';
  end if;

  insert into public.support_fee_ledger (
    property_id,
    kind,
    amount,
    period,
    note,
    recorded_by,
    debt_after,
    overpayment_after
  )
  values (
    p_property_id,
    'payment',
    v_pay,
    null,
    v_note,
    btrim(v_email),
    v_new_debt,
    v_new_over
  )
  returning id into v_ledger_id;

  update public.properties
  set debt = v_new_debt,
      overpayment = v_new_over
  where id = p_property_id;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'amount', v_pay,
    'debt', v_new_debt,
    'overpayment', v_new_over
  );
end;
$$;

revoke all on function public.record_support_payment(bigint, numeric, text) from public;
revoke execute on function public.record_support_payment(bigint, numeric, text) from anon;
grant execute on function public.record_support_payment(bigint, numeric, text) to authenticated;

create or replace function public.charge_support_fee(
  p_property_id bigint,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_period text;
  v_area numeric;
  v_debt numeric;
  v_over numeric;
  v_rate numeric;
  v_amount numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_ledger_id bigint;
  v_note text;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'charge_support_fee: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'charge_support_fee: not allowed'
      using errcode = '42501';
  end if;

  v_period := btrim(coalesce(p_period, ''));
  if v_period !~ '^[0-9]{4}$' then
    raise exception 'charge_support_fee: period must be YYYY'
      using errcode = '22023';
  end if;

  select
    coalesce(p.area_sqm, 0)::numeric,
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_area, v_debt, v_over
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'charge_support_fee: property not found'
      using errcode = '22023';
  end if;

  select bs.support_rate_eur_per_sqm_year
    into v_rate
  from public.building_settings as bs
  where bs.id = 1;

  if v_rate is null or v_rate <= 0 then
    v_rate := 8;
  end if;

  v_amount := round(coalesce(v_area, 0) * v_rate, 2);

  if v_amount <= 0 then
    return jsonb_build_object(
      'applied', false,
      'ledger_id', null,
      'amount', 0,
      'debt', v_debt,
      'overpayment', v_over
    );
  end if;

  if v_amount <= v_over then
    v_new_debt := v_debt;
    v_new_over := round(v_over - v_amount, 2);
  else
    v_new_debt := round(v_debt + (v_amount - v_over), 2);
    v_new_over := 0;
  end if;

  v_note := 'Начисление таксы за ' || v_period;

  insert into public.support_fee_ledger (
    property_id,
    kind,
    amount,
    period,
    note,
    recorded_by,
    debt_after,
    overpayment_after
  )
  values (
    p_property_id,
    'charge',
    v_amount,
    v_period,
    v_note,
    btrim(v_email),
    v_new_debt,
    v_new_over
  )
  returning id into v_ledger_id;

  update public.properties
  set debt = v_new_debt,
      overpayment = v_new_over
  where id = p_property_id;

  return jsonb_build_object(
    'applied', true,
    'ledger_id', v_ledger_id,
    'amount', v_amount,
    'debt', v_new_debt,
    'overpayment', v_new_over
  );
end;
$$;

revoke all on function public.charge_support_fee(bigint, text) from public;
revoke execute on function public.charge_support_fee(bigint, text) from anon;
grant execute on function public.charge_support_fee(bigint, text) to authenticated;

alter table public.support_fee_ledger enable row level security;

drop policy if exists support_fee_ledger_all on public.support_fee_ledger;
drop policy if exists support_fee_ledger_owner_select on public.support_fee_ledger;
drop policy if exists support_fee_ledger_staff_select on public.support_fee_ledger;

revoke all on table public.support_fee_ledger from anon;
revoke all on table public.support_fee_ledger from authenticated;

grant select
on table public.support_fee_ledger
to authenticated;

create policy support_fee_ledger_owner_select
on public.support_fee_ledger
for select
to authenticated
using (public.owns_property(property_id));

create policy support_fee_ledger_staff_select
on public.support_fee_ledger
for select
to authenticated
using (public.is_staff());

commit;
