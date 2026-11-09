-- Allow policy ops (early discount / late penalty / waive) to update
-- pricing_rule + final_amount under an explicit transaction-local flag.
-- Tariff snapshot fields remain protected unless tariff-reprice flag is set.

begin;

create or replace function public.support_fee_assessment_snapshot_immutable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' then
    if current_setting('uk.support_fee_allow_tariff_reprice', true) = '1'
       or current_setting('uk.support_fee_allow_policy_ops', true) = '1' then
      return new;
    end if;
    if old.tariff_version_id is distinct from new.tariff_version_id
       or old.area_sqm_snapshot is distinct from new.area_sqm_snapshot
       or old.rate_eur_per_sqm_year_snapshot is distinct from new.rate_eur_per_sqm_year_snapshot
       or old.base_amount is distinct from new.base_amount
       or old.early_amount is distinct from new.early_amount
       or old.late_amount is distinct from new.late_amount
       or old.discount_percent is distinct from new.discount_percent
       or old.increase_percent is distinct from new.increase_percent
       or old.pricing_rule is distinct from new.pricing_rule
       or old.final_amount is distinct from new.final_amount then
      raise exception
        'support_fee_assessments: pricing snapshot is immutable; use correction ledger'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$fn$;

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

  v_covered := public.support_fee_allocated_toward_early(v_a.id, v_a.early_deadline_at);
  if v_covered + 0.001 < round(coalesce(v_a.early_amount, 0), 2) then
    return jsonb_build_object(
      'applied', false,
      'reason', 'not_fully_covered',
      'covered', v_covered,
      'need', round(v_a.early_amount, 2)
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
  -- If year already settled at base (paid >= base), still post discount as credit/overpayment.
  -- Example: paid 350 early → discount 35 → overpayment +35, final=early.
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
    -- remaining already 0: credit the discount into overpayment
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
     set remaining_due = greatest(0, round(remaining_due - v_discount, 2)),
         final_amount = round(coalesce(early_amount, base_amount - v_discount), 2),
         status = case
           when remaining_due - v_discount <= 0 then 'paid'
           else status
         end,
         pricing_rule = 'early_full_payment',
         pricing_reason_code = 'early_fully_covered_by_payments',
         qualification_status = 'qualified',
         qualification_checked_at = v_as_of,
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
    'remaining_due', greatest(0, round(v_remaining - v_discount, 2))
  );
end;
$fn$;

-- Late penalty: set flag before updating assessment snapshot fields
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
     or coalesce(v_early ->> 'reason', '') in ('already_discounted', 'legacy_baked_early', 'already_settled_at_base') then
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
    'remaining_due', round(coalesce(v_a.remaining_due, 0) + v_penalty, 2)
  );
end;
$fn$;

-- Waive also updates final_amount
create or replace function public.waive_support_fee_late_increase(
  p_assessment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email text := auth.email();
  v_reason text;
  v_a public.support_fee_assessments;
  v_existing public.support_fee_ledger;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_waive numeric;
  v_ledger_id bigint;
  v_remaining numeric;
  v_pct numeric;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'waive_support_fee_late_increase: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'waive_support_fee_late_increase: not allowed' using errcode = '42501';
  end if;
  if p_assessment_id is null or p_idempotency_key is null then
    raise exception 'waive_support_fee_late_increase: assessment and idempotency key required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'waive_support_fee_late_increase: reason required' using errcode = '22023';
  end if;

  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'late_increase_waive' then
      raise exception 'waive_support_fee_late_increase: idempotency key conflict'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'assessment_id', p_assessment_id,
      'waive_ledger_id', v_existing.id,
      'waived_amount', v_existing.amount,
      'idempotent', true,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after
    );
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'waive_support_fee_late_increase: assessment not found'
      using errcode = 'P0002';
  end if;
  if coalesce(v_a.opening_import, false) then
    raise exception 'waive_support_fee_late_increase: opening_import blocks waive'
      using errcode = 'P0001';
  end if;

  if v_a.penalty_waived_at is not null then
    raise exception 'waive_support_fee_late_increase: already waived' using errcode = '22023';
  end if;
  if v_a.status is distinct from 'open' then
    raise exception 'waive_support_fee_late_increase: assessment must be open'
      using errcode = '22023';
  end if;
  if v_a.pricing_rule is distinct from 'late' then
    raise exception 'waive_support_fee_late_increase: only late assessments'
      using errcode = '22023';
  end if;
  if coalesce(v_a.increase_percent, 0) <= 0 then
    raise exception 'waive_support_fee_late_increase: no late increase on assessment'
      using errcode = '22023';
  end if;

  v_remaining := greatest(0, round(coalesce(v_a.remaining_due, 0), 2));
  v_waive := least(
    v_remaining,
    greatest(
      0,
      round(coalesce(v_a.late_amount, 0) - coalesce(v_a.base_amount, 0), 2),
      round(coalesce(v_a.base_amount, 0) * coalesce(v_a.increase_percent, 0) / 100.0, 2)
    )
  );
  if v_a.late_penalty_ledger_id is not null then
    select amount into v_waive
    from public.support_fee_ledger
    where id = v_a.late_penalty_ledger_id;
    v_waive := least(v_remaining, round(coalesce(v_waive, 0), 2));
  end if;
  if v_waive <= 0 then
    raise exception 'waive_support_fee_late_increase: nothing to waive' using errcode = '22023';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if v_waive <= v_debt then
    v_new_debt := round(v_debt - v_waive, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := v_over;
  end if;

  v_pct := coalesce(v_a.increase_percent, 0);

  insert into public.support_fee_ledger (
    property_id, kind, amount, period, note, recorded_by,
    debt_after, overpayment_after, idempotency_key, reversal_reason, effective_at
  ) values (
    v_a.property_id,
    'late_increase_waive',
    v_waive,
    v_a.billing_year::text,
    format('Штраф %s%% отменён — %s €',
      trim(to_char(v_pct, 'FM999990.##')),
      trim(to_char(v_waive, 'FM999990.00'))),
    btrim(v_email),
    v_new_debt,
    v_new_over,
    p_idempotency_key,
    v_reason,
    now()
  )
  returning id into v_ledger_id;

  perform set_config('uk.support_fee_allow_policy_ops', '1', true);

  update public.support_fee_assessments
     set remaining_due = greatest(0, round(remaining_due - v_waive, 2)),
         final_amount = greatest(
           round(coalesce(base_amount, 0), 2),
           round(coalesce(final_amount, 0) - v_waive, 2)
         ),
         status = case
           when remaining_due - v_waive <= 0 then 'paid'
           else status
         end,
         penalty_waive_reason = v_reason,
         penalty_waived_at = now(),
         penalty_waived_by_email = btrim(v_email),
         penalty_waive_ledger_id = v_ledger_id
   where id = p_assessment_id;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'assessment_id', p_assessment_id,
    'waive_ledger_id', v_ledger_id,
    'waived_amount', v_waive,
    'remaining_due', greatest(0, round(v_remaining - v_waive, 2)),
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false,
    'billing_year', v_a.billing_year,
    'increase_percent', v_pct
  );
end;
$fn$;

commit;
