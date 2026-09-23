-- =============================================================================
-- AMADEUS 11 — support fee annual pricing (early 90% / late 110%)
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Incremental. Does NOT drop support_fee_ledger, properties.debt/overpayment,
-- water, electricity, capital repair, general meetings, or polls.
-- Base amount remains: round(area_sqm * support_rate_eur_per_sqm_year, 2).
-- Allocation order unchanged: payments reduce debt first; remainder = overpayment.
-- Charges consume overpayment first, then increase debt.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.support_fee_ledger') is null then
    raise exception 'Pre-flight failed: public.support_fee_ledger does not exist.';
  end if;
  if to_regclass('public.building_settings') is null then
    raise exception 'Pre-flight failed: public.building_settings does not exist.';
  end if;
  if to_regclass('public.properties') is null then
    raise exception 'Pre-flight failed: public.properties does not exist.';
  end if;
  if to_regprocedure('public.can_manage_support_fees()') is null then
    raise exception 'Pre-flight failed: public.can_manage_support_fees() does not exist.';
  end if;
  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'Pre-flight failed: public.is_staff() does not exist.';
  end if;
  if to_regprocedure('public.charge_support_fee(bigint,text)') is null then
    raise exception 'Pre-flight failed: public.charge_support_fee(bigint,text) does not exist.';
  end if;
  if to_regprocedure('public.record_support_payment(bigint,numeric,text)') is null then
    raise exception 'Pre-flight failed: public.record_support_payment(bigint,numeric,text) does not exist.';
  end if;
end
$pre$;

do $kind$
declare
  v_name name;
  v_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid)
    into v_name, v_def
  from pg_constraint c
  where c.conrelid = 'public.support_fee_ledger'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%kind%'
  order by c.oid
  limit 1;

  if v_name is null then
    alter table public.support_fee_ledger
      add constraint support_fee_ledger_kind_chk
      check (kind in ('payment','charge','adjustment_debit','adjustment_credit'));
    return;
  end if;

  if v_def like '%adjustment_debit%' then
    return;
  end if;

  execute format('alter table public.support_fee_ledger drop constraint %I', v_name);
  alter table public.support_fee_ledger
    add constraint support_fee_ledger_kind_chk
    check (kind in ('payment','charge','adjustment_debit','adjustment_credit'));
end
$kind$;

create table if not exists public.support_fee_annual_policies (
  id uuid primary key default gen_random_uuid(),
  billing_year integer not null unique
    check (billing_year >= 2000 and billing_year <= 2100),
  enabled boolean not null default true,
  status text not null default 'draft'
    check (status in ('draft','published','closed')),
  early_discount_percent numeric(5,2) not null default 10
    check (early_discount_percent >= 0 and early_discount_percent <= 100),
  late_increase_percent numeric(5,2) not null default 10
    check (late_increase_percent >= 0 and late_increase_percent <= 100),
  early_payment_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create table if not exists public.support_fee_assessments (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  billing_year integer not null
    check (billing_year >= 2000 and billing_year <= 2100),
  policy_id uuid references public.support_fee_annual_policies (id) on delete set null,
  charge_ledger_id bigint references public.support_fee_ledger (id) on delete set null,
  base_amount numeric(12,2) not null,
  discount_percent numeric(5,2) not null default 0,
  increase_percent numeric(5,2) not null default 0,
  early_amount numeric(12,2) not null,
  late_amount numeric(12,2) not null,
  early_deadline_at timestamptz,
  pricing_rule text not null
    check (pricing_rule in ('early_full_payment','late','standard')),
  pricing_reason_code text
    check (pricing_reason_code in (
      'early_fully_covered_by_credit',
      'early_fully_covered_by_payments',
      'early_fully_covered_mixed',
      'early_not_fully_covered',
      'policy_disabled'
    )),
  qualification_status text not null
    check (qualification_status in ('not_checked','qualified','not_qualified')),
  qualification_checked_at timestamptz,
  available_credit_at_check numeric(12,2) not null default 0,
  amount_covered_at_check numeric(12,2) not null default 0,
  dedicated_payment_at_check numeric(12,2) not null default 0,
  applied_credit_amount numeric(12,2) not null default 0,
  applied_payment_amount numeric(12,2) not null default 0,
  final_amount numeric(12,2) not null,
  remaining_due numeric(12,2) not null default 0,
  balance_before numeric(12,2),
  balance_after numeric(12,2),
  status text not null default 'open'
    check (status in ('open','paid')),
  created_at timestamptz not null default now(),
  created_by_email text,
  finalized_at timestamptz,
  finalized_by_email text,
  correction_reason text,
  correction_at timestamptz,
  correction_by_email text,
  unique (property_id, billing_year)
);

create table if not exists public.support_fee_allocations (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.support_fee_assessments (id) on delete cascade,
  ledger_entry_id bigint references public.support_fee_ledger (id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  allocation_type text not null check (allocation_type in ('payment','credit')),
  created_at timestamptz not null default now(),
  created_by_email text
);

create index if not exists support_fee_assessments_property_idx
  on public.support_fee_assessments (property_id, billing_year desc);

create index if not exists support_fee_allocations_assessment_idx
  on public.support_fee_allocations (assessment_id, created_at);

alter table public.support_fee_annual_policies enable row level security;
alter table public.support_fee_assessments enable row level security;
alter table public.support_fee_allocations enable row level security;

revoke all on table public.support_fee_annual_policies from public;
revoke all on table public.support_fee_annual_policies from anon;
revoke all on table public.support_fee_assessments from public;
revoke all on table public.support_fee_assessments from anon;
revoke all on table public.support_fee_allocations from public;
revoke all on table public.support_fee_allocations from anon;

revoke all on table public.support_fee_annual_policies from authenticated;
revoke all on table public.support_fee_assessments from authenticated;
revoke all on table public.support_fee_allocations from authenticated;

grant select on table public.support_fee_annual_policies to authenticated;
grant select on table public.support_fee_assessments to authenticated;
grant select on table public.support_fee_allocations to authenticated;

drop policy if exists support_fee_annual_policies_select on public.support_fee_annual_policies;
create policy support_fee_annual_policies_select
on public.support_fee_annual_policies
for select
to authenticated
using (
  public.is_staff()
  or status in ('published','closed')
);

drop policy if exists support_fee_assessments_select on public.support_fee_assessments;
create policy support_fee_assessments_select
on public.support_fee_assessments
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

drop policy if exists support_fee_allocations_select on public.support_fee_allocations;
create policy support_fee_allocations_select
on public.support_fee_allocations
for select
to authenticated
using (
  public.is_staff()
  or exists (
    select 1
    from public.support_fee_assessments as a
    where a.id = assessment_id
      and public.owns_property(a.property_id)
  )
);

create or replace function public.support_fee_early_deadline(p_billing_year integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select make_timestamptz(p_billing_year - 1, 12, 31, 23, 59, 59, 'Europe/Sofia');
$$;

create or replace function public.support_fee_year_start(p_billing_year integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select make_timestamptz(p_billing_year, 1, 1, 0, 0, 0, 'Europe/Sofia');
$$;

create or replace function public.support_fee_base_amount(p_property_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_area numeric;
  v_rate numeric;
begin
  select coalesce(p.area_sqm, 0)::numeric
    into v_area
  from public.properties as p
  where p.id = p_property_id;

  if not found then
    return 0;
  end if;

  select bs.support_rate_eur_per_sqm_year
    into v_rate
  from public.building_settings as bs
  where bs.id = 1;

  if v_rate is null or v_rate <= 0 then
    v_rate := 8;
  end if;

  return round(coalesce(v_area, 0) * v_rate, 2);
end;
$fn$;

revoke all on function public.support_fee_early_deadline(integer) from public;
revoke all on function public.support_fee_year_start(integer) from public;
revoke all on function public.support_fee_base_amount(bigint) from public;
revoke execute on function public.support_fee_early_deadline(integer) from anon;
revoke execute on function public.support_fee_year_start(integer) from anon;
revoke execute on function public.support_fee_base_amount(bigint) from anon;
grant execute on function public.support_fee_early_deadline(integer) to authenticated;
grant execute on function public.support_fee_year_start(integer) to authenticated;
grant execute on function public.support_fee_base_amount(bigint) to authenticated;

create or replace function public.upsert_support_fee_annual_policy(
  p_billing_year integer,
  p_enabled boolean,
  p_early_discount_percent numeric,
  p_late_increase_percent numeric,
  p_early_payment_deadline timestamptz
)
returns public.support_fee_annual_policies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.support_fee_annual_policies;
  v_email text := auth.email();
  v_deadline timestamptz;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'upsert_support_fee_annual_policy: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'upsert_support_fee_annual_policy: not allowed' using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'upsert_support_fee_annual_policy: invalid billing year' using errcode = '22023';
  end if;

  v_deadline := coalesce(p_early_payment_deadline, public.support_fee_early_deadline(p_billing_year));

  select * into v_row
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
  for update;

  if found then
    if v_row.status is distinct from 'draft' then
      raise exception 'upsert_support_fee_annual_policy: published policy cannot be edited' using errcode = '42501';
    end if;
    update public.support_fee_annual_policies as p
       set enabled = coalesce(p_enabled, p.enabled),
           early_discount_percent = round(coalesce(p_early_discount_percent, p.early_discount_percent), 2),
           late_increase_percent = round(coalesce(p_late_increase_percent, p.late_increase_percent), 2),
           early_payment_deadline = v_deadline,
           updated_at = now(),
           updated_by_email = btrim(v_email)
     where p.id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.support_fee_annual_policies (
    billing_year, enabled, status,
    early_discount_percent, late_increase_percent, early_payment_deadline,
    created_by_email, updated_by_email
  ) values (
    p_billing_year,
    coalesce(p_enabled, true),
    'draft',
    round(coalesce(p_early_discount_percent, 10), 2),
    round(coalesce(p_late_increase_percent, 10), 2),
    v_deadline,
    btrim(v_email),
    btrim(v_email)
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.publish_support_fee_annual_policy(p_billing_year integer)
returns public.support_fee_annual_policies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.support_fee_annual_policies;
  v_email text := auth.email();
begin
  if v_email is null then
    raise exception 'publish_support_fee_annual_policy: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'publish_support_fee_annual_policy: not allowed' using errcode = '42501';
  end if;

  update public.support_fee_annual_policies as p
     set status = 'published',
         updated_at = now(),
         updated_by_email = btrim(v_email)
   where p.billing_year = p_billing_year
     and p.status = 'draft'
  returning * into v_row;

  if not found then
    raise exception 'publish_support_fee_annual_policy: draft policy not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.close_support_fee_annual_policy(p_billing_year integer)
returns public.support_fee_annual_policies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.support_fee_annual_policies;
  v_email text := auth.email();
begin
  if v_email is null then
    raise exception 'close_support_fee_annual_policy: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'close_support_fee_annual_policy: not allowed' using errcode = '42501';
  end if;

  update public.support_fee_annual_policies as p
     set status = 'closed',
         updated_at = now(),
         updated_by_email = btrim(v_email)
   where p.billing_year = p_billing_year
     and p.status in ('published','closed')
  returning * into v_row;

  if not found then
    raise exception 'close_support_fee_annual_policy: published policy not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.preview_support_fee_year(
  p_property_id bigint,
  p_billing_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_base numeric;
  v_early numeric;
  v_late numeric;
  v_over numeric;
  v_debt numeric;
  v_pol public.support_fee_annual_policies;
  v_now timestamptz := now();
  v_need numeric;
begin
  if v_email is null then
    raise exception 'preview_support_fee_year: authentication required' using errcode = '42501';
  end if;
  if not public.owns_property(p_property_id) and not public.can_manage_support_fees() and not public.is_staff() then
    raise exception 'preview_support_fee_year: not allowed' using errcode = '42501';
  end if;

  v_base := public.support_fee_base_amount(p_property_id);

  select * into v_pol
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
    and p.status in ('published','closed');

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = p_property_id;

  if v_pol.id is null or v_pol.enabled is not true then
    return jsonb_build_object(
      'billing_year', p_billing_year,
      'policy_enabled', false,
      'pricing_mode', 'standard',
      'base_amount', v_base,
      'early_amount', v_base,
      'late_amount', v_base,
      'available_credit', coalesce(v_over, 0),
      'old_debt', coalesce(v_debt, 0),
      'amount_needed_for_discount', null
    );
  end if;

  v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
  v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);
  v_need := round(greatest(0, v_early - coalesce(v_over, 0)), 2);

  return jsonb_build_object(
    'billing_year', p_billing_year,
    'policy_enabled', true,
    'early_deadline_at', v_pol.early_payment_deadline,
    'year_starts_at', public.support_fee_year_start(p_billing_year),
    'in_early_window', v_now <= v_pol.early_payment_deadline,
    'discount_percent', v_pol.early_discount_percent,
    'increase_percent', v_pol.late_increase_percent,
    'base_amount', v_base,
    'early_amount', v_early,
    'late_amount', v_late,
    'available_credit', coalesce(v_over, 0),
    'old_debt', coalesce(v_debt, 0),
    'credit_covers_early', coalesce(v_over, 0) >= v_early,
    'amount_needed_for_discount', v_need
  );
end;
$fn$;

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
  v_ledger_id bigint;
  v_note text;
  v_id uuid;
  v_remaining numeric;
  v_status text;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'finalize_support_fee_assessment: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'finalize_support_fee_assessment: not allowed' using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'finalize_support_fee_assessment: invalid billing year' using errcode = '22023';
  end if;

  v_period := p_billing_year::text;

  select * into v_existing
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.billing_year = p_billing_year
  for update;

  if found then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'assessment_id', v_existing.id,
      'pricing_rule', v_existing.pricing_rule,
      'final_amount', v_existing.final_amount,
      'remaining_due', v_existing.remaining_due,
      'status', v_existing.status
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

  v_base := public.support_fee_base_amount(p_property_id);

  select * into v_pol
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
    and p.status in ('published','closed')
  for update;

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

  if v_base <= 0 then
    return jsonb_build_object('applied', false, 'amount', 0, 'reason', 'zero_base');
  end if;

  if v_pol.id is null or v_pol.enabled is not true then
    return jsonb_build_object(
      'applied', false,
      'reason', 'policy_disabled_use_ordinary_charge',
      'base_amount', v_base
    );
  end if;

  v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
  v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);

  select coalesce(sum(l.amount), 0)
    into v_dedicated
  from public.support_fee_ledger as l
  where l.property_id = p_property_id
    and l.kind = 'payment'
    and l.period = v_period;

  if v_now <= v_pol.early_payment_deadline then
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
        'amount_needed', round(v_early - v_over, 2)
      );
    end if;
  else
    v_rule := 'late';
    v_qual := 'not_qualified';
    v_final := v_late;
    v_reason := 'early_not_fully_covered';
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
    status, created_by_email, finalized_at, finalized_by_email
  ) values (
    p_property_id, p_billing_year, v_pol.id, v_ledger_id,
    v_base, v_pol.early_discount_percent, v_pol.late_increase_percent,
    v_early, v_late, v_pol.early_payment_deadline,
    v_rule, v_reason, v_qual, v_now,
    v_over, least(v_over, v_early), coalesce(v_dedicated, 0),
    v_from_balance, v_applied_pay,
    v_final, v_remaining, v_over, v_new_over,
    v_status, btrim(v_email), v_now, btrim(v_email)
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
    'idempotent', false,
    'assessment_id', v_id,
    'pricing_rule', v_rule,
    'qualification_status', v_qual,
    'pricing_reason_code', v_reason,
    'base_amount', v_base,
    'final_amount', v_final,
    'applied_credit_amount', v_from_balance,
    'applied_payment_amount', v_applied_pay,
    'remaining_due', v_remaining,
    'overpayment', v_new_over,
    'debt', v_new_debt,
    'status', v_status
  );
end;
$fn$;

create or replace function public.finalize_support_fee_year(p_billing_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_id bigint;
  v_ok int := 0;
  v_skip int := 0;
  v_res jsonb;
begin
  if v_email is null then
    raise exception 'finalize_support_fee_year: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'finalize_support_fee_year: not allowed' using errcode = '42501';
  end if;

  for v_id in select p.id from public.properties as p order by p.id
  loop
    v_res := public.finalize_support_fee_assessment(v_id, p_billing_year);
    if coalesce((v_res->>'applied')::boolean, false) then
      v_ok := v_ok + 1;
    else
      v_skip := v_skip + 1;
    end if;
  end loop;

  return jsonb_build_object('applied_count', v_ok, 'skipped_count', v_skip, 'billing_year', p_billing_year);
end;
$fn$;

create or replace function public.record_support_fee_assessment_correction(
  p_assessment_id uuid,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_a public.support_fee_assessments;
  v_amt numeric;
  v_reason text;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_kind text;
  v_ledger_id bigint;
begin
  if v_email is null then
    raise exception 'record_support_fee_assessment_correction: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'record_support_fee_assessment_correction: not allowed' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'record_support_fee_assessment_correction: reason required' using errcode = '22023';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt = 0 then
    raise exception 'record_support_fee_assessment_correction: amount required' using errcode = '22023';
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'record_support_fee_assessment_correction: not found' using errcode = 'P0002';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if v_amt > 0 then
    v_kind := 'adjustment_debit';
    if v_amt <= v_over then
      v_new_debt := v_debt;
      v_new_over := round(v_over - v_amt, 2);
    else
      v_new_debt := round(v_debt + (v_amt - v_over), 2);
      v_new_over := 0;
    end if;
    update public.support_fee_assessments
       set remaining_due = round(remaining_due + v_amt, 2),
           status = 'open',
           correction_reason = v_reason,
           correction_at = now(),
           correction_by_email = btrim(v_email)
     where id = v_a.id;
  else
    v_kind := 'adjustment_credit';
    v_amt := abs(v_amt);
    if v_amt <= v_debt then
      v_new_debt := round(v_debt - v_amt, 2);
      v_new_over := v_over;
    else
      v_new_debt := 0;
      v_new_over := round(v_over + (v_amt - v_debt), 2);
    end if;
    update public.support_fee_assessments
       set remaining_due = greatest(0, round(remaining_due - v_amt, 2)),
           status = case when remaining_due - v_amt <= 0 then 'paid' else status end,
           correction_reason = v_reason,
           correction_at = now(),
           correction_by_email = btrim(v_email)
     where id = v_a.id;
  end if;

  insert into public.support_fee_ledger (
    property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after
  ) values (
    v_a.property_id, v_kind, v_amt, v_a.billing_year::text, v_reason, btrim(v_email), v_new_debt, v_new_over
  )
  returning id into v_ledger_id;

  update public.properties
     set debt = v_new_debt, overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object('ledger_id', v_ledger_id, 'kind', v_kind, 'amount', v_amt);
end;
$fn$;

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
  v_debt_paid numeric;
  v_a public.support_fee_assessments;
  v_take numeric;
  v_left numeric;
  v_year integer;
  v_fin jsonb;
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

  v_debt_paid := least(v_pay, v_debt);

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
    property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after
  )
  values (
    p_property_id, 'payment', v_pay, null, v_note, btrim(v_email), v_new_debt, v_new_over
  )
  returning id into v_ledger_id;

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
    order by a.billing_year, a.created_at
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_a.remaining_due, v_left);
    insert into public.support_fee_allocations (
      assessment_id, ledger_entry_id, amount, allocation_type, created_by_email
    ) values (
      v_a.id, v_ledger_id, v_take, 'payment', btrim(v_email)
    );
    update public.support_fee_assessments
       set remaining_due = round(remaining_due - v_take, 2),
           applied_payment_amount = round(applied_payment_amount + v_take, 2),
           status = case when remaining_due - v_take <= 0 then 'paid' else status end
     where id = v_a.id;
    v_left := round(v_left - v_take, 2);
  end loop;

  for v_year in
    select p.billing_year
    from public.support_fee_annual_policies as p
    where p.enabled is true
      and p.status = 'published'
      and now() <= p.early_payment_deadline
    order by p.billing_year
  loop
    v_fin := public.finalize_support_fee_assessment(p_property_id, v_year);
  end loop;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'amount', v_pay,
    'debt', v_new_debt,
    'overpayment', v_new_over
  );
end;
$$;

create or replace function public.record_support_payment_for_year(
  p_property_id bigint,
  p_amount numeric,
  p_billing_year integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_res jsonb;
  v_id bigint;
begin
  v_res := public.record_support_payment(p_property_id, p_amount, p_note);
  v_id := (v_res->>'ledger_id')::bigint;
  if p_billing_year is not null then
    update public.support_fee_ledger
       set period = p_billing_year::text
     where id = v_id
       and kind = 'payment';
    perform public.finalize_support_fee_assessment(p_property_id, p_billing_year);
  end if;
  return v_res;
end;
$fn$;

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
  v_year integer;
  v_area numeric;
  v_debt numeric;
  v_over numeric;
  v_rate numeric;
  v_amount numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_ledger_id bigint;
  v_note text;
  v_pol_enabled boolean := false;
  v_fin jsonb;
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

  v_year := v_period::integer;

  select exists (
    select 1
    from public.support_fee_annual_policies as p
    where p.billing_year = v_year
      and p.enabled is true
      and p.status in ('published','closed')
  ) into v_pol_enabled;

  if v_pol_enabled then
    v_fin := public.finalize_support_fee_assessment(p_property_id, v_year);
    if coalesce((v_fin->>'applied')::boolean, false)
       or coalesce((v_fin->>'idempotent')::boolean, false) then
      return v_fin;
    end if;
    if v_fin->>'reason' = 'early_window_not_qualified' then
      return v_fin;
    end if;
    if v_fin->>'reason' = 'charge_already_exists' then
      return v_fin;
    end if;
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
    property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after
  )
  values (
    p_property_id, 'charge', v_amount, v_period, v_note, btrim(v_email), v_new_debt, v_new_over
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

revoke all on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) from public;
revoke all on function public.publish_support_fee_annual_policy(integer) from public;
revoke all on function public.close_support_fee_annual_policy(integer) from public;
revoke all on function public.preview_support_fee_year(bigint, integer) from public;
revoke all on function public.finalize_support_fee_assessment(bigint, integer) from public;
revoke all on function public.finalize_support_fee_year(integer) from public;
revoke all on function public.record_support_fee_assessment_correction(uuid, numeric, text) from public;
revoke all on function public.record_support_payment_for_year(bigint, numeric, integer, text) from public;
revoke all on function public.record_support_payment(bigint, numeric, text) from public;
revoke all on function public.charge_support_fee(bigint, text) from public;

revoke all on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) from anon;
revoke all on function public.publish_support_fee_annual_policy(integer) from anon;
revoke all on function public.close_support_fee_annual_policy(integer) from anon;
revoke all on function public.preview_support_fee_year(bigint, integer) from anon;
revoke all on function public.finalize_support_fee_assessment(bigint, integer) from anon;
revoke all on function public.finalize_support_fee_year(integer) from anon;
revoke all on function public.record_support_fee_assessment_correction(uuid, numeric, text) from anon;
revoke all on function public.record_support_payment_for_year(bigint, numeric, integer, text) from anon;
revoke all on function public.record_support_payment(bigint, numeric, text) from anon;
revoke all on function public.charge_support_fee(bigint, text) from anon;

grant execute on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.publish_support_fee_annual_policy(integer) to authenticated;
grant execute on function public.close_support_fee_annual_policy(integer) to authenticated;
grant execute on function public.preview_support_fee_year(bigint, integer) to authenticated;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to authenticated;
grant execute on function public.finalize_support_fee_year(integer) to authenticated;
grant execute on function public.record_support_fee_assessment_correction(uuid, numeric, text) to authenticated;
grant execute on function public.record_support_payment_for_year(bigint, numeric, integer, text) to authenticated;
grant execute on function public.record_support_payment(bigint, numeric, text) to authenticated;
grant execute on function public.charge_support_fee(bigint, text) to authenticated;

commit;
