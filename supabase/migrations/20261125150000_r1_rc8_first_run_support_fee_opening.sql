-- =============================================================================
-- R1-RC8 — First-run Support Fee opening stage (after meters → before CR/tariffs).
-- Atomic preview/commit; no published tariff for historical inventarisation;
-- opening year cannot be charged/repriced; no synthetic payments.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Stage catalog: support_fee → capital_repair → tariffs → complete
-- ---------------------------------------------------------------------------

insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values
  ('support_fee_opening', 70, true, 'support_fee', 'admin.firstRunStageSupportFee'),
  ('capital_repair_opening', 80, true, 'capital_repair', 'admin.firstRunStageCapitalRepair'),
  ('tariffs', 90, true, null, 'admin.firstRunStageTariffs')
on conflict (stage_key) do update
set
  sort_order = excluded.sort_order,
  required = excluded.required,
  module_key = excluded.module_key,
  label_i18n_key = excluded.label_i18n_key;

-- Already-complete installs: backfill new stages only (never reopen gate).
insert into public.first_run_stage_progress (installation_id, stage_key, status, completed_at)
select i.id, c.stage_key, 'complete', coalesce(i.first_run_completed_at, now())
from public.platform_installations as i
cross join public.first_run_stage_catalog as c
where i.first_run_status = 'complete'
  and c.stage_key in ('support_fee_opening', 'capital_repair_opening', 'tariffs')
on conflict (installation_id, stage_key) do nothing;

-- ---------------------------------------------------------------------------
-- Allow IS-4 opening reason code (later finance migrations narrowed the CHECK).
-- ---------------------------------------------------------------------------

alter table public.support_fee_assessments
  drop constraint if exists support_fee_assessments_pricing_reason_code_check;

alter table public.support_fee_assessments
  add constraint support_fee_assessments_pricing_reason_code_check
  check (
    pricing_reason_code = any (array[
      'early_fully_covered_by_credit',
      'early_fully_covered_by_payments',
      'early_fully_covered_mixed',
      'early_not_fully_covered',
      'policy_disabled',
      'is4_opening_state',
      'policy_present_standard_finalize'
    ]::text[])
  );

-- ---------------------------------------------------------------------------
-- Single-row import: basis required; debt XOR overpayment (zero OK); no tariff.
-- ---------------------------------------------------------------------------

create or replace function public.import_support_fee_opening_state(
  p_property_id bigint,
  p_billing_year integer,
  p_obligation_type text,
  p_assessed_amount numeric,
  p_historically_paid_amount numeric,
  p_remaining_debt numeric,
  p_opening_overpayment numeric,
  p_transition_date date,
  p_source_reference text,
  p_notes text,
  p_idempotency_key uuid,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_obl text := lower(btrim(coalesce(p_obligation_type, 'support_fee')));
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over_in numeric(12, 2);
  v_debt numeric(12, 2);
  v_over numeric(12, 2);
  v_new_debt numeric(12, 2);
  v_new_over numeric(12, 2);
  v_status text;
  v_assessment_id uuid;
  v_import_id uuid;
  v_period text;
  v_ledger_obl bigint;
  v_ledger_settle bigint;
  v_ledger_credit bigint;
  v_existing_import public.support_fee_opening_imports;
  v_src text;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_support_fee_opening_state: authentication required' using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_support_fee_opening_state: not allowed' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_support_fee_opening_state: idempotency key is required' using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_support_fee_opening_state: invalid property' using errcode = '22023';
  end if;

  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'import_support_fee_opening_state: invalid billing year' using errcode = '22023';
  end if;

  if p_transition_date is null then
    raise exception 'import_support_fee_opening_state: transition date required' using errcode = '22023';
  end if;

  if p_transition_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'import_support_fee_opening_state: transition date cannot be in the future'
      using errcode = '22023';
  end if;

  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  if v_src is null then
    raise exception 'import_support_fee_opening_state: source_reference (basis) required'
      using errcode = '22023';
  end if;

  if v_obl is distinct from 'support_fee' then
    raise exception 'import_support_fee_opening_state: unsupported obligation_type' using errcode = '22023';
  end if;

  v_assessed := round(coalesce(p_assessed_amount, -1), 2);
  v_paid := round(coalesce(p_historically_paid_amount, -1), 2);
  v_remaining := round(coalesce(p_remaining_debt, -1), 2);
  v_over_in := round(coalesce(p_opening_overpayment, 0), 2);

  if v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over_in < 0 then
    raise exception 'import_support_fee_opening_state: amounts must be nonnegative' using errcode = '22023';
  end if;

  if v_assessed <> round(v_paid + v_remaining, 2) then
    raise exception 'import_support_fee_opening_state: assessed must equal historically_paid + remaining'
      using errcode = '22023';
  end if;

  if v_remaining > 0 and v_over_in > 0 then
    raise exception 'import_support_fee_opening_state: remaining_debt and opening_overpayment are mutually exclusive'
      using errcode = '22023';
  end if;

  v_period := p_billing_year::text;

  select * into v_existing_import
  from public.support_fee_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_import.property_id is distinct from p_property_id
       or v_existing_import.billing_year is distinct from p_billing_year
       or v_existing_import.assessed_amount is distinct from v_assessed
       or v_existing_import.historically_paid_amount is distinct from v_paid
       or v_existing_import.remaining_debt is distinct from v_remaining
       or v_existing_import.opening_overpayment is distinct from v_over_in then
      raise exception 'import_support_fee_opening_state: idempotency key conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', 'SKIPPED_EXISTING',
      'import_id', v_existing_import.id,
      'assessment_id', v_existing_import.assessment_id,
      'remaining_due', v_existing_import.remaining_debt,
      'synthetic_payments', false,
      'charges_generated', false,
      'tariff_required', false
    );
  end if;

  select * into v_existing_import
  from public.support_fee_opening_imports as i
  where i.property_id = p_property_id
    and i.billing_year = p_billing_year
    and i.obligation_type = v_obl;

  if found then
    if v_existing_import.assessed_amount = v_assessed
       and v_existing_import.historically_paid_amount = v_paid
       and v_existing_import.remaining_debt = v_remaining
       and v_existing_import.opening_overpayment = v_over_in then
      return jsonb_build_object(
        'applied', false,
        'idempotent', true,
        'outcome', 'SKIPPED_EXISTING',
        'import_id', v_existing_import.id,
        'assessment_id', v_existing_import.assessment_id,
        'remaining_due', v_existing_import.remaining_debt,
        'synthetic_payments', false,
        'charges_generated', false,
        'tariff_required', false
      );
    end if;
    raise exception 'import_support_fee_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.support_fee_assessments as a
    where a.property_id = p_property_id
      and a.billing_year = p_billing_year
      and lower(coalesce(a.status, 'open')) not in ('void', 'corrected')
  ) then
    raise exception 'import_support_fee_opening_state: conflict existing assessment'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.support_fee_ledger as l
    where l.property_id = p_property_id
      and l.kind = 'charge'
      and l.period = v_period
  ) then
    raise exception 'import_support_fee_opening_state: conflict existing charge ledger'
      using errcode = '23505';
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'import_support_fee_opening_state: property not found' using errcode = 'P0002';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
  into v_debt, v_over
  from public.properties as p
  where p.id = p_property_id;

  v_status := case when v_remaining <= 0 then 'paid' else 'open' end;
  v_new_debt := round(v_debt + v_remaining, 2);
  v_new_over := round(v_over + v_over_in, 2);

  insert into public.support_fee_assessments (
    property_id, billing_year, policy_id, charge_ledger_id,
    base_amount, discount_percent, increase_percent, early_amount, late_amount,
    early_deadline_at, pricing_rule, pricing_reason_code, qualification_status,
    qualification_checked_at, available_credit_at_check, amount_covered_at_check,
    dedicated_payment_at_check, applied_credit_amount, applied_payment_amount,
    final_amount, remaining_due, balance_before, balance_after, status,
    created_by_email, finalized_at, finalized_by_email,
    tariff_version_id, area_sqm_snapshot, rate_eur_per_sqm_year_snapshot,
    opening_import, opening_historically_paid_amount, opening_transition_date,
    opening_source_reference, opening_obligation_type, opening_notes
  ) values (
    p_property_id, p_billing_year, null, null,
    v_assessed, 0, 0, v_assessed, v_assessed,
    null, 'standard', 'is4_opening_state', 'not_checked',
    null, 0, v_paid,
    0, 0, 0,
    v_assessed, v_remaining, v_debt, v_new_debt, v_status,
    v_email, now(), v_email,
    null, null, null,
    true, v_paid, p_transition_date,
    v_src, v_obl, nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_assessment_id;

  -- Ledger amount_positive: skip zero-amount opening_obligation (confirmed zero / credit-only).
  if v_assessed > 0 then
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, idempotency_key
    ) values (
      p_property_id, 'opening_obligation', v_assessed, v_period,
      'IS-4 opening obligation; source=' || v_src,
      v_email, v_new_debt, v_new_over, p_idempotency_key
    )
    returning id into v_ledger_obl;

    update public.support_fee_assessments
    set charge_ledger_id = v_ledger_obl
    where id = v_assessment_id;
  end if;

  if v_paid > 0 then
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, idempotency_key
    ) values (
      p_property_id, 'opening_historical_settlement', v_paid, v_period,
      'IS-4 historical settlement (not a platform payment); source=' || v_src,
      v_email, v_new_debt, v_new_over, null
    )
    returning id into v_ledger_settle;
  end if;

  if v_over_in > 0 then
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, idempotency_key
    ) values (
      p_property_id, 'opening_credit', v_over_in, v_period,
      'IS-4 opening credit/overpayment; source=' || v_src,
      v_email, v_new_debt, v_new_over, null
    )
    returning id into v_ledger_credit;
  end if;

  update public.properties
  set debt = v_new_debt, overpayment = v_new_over
  where id = p_property_id;

  insert into public.support_fee_opening_imports (
    property_id, billing_year, obligation_type, assessment_id,
    assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,
    transition_date, source_reference, notes, idempotency_key, batch_id, created_by_email
  ) values (
    p_property_id, p_billing_year, v_obl, v_assessment_id,
    v_assessed, v_paid, v_remaining, v_over_in,
    p_transition_date, v_src, nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key, p_batch_id, v_email
  )
  returning id into v_import_id;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'assessment_id', v_assessment_id,
    'property_id', p_property_id,
    'billing_year', p_billing_year,
    'obligation_type', v_obl,
    'assessed_amount', v_assessed,
    'historically_paid_amount', v_paid,
    'remaining_due', v_remaining,
    'opening_overpayment', v_over_in,
    'status', v_status,
    'debt_after', v_new_debt,
    'overpayment_after', v_new_over,
    'synthetic_payments', false,
    'charges_generated', false,
    'tariff_required', false,
    'tariff_version_id', null,
    'ledger_obligation_id', v_ledger_obl,
    'ledger_settlement_id', v_ledger_settle,
    'ledger_credit_id', v_ledger_credit
  );
end;
$fn$;

comment on function public.import_support_fee_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, uuid
) is
  'IS-4/R1-RC8: inventarise SF opening debt/overpayment/zero. No tariff, no synthetic payment/charge.';

-- ---------------------------------------------------------------------------
-- charge_support_fee: opening inventarisation year cannot be charged/repriced
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
  v_opening boolean;
  v_assessment_id uuid;
  v_final numeric(12, 2);
  v_remaining numeric(12, 2);
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
       'opening_import_blocks_charge'
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

-- ---------------------------------------------------------------------------
-- Atomic batch preview / commit (first-run + Initial Setup)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Complete assert: require support_fee_opening + ACTIVE support_fee;
-- also capital_repair_opening + tariffs progress before final complete.
-- ---------------------------------------------------------------------------

create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_book_state text;
  v_water_state text;
  v_elec_state text;
  v_sf_state text;
  v_stage_status text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(v_inst.display_name, v_inst.complex_name, '')), '') is null then
    raise exception 'first_run: complex card incomplete (name)' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.address, '')), '') is null then
    raise exception 'first_run: complex card incomplete (address)' using errcode = 'P0001';
  end if;
  if v_inst.apartment_count is null or v_inst.apartment_count <= 0 then
    raise exception 'first_run: complex card incomplete (apartment_count)' using errcode = 'P0001';
  end if;

  foreach v_stage_status in array array[
    'welcome', 'complex_card', 'property_book', 'meters_select',
    'support_fee_opening', 'capital_repair_opening', 'tariffs'
  ]
  loop
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = v_stage_status
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage % not complete', v_stage_status using errcode = 'P0001';
    end if;
  end loop;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)
  into v_selected;

  v_need_water := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) = 'water'
  );
  v_need_elec := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  );
  if not v_need_water and not v_need_elec then
    raise exception 'first_run: at least one meter utility required' using errcode = 'P0001';
  end if;

  select ml.state into v_book_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'property_book';
  if v_book_state is distinct from 'ACTIVE' then
    raise exception 'first_run: property_book must be ACTIVE (got %)', coalesce(v_book_state, 'missing')
      using errcode = 'P0001';
  end if;

  if v_need_water then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_water'
        and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_water stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_water_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'water';
    if v_water_state is distinct from 'ACTIVE' then
      raise exception 'first_run: water must be ACTIVE (got %)', coalesce(v_water_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  if v_need_elec then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_electricity'
        and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_electricity stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_elec_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'electricity';
    if v_elec_state is distinct from 'ACTIVE' then
      raise exception 'first_run: electricity must be ACTIVE (got %)', coalesce(v_elec_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  select ml.state into v_sf_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'support_fee';
  if v_sf_state is distinct from 'ACTIVE' then
    raise exception 'first_run: support_fee must be ACTIVE (got %)', coalesce(v_sf_state, 'missing')
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.support_fee_opening_imports
  ) and exists (select 1 from public.properties) then
    raise exception 'first_run: support_fee opening inventarisation missing' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

commit;
