-- =============================================================================
-- R1-RC8 — Close Support Fee opening before capital repair:
-- block reprice/void/restore/correction of opening_import;
-- reject empty batch; server stage-complete requires per-apartment opening
-- (including explicit zero).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Ledger trigger: no operational charge/adjustment/reversal on opening year
-- ---------------------------------------------------------------------------

create or replace function public.tg_support_fee_ledger_block_opening_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT'
     and new.kind in (
       'charge',
       'adjustment_debit',
       'adjustment_credit',
       'payment_reversal',
       'assessment_void',
       'assessment_restore'
     )
     and exists (
       select 1
       from public.support_fee_assessments as a
       where a.property_id = new.property_id
         and a.billing_year::text = new.period
         and coalesce(a.opening_import, false)
         and lower(coalesce(a.status, 'open')) not in ('void', 'corrected')
     ) then
    raise exception
      'support_fee_ledger: opening_import blocks kind=% for period %',
      new.kind, new.period
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists support_fee_ledger_block_opening_mutation_trg on public.support_fee_ledger;
create trigger support_fee_ledger_block_opening_mutation_trg
  before insert on public.support_fee_ledger
  for each row
  execute function public.tg_support_fee_ledger_block_opening_mutation();

-- Correction RPC: refuse opening_import only; normal assessments keep full path.
-- DROP first: prior RC8 close stub used p_delta; restore canonical p_amount.
drop function if exists public.record_support_fee_assessment_correction(uuid, numeric, text);

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
  if v_email is null or btrim(v_email) = '' then
    raise exception 'record_support_fee_assessment_correction: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'record_support_fee_assessment_correction: not allowed'
      using errcode = '42501';
  end if;
  if p_assessment_id is null then
    raise exception 'record_support_fee_assessment_correction: assessment id required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'record_support_fee_assessment_correction: reason required'
      using errcode = '22023';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt = 0 then
    raise exception 'record_support_fee_assessment_correction: amount required'
      using errcode = '22023';
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'record_support_fee_assessment_correction: not found'
      using errcode = 'P0002';
  end if;
  if coalesce(v_a.opening_import, false) then
    raise exception 'record_support_fee_assessment_correction: opening_import blocks correction'
      using errcode = 'P0001';
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
    v_a.property_id, v_kind, v_amt, v_a.billing_year::text, v_reason, btrim(v_email),
    v_new_debt, v_new_over
  )
  returning id into v_ledger_id;

  update public.properties
     set debt = v_new_debt, overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object('ledger_id', v_ledger_id, 'kind', v_kind, 'amount', v_amt);
end;
$fn$;

revoke all on function public.record_support_fee_assessment_correction(uuid, numeric, text)
  from public, anon;
grant execute on function public.record_support_fee_assessment_correction(uuid, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Stage complete: every apartment has opening inventarisation (incl. zero)
-- ---------------------------------------------------------------------------

create or replace function public.first_run_assert_support_fee_opening_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_props int;
  v_missing text;
  v_years int;
begin
  select count(*)::int into v_props from public.properties;
  if v_props <= 0 then
    raise exception 'first_run: support_fee opening requires property book apartments'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.support_fee_opening_imports) then
    raise exception 'first_run: support_fee opening batch is empty'
      using errcode = 'P0001';
  end if;

  select count(distinct billing_year)::int into v_years
  from public.support_fee_opening_imports;
  if v_years is null or v_years < 1 then
    raise exception 'first_run: support_fee opening period missing'
      using errcode = 'P0001';
  end if;

  -- Every apartment must have an opening row for every inventarised billing year.
  select string_agg(fmt, ', ' order by fmt)
  into v_missing
  from (
    select p.apartment_number || '@' || y.billing_year::text as fmt
    from public.properties as p
    cross join (select distinct billing_year from public.support_fee_opening_imports) as y
    where not exists (
      select 1
      from public.support_fee_opening_imports as i
      where i.property_id = p.id
        and i.billing_year = y.billing_year
        and i.obligation_type = 'support_fee'
    )
  ) as miss;

  if v_missing is not null then
    raise exception 'first_run: support_fee opening missing apartments/years: %', v_missing
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.module_lifecycle ml
    where ml.installation_id = p_installation_id
      and ml.module_key = 'support_fee'
      and ml.state = 'ACTIVE'
  ) then
    raise exception 'first_run: support_fee must be ACTIVE before stage complete'
      using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_support_fee_opening_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_support_fee_opening_ready(uuid) to authenticated;

-- reprice / void / restore / import / complete
CREATE OR REPLACE FUNCTION public.reprice_support_fee_assessment_to_tariff(p_property_id bigint, p_billing_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
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

  if coalesce(v_a.opening_import, false) then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'reason', 'opening_import_blocks_reprice',
      'opening_import', true,
      'assessment_id', v_a.id,
      'final_amount', v_a.final_amount,
      'remaining_due', v_a.remaining_due
    );
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



CREATE OR REPLACE FUNCTION public.void_support_fee_assessment(p_assessment_id uuid, p_reason text, p_idempotency_key uuid, p_expected_property_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_email text;
  v_reason text;
  v_a public.support_fee_assessments;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_due numeric;
  v_void_id bigint;
  v_existing public.support_fee_ledger;
  v_pay_alloc numeric;
  v_credit_alloc numeric;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'void_support_fee_assessment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'void_support_fee_assessment: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'void_support_fee_assessment: idempotency key is required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'void_support_fee_assessment: reason required'
      using errcode = '22023';
  end if;

  if p_assessment_id is null then
    raise exception 'void_support_fee_assessment: assessment id required'
      using errcode = '22023';
  end if;

  select a.* into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'void_support_fee_assessment: not found'
      using errcode = 'P0002';
  end if;

  if coalesce(v_a.opening_import, false) then
    raise exception 'void_support_fee_assessment: opening_import blocks void'
      using errcode = 'P0001';
  end if;

  -- E2.3-D: reject mismatched apartment/property before any mutation.
  if p_expected_property_id is null then
    raise exception 'void_support_fee_assessment: expected property id required'
      using errcode = '22023';
  end if;
  if v_a.property_id is distinct from p_expected_property_id then
    raise exception
      'void_support_fee_assessment: property mismatch — assessment belongs to property % but expected %',
      v_a.property_id, p_expected_property_id
      using errcode = '22023';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if not found then
    raise exception 'void_support_fee_assessment: property not found'
      using errcode = '22023';
  end if;

  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'assessment_void'
       or v_existing.property_id is distinct from v_a.property_id then
      raise exception 'void_support_fee_assessment: idempotency key conflict'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'void_ledger_id', v_existing.id,
      'assessment_id', p_assessment_id,
      'status', 'void',
      'idempotent', true,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after,
      'property_id', v_a.property_id
    );
  end if;

  if v_a.status is not distinct from 'void' then
    raise exception 'void_support_fee_assessment: already void'
      using errcode = '22023';
  end if;

  if v_a.status is not distinct from 'corrected' then
    raise exception 'void_support_fee_assessment: corrected assessments cannot be voided'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(a.amount) filter (where a.allocation_type = 'payment'), 0),
    coalesce(sum(a.amount) filter (where a.allocation_type = 'credit'), 0)
    into v_pay_alloc, v_credit_alloc
  from public.support_fee_allocations as a
  where a.assessment_id = p_assessment_id;

  if coalesce(v_a.applied_payment_amount, 0) > 0
     or coalesce(v_a.applied_credit_amount, 0) > 0
     or v_pay_alloc > 0
     or v_credit_alloc > 0
     or v_a.status is not distinct from 'paid' then
    raise exception
      'void_support_fee_assessment: blocked — assessment has payments or credits; reverse payments first (reallocation/credit void not defined)'
      using errcode = '22023';
  end if;

  v_due := greatest(0, round(coalesce(v_a.remaining_due, 0), 2));
  if v_due <= 0 then
    raise exception
      'void_support_fee_assessment: blocked — nothing outstanding; paid/zero-due void requires undefined credit handling'
      using errcode = '22023';
  end if;

  if v_due <= v_debt then
    v_new_debt := round(v_debt - v_due, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := v_over;
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
      reversal_reason
    )
    values (
      v_a.property_id,
      'assessment_void',
      v_due,
      v_a.billing_year::text,
      'VOID assessment ' || p_assessment_id::text || ': ' || v_reason,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key,
      v_reason
    )
    returning id into v_void_id;
  exception
    when unique_violation then
      select l.* into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      return jsonb_build_object(
        'void_ledger_id', v_existing.id,
        'assessment_id', p_assessment_id,
        'status', 'void',
        'idempotent', true,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after,
        'property_id', v_a.property_id
      );
  end;

  update public.support_fee_assessments
     set remaining_due = 0,
         status = 'void',
         void_reason = v_reason,
         voided_at = now(),
         voided_by_email = btrim(v_email)
   where id = p_assessment_id
     and property_id = p_expected_property_id;

  if not found then
    raise exception 'void_support_fee_assessment: property mismatch on update'
      using errcode = '22023';
  end if;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'void_ledger_id', v_void_id,
    'assessment_id', p_assessment_id,
    'status', 'void',
    'voided_remaining_due', v_due,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false,
    'property_id', v_a.property_id,
    'note', 're_finalize_same_year_blocked_while_charge_ledger_exists'
  );
end;
$fn$;



CREATE OR REPLACE FUNCTION public.restore_support_fee_assessment(p_assessment_id uuid, p_reason text, p_idempotency_key uuid, p_expected_property_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_email text;
  v_reason text;
  v_a public.support_fee_assessments;
  v_void public.support_fee_ledger;
  v_existing public.support_fee_ledger;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_restore numeric;
  v_restore_id bigint;
  v_pay_alloc numeric;
  v_credit_alloc numeric;
  v_sibling int;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'restore_support_fee_assessment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'restore_support_fee_assessment: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'restore_support_fee_assessment: idempotency key is required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'restore_support_fee_assessment: reason required'
      using errcode = '22023';
  end if;

  if p_assessment_id is null then
    raise exception 'restore_support_fee_assessment: assessment id required'
      using errcode = '22023';
  end if;

  if p_expected_property_id is null then
    raise exception 'restore_support_fee_assessment: expected property id required'
      using errcode = '22023';
  end if;

  select a.* into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'restore_support_fee_assessment: not found'
      using errcode = 'P0002';
  end if;

  if coalesce(v_a.opening_import, false) then
    raise exception 'restore_support_fee_assessment: opening_import blocks restore'
      using errcode = 'P0001';
  end if;

  if v_a.property_id is distinct from p_expected_property_id then
    raise exception
      'restore_support_fee_assessment: property mismatch — assessment belongs to property % but expected %',
      v_a.property_id, p_expected_property_id
      using errcode = '22023';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if not found then
    raise exception 'restore_support_fee_assessment: property not found'
      using errcode = '22023';
  end if;

  -- Idempotent replay via idempotency key.
  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'assessment_restore'
       or v_existing.property_id is distinct from v_a.property_id then
      raise exception 'restore_support_fee_assessment: idempotency key conflict'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'restore_ledger_id', v_existing.id,
      'assessment_id', p_assessment_id,
      'status', 'open',
      'idempotent', true,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after,
      'property_id', v_a.property_id,
      'restored_remaining_due', v_existing.amount
    );
  end if;

  if v_a.status is distinct from 'void' then
    raise exception 'restore_support_fee_assessment: assessment is not void'
      using errcode = '22023';
  end if;

  if v_a.restored_at is not null or v_a.restore_ledger_id is not null then
    raise exception 'restore_support_fee_assessment: already restored'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(al.amount) filter (where al.allocation_type = 'payment'), 0),
    coalesce(sum(al.amount) filter (where al.allocation_type = 'credit'), 0)
    into v_pay_alloc, v_credit_alloc
  from public.support_fee_allocations as al
  where al.assessment_id = p_assessment_id;

  if coalesce(v_a.applied_payment_amount, 0) > 0
     or coalesce(v_a.applied_credit_amount, 0) > 0
     or v_pay_alloc > 0
     or v_credit_alloc > 0 then
    raise exception
      'restore_support_fee_assessment: blocked — assessment has payments or credits; restore rule not defined'
      using errcode = '22023';
  end if;

  -- Competing active assessment for same apartment/year would violate active-year uidx.
  select count(*)::int into v_sibling
  from public.support_fee_assessments as s
  where s.property_id = v_a.property_id
    and s.billing_year = v_a.billing_year
    and s.id is distinct from p_assessment_id
    and s.status is distinct from 'void'
    and s.status is distinct from 'corrected';

  if coalesce(v_sibling, 0) > 0 then
    raise exception
      'restore_support_fee_assessment: blocked — another active assessment exists for this apartment/year'
      using errcode = '22023';
  end if;

  select l.* into v_void
  from public.support_fee_ledger as l
  where l.property_id = v_a.property_id
    and l.kind = 'assessment_void'
    and l.note like ('VOID assessment ' || p_assessment_id::text || '%')
  order by l.id desc
  limit 1
  for update;

  if not found then
    raise exception 'restore_support_fee_assessment: void ledger not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.support_fee_ledger as r
    where r.reverses_ledger_id = v_void.id
  ) then
    raise exception 'restore_support_fee_assessment: void already restored'
      using errcode = '22023';
  end if;

  v_restore := greatest(0, round(coalesce(v_void.amount, 0), 2));
  if v_restore <= 0 then
    raise exception 'restore_support_fee_assessment: nothing to restore'
      using errcode = '22023';
  end if;

  -- Inverse of unpaid void: put outstanding back onto portal debt cache.
  v_new_debt := round(v_debt + v_restore, 2);
  v_new_over := v_over;
  if v_new_debt < 0 or v_new_over < 0 then
    raise exception 'restore_support_fee_assessment: invalid balance result'
      using errcode = '22023';
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
      reverses_ledger_id,
      reversal_reason
    )
    values (
      v_a.property_id,
      'assessment_restore',
      v_restore,
      v_a.billing_year::text,
      'RESTORE assessment ' || p_assessment_id::text
        || ' (void ledger ' || v_void.id::text || '): ' || v_reason,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key,
      v_void.id,
      v_reason
    )
    returning id into v_restore_id;
  exception
    when unique_violation then
      -- Concurrent restore of the same void ledger (reverses_ledger_id uidx) or key race.
      select l.* into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key
         or l.reverses_ledger_id = v_void.id
      order by l.id
      limit 1;

      if not found or v_existing.kind is distinct from 'assessment_restore' then
        raise exception 'restore_support_fee_assessment: concurrent restore conflict'
          using errcode = '22023';
      end if;

      return jsonb_build_object(
        'restore_ledger_id', v_existing.id,
        'assessment_id', p_assessment_id,
        'status', 'open',
        'idempotent', true,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after,
        'property_id', v_a.property_id,
        'restored_remaining_due', v_existing.amount,
        'void_ledger_id', v_void.id
      );
  end;

  update public.support_fee_assessments
     set remaining_due = v_restore,
         status = 'open',
         restore_reason = v_reason,
         restored_at = now(),
         restored_by_email = btrim(v_email),
         restore_ledger_id = v_restore_id
   where id = p_assessment_id
     and property_id = p_expected_property_id
     and status = 'void'
     and restored_at is null;

  if not found then
    raise exception 'restore_support_fee_assessment: concurrent status change'
      using errcode = '22023';
  end if;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'restore_ledger_id', v_restore_id,
    'void_ledger_id', v_void.id,
    'assessment_id', p_assessment_id,
    'status', 'open',
    'restored_remaining_due', v_restore,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false,
    'property_id', v_a.property_id
  );
end;
$fn$;



create or replace function public.admin_import_support_fee_opening(
  p_rows jsonb,
  p_dry_run boolean default true,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_idx int := 0;
  v_row_num int;
  v_apt text;
  v_property_id bigint;
  v_year int;
  v_obl text;
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over numeric(12, 2);
  v_transition date;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_res jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_years int[];
  v_year_one int;
  v_covered bigint[];
  v_missing text;
  v_scope text;
  v_scopes text[] := '{}';
  v_row_errors text[];
  v_outcome text;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_support_fee_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_support_fee_opening: not allowed' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_support_fee_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if coalesce(p_dry_run, true) then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'reason', 'empty_batch',
        'batch_id', v_batch,
        'row_count', 0,
        'created_count', 0,
        'skipped_existing_count', 0,
        'error_count', 1,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0,
          'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch'),
          'field', 'rows'
        )),
        'rows', '[]'::jsonb,
        'synthetic_payments', false,
        'charges_generated', false,
        'tariff_required', false
      );
    end if;
    raise exception 'admin_import_support_fee_opening: empty batch not allowed'
      using errcode = '22023';
  end if;

  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_row_num := coalesce(nullif(btrim(coalesce(v_elem->>'rowNumber', v_elem->>'row', '')), '')::int, v_idx + 1);
    v_row_errors := '{}';
    v_apt := nullif(btrim(coalesce(v_elem->>'apartment_number', '')), '');
    v_property_id := null;
    v_year := null;
    v_assessed := null;
    v_paid := null;
    v_remaining := null;
    v_over := 0;
    v_transition := null;
    v_src := nullif(btrim(coalesce(v_elem->>'source_reference', '')), '');
    v_notes := nullif(btrim(coalesce(v_elem->>'notes', '')), '');
    v_obl := lower(btrim(coalesce(v_elem->>'obligation_type', 'support_fee')));

    if v_apt is null then
      v_row_errors := array_append(v_row_errors, 'required:apartment_number');
    else
      select p.id into v_property_id
      from public.properties as p
      where lower(btrim(p.apartment_number)) = lower(v_apt)
      limit 1;
      if v_property_id is null then
        v_row_errors := array_append(v_row_errors, 'unknown_apartment');
      end if;
    end if;

    begin
      v_year := nullif(btrim(coalesce(v_elem->>'billing_year', '')), '')::int;
    exception when others then
      v_year := null;
    end;
    if v_year is null or v_year < 2000 or v_year > 2100 then
      v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
    end if;

    if v_obl is distinct from 'support_fee' then
      v_row_errors := array_append(v_row_errors, 'unsupported:obligation_type');
    end if;

    begin
      v_assessed := round(nullif(btrim(coalesce(v_elem->>'assessed_amount', '')), '')::numeric, 2);
      v_paid := round(nullif(btrim(coalesce(v_elem->>'historically_paid_amount', '')), '')::numeric, 2);
      v_remaining := round(nullif(btrim(coalesce(v_elem->>'remaining_debt', '')), '')::numeric, 2);
      v_over := round(coalesce(nullif(btrim(coalesce(v_elem->>'opening_overpayment', '')), '')::numeric, 0), 2);
    exception when others then
      v_row_errors := array_append(v_row_errors, 'invalid:amounts');
      v_assessed := null;
    end;

    if v_assessed is null or v_paid is null or v_remaining is null or v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over < 0 then
      v_row_errors := array_append(v_row_errors, 'invalid:amounts');
    elsif v_assessed <> round(v_paid + v_remaining, 2) then
      v_row_errors := array_append(v_row_errors, 'inconsistent:assessed_ne_paid_plus_remaining');
    end if;

    if v_remaining is not null and v_over is not null and v_remaining > 0 and v_over > 0 then
      v_row_errors := array_append(v_row_errors, 'mutually_exclusive:debt_and_overpayment');
    end if;

    begin
      v_transition := nullif(btrim(coalesce(v_elem->>'transition_date', '')), '')::date;
    exception when others then
      v_transition := null;
    end;
    if v_transition is null then
      v_row_errors := array_append(v_row_errors, 'required:transition_date');
    elsif v_transition > v_today then
      v_row_errors := array_append(v_row_errors, 'invalid:transition_date_future');
    end if;

    if v_src is null then
      v_row_errors := array_append(v_row_errors, 'required:source_reference');
    end if;

    if v_property_id is not null and v_year is not null then
      v_scope := v_property_id::text || '|' || v_year::text;
      if v_scope = any (v_scopes) then
        v_row_errors := array_append(v_row_errors, 'duplicate_in_file:apartment_year');
      else
        v_scopes := array_append(v_scopes, v_scope);
      end if;
    end if;

    if coalesce(array_length(v_row_errors, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'codes', to_jsonb(v_row_errors),
        'reason', v_row_errors[1],
        'field', 'support_fee_opening'
      ));
      continue;
    end if;

    -- Preview conflict / skip classification (no writes).
    if exists (
      select 1 from public.support_fee_opening_imports as i
      where i.property_id = v_property_id
        and i.billing_year = v_year
        and i.obligation_type = 'support_fee'
        and (
          i.assessed_amount is distinct from v_assessed
          or i.historically_paid_amount is distinct from v_paid
          or i.remaining_debt is distinct from v_remaining
          or i.opening_overpayment is distinct from v_over
        )
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_opening_import_mismatch'),
        'reason', 'conflict:existing_opening_import_mismatch',
        'field', 'support_fee_opening'
      ));
      continue;
    end if;

    if exists (
      select 1 from public.support_fee_assessments as a
      where a.property_id = v_property_id
        and a.billing_year = v_year
        and lower(coalesce(a.status, 'open')) not in ('void', 'corrected')
        and coalesce(a.opening_import, false) is not true
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_obligation'),
        'reason', 'conflict:existing_obligation',
        'field', 'support_fee_opening'
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      if exists (
        select 1 from public.support_fee_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
          and i.obligation_type = 'support_fee'
          and i.assessed_amount = v_assessed
          and i.historically_paid_amount = v_paid
          and i.remaining_debt = v_remaining
          and i.opening_overpayment = v_over
      ) then
        v_skipped := v_skipped + 1;
        v_outcome := 'SKIP';
      else
        v_outcome := 'CREATE';
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'property_id', v_property_id,
        'billing_year', v_year,
        'outcome', v_outcome,
        'remaining_debt', v_remaining,
        'opening_overpayment', v_over,
        'assessed_amount', v_assessed
      ));
      continue;
    end if;

    -- Commit path
    v_idem := coalesce(
      nullif(btrim(coalesce(v_elem->>'idempotency_key', '')), '')::uuid,
      gen_random_uuid()
    );
    v_res := public.import_support_fee_opening_state(
      v_property_id,
      v_year,
      'support_fee',
      v_assessed,
      v_paid,
      v_remaining,
      v_over,
      v_transition,
      v_src,
      v_notes,
      v_idem,
      v_batch
    );
    v_outcome := coalesce(v_res->>'outcome', 'CREATED');
    if v_outcome = 'CREATED' then
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', v_row_num,
      'apartment_number', v_apt,
      'property_id', v_property_id,
      'billing_year', v_year,
      'outcome', v_outcome,
      'remaining_due', (v_res->>'remaining_due')::numeric,
      'opening_overpayment', v_over,
      'assessment_id', v_res->>'assessment_id',
      'import_id', v_res->>'import_id'
    ));
  end loop;

  -- All apartments must be covered for each billing_year present in the file.
  select array_agg(distinct (split_part(s, '|', 2))::int)
  into v_years
  from unnest(v_scopes) as s;
  if v_years is not null then
    foreach v_year_one in array v_years
    loop
      select string_agg(p.apartment_number, ', ' order by p.apartment_number)
      into v_missing
      from public.properties as p
      where not exists (
        select 1
        from unnest(v_scopes) as s
        where split_part(s, '|', 1)::bigint = p.id
          and split_part(s, '|', 2)::int = v_year_one
      );
      if v_missing is not null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', 0,
          'apartment_number', '',
          'codes', jsonb_build_array('missing_apartment_coverage'),
          'reason', 'missing_apartment_coverage',
          'field', 'billing_year',
          'billing_year', v_year_one,
          'missing', v_missing
        ));
      end if;
    end loop;
  end if;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_support_fee_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'dry_run', coalesce(p_dry_run, true),
    'batch_id', v_batch,
    'row_count', jsonb_array_length(p_rows),
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'rows', v_results,
    'synthetic_payments', false,
    'charges_generated', false,
    'tariff_required', false,
    'reconcile', jsonb_build_object(
      'remaining_debt_sum', (
        select coalesce(sum(coalesce((r->>'remaining_due')::numeric, (r->>'remaining_debt')::numeric)), 0)
        from jsonb_array_elements(v_results) as r
        where r->>'outcome' in ('CREATE', 'CREATED', 'SKIP', 'SKIPPED_EXISTING')
      ),
      'opening_overpayment_sum', (
        select coalesce(sum((r->>'opening_overpayment')::numeric), 0)
        from jsonb_array_elements(v_results) as r
        where r->>'outcome' in ('CREATE', 'CREATED', 'SKIP', 'SKIPPED_EXISTING')
      ),
      'apartment_rows', jsonb_array_length(v_results)
    )
  );
end;
$fn$;

revoke all on function public.admin_import_support_fee_opening(jsonb, boolean, uuid) from public, anon;
grant execute on function public.admin_import_support_fee_opening(jsonb, boolean, uuid) to authenticated;

comment on function public.admin_import_support_fee_opening(jsonb, boolean, uuid) is
  'R1-RC8: atomic SF opening preview/commit. No tariff required. No synthetic payments/charges.';

CREATE OR REPLACE FUNCTION public.admin_complete_first_run_stage(p_stage text, p_next_stage text DEFAULT NULL::text, p_draft jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');


  if v_stage = 'support_fee_opening' then
    perform public.first_run_assert_support_fee_opening_ready(v_id);
    if v_next is null then
      v_next := 'capital_repair_opening';
    end if;
  end if;
  -- Direct jump to terminal stage (skipping setup) is rejected up front.
  if v_stage = 'complete' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb)
    where i.id = v_id;
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', coalesce(p_draft, '{}'::jsonb), now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', p_draft -> 'meters_selected', '[]'::jsonb)
    into v_selected
    from public.platform_installations as i
    where i.id = v_id;

    v_need_water := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    );
    v_need_elec := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    );

    if not v_need_water and not v_need_elec then
      raise exception 'first_run: at least one meter utility required' using errcode = '22023';
    end if;

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || jsonb_build_object('meters_selected', coalesce(v_selected, '[]'::jsonb))
      || coalesce(p_draft, '{}'::jsonb)
    where i.id = v_id;

    if not v_need_water then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_water', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
    end if;
    if not v_need_elec then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_electricity', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
    end if;

    if v_next is null then
      v_next := case
        when v_need_water then 'meters_water'
        when v_need_elec then 'meters_electricity'
        else 'support_fee_opening'
      end;
    end if;
  end if;

  if v_stage = 'meters_water' and v_next is null then
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'skipped'
    ) or exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      v_next := 'support_fee_opening';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'support_fee_opening';
  end if;

  -- Re-check when advancing into complete after meter stage completion.
  if v_next = 'complete' and v_stage is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, now()),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', now(), now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, now()), updated_at = now();
  elsif v_next is not null then
    update public.platform_installations as i
    set
      first_run_status = case when i.first_run_status = 'complete' then 'complete' else 'in_progress' end,
      first_run_stage = case when i.first_run_status = 'complete' then i.first_run_stage else v_next end,
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
      updated_at = now()
    where i.id = v_id
      and i.first_run_status is distinct from 'complete';

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, updated_at, updated_by
    ) values (v_id, v_next, 'in_progress', now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set
      status = case when p.status in ('complete', 'skipped') then p.status else 'in_progress' end,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  return public.admin_get_first_run_state();
end;
$fn$;

commit;
