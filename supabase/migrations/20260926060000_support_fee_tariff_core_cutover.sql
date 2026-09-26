-- Support Fee — Tariff Core cutover + annual integrity.
-- Applied AFTER 20260926050100_tariff_core_package2_integrity_fix.sql.
-- Does NOT edit applied migrations.
-- Does NOT rewrite historical assessments / ledger / payments.

begin;

-- ---------------------------------------------------------------------------
-- 1. Assessment pricing snapshot columns (nullable for legacy rows)
-- ---------------------------------------------------------------------------

alter table public.support_fee_assessments
  add column if not exists tariff_version_id uuid
    references public.tariff_versions (id) on delete restrict;

alter table public.support_fee_assessments
  add column if not exists area_sqm_snapshot numeric(12, 3);

alter table public.support_fee_assessments
  add column if not exists rate_eur_per_sqm_year_snapshot numeric(12, 4);

comment on column public.support_fee_assessments.tariff_version_id is
  'Tariff Core version snapshotted at finalization. Null on pre-cutover rows.';
comment on column public.support_fee_assessments.area_sqm_snapshot is
  'Property area snapshotted at finalization. Null on pre-cutover rows.';
comment on column public.support_fee_assessments.rate_eur_per_sqm_year_snapshot is
  'EUR/m2/year rate snapshotted at finalization. Null on pre-cutover rows.';

create index if not exists support_fee_assessments_tariff_version_idx
  on public.support_fee_assessments (tariff_version_id)
  where tariff_version_id is not null;

-- All-or-nothing snapshot on a row; legacy all-null rows allowed.
alter table public.support_fee_assessments
  drop constraint if exists support_fee_assessments_snapshot_complete_chk;

alter table public.support_fee_assessments
  add constraint support_fee_assessments_snapshot_complete_chk
  check (
    (
      tariff_version_id is null
      and area_sqm_snapshot is null
      and rate_eur_per_sqm_year_snapshot is null
    )
    or (
      tariff_version_id is not null
      and area_sqm_snapshot is not null
      and area_sqm_snapshot >= 0
      and rate_eur_per_sqm_year_snapshot is not null
      and rate_eur_per_sqm_year_snapshot > 0
    )
  );

-- When snapshot present, base_amount must match area × rate (money round 2).
alter table public.support_fee_assessments
  drop constraint if exists support_fee_assessments_snapshot_base_chk;

alter table public.support_fee_assessments
  add constraint support_fee_assessments_snapshot_base_chk
  check (
    tariff_version_id is null
    or base_amount = round(area_sqm_snapshot * rate_eur_per_sqm_year_snapshot, 2)
  );

-- Immutable pricing snapshot after insert (append-only corrections stay on ledger).
create or replace function public.support_fee_assessment_snapshot_immutable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' then
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

drop trigger if exists support_fee_assessment_snapshot_immutable
  on public.support_fee_assessments;

create trigger support_fee_assessment_snapshot_immutable
  before update on public.support_fee_assessments
  for each row
  execute function public.support_fee_assessment_snapshot_immutable_trg();

-- ---------------------------------------------------------------------------
-- 2. resolve_support_tariff_for_year (canonical internal + client-safe wrapper)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_support_tariff_for_year(
  p_billing_year integer
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cat_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rate numeric;
  v_on date;
begin
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_support_tariff_for_year: invalid billing year'
      using errcode = '22023';
  end if;

  select c.id
    into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'support_fee'
    and c.active is true;

  if v_cat_id is null then
    raise exception 'resolve_support_tariff_for_year: support_fee catalog missing'
      using errcode = 'P0002';
  end if;

  v_on := make_date(p_billing_year, 1, 1);

  begin
    v_version_id := public.resolve_support_tariff_version_by_year(v_cat_id, p_billing_year);
  exception
    when sqlstate 'P0002' then
      raise exception 'No support fee tariff configured for billing year %', p_billing_year
        using errcode = 'P0002';
  end;

  select tv.valid_from
    into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id
    and tv.status = 'published';

  if v_valid_from is null then
    raise exception 'No support fee tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  select ri.rate
    into v_rate
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base';

  if v_rate is null or v_rate <= 0 then
    raise exception 'resolve_support_tariff_for_year: invalid base rate'
      using errcode = '22023';
  end if;

  -- Exactly one base component expected for Support.
  if (
    select count(*)::int
    from public.tariff_rate_items as ri
    where ri.version_id = v_version_id
  ) <> 1 then
    raise exception 'resolve_support_tariff_for_year: expected exactly one rate component'
      using errcode = '22023';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rate := v_rate;
  return next;
end;
$fn$;

revoke all on function public.resolve_support_tariff_for_year(integer) from public;
revoke all on function public.resolve_support_tariff_for_year(integer) from anon;
revoke all on function public.resolve_support_tariff_for_year(integer) from authenticated;
-- Internal: called from SECURITY DEFINER RPCs; client uses get_applicable_support_tariff.

create or replace function public.get_applicable_support_tariff(
  p_billing_year integer default null
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rate_eur_per_sqm_year numeric,
  billing_year integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_applicable_support_tariff: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.is_owner()
    or public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'get_applicable_support_tariff: not allowed'
      using errcode = '42501';
  end if;

  v_year := coalesce(
    p_billing_year,
    extract(year from (now() at time zone 'Europe/Sofia'))::integer
  );

  return query
  select
    r.tariff_version_id,
    r.valid_from,
    r.rate,
    v_year
  from public.resolve_support_tariff_for_year(v_year) as r;
end;
$fn$;

revoke all on function public.get_applicable_support_tariff(integer) from public;
revoke all on function public.get_applicable_support_tariff(integer) from anon;
grant execute on function public.get_applicable_support_tariff(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Year-aware base amount (Tariff Core only — no building_settings / no 8)
-- ---------------------------------------------------------------------------

create or replace function public.support_fee_base_amount_for_year(
  p_property_id bigint,
  p_billing_year integer
)
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
  if not (
    public.owns_property(p_property_id)
    or public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'support_fee_base_amount_for_year: not allowed'
      using errcode = '42501';
  end if;

  if p_property_id is null then
    raise exception 'support_fee_base_amount_for_year: property required'
      using errcode = '22023';
  end if;

  select coalesce(p.area_sqm, 0)::numeric
    into v_area
  from public.properties as p
  where p.id = p_property_id;

  if not found then
    return 0;
  end if;

  select r.rate
    into v_rate
  from public.resolve_support_tariff_for_year(p_billing_year) as r;

  return round(round(coalesce(v_area, 0), 3) * v_rate, 2);
end;
$fn$;

revoke all on function public.support_fee_base_amount_for_year(bigint, integer) from public;
revoke all on function public.support_fee_base_amount_for_year(bigint, integer) from anon;
grant execute on function public.support_fee_base_amount_for_year(bigint, integer) to authenticated;

-- Compatibility wrapper: current Sofia calendar year via Tariff Core (no legacy).
create or replace function public.support_fee_base_amount(p_property_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
begin
  v_year := extract(year from (now() at time zone 'Europe/Sofia'))::integer;
  return public.support_fee_base_amount_for_year(p_property_id, v_year);
end;
$fn$;

revoke all on function public.support_fee_base_amount(bigint) from public;
revoke execute on function public.support_fee_base_amount(bigint) from anon;
grant execute on function public.support_fee_base_amount(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. tariff_version_bound_to_support_usage — real assessment binding
-- ---------------------------------------------------------------------------

create or replace function public.tariff_version_bound_to_support_usage(p_version_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_version_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.support_fee_assessments as a
    where a.tariff_version_id = p_version_id
  );
end;
$fn$;

comment on function public.tariff_version_bound_to_support_usage(uuid) is
  'True when any support_fee_assessment financially snapshots this tariff version.';

revoke all on function public.tariff_version_bound_to_support_usage(uuid) from public;
revoke all on function public.tariff_version_bound_to_support_usage(uuid) from anon;
-- Internal only (cancel_future_tariff_version).

-- ---------------------------------------------------------------------------
-- 5. Legacy Support rate setter blocked
-- ---------------------------------------------------------------------------

create or replace function public.set_support_rate_eur_per_sqm_year(
  p_rate numeric
)
returns table (
  id integer,
  support_rate_eur_per_sqm_year numeric,
  updated_at timestamptz,
  updated_by text
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception
    'Legacy Support Fee tariff publication disabled; use Tariff Core.'
    using errcode = '42501';
end;
$fn$;

revoke all on function public.set_support_rate_eur_per_sqm_year(numeric) from public;
revoke execute on function public.set_support_rate_eur_per_sqm_year(numeric) from anon;
grant execute on function public.set_support_rate_eur_per_sqm_year(numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. preview_support_fee_year — year-aware Core rate
-- ---------------------------------------------------------------------------

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
  v_tariff record;
begin
  if v_email is null then
    raise exception 'preview_support_fee_year: authentication required' using errcode = '42501';
  end if;
  if not public.owns_property(p_property_id) and not public.can_manage_support_fees() then
    raise exception 'preview_support_fee_year: not allowed' using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'preview_support_fee_year: invalid billing year' using errcode = '22023';
  end if;

  select r.* into v_tariff
  from public.resolve_support_tariff_for_year(p_billing_year) as r;

  select coalesce(p.area_sqm, 0)::numeric
    into v_base
  from public.properties as p
  where p.id = p_property_id;

  if not found then
    raise exception 'preview_support_fee_year: property not found' using errcode = 'P0002';
  end if;

  -- Preview uses current property area × resolved Core rate (not financial history).
  v_base := round(round(coalesce(v_base, 0), 3) * v_tariff.rate, 2);

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
      'amount_needed_for_discount', null,
      'tariff_version_id', v_tariff.tariff_version_id,
      'rate_eur_per_sqm_year', v_tariff.rate,
      'preview', true
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
    'amount_needed_for_discount', v_need,
    'tariff_version_id', v_tariff.tariff_version_id,
    'rate_eur_per_sqm_year', v_tariff.rate,
    'preview', true
  );
end;
$fn$;

revoke all on function public.preview_support_fee_year(bigint, integer) from public;
revoke all on function public.preview_support_fee_year(bigint, integer) from anon;
grant execute on function public.preview_support_fee_year(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. finalize_support_fee_assessment — Core snapshot + immutable retry
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
  v_ledger_id bigint;
  v_note text;
  v_id uuid;
  v_remaining numeric;
  v_status text;
  v_tariff record;
  v_rate numeric;
  v_version_id uuid;
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
    -- Idempotent: never reprice from live area/tariff/policy.
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'assessment_id', v_existing.id,
      'pricing_rule', v_existing.pricing_rule,
      'final_amount', v_existing.final_amount,
      'remaining_due', v_existing.remaining_due,
      'status', v_existing.status,
      'base_amount', v_existing.base_amount,
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

  -- Legacy charge without assessment: do not invent a Core assessment / double-charge.
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

  -- Annual policy is optional. No enabled published/closed policy => STANDARD assessment.
  if v_pol.id is null or v_pol.enabled is not true then
    v_rule := 'standard';
    v_qual := 'not_checked';
    v_reason := 'policy_disabled';
    v_early := v_base;
    v_late := v_base;
    v_final := v_base;
  elsif v_now <= v_pol.early_payment_deadline then
    v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
    v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);
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
    case when v_rule = 'standard' then null else v_pol.early_payment_deadline end,
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
    'status', v_status,
    'tariff_version_id', v_version_id,
    'area_sqm_snapshot', v_area,
    'rate_eur_per_sqm_year_snapshot', v_rate
  );
end;
$fn$;

revoke all on function public.finalize_support_fee_assessment(bigint, integer) from public;
revoke all on function public.finalize_support_fee_assessment(bigint, integer) from anon;
grant execute on function public.finalize_support_fee_assessment(bigint, integer) to authenticated;

-- finalize_support_fee_year unchanged in signature; body already delegates to assessment.

-- ---------------------------------------------------------------------------
-- 8. charge_support_fee — thin wrapper; ONE canonical financial write path
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

  -- Canonical path only: finalize creates assessment + ledger (or returns safely).
  v_fin := public.finalize_support_fee_assessment(p_property_id, v_year);

  -- Preserve response fields historically expected by callers of charge_support_fee.
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

revoke all on function public.charge_support_fee(bigint, text) from public;
revoke all on function public.charge_support_fee(bigint, text) from anon;
grant execute on function public.charge_support_fee(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Initial 2026 Support Fee Tariff Core baseline (cutover / legacy import)
-- Direct insert — does NOT call publish_tariff_version (current-year blocked).
-- Bootstrap ONLY when support_fee has zero published versions.
-- Confirmed operational rate: 8.0000 EUR/m²/year for billing year 2026.
-- ---------------------------------------------------------------------------

do $bootstrap$
declare
  v_cat_id uuid;
  v_version_id uuid := (
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 1, 8) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 9, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 13, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 17, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 21, 12)
  )::uuid;
  v_idem uuid := (
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 1, 8) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 9, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 13, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 17, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 21, 12)
  )::uuid;
  v_fp text := md5(
    'support_fee|2026-01-01|8.0000|legacy_import|building_settings:support_rate_eur_per_sqm_year'
  );
  v_published_count int;
begin
  select c.id into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'support_fee'
    and c.active is true;

  if v_cat_id is null then
    raise exception
      'support_fee_tariff_core_cutover: support_fee catalog missing/inactive — cannot bootstrap 2026 baseline'
      using errcode = 'P0002';
  end if;

  select count(*)::int into v_published_count
  from public.tariff_versions as tv
  where tv.tariff_id = v_cat_id
    and tv.status = 'published';

  if v_published_count > 0 then
    -- Already has published Core Support history — do not invent another baseline.
    return;
  end if;

  insert into public.tariff_versions (
    id,
    tariff_id,
    valid_from,
    status,
    basis_type,
    basis_reference,
    basis_date,
    basis_note,
    decision_id,
    published_at,
    published_by,
    legacy_author,
    idempotency_key,
    payload_fingerprint
  )
  values (
    v_version_id,
    v_cat_id,
    date '2026-01-01',
    'published',
    'legacy_import',
    'building_settings:support_rate_eur_per_sqm_year',
    date '2026-01-01',
    'Initial Tariff Core cutover baseline — existing operational Support Fee rate confirmed as 8.00 EUR/m²/year for 2026',
    null,
    now(),
    null,
    'migration:20260926060000_support_fee_tariff_core_cutover',
    v_idem,
    v_fp
  )
  on conflict (idempotency_key) do nothing;

  insert into public.tariff_rate_items (version_id, component_key, rate)
  values (v_version_id, 'base', 8.0000)
  on conflict (version_id, component_key) do nothing;

  -- Bind existing Package 1 legacy pointer (version_id was null) if present.
  update public.tariff_legacy_links as l
     set version_id = v_version_id,
         note = 'Package 3 cutover: bound to 2026-01-01 Core baseline (8.0000 EUR/m2/year). '
             || 'Legacy building_settings column retained; operational billing uses Tariff Core.'
   where l.tariff_key = 'support_fee'
     and l.legacy_source = 'building_settings'
     and l.legacy_key = 'support_rate_eur_per_sqm_year'
     and l.version_id is null;

  -- If Package 1 pointer missing, create a single non-conflicting link.
  insert into public.tariff_legacy_links (
    tariff_key, legacy_source, legacy_row_id, legacy_key, version_id, note
  )
  select
    'support_fee',
    'building_settings',
    null,
    'support_rate_eur_per_sqm_year',
    v_version_id,
    'Package 3 cutover: 2026-01-01 Core baseline (8.0000 EUR/m2/year).'
  where exists (select 1 from public.tariff_versions as tv where tv.id = v_version_id)
    and not exists (
      select 1 from public.tariff_legacy_links as l
      where l.legacy_source = 'building_settings'
        and l.legacy_key = 'support_rate_eur_per_sqm_year'
    );
end;
$bootstrap$;

commit;
