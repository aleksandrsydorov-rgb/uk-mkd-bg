-- R1-RC8: capital_repair opening inventarisation — optional source_reference / technical transition.
-- Align import_capital_repair_opening_state with support_fee opening (no fictional documents).

CREATE OR REPLACE FUNCTION public.import_capital_repair_opening_state(p_property_id bigint, p_billing_year integer, p_obligation_type text, p_assessed_amount numeric, p_historically_paid_amount numeric, p_remaining_debt numeric, p_opening_overpayment numeric, p_transition_date date, p_source_reference text, p_notes text, p_idempotency_key uuid, p_assessment_title text DEFAULT NULL::text, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := auth.email();
  v_obl text := lower(btrim(coalesce(p_obligation_type, 'capital_repair')));
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over_in numeric(12, 2);
  v_title text;
  v_assessment_id uuid;
  v_import_id uuid;
  v_existing_import public.capital_repair_opening_imports;
  v_lock bigint;
  v_src text;
begin

  if not exists (
    select 1 from public.capital_repair_opening_pending as u
    where u.property_id = p_property_id
      and u.status = 'needs_initial'
  ) then
    perform public.admin_assert_module_initial_setup_writable('capital_repair');
  end if;  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_capital_repair_opening_state: authentication required'
      using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_capital_repair_opening_state: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_capital_repair_opening_state: idempotency key is required'
      using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_capital_repair_opening_state: invalid property'
      using errcode = '22023';
  end if;

  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'import_capital_repair_opening_state: invalid billing year'
      using errcode = '22023';
  end if;

  if p_transition_date is null then
    p_transition_date := (now() at time zone 'Europe/Sofia')::date;
  end if;

  if p_transition_date > (timezone('Europe/Sofia', now()))::date then
    raise exception 'import_capital_repair_opening_state: transition date cannot be in the future'
      using errcode = '22023';
  end if;

  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  -- source_reference optional for simple inventarisation; never invent a document.

  if v_obl is distinct from 'capital_repair' then
    raise exception 'import_capital_repair_opening_state: unsupported obligation_type'
      using errcode = '22023';
  end if;

  v_assessed := round(coalesce(p_assessed_amount, -1), 2);
  v_paid := round(coalesce(p_historically_paid_amount, -1), 2);
  v_remaining := round(coalesce(p_remaining_debt, -1), 2);
  v_over_in := round(coalesce(p_opening_overpayment, 0), 2);

  if v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over_in < 0 then
    raise exception 'import_capital_repair_opening_state: amounts must be nonnegative'
      using errcode = '22023';
  end if;

  if v_assessed <> round(v_paid + v_remaining, 2) then
    raise exception 'import_capital_repair_opening_state: assessed must equal historically_paid + remaining'
      using errcode = '22023';
  end if;

  if v_over_in > 0 and v_remaining > 0 then
    raise exception 'import_capital_repair_opening_state: opening_overpayment and remaining_debt are mutually exclusive'
      using errcode = '22023';
  end if;

  select * into v_existing_import
  from public.capital_repair_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', 'SKIPPED_EXISTING',
      'import_id', v_existing_import.id,
      'assessment_id', v_existing_import.assessment_id,
      'property_id', v_existing_import.property_id,
      'billing_year', v_existing_import.billing_year,
      'remaining_debt', v_existing_import.remaining_debt,
      'opening_overpayment', v_existing_import.opening_overpayment,
      'synthetic_payments', false,
      'operational_charges', false
    );
  end if;

  select p.id into v_lock
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'import_capital_repair_opening_state: property not found'
      using errcode = 'P0002';
  end if;

  select * into v_existing_import
  from public.capital_repair_opening_imports as i
  where i.property_id = p_property_id
    and i.billing_year = p_billing_year;

  if found then
    if v_existing_import.assessed_amount is not distinct from v_assessed
       and v_existing_import.historically_paid_amount is not distinct from v_paid
       and v_existing_import.remaining_debt is not distinct from v_remaining
       and v_existing_import.opening_overpayment is not distinct from v_over_in then
      return jsonb_build_object(
        'applied', false,
        'idempotent', true,
        'outcome', 'SKIPPED_EXISTING',
        'import_id', v_existing_import.id,
        'assessment_id', v_existing_import.assessment_id,
        'property_id', v_existing_import.property_id,
        'billing_year', v_existing_import.billing_year,
        'remaining_debt', v_existing_import.remaining_debt,
        'opening_overpayment', v_existing_import.opening_overpayment,
        'synthetic_payments', false,
        'operational_charges', false
      );
    end if;
    raise exception 'import_capital_repair_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and i.source_reference = v_src
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing source_reference'
      using errcode = '23505';
  end if;

  v_title := nullif(btrim(coalesce(p_assessment_title, '')), '');
  if v_title is null then
    v_title := 'Капитальный ремонт ' || p_billing_year::text;
  end if;

  select a.id into v_assessment_id
  from public.capital_repair_assessments as a
  where a.title = v_title
    and coalesce(a.status, 'active') is distinct from 'cancelled'
  order by a.created_at asc
  limit 1;

  if v_assessment_id is null then
    insert into public.capital_repair_assessments (
      title, description, decision_date, due_date, status, created_by_email
    ) values (
      v_title,
      'R1-RC8 / IS-8 opening inventarisation shell (no operational charge)',
      p_transition_date,
      null,
      'active',
      v_email
    )
    returning id into v_assessment_id;
  end if;

  if v_assessment_id is null then
    raise exception 'import_capital_repair_opening_state: assessment linkage failed'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing operational charge'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'opening_obligation'
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing opening obligation'
      using errcode = '23505';
  end if;

  if v_assessed > 0 then
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_assessment_id, 'opening_obligation', v_assessed,
      'IS-8 opening obligation; source=' || v_src, v_email, p_idempotency_key
    );
  end if;

  if v_paid > 0 then
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_assessment_id, 'opening_historical_settlement', v_paid,
      'IS-8 historical settlement (not a platform payment)', v_email, gen_random_uuid()
    );
  end if;

  if v_over_in > 0 then
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_assessment_id, 'opening_credit', v_over_in,
      'IS-8 opening credit/overpayment', v_email, gen_random_uuid()
    );
  end if;

  insert into public.capital_repair_opening_imports (
    property_id, billing_year, assessment_id,
    assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,
    transition_date, source_reference, notes, imported_by_email, idempotency_key, batch_id
  ) values (
    p_property_id, p_billing_year, v_assessment_id,
    v_assessed, v_paid, v_remaining, v_over_in,
    p_transition_date, v_src, nullif(btrim(coalesce(p_notes, '')), ''),
    v_email, p_idempotency_key, p_batch_id
  )
  returning id into v_import_id;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'assessment_id', v_assessment_id,
    'assessment_title', v_title,
    'property_id', p_property_id,
    'billing_year', p_billing_year,
    'remaining_debt', v_remaining,
    'opening_overpayment', v_over_in,
    'synthetic_payments', false,
    'operational_charges', false
  );
end;
$function$;
