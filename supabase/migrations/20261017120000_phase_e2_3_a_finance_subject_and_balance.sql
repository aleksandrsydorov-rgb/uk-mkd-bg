-- Phase E2.3-A — Finance subject fix (FIN-P1-7) + D2/D3 charge/reprice policy
-- D1: remaining_due remains SoT for SF outstanding (no historical money rewrites).
-- D2: mid-year / ownership subject change stays prospective (unchanged elsewhere).
-- D3: charge paths must NOT auto-reprice; staff calls reprice_support_fee_assessment_to_tariff.
-- D5: apartment-level billing unchanged (no share split).
-- Does NOT enable debt gate / email. Does NOT backfill or correct legacy balances.
-- DO NOT APPLY until operator authorization (Phase E2.3-A prepare-only).

begin;

-- ---------------------------------------------------------------------------
-- FIN-P1-7: finalize — resolve tariff by Property Book subject (natural|legal)
-- ---------------------------------------------------------------------------

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
  v_subject text;
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

  -- FIN-P1-7: Book-driven subject (legal_entity → legal; else natural). No email/name inference here.
  v_subject := public.property_tariff_subject_kind(p_property_id);
  select r.* into v_tariff
  from public.resolve_support_tariff_for_year(p_billing_year, v_subject) as r;

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
        'rate_eur_per_sqm_year', v_rate,
        'subject_kind', v_subject
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
    'rate_eur_per_sqm_year_snapshot', v_rate,
    'subject_kind', v_subject
  );
end;
$fn$;

revoke all on function public.finalize_support_fee_assessment(bigint, integer) from public, anon;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- FIN-P1-7 + D2/D3: reprice — subject-aware; refuse settled/paid; compare rate too
-- ---------------------------------------------------------------------------

create or replace function public.reprice_support_fee_assessment_to_tariff(
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
  v_a public.support_fee_assessments;
  v_tariff record;
  v_new_rate numeric;
  v_new_base numeric;
  v_new_early numeric;
  v_new_late numeric;
  v_new_final numeric;
  v_delta numeric;
  v_corr jsonb;
  v_module_enabled boolean;
  v_subject text;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'reprice_support_fee_assessment_to_tariff: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'reprice_support_fee_assessment_to_tariff: not allowed'
      using errcode = '42501';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'support_fee';
  if v_module_enabled is not true then
    raise exception 'Support fee module is disabled.';
  end if;

  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'reprice_support_fee_assessment_to_tariff: invalid billing year'
      using errcode = '22023';
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.billing_year = p_billing_year
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'no_assessment');
  end if;

  -- D2: previously paid/settled periods stay unchanged even for explicit reprice.
  if v_a.status is not distinct from 'paid'
     or v_a.status is not distinct from 'void'
     or v_a.status is not distinct from 'corrected'
     or coalesce(v_a.remaining_due, 0) <= 0 then
    return jsonb_build_object(
      'applied', false,
      'reason', 'settled_assessment_immutable',
      'assessment_id', v_a.id,
      'status', v_a.status,
      'remaining_due', v_a.remaining_due
    );
  end if;

  v_subject := public.property_tariff_subject_kind(p_property_id);
  select r.* into v_tariff
  from public.resolve_support_tariff_for_year(p_billing_year, v_subject) as r;

  -- Same version alone is insufficient: wrong subject may share tariff_version_id.
  if v_a.tariff_version_id is not distinct from v_tariff.tariff_version_id
     and v_a.rate_eur_per_sqm_year_snapshot is not distinct from v_tariff.rate then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'reason', 'same_tariff',
      'assessment_id', v_a.id,
      'tariff_version_id', v_a.tariff_version_id,
      'final_amount', v_a.final_amount,
      'subject_kind', v_subject
    );
  end if;

  v_new_rate := v_tariff.rate;
  v_new_base := round(coalesce(v_a.area_sqm_snapshot, 0) * v_new_rate, 2);
  v_new_early := round(v_new_base * (1 - coalesce(v_a.discount_percent, 0) / 100), 2);
  v_new_late := round(v_new_base * (1 + coalesce(v_a.increase_percent, 0) / 100), 2);

  if v_a.pricing_rule = 'early_full_payment' then
    v_new_final := v_new_early;
  elsif v_a.pricing_rule = 'late' then
    v_new_final := v_new_late;
  else
    v_new_final := v_new_base;
    v_new_early := v_new_base;
    v_new_late := v_new_base;
  end if;

  v_delta := round(v_new_final - v_a.final_amount, 2);

  if v_delta <> 0 then
    v_corr := public.record_support_fee_assessment_correction(
      v_a.id,
      v_delta,
      'Пересчёт по новому тарифу ' || p_billing_year::text || ' (' || v_subject || ')'
    );
  end if;

  perform set_config('uk.support_fee_allow_tariff_reprice', '1', true);

  update public.support_fee_assessments as a
     set tariff_version_id = v_tariff.tariff_version_id,
         rate_eur_per_sqm_year_snapshot = v_new_rate,
         base_amount = v_new_base,
         early_amount = v_new_early,
         late_amount = v_new_late,
         final_amount = v_new_final
   where a.id = v_a.id;

  perform set_config('uk.support_fee_allow_tariff_reprice', '0', true);

  return jsonb_build_object(
    'applied', true,
    'repriced', true,
    'assessment_id', v_a.id,
    'tariff_version_id', v_tariff.tariff_version_id,
    'previous_final_amount', v_a.final_amount,
    'final_amount', v_new_final,
    'delta', v_delta,
    'correction', v_corr,
    'subject_kind', v_subject
  );
end;
$fn$;

revoke all on function public.reprice_support_fee_assessment_to_tariff(bigint, integer) from public, anon;
grant execute on function public.reprice_support_fee_assessment_to_tariff(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- D3: charge must NOT auto-reprice existing assessments (explicit reprice only)
-- ---------------------------------------------------------------------------

create or replace function public.charge_support_fee(
  p_property_id bigint,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_period text;
  v_year integer;
  v_fin jsonb;
  v_module_enabled boolean;
  v_existing public.support_fee_assessments;
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

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'support_fee';
  if v_module_enabled is not true then
    raise exception 'Support fee module is disabled.';
  end if;

  v_period := btrim(coalesce(p_period, ''));
  if v_period !~ '^[0-9]{4}$' then
    raise exception 'charge_support_fee: period must be YYYY'
      using errcode = '22023';
  end if;

  v_year := v_period::integer;

  select a.* into v_existing
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.billing_year = v_year
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected'
  order by a.created_at desc
  limit 1;

  if found then
    -- D3: leave existing assessment untouched; staff may call reprice explicitly.
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'reason', 'assessment_exists_no_auto_reprice',
      'assessment_id', v_existing.id,
      'status', v_existing.status,
      'final_amount', v_existing.final_amount,
      'remaining_due', v_existing.remaining_due,
      'amount', v_existing.final_amount,
      'ledger_id', v_existing.charge_ledger_id,
      'tariff_version_id', v_existing.tariff_version_id
    );
  end if;

  v_fin := public.finalize_support_fee_assessment(p_property_id, v_year);

  if coalesce((v_fin->>'applied')::boolean, false) then
    return v_fin || jsonb_build_object(
      'ledger_id', (
        select a.charge_ledger_id
        from public.support_fee_assessments as a
        where a.id = (v_fin->>'assessment_id')::uuid
      ),
      'amount', (v_fin->>'final_amount')::numeric
    );
  end if;

  if coalesce((v_fin->>'idempotent')::boolean, false)
     or v_fin->>'reason' in (
       'charge_already_exists',
       'early_window_not_qualified',
       'zero_base'
     ) then
    return v_fin || jsonb_build_object(
      'amount', coalesce((v_fin->>'final_amount')::numeric, (v_fin->>'amount')::numeric, 0),
      'ledger_id', null
    );
  end if;

  return v_fin;
end;
$fn$;

revoke all on function public.charge_support_fee(bigint, text) from public, anon;
grant execute on function public.charge_support_fee(bigint, text) to authenticated;

comment on function public.finalize_support_fee_assessment(bigint, integer) is
  'E2.3-A: finalize SF assessment using property_tariff_subject_kind (natural|legal).';

comment on function public.reprice_support_fee_assessment_to_tariff(bigint, integer) is
  'E2.3-A: explicit staff reprice; subject-aware; refuses settled/paid assessments.';

comment on function public.charge_support_fee(bigint, text) is
  'E2.3-A: charge/finalize only; does not auto-reprice existing assessments (D3).';

commit;
