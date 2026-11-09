-- R1-RC8: Support Fee annual policy as separate ledger ops.
-- Charge always posts base_amount. Early discount and late penalty are
-- append-only ledger rows. Late penalties can run after the deadline without
-- a payment (process_support_fee_late_penalties). Legacy baked early/late
-- assessments are left untouched.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema: effective_at + ledger kinds
-- ---------------------------------------------------------------------------

alter table public.support_fee_ledger
  add column if not exists effective_at timestamptz null;

comment on column public.support_fee_ledger.effective_at is
  'Actual cash/value date (Europe/Sofia business rules). Defaults to created_at.';

update public.support_fee_ledger
   set effective_at = created_at
 where effective_at is null;

alter table public.support_fee_ledger
  alter column effective_at set default now();

alter table public.support_fee_assessments
  add column if not exists early_discount_ledger_id bigint null
    references public.support_fee_ledger (id);

alter table public.support_fee_assessments
  add column if not exists late_penalty_ledger_id bigint null
    references public.support_fee_ledger (id);

alter table public.support_fee_ledger
  drop constraint if exists support_fee_ledger_kind_chk;

alter table public.support_fee_ledger
  add constraint support_fee_ledger_kind_chk
  check (
    kind = any (
      array[
        'payment'::text,
        'charge'::text,
        'adjustment_debit'::text,
        'adjustment_credit'::text,
        'payment_reversal'::text,
        'assessment_void'::text,
        'assessment_restore'::text,
        'opening_obligation'::text,
        'opening_historical_settlement'::text,
        'opening_credit'::text,
        'late_increase_waive'::text,
        'early_discount'::text,
        'late_penalty'::text
      ]
    )
  );

create unique index if not exists support_fee_ledger_early_discount_period_uidx
  on public.support_fee_ledger (property_id, period)
  where kind = 'early_discount' and period is not null;

create unique index if not exists support_fee_ledger_late_penalty_period_uidx
  on public.support_fee_ledger (property_id, period)
  where kind = 'late_penalty' and period is not null;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

create or replace function public.support_fee_legacy_baked_early(p_a public.support_fee_assessments)
returns boolean
language sql
stable
set search_path to ''
as $$
  select
    p_a.pricing_rule = 'early_full_payment'
    and p_a.early_discount_ledger_id is null
    and round(coalesce(p_a.final_amount, 0), 2)
      <= round(coalesce(p_a.early_amount, p_a.final_amount), 2) + 0.001
    and round(coalesce(p_a.final_amount, 0), 2)
      < round(coalesce(p_a.base_amount, 0), 2) - 0.001;
$$;

create or replace function public.support_fee_legacy_baked_late(p_a public.support_fee_assessments)
returns boolean
language sql
stable
set search_path to ''
as $$
  select
    p_a.pricing_rule = 'late'
    and p_a.late_penalty_ledger_id is null
    and round(coalesce(p_a.final_amount, 0), 2)
      >= round(coalesce(p_a.late_amount, p_a.final_amount), 2) - 0.001
    and round(coalesce(p_a.final_amount, 0), 2)
      > round(coalesce(p_a.base_amount, 0), 2) + 0.001;
$$;

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
  v_sum numeric := 0;
begin
  select coalesce(sum(a.amount), 0)
    into v_sum
  from public.support_fee_allocations as a
  join public.support_fee_ledger as l on l.id = a.ledger_entry_id
  where a.assessment_id = p_assessment_id
    and (
      a.allocation_type = 'credit'
      or (
        l.kind = 'payment'
        and coalesce(l.effective_at, l.created_at) <= p_deadline
      )
    );
  return round(coalesce(v_sum, 0), 2);
end;
$fn$;

revoke all on function public.support_fee_allocated_toward_early(uuid, timestamptz) from public, anon;
grant execute on function public.support_fee_allocated_toward_early(uuid, timestamptz) to authenticated;
grant execute on function public.support_fee_allocated_toward_early(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Early discount (idempotent)
-- ---------------------------------------------------------------------------

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
  v_discount := least(v_discount, v_remaining);
  if v_discount <= 0 then
    -- Fully paid at base already; still stamp early rule without money move.
    update public.support_fee_assessments
       set pricing_rule = 'early_full_payment',
           pricing_reason_code = 'early_fully_covered_by_credit',
           qualification_status = 'qualified',
           qualification_checked_at = v_as_of,
           final_amount = round(coalesce(early_amount, final_amount), 2)
     where id = v_a.id;
    return jsonb_build_object('applied', false, 'reason', 'already_settled_at_base');
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if v_discount <= v_debt then
    v_new_debt := round(v_debt - v_discount, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := round(v_over + (v_discount - v_debt), 2);
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

revoke all on function public.apply_support_fee_early_discount(uuid, timestamptz) from public, anon;
grant execute on function public.apply_support_fee_early_discount(uuid, timestamptz) to authenticated;
grant execute on function public.apply_support_fee_early_discount(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Late penalty (idempotent; may run without payment)
-- ---------------------------------------------------------------------------

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

  -- Last chance: if early was met by deadline but discount not posted yet, discount instead.
  v_early := public.apply_support_fee_early_discount(v_a.id, v_a.early_deadline_at);
  if coalesce((v_early ->> 'applied')::boolean, false)
     or coalesce(v_early ->> 'reason', '') in ('already_discounted', 'legacy_baked_early', 'already_settled_at_base') then
    return jsonb_build_object('applied', false, 'reason', 'early_resolved', 'early', v_early);
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id;

  -- Unpaid / early condition not met.
  if round(coalesce(v_a.remaining_due, 0), 2) <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'settled_without_penalty');
  end if;

  -- Penalty rule (acceptance): flat % of base_amount, not of remaining unpaid.
  -- Example: base 350 + 10% → penalty 35 even after a partial payment.
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

revoke all on function public.apply_support_fee_late_penalty(uuid, timestamptz) from public, anon;
grant execute on function public.apply_support_fee_late_penalty(uuid, timestamptz) to authenticated;
grant execute on function public.apply_support_fee_late_penalty(uuid, timestamptz) to service_role;

create or replace function public.process_support_fee_late_penalties(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_row record;
  v_res jsonb;
  v_applied int := 0;
  v_skipped int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  -- Cron (postgres), service_role, or fee managers.
  if current_user not in ('postgres', 'supabase_admin')
     and auth.role() is distinct from 'service_role'
     and not (
       public.has_staff_role('администрация')
       or public.has_staff_role('бухгалтер')
     ) then
    raise exception 'process_support_fee_late_penalties: not allowed' using errcode = '42501';
  end if;

  for v_row in
    select a.id
    from public.support_fee_assessments as a
    where a.status is distinct from 'void'
      and a.status is distinct from 'corrected'
      and a.early_deadline_at is not null
      and a.early_deadline_at < v_as_of
      and coalesce(a.increase_percent, 0) > 0
      and a.late_penalty_ledger_id is null
      and a.early_discount_ledger_id is null
      and a.pricing_rule is distinct from 'early_full_payment'
    order by a.billing_year, a.created_at
  loop
    v_res := public.apply_support_fee_late_penalty(v_row.id, v_as_of);
    if coalesce((v_res ->> 'applied')::boolean, false) then
      v_applied := v_applied + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
    v_details := v_details || jsonb_build_array(
      jsonb_build_object('assessment_id', v_row.id) || v_res
    );
  end loop;

  return jsonb_build_object(
    'as_of', v_as_of,
    'applied', v_applied,
    'skipped', v_skipped,
    'details', v_details
  );
end;
$fn$;

revoke all on function public.process_support_fee_late_penalties(timestamptz) from public, anon, authenticated;
grant execute on function public.process_support_fee_late_penalties(timestamptz) to service_role;

-- Optional pg_cron (same pattern as internet monthly).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('support-fee-late-penalties');
    exception when others then
      null;
    end;
    perform cron.schedule(
      'support-fee-late-penalties',
      '15 0 * * *',
      $cmd$select public.process_support_fee_late_penalties(now())$cmd$
    );
  end if;
exception when others then
  raise notice 'process_support_fee_late_penalties cron not scheduled: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Charge always posts base; then early discount or late penalty
-- ---------------------------------------------------------------------------

create or replace function public.finalize_support_fee_assessment(p_property_id bigint, p_billing_year integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  v_launch integer;
  v_disc jsonb;
  v_pen jsonb;
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

  v_launch := public.complex_launch_year();
  if v_launch is not null and p_billing_year <= v_launch then
    return jsonb_build_object(
      'applied', false,
      'idempotent', false,
      'reason', 'launch_year_blocks_charge',
      'launch_year', v_launch,
      'min_charge_year', v_launch + 1,
      'billing_year', p_billing_year,
      'amount', 0
    );
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
      'reason', 'charge_already_exists'
    );
  end if;

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

  -- Always charge BASE. Policy terms are snapshotted; discount/penalty are separate ops.
  v_final := v_base;
  v_rule := 'standard';
  v_qual := 'not_checked';
  if v_pol.id is null or v_pol.enabled is not true then
    v_early := v_base;
    v_late := v_base;
    v_deadline := (
      ((p_billing_year - 1)::text || '-12-31 23:59:00')::timestamp
      at time zone 'Europe/Sofia'
    );
    v_reason := 'policy_disabled';
  else
    v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
    v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);
    v_deadline := v_pol.early_payment_deadline;
    v_reason := 'policy_present_standard_finalize';
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
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, effective_at
    ) values (
      p_property_id, 'charge', v_final, v_period, v_note, btrim(v_email), v_new_debt, v_new_over, v_now
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
    case when v_pol.id is null or v_pol.enabled is not true then null else v_pol.id end,
    v_ledger_id,
    v_base,
    case when v_pol.id is null or v_pol.enabled is not true then 0 else v_pol.early_discount_percent end,
    case when v_pol.id is null or v_pol.enabled is not true then 0 else v_pol.late_increase_percent end,
    v_early,
    v_late,
    v_deadline,
    v_rule, v_reason, v_qual, v_now,
    v_over,
    least(v_over, v_base),
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

  -- After base charge: apply early discount if covered, else late penalty if past deadline.
  if v_pol.id is not null and v_pol.enabled is true then
    if v_now <= v_deadline then
      v_disc := public.apply_support_fee_early_discount(v_id, v_now);
    else
      v_pen := public.apply_support_fee_late_penalty(v_id, v_now);
    end if;
  end if;

  select a.final_amount, a.remaining_due, a.pricing_rule, a.status
    into v_final, v_remaining, v_rule, v_status
  from public.support_fee_assessments as a
  where a.id = v_id;

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
    'subject_kind', v_subject,
    'early_discount', v_disc,
    'late_penalty', v_pen
  );
end;
$function$;

revoke all on function public.finalize_support_fee_assessment(bigint, integer) from public;
revoke all on function public.finalize_support_fee_assessment(bigint, integer) from anon;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to authenticated;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Payments: effective_at + early discount pass + optional waive in same tx
-- ---------------------------------------------------------------------------

drop function if exists public.record_support_payment(bigint, numeric, text, uuid);
drop function if exists public.record_support_payment_for_year(bigint, numeric, integer, text, uuid);
drop function if exists public.record_support_payment_internal(bigint, numeric, integer, text, uuid);

create or replace function public.record_support_payment_internal(
  p_property_id bigint,
  p_amount numeric,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid,
  p_effective_at timestamptz default null,
  p_waive_assessment_id uuid default null,
  p_waive_reason text default null,
  p_waive_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email text;
  v_debt numeric;
  v_over numeric;
  v_pay numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_note text;
  v_period text;
  v_ledger_id bigint;
  v_debt_paid numeric;
  v_a public.support_fee_assessments;
  v_take numeric;
  v_left numeric;
  v_fin jsonb;
  v_existing public.support_fee_ledger;
  v_eff timestamptz;
  v_disc jsonb;
  v_waive jsonb;
  v_touched uuid[] := array[]::uuid[];
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

  if p_idempotency_key is null then
    raise exception 'record_support_payment: idempotency key is required'
      using errcode = '22023';
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

  v_note := btrim(coalesce(p_note, ''));
  if v_note = '' then
    v_note := 'Оплата таксы поддержки';
  end if;
  v_period := case
    when p_billing_year is null then null
    else p_billing_year::text
  end;
  v_eff := coalesce(p_effective_at, now());

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

  select l.*
    into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'payment'
       or v_existing.property_id is distinct from p_property_id
       or v_existing.amount is distinct from v_pay then
      raise exception 'record_support_payment: idempotency key conflict'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'ledger_id', v_existing.id,
      'amount', v_existing.amount,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after,
      'idempotent', true
    );
  end if;

  v_debt_paid := least(v_pay, v_debt);

  if v_pay <= v_debt then
    v_new_debt := round(v_debt - v_pay, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := round(v_over + (v_pay - v_debt), 2);
  end if;

  begin
    insert into public.support_fee_ledger (
      property_id,
      kind,
      amount,
      period,
      note,
      recorded_by,
      debt_after,
      overpayment_after,
      idempotency_key,
      effective_at
    )
    values (
      p_property_id,
      'payment',
      v_pay,
      null,
      v_note,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key,
      v_eff
    )
    returning id into v_ledger_id;
  exception
    when unique_violation then
      select l.* into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key;
      return jsonb_build_object(
        'ledger_id', v_existing.id,
        'amount', v_existing.amount,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after,
        'idempotent', true
      );
  end;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = p_property_id;

  v_left := v_debt_paid;
  for v_a in
    select *
    from public.support_fee_assessments as a
    where a.property_id = p_property_id
      and a.remaining_due > 0
      and a.status is distinct from 'void'
      and a.status is distinct from 'corrected'
    order by a.billing_year, a.created_at
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_a.remaining_due, v_left);
    insert into public.support_fee_allocations (
      assessment_id,
      ledger_entry_id,
      amount,
      allocation_type,
      created_by_email
    )
    values (
      v_a.id,
      v_ledger_id,
      v_take,
      'payment',
      btrim(v_email)
    );
    update public.support_fee_assessments
       set remaining_due = round(remaining_due - v_take, 2),
           applied_payment_amount = round(applied_payment_amount + v_take, 2),
           status = case when remaining_due - v_take <= 0 then 'paid' else status end
     where id = v_a.id;
    v_touched := array_append(v_touched, v_a.id);
    v_left := round(v_left - v_take, 2);
  end loop;

  if p_billing_year is not null then
    update public.support_fee_ledger
       set period = v_period
     where id = v_ledger_id
       and kind = 'payment';
    v_fin := public.finalize_support_fee_assessment(p_property_id, p_billing_year);
  end if;

  -- Early discount for assessments touched (and any open early-window years).
  for v_a in
    select *
    from public.support_fee_assessments as a
    where a.property_id = p_property_id
      and a.status is distinct from 'void'
      and a.status is distinct from 'corrected'
      and a.early_deadline_at is not null
      and v_eff <= a.early_deadline_at
  loop
    v_disc := public.apply_support_fee_early_discount(v_a.id, v_eff);
  end loop;

  if p_waive_assessment_id is not null then
    if p_waive_idempotency_key is null then
      raise exception 'record_support_payment: waive idempotency key required'
        using errcode = '22023';
    end if;
    v_waive := public.waive_support_fee_late_increase(
      p_waive_assessment_id,
      p_waive_reason,
      p_waive_idempotency_key
    );
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_new_debt, v_new_over
  from public.properties as p
  where p.id = p_property_id;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'amount', v_pay,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false,
    'effective_at', v_eff,
    'finalize', v_fin,
    'waive', v_waive,
    'touched_assessments', to_jsonb(v_touched)
  );
end;
$fn$;

create or replace function public.record_support_payment(
  p_property_id bigint,
  p_amount numeric,
  p_note text,
  p_idempotency_key uuid,
  p_effective_at timestamptz default null,
  p_waive_assessment_id uuid default null,
  p_waive_reason text default null,
  p_waive_idempotency_key uuid default null
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.record_support_payment_internal(
    p_property_id,
    p_amount,
    null,
    p_note,
    p_idempotency_key,
    p_effective_at,
    p_waive_assessment_id,
    p_waive_reason,
    p_waive_idempotency_key
  );
$function$;

create or replace function public.record_support_payment_for_year(
  p_property_id bigint,
  p_amount numeric,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid,
  p_effective_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.record_support_payment_internal(
    p_property_id,
    p_amount,
    p_billing_year,
    p_note,
    p_idempotency_key,
    p_effective_at,
    null,
    null,
    null
  );
$function$;

revoke all on function public.record_support_payment_internal(bigint, numeric, integer, text, uuid, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function public.record_support_payment_internal(bigint, numeric, integer, text, uuid, timestamptz, uuid, text, uuid) to authenticated;
grant execute on function public.record_support_payment_internal(bigint, numeric, integer, text, uuid, timestamptz, uuid, text, uuid) to service_role;

revoke all on function public.record_support_payment(bigint, numeric, text, uuid, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function public.record_support_payment(bigint, numeric, text, uuid, timestamptz, uuid, text, uuid) to authenticated;
grant execute on function public.record_support_payment(bigint, numeric, text, uuid, timestamptz, uuid, text, uuid) to service_role;

revoke all on function public.record_support_payment_for_year(bigint, numeric, integer, text, uuid, timestamptz) from public, anon;
grant execute on function public.record_support_payment_for_year(bigint, numeric, integer, text, uuid, timestamptz) to authenticated;
grant execute on function public.record_support_payment_for_year(bigint, numeric, integer, text, uuid, timestamptz) to service_role;

-- Waive note text for cancel-penalty wording (same RPC, clearer history).
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
    property_id,
    kind,
    amount,
    period,
    note,
    recorded_by,
    debt_after,
    overpayment_after,
    idempotency_key,
    reversal_reason,
    effective_at
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

revoke all on function public.waive_support_fee_late_increase(uuid, text, uuid) from public, anon;
grant execute on function public.waive_support_fee_late_increase(uuid, text, uuid) to authenticated;
grant execute on function public.waive_support_fee_late_increase(uuid, text, uuid) to service_role;

commit;
