-- PKG-XFER P5: stamp early_deadline_at on ALL support-fee assessments (incl. standard).
-- Without a deadline, ownership_change_overdue_debt classifies remaining_due as future_due only,
-- so ordinary debt warnings / gate never see Finance Core unpaid assessments.
-- No protected-apartment targeting; backfill is global for open rows with null deadline.

create or replace function public.finalize_support_fee_assessment(
  p_property_id bigint,
  p_billing_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_period text;
  v_pol public.support_fee_annual_policies;
  v_existing public.support_fee_assessments;
  v_area numeric;
  v_debt numeric;
  v_over numeric;
  v_base numeric;
  v_early numeric;
  v_late numeric;
  v_final numeric;
  v_rule text;
  v_qual text;
  v_reason text;
  v_now timestamptz := now();
  v_dedicated numeric;
  v_applied_credit numeric;
  v_applied_pay numeric;
  v_from_balance numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_remaining numeric;
  v_status text;
  v_note text;
  v_ledger_id bigint;
  v_id uuid;
  v_tariff record;
  v_version_id uuid;
  v_rate numeric;
  v_deadline timestamptz;
begin
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'finalize_support_fee_assessment: authentication required' using errcode = '42501';
  end if;
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'finalize_support_fee_assessment: not allowed' using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'finalize_support_fee_assessment: invalid billing year' using errcode = '22023';
  end if;

  v_period := p_billing_year::text;

  select a.* into v_existing
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.billing_year = p_billing_year
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected'
  order by a.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'status', v_existing.status,
      'assessment_id', v_existing.id,
      'base_amount', v_existing.base_amount,
      'final_amount', v_existing.final_amount,
      'remaining_due', v_existing.remaining_due,
      'pricing_rule', v_existing.pricing_rule,
      'early_deadline_at', v_existing.early_deadline_at,
      'tariff_version_id', v_existing.tariff_version_id,
      'area_sqm_snapshot', v_existing.area_sqm_snapshot,
      'rate_eur_per_sqm_year_snapshot', v_existing.rate_eur_per_sqm_year_snapshot
    );
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
    raise exception 'finalize_support_fee_assessment: property not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.support_fee_ledger as l
    where l.property_id = p_property_id
      and l.kind = 'charge'
      and l.period = v_period
  ) then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'reason', 'charge_already_exists',
      'final_amount', (
        select l.amount from public.support_fee_ledger as l
        where l.property_id = p_property_id and l.kind = 'charge' and l.period = v_period
        limit 1
      )
    );
  end if;

  select r.* into v_tariff
  from public.resolve_support_tariff_for_year(p_billing_year) as r;

  v_version_id := v_tariff.tariff_version_id;
  v_rate := v_tariff.rate;
  v_area := round(coalesce(v_area, 0), 3);
  v_base := round(v_area * v_rate, 2);

  select * into v_pol
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
    and p.status in ('published','closed')
  for update;

  if v_base <= 0 then
    return jsonb_build_object('applied', false, 'amount', 0, 'reason', 'zero_base');
  end if;

  select coalesce(sum(l.amount), 0)
    into v_dedicated
  from public.support_fee_ledger as l
  where l.property_id = p_property_id
    and l.kind = 'payment'
    and l.period = v_period;

  if v_pol.id is null or v_pol.enabled is not true then
    v_rule := 'standard';
    v_qual := 'not_checked';
    v_reason := 'policy_disabled';
    v_early := v_base;
    v_late := v_base;
    v_final := v_base;
    -- Default early window end: 31 Dec (year-1) 23:59 Europe/Sofia
    v_deadline := (
      ((p_billing_year - 1)::text || '-12-31 23:59:00')::timestamp
      at time zone 'Europe/Sofia'
    );
  elsif v_now <= v_pol.early_payment_deadline then
    v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
    v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);
    v_deadline := v_pol.early_payment_deadline;
    if v_over >= v_early then
      v_rule := 'early_full_payment';
      v_qual := 'qualified';
      v_final := v_early;
      if v_dedicated >= v_early then
        v_reason := 'early_fully_covered_by_payments';
      elsif v_dedicated > 0 then
        v_reason := 'early_fully_covered_mixed';
      else
        v_reason := 'early_fully_covered_by_credit';
      end if;
    else
      return jsonb_build_object(
        'applied', false,
        'reason', 'early_window_not_qualified',
        'base_amount', v_base,
        'early_amount', v_early,
        'available_credit', v_over,
        'amount_needed', round(v_early - v_over, 2),
        'tariff_version_id', v_version_id,
        'rate_eur_per_sqm_year', v_rate
      );
    end if;
  else
    v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
    v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);
    v_rule := 'late';
    v_qual := 'not_qualified';
    v_final := v_late;
    v_reason := 'early_not_fully_covered';
    v_deadline := v_pol.early_payment_deadline;
  end if;

  v_applied_credit := least(v_over, v_final);
  v_applied_pay := least(coalesce(v_dedicated, 0), v_applied_credit);
  v_from_balance := round(v_applied_credit - v_applied_pay, 2);

  if v_final <= v_over then
    v_new_debt := v_debt;
    v_new_over := round(v_over - v_final, 2);
  else
    v_new_debt := round(v_debt + (v_final - v_over), 2);
    v_new_over := 0;
  end if;

  v_remaining := round(v_final - v_applied_credit, 2);
  v_status := case when v_remaining <= 0 then 'paid' else 'open' end;
  v_note := 'Начисление таксы за ' || v_period;

  begin
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after
    ) values (
      p_property_id, 'charge', v_final, v_period, v_note, btrim(v_email), v_new_debt, v_new_over
    )
    returning id into v_ledger_id;
  exception
    when unique_violation then
      return jsonb_build_object(
        'applied', false,
        'idempotent', true,
        'reason', 'charge_already_exists'
      );
  end;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = p_property_id;

  insert into public.support_fee_assessments (
    property_id, billing_year, policy_id, charge_ledger_id,
    base_amount, discount_percent, increase_percent,
    early_amount, late_amount, early_deadline_at,
    pricing_rule, pricing_reason_code, qualification_status, qualification_checked_at,
    available_credit_at_check, amount_covered_at_check, dedicated_payment_at_check,
    applied_credit_amount, applied_payment_amount,
    final_amount, remaining_due, balance_before, balance_after,
    status, created_by_email, finalized_at, finalized_by_email,
    tariff_version_id, area_sqm_snapshot, rate_eur_per_sqm_year_snapshot
  ) values (
    p_property_id,
    p_billing_year,
    case when v_rule = 'standard' then null else v_pol.id end,
    v_ledger_id,
    v_base,
    case when v_rule = 'standard' then 0 else v_pol.early_discount_percent end,
    case when v_rule = 'standard' then 0 else v_pol.late_increase_percent end,
    v_early,
    v_late,
    v_deadline,
    v_rule, v_reason, v_qual, v_now,
    v_over,
    case when v_rule = 'standard' then least(v_over, v_base) else least(v_over, v_early) end,
    coalesce(v_dedicated, 0),
    v_from_balance, v_applied_pay,
    v_final, v_remaining, v_over, v_new_over,
    v_status, btrim(v_email), v_now, btrim(v_email),
    v_version_id, v_area, v_rate
  )
  returning id into v_id;

  if v_from_balance > 0 then
    insert into public.support_fee_allocations (
      assessment_id, ledger_entry_id, amount, allocation_type, created_by_email
    ) values (
      v_id, v_ledger_id, v_from_balance, 'credit', btrim(v_email)
    );
  end if;
  if v_applied_pay > 0 then
    insert into public.support_fee_allocations (
      assessment_id, ledger_entry_id, amount, allocation_type, created_by_email
    ) values (
      v_id, v_ledger_id, v_applied_pay, 'payment', btrim(v_email)
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'status', v_status,
    'assessment_id', v_id,
    'base_amount', v_base,
    'final_amount', v_final,
    'remaining_due', v_remaining,
    'pricing_rule', v_rule,
    'early_deadline_at', v_deadline,
    'tariff_version_id', v_version_id,
    'area_sqm_snapshot', v_area,
    'rate_eur_per_sqm_year_snapshot', v_rate
  );
end;
$fn$;

revoke all on function public.finalize_support_fee_assessment(bigint, integer) from public, anon;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to authenticated;

-- Admin repair: stamp missing deadlines from published/closed policy (or Sofia default).
create or replace function public.admin_backfill_support_fee_early_deadlines(
  p_property_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n integer := 0;
begin
  perform public.admin_assert_book_admin();

  update public.support_fee_assessments as a
     set early_deadline_at = coalesce(
       (
         select p.early_payment_deadline
         from public.support_fee_annual_policies as p
         where p.billing_year = a.billing_year
           and p.status in ('published', 'closed')
         limit 1
       ),
       (((a.billing_year - 1)::text || '-12-31 23:59:00')::timestamp at time zone 'Europe/Sofia')
     )
   where a.early_deadline_at is null
     and a.status is distinct from 'void'
     and a.status is distinct from 'corrected'
     and a.remaining_due > 0
     and (p_property_id is null or a.property_id = p_property_id);

  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end;
$fn$;

revoke all on function public.admin_backfill_support_fee_early_deadlines(bigint) from public, anon;
grant execute on function public.admin_backfill_support_fee_early_deadlines(bigint) to authenticated;

comment on function public.admin_backfill_support_fee_early_deadlines(bigint) is
  'PKG-XFER P5 repair: set early_deadline_at on open assessments so overdue debt classification works.';
