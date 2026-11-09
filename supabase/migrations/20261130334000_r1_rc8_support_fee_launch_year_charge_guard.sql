-- Support fee: immutable complex launch year + block new annual charges for that year.
-- Launch year is stored once from Sofia calendar year of first_run_completed_at.
-- First allowed operational charge year = launch_year + 1.
-- Opening inventarisation years remain independent (opening_import_blocks_charge unchanged).

begin;

-- ---------------------------------------------------------------------------
-- 1. Persisted launch year on the complex (platform_installations)
-- ---------------------------------------------------------------------------

alter table public.platform_installations
  add column if not exists complex_launch_year integer;

comment on column public.platform_installations.complex_launch_year is
  'Immutable Sofia calendar year when the complex went live (first_run complete). New support-fee annual charges for this year are forbidden; first allowed year is launch+1.';

update public.platform_installations as i
   set complex_launch_year = extract(
         year from timezone('Europe/Sofia', i.first_run_completed_at)
       )::integer
 where i.first_run_completed_at is not null
   and i.complex_launch_year is null;

alter table public.platform_installations
  drop constraint if exists platform_installations_complex_launch_year_chk;

alter table public.platform_installations
  add constraint platform_installations_complex_launch_year_chk
  check (
    complex_launch_year is null
    or (complex_launch_year >= 2000 and complex_launch_year <= 2100)
  );

create or replace function public.platform_installations_stamp_launch_year()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg$
declare
  v_year integer;
begin
  if new.first_run_completed_at is null then
    return new;
  end if;
  -- Never overwrite a saved launch year when the calendar changes.
  if new.complex_launch_year is not null then
    return new;
  end if;
  v_year := extract(year from timezone('Europe/Sofia', new.first_run_completed_at))::integer;
  new.complex_launch_year := v_year;
  return new;
end;
$tg$;

drop trigger if exists trg_platform_installations_stamp_launch_year
  on public.platform_installations;

create trigger trg_platform_installations_stamp_launch_year
  before insert or update of first_run_completed_at, complex_launch_year
  on public.platform_installations
  for each row
  execute function public.platform_installations_stamp_launch_year();

-- ---------------------------------------------------------------------------
-- 2. Single-source helpers (UI + server)
-- ---------------------------------------------------------------------------

create or replace function public.complex_launch_year()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select i.complex_launch_year
  from public.platform_installations as i
  where i.complex_launch_year is not null
  order by i.first_run_completed_at nulls last, i.id
  limit 1;
$fn$;

comment on function public.complex_launch_year() is
  'Saved complex launch year (Sofia). One source for support-fee UI and charge guards.';

revoke all on function public.complex_launch_year() from public;
revoke all on function public.complex_launch_year() from anon;
grant execute on function public.complex_launch_year() to authenticated;
grant execute on function public.complex_launch_year() to service_role;

create or replace function public.support_fee_min_charge_year()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when public.complex_launch_year() is null then null
    else public.complex_launch_year() + 1
  end;
$fn$;

comment on function public.support_fee_min_charge_year() is
  'First billing year allowed for a new operational support-fee charge (= launch_year + 1).';

revoke all on function public.support_fee_min_charge_year() from public;
revoke all on function public.support_fee_min_charge_year() from anon;
grant execute on function public.support_fee_min_charge_year() to authenticated;
grant execute on function public.support_fee_min_charge_year() to service_role;

create or replace function public.support_fee_launch_year_blocks(p_billing_year integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    p_billing_year is not null
    and public.complex_launch_year() is not null
    and p_billing_year <= public.complex_launch_year();
$fn$;

revoke all on function public.support_fee_launch_year_blocks(integer) from public;
revoke all on function public.support_fee_launch_year_blocks(integer) from anon;
grant execute on function public.support_fee_launch_year_blocks(integer) to authenticated;
grant execute on function public.support_fee_launch_year_blocks(integer) to service_role;

create or replace function public.support_fee_launch_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_launch integer := public.complex_launch_year();
  v_min integer := public.support_fee_min_charge_year();
begin
  return jsonb_build_object(
    'launch_year', v_launch,
    'min_charge_year', v_min,
    'has_launch_year', v_launch is not null
  );
end;
$fn$;

revoke all on function public.support_fee_launch_context() from public;
revoke all on function public.support_fee_launch_context() from anon;
grant execute on function public.support_fee_launch_context() to authenticated;
grant execute on function public.support_fee_launch_context() to service_role;

create or replace function public.support_fee_year_charge_context(p_billing_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_launch integer := public.complex_launch_year();
  v_min integer := public.support_fee_min_charge_year();
  v_blocked boolean := public.support_fee_launch_year_blocks(p_billing_year);
  v_rate numeric;
  v_version uuid;
  v_policy_status text;
  v_policy_enabled boolean;
  v_early numeric;
  v_late numeric;
  v_deadline timestamptz;
  v_total int := 0;
  v_charged int := 0;
  v_opening int := 0;
begin
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'support_fee_year_charge_context: invalid billing year'
      using errcode = '22023';
  end if;

  begin
    select r.rate, r.tariff_version_id
      into v_rate, v_version
    from public.resolve_support_tariff_for_year(p_billing_year) as r;
  exception
    when others then
      v_rate := null;
      v_version := null;
  end;

  select p.status, p.enabled, p.early_discount_percent, p.late_increase_percent, p.early_payment_deadline
    into v_policy_status, v_policy_enabled, v_early, v_late, v_deadline
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
  order by case p.status when 'published' then 0 when 'closed' then 1 when 'draft' then 2 else 3 end
  limit 1;

  select count(*)::int into v_total from public.properties;

  select count(*)::int into v_charged
  from public.support_fee_assessments as a
  where a.billing_year = p_billing_year
    and coalesce(a.opening_import, false) is not true
    and lower(coalesce(a.status, 'open')) not in ('void', 'corrected');

  select count(*)::int into v_opening
  from public.support_fee_assessments as a
  where a.billing_year = p_billing_year
    and coalesce(a.opening_import, false) is true
    and lower(coalesce(a.status, 'open')) not in ('void', 'corrected');

  return jsonb_build_object(
    'billing_year', p_billing_year,
    'launch_year', v_launch,
    'min_charge_year', v_min,
    'blocked', v_blocked,
    'block_reason', case when v_blocked then 'launch_year_blocks_charge' else null end,
    'rate_eur_per_sqm_year', v_rate,
    'tariff_version_id', v_version,
    'policy_status', v_policy_status,
    'policy_enabled', v_policy_enabled,
    'early_discount_percent', v_early,
    'late_increase_percent', v_late,
    'early_payment_deadline', v_deadline,
    'pricing_mode', case
      when v_policy_status in ('published', 'closed') and v_policy_enabled is true then 'policy'
      else 'standard_tariff'
    end,
    'apartments_total', v_total,
    'apartments_charged', v_charged,
    'apartments_opening', v_opening,
    'apartments_remaining', greatest(0, v_total - v_charged - v_opening)
  );
end;
$fn$;

revoke all on function public.support_fee_year_charge_context(integer) from public;
revoke all on function public.support_fee_year_charge_context(integer) from anon;
grant execute on function public.support_fee_year_charge_context(integer) to authenticated;
grant execute on function public.support_fee_year_charge_context(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Guard: finalize_support_fee_assessment
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
      'reason', 'charge_already_exists',
      'final_amount', (
        select l.amount from public.support_fee_ledger as l
        where l.property_id = p_property_id and l.kind = 'charge' and l.period = v_period
        limit 1
      )
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
$function$;

revoke all on function public.finalize_support_fee_assessment(bigint, integer) from public;
revoke all on function public.finalize_support_fee_assessment(bigint, integer) from anon;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to authenticated;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Guard: charge_support_fee
-- ---------------------------------------------------------------------------

create or replace function public.charge_support_fee(p_property_id bigint, p_period text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_email text;
  v_period text;
  v_year integer;
  v_fin jsonb;
  v_module_enabled boolean;
  v_opening boolean;
  v_assessment_id uuid;
  v_final numeric(12, 2);
  v_remaining numeric(12, 2);
  v_launch integer;
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

  v_launch := public.complex_launch_year();
  if v_launch is not null and v_year <= v_launch then
    return jsonb_build_object(
      'applied', false,
      'idempotent', false,
      'reason', 'launch_year_blocks_charge',
      'launch_year', v_launch,
      'min_charge_year', v_launch + 1,
      'billing_year', v_year,
      'amount', 0,
      'ledger_id', null,
      'synthetic_payments', false
    );
  end if;

  select a.opening_import, a.id, a.final_amount, a.remaining_due
    into v_opening, v_assessment_id, v_final, v_remaining
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.billing_year = v_year
    and lower(coalesce(a.status, 'open')) not in ('void', 'corrected')
  limit 1;

  if found and coalesce(v_opening, false) then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'reason', 'opening_import_blocks_charge',
      'opening_import', true,
      'assessment_id', v_assessment_id,
      'final_amount', v_final,
      'remaining_due', v_remaining,
      'amount', coalesce(v_final, 0),
      'ledger_id', null,
      'synthetic_payments', false
    );
  end if;

  if found then
    v_fin := public.reprice_support_fee_assessment_to_tariff(p_property_id, v_year);
    if coalesce((v_fin->>'repriced')::boolean, false) then
      return v_fin || jsonb_build_object('amount', (v_fin->>'final_amount')::numeric);
    end if;
    return v_fin || jsonb_build_object(
      'amount', coalesce((v_fin->>'final_amount')::numeric, 0),
      'ledger_id', null
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
       'zero_base',
       'opening_import_blocks_charge',
       'launch_year_blocks_charge'
     ) then
    return v_fin || jsonb_build_object(
      'amount', coalesce((v_fin->>'final_amount')::numeric, (v_fin->>'amount')::numeric, 0),
      'ledger_id', null
    );
  end if;

  return v_fin;
end;
$function$;

revoke all on function public.charge_support_fee(bigint, text) from public;
revoke all on function public.charge_support_fee(bigint, text) from anon;
grant execute on function public.charge_support_fee(bigint, text) to authenticated;
grant execute on function public.charge_support_fee(bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Guard: charge_support_fee_bulk (early exit for launch year)
-- ---------------------------------------------------------------------------

create or replace function public.charge_support_fee_bulk(p_period text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_email text := auth.email();
  v_period text;
  v_year integer;
  v_id bigint;
  v_res jsonb;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_repriced int := 0;
  v_not int := 0;
  v_module_enabled boolean;
  v_launch integer;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'charge_support_fee_bulk: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'charge_support_fee_bulk: not allowed' using errcode = '42501';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'support_fee';
  if v_module_enabled is not true then
    raise exception 'Support fee module is disabled.';
  end if;

  v_period := btrim(coalesce(p_period, ''));
  if v_period !~ '^[0-9]{4}$' then
    raise exception 'charge_support_fee_bulk: period must be YYYY' using errcode = '22023';
  end if;

  v_year := v_period::integer;
  v_launch := public.complex_launch_year();
  if v_launch is not null and v_year <= v_launch then
    return jsonb_build_object(
      'total', 0,
      'created', 0,
      'skipped_existing', 0,
      'repriced', 0,
      'not_applied', 0,
      'period', v_period,
      'applied', false,
      'reason', 'launch_year_blocks_charge',
      'launch_year', v_launch,
      'min_charge_year', v_launch + 1
    );
  end if;

  perform 1 from public.resolve_support_tariff_for_year(v_year);

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    perform 1 from public.properties as p where p.id = v_id for update;
  end loop;

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;
    begin
      v_res := public.charge_support_fee(v_id, v_period);
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
        continue;
    end;

    if coalesce((v_res->>'repriced')::boolean, false) then
      v_repriced := v_repriced + 1;
    elsif coalesce((v_res->>'applied')::boolean, false) then
      v_created := v_created + 1;
    elsif coalesce((v_res->>'idempotent')::boolean, false)
       or v_res->>'reason' in ('charge_already_exists', 'same_tariff') then
      v_skipped := v_skipped + 1;
    else
      v_not := v_not + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'created', v_created,
    'skipped_existing', v_skipped,
    'repriced', v_repriced,
    'not_applied', v_not,
    'period', v_period
  );
end;
$function$;

revoke all on function public.charge_support_fee_bulk(text) from public;
revoke all on function public.charge_support_fee_bulk(text) from anon;
grant execute on function public.charge_support_fee_bulk(text) to authenticated;
grant execute on function public.charge_support_fee_bulk(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. finalize_support_fee_year (UI still calls it; create with same guard)
-- ---------------------------------------------------------------------------

create or replace function public.finalize_support_fee_year(p_billing_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_launch integer;
  v_id bigint;
  v_res jsonb;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_not int := 0;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'finalize_support_fee_year: authentication required' using errcode = '42501';
  end if;
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'finalize_support_fee_year: not allowed' using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'finalize_support_fee_year: invalid billing year' using errcode = '22023';
  end if;

  v_launch := public.complex_launch_year();
  if v_launch is not null and p_billing_year <= v_launch then
    return jsonb_build_object(
      'applied', false,
      'reason', 'launch_year_blocks_charge',
      'launch_year', v_launch,
      'min_charge_year', v_launch + 1,
      'billing_year', p_billing_year,
      'total', 0,
      'created', 0,
      'skipped_existing', 0,
      'not_applied', 0
    );
  end if;

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;
    v_res := public.finalize_support_fee_assessment(v_id, p_billing_year);
    if coalesce((v_res->>'applied')::boolean, false) then
      v_created := v_created + 1;
    elsif coalesce((v_res->>'idempotent')::boolean, false)
       or v_res->>'reason' in ('charge_already_exists') then
      v_skipped := v_skipped + 1;
    else
      v_not := v_not + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'applied', v_created > 0,
    'billing_year', p_billing_year,
    'total', v_total,
    'created', v_created,
    'skipped_existing', v_skipped,
    'not_applied', v_not
  );
end;
$fn$;

revoke all on function public.finalize_support_fee_year(integer) from public;
revoke all on function public.finalize_support_fee_year(integer) from anon;
grant execute on function public.finalize_support_fee_year(integer) to authenticated;
grant execute on function public.finalize_support_fee_year(integer) to service_role;

commit;
