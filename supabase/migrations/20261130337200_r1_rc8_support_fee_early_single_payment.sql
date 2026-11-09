-- Early discount requires ONE payment whose year-allocated portion
-- (after FIFO older debts) covers early_amount by the deadline inclusive.
-- Partial payments are NOT combined.

begin;

create or replace function public.support_fee_allocated_toward_early(
  p_assessment_id uuid,
  p_deadline timestamptz
)
returns numeric
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_best numeric := 0;
begin
  -- Largest year-allocation from any single non-reversed payment
  -- with effective_at (or created_at) on/before the early deadline.
  select coalesce(max(s.pay_amt), 0)
    into v_best
  from (
    select a.ledger_entry_id, round(sum(a.amount)::numeric, 2) as pay_amt
    from public.support_fee_allocations as a
    join public.support_fee_ledger as l on l.id = a.ledger_entry_id
    where a.assessment_id = p_assessment_id
      and a.allocation_type = 'payment'
      and l.kind = 'payment'
      and coalesce(l.effective_at, l.created_at) <= p_deadline
      and not exists (
        select 1
        from public.support_fee_ledger as r
        where r.kind = 'payment_reversal'
          and r.reverses_ledger_id = l.id
      )
    group by a.ledger_entry_id
  ) as s;

  return round(coalesce(v_best, 0), 2);
end;
$fn$;

comment on function public.support_fee_allocated_toward_early(uuid, timestamptz) is
  'Max year-allocated amount from a single non-reversed payment on/before early deadline. Partials are not summed.';

create or replace function public.apply_support_fee_early_discount(
  p_assessment_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email text := auth.email();
  v_a public.support_fee_assessments;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_covered numeric;
  v_discount numeric;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_ledger_id bigint;
  v_remaining numeric;
  v_pct numeric;
  v_need numeric;
begin
  if p_assessment_id is null then
    return jsonb_build_object('applied', false, 'reason', 'missing_assessment');
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;

  if v_a.status in ('void', 'corrected') then
    return jsonb_build_object('applied', false, 'reason', 'inactive');
  end if;
  if public.support_fee_legacy_baked_early(v_a) then
    return jsonb_build_object('applied', false, 'reason', 'legacy_baked_early', 'idempotent', true);
  end if;
  if v_a.early_discount_ledger_id is not null
     or exists (
       select 1 from public.support_fee_ledger l
       where l.property_id = v_a.property_id
         and l.kind = 'early_discount'
         and l.period = v_a.billing_year::text
     ) then
    return jsonb_build_object('applied', false, 'reason', 'already_discounted', 'idempotent', true);
  end if;
  if v_a.late_penalty_ledger_id is not null
     or public.support_fee_legacy_baked_late(v_a)
     or exists (
       select 1 from public.support_fee_ledger l
       where l.property_id = v_a.property_id
         and l.kind = 'late_penalty'
         and l.period = v_a.billing_year::text
     ) then
    return jsonb_build_object('applied', false, 'reason', 'late_already_applied');
  end if;
  if v_a.early_deadline_at is null
     or coalesce(v_a.discount_percent, 0) <= 0
     or coalesce(v_a.early_amount, 0) <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'no_early_policy');
  end if;
  if v_as_of > v_a.early_deadline_at then
    return jsonb_build_object('applied', false, 'reason', 'after_deadline');
  end if;

  v_need := round(coalesce(v_a.early_amount, 0), 2);
  v_covered := public.support_fee_allocated_toward_early(v_a.id, v_a.early_deadline_at);
  if v_covered + 0.001 < v_need then
    return jsonb_build_object(
      'applied', false,
      'reason', 'not_single_payment_cover',
      'covered', v_covered,
      'need', v_need
    );
  end if;

  v_discount := round(
    greatest(0, coalesce(v_a.base_amount, 0) - coalesce(v_a.early_amount, 0)),
    2
  );
  if v_discount <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'zero_discount');
  end if;

  v_remaining := greatest(0, round(coalesce(v_a.remaining_due, 0), 2));
  perform set_config('uk.support_fee_allow_policy_ops', '1', true);

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if v_discount <= v_remaining then
    if v_discount <= v_debt then
      v_new_debt := round(v_debt - v_discount, 2);
      v_new_over := v_over;
    else
      v_new_debt := 0;
      v_new_over := round(v_over + (v_discount - v_debt), 2);
    end if;
  else
    -- Already settled at/above early (e.g. one payment of base): discount → overpayment.
    v_new_debt := v_debt;
    v_new_over := round(v_over + v_discount, 2);
  end if;

  v_pct := coalesce(v_a.discount_percent, 0);

  begin
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by,
      debt_after, overpayment_after, effective_at
    ) values (
      v_a.property_id,
      'early_discount',
      v_discount,
      v_a.billing_year::text,
      format('Скидка за досрочную оплату %s%% — %s €',
        trim(to_char(v_pct, 'FM999990.##')),
        trim(to_char(v_discount, 'FM999990.00'))),
      coalesce(nullif(btrim(v_email), ''), 'system'),
      v_new_debt,
      v_new_over,
      v_as_of
    )
    returning id into v_ledger_id;
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'already_discounted', 'idempotent', true);
  end;

  update public.support_fee_assessments
     set remaining_due = greatest(0, round(remaining_due - least(v_discount, remaining_due), 2)),
         final_amount = round(coalesce(early_amount, base_amount - v_discount), 2),
         status = case
           when remaining_due - least(v_discount, remaining_due) <= 0 then 'paid'
           else status
         end,
         pricing_rule = 'early_full_payment',
         pricing_reason_code = 'early_fully_covered_by_payments',
         qualification_status = 'qualified',
         qualification_checked_at = v_as_of,
         amount_covered_at_check = v_covered,
         dedicated_payment_at_check = v_covered,
         early_discount_ledger_id = v_ledger_id
   where id = v_a.id;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'applied', true,
    'assessment_id', v_a.id,
    'discount_ledger_id', v_ledger_id,
    'discount_amount', v_discount,
    'single_payment_covered', v_covered,
    'remaining_due', greatest(0, round(v_remaining - least(v_discount, v_remaining), 2))
  );
end;
$fn$;

-- When late penalty stamps amount_covered_at_check, keep single-payment semantics.
create or replace function public.apply_support_fee_late_penalty(
  p_assessment_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email text := auth.email();
  v_a public.support_fee_assessments;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_penalty numeric;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_ledger_id bigint;
  v_pct numeric;
  v_early jsonb;
  v_covered numeric;
begin
  if p_assessment_id is null then
    return jsonb_build_object('applied', false, 'reason', 'missing_assessment');
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;

  if v_a.status in ('void', 'corrected') then
    return jsonb_build_object('applied', false, 'reason', 'inactive');
  end if;
  if public.support_fee_legacy_baked_late(v_a) then
    return jsonb_build_object('applied', false, 'reason', 'legacy_baked_late', 'idempotent', true);
  end if;
  if v_a.late_penalty_ledger_id is not null
     or exists (
       select 1 from public.support_fee_ledger l
       where l.property_id = v_a.property_id
         and l.kind = 'late_penalty'
         and l.period = v_a.billing_year::text
     ) then
    return jsonb_build_object('applied', false, 'reason', 'already_penalized', 'idempotent', true);
  end if;
  if v_a.early_discount_ledger_id is not null
     or public.support_fee_legacy_baked_early(v_a)
     or v_a.pricing_rule = 'early_full_payment' then
    return jsonb_build_object('applied', false, 'reason', 'early_applied');
  end if;
  if v_a.early_deadline_at is null
     or coalesce(v_a.increase_percent, 0) <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'no_late_policy');
  end if;
  if v_as_of <= v_a.early_deadline_at then
    return jsonb_build_object('applied', false, 'reason', 'before_deadline');
  end if;

  v_early := public.apply_support_fee_early_discount(v_a.id, v_a.early_deadline_at);
  if coalesce((v_early ->> 'applied')::boolean, false)
     or coalesce(v_early ->> 'reason', '') in ('already_discounted', 'legacy_baked_early') then
    return jsonb_build_object('applied', false, 'reason', 'early_resolved', 'early', v_early);
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id;

  if round(coalesce(v_a.remaining_due, 0), 2) <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'settled_without_penalty');
  end if;

  v_penalty := round(
    greatest(
      0,
      coalesce(v_a.late_amount, coalesce(v_a.base_amount, 0))
        - coalesce(v_a.base_amount, 0),
      coalesce(v_a.base_amount, 0) * coalesce(v_a.increase_percent, 0) / 100.0
    ),
    2
  );
  if v_penalty <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'zero_penalty');
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  v_new_debt := round(v_debt + v_penalty, 2);
  v_pct := coalesce(v_a.increase_percent, 0);
  v_covered := public.support_fee_allocated_toward_early(v_a.id, v_a.early_deadline_at);

  begin
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by,
      debt_after, overpayment_after, effective_at
    ) values (
      v_a.property_id,
      'late_penalty',
      v_penalty,
      v_a.billing_year::text,
      format('Штраф за просрочку %s%% — %s €',
        trim(to_char(v_pct, 'FM999990.##')),
        trim(to_char(v_penalty, 'FM999990.00'))),
      coalesce(nullif(btrim(v_email), ''), 'system'),
      v_new_debt,
      v_over,
      v_as_of
    )
    returning id into v_ledger_id;
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'already_penalized', 'idempotent', true);
  end;

  perform set_config('uk.support_fee_allow_policy_ops', '1', true);

  update public.support_fee_assessments
     set remaining_due = round(coalesce(remaining_due, 0) + v_penalty, 2),
         final_amount = round(coalesce(base_amount, 0) + v_penalty, 2),
         status = 'open',
         pricing_rule = 'late',
         pricing_reason_code = 'early_not_fully_covered',
         qualification_status = 'not_qualified',
         qualification_checked_at = v_as_of,
         amount_covered_at_check = v_covered,
         dedicated_payment_at_check = v_covered,
         late_penalty_ledger_id = v_ledger_id
   where id = v_a.id;

  update public.properties
     set debt = v_new_debt
   where id = v_a.property_id;

  return jsonb_build_object(
    'applied', true,
    'assessment_id', v_a.id,
    'penalty_ledger_id', v_ledger_id,
    'penalty_amount', v_penalty,
    'remaining_due', round(coalesce(v_a.remaining_due, 0) + v_penalty, 2),
    'single_payment_covered', v_covered
  );
end;
$fn$;

commit;
