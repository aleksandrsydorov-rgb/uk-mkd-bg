-- Support fee bulk: charge from current Tariff Core; skip same version;
-- if published tariff for the year changed, reprice existing assessments via
-- correction ledger + snapshot update (transaction-local allow flag).

begin;

create or replace function public.support_fee_assessment_snapshot_immutable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' then
    if current_setting('uk.support_fee_allow_tariff_reprice', true) = '1' then
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

  select r.* into v_tariff
  from public.resolve_support_tariff_for_year(p_billing_year) as r;

  if v_a.tariff_version_id is not distinct from v_tariff.tariff_version_id then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'reason', 'same_tariff',
      'assessment_id', v_a.id,
      'tariff_version_id', v_a.tariff_version_id,
      'final_amount', v_a.final_amount
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
      'Пересчёт по новому тарифу ' || p_billing_year::text
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
    'correction', v_corr
  );
end;
$fn$;

revoke all on function public.reprice_support_fee_assessment_to_tariff(bigint, integer) from public;
revoke all on function public.reprice_support_fee_assessment_to_tariff(bigint, integer) from anon;
grant execute on function public.reprice_support_fee_assessment_to_tariff(bigint, integer) to authenticated;

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

  -- Existing assessment: reprice if tariff version changed; else idempotent.
  if exists (
    select 1 from public.support_fee_assessments as a
    where a.property_id = p_property_id and a.billing_year = v_year
  ) then
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

create or replace function public.charge_support_fee_bulk(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_period text;
  v_id bigint;
  v_res jsonb;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_repriced int := 0;
  v_not int := 0;
  v_module_enabled boolean;
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

  -- Ensure tariff exists for the year (fail closed before locking all apartments).
  perform 1 from public.resolve_support_tariff_for_year(v_period::integer);

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
$fn$;

revoke all on function public.charge_support_fee_bulk(text) from public;
revoke all on function public.charge_support_fee_bulk(text) from anon;
grant execute on function public.charge_support_fee_bulk(text) to authenticated;

commit;
