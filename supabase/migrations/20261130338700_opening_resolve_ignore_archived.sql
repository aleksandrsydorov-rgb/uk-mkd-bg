-- Opening import resolve: ignore archived properties (387).
-- Archived demos / superseded identities must not create false ambiguity.
-- SF/CR opening coverage also ignores archived properties.

create or replace function public.resolve_property_id_for_opening_import(
  p_apartment_number text,
  p_section_code text default null,
  p_block_code text default null
)
returns table(property_id bigint, error_code text)
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_apt text := nullif(btrim(coalesce(p_apartment_number, '')), '');
  v_section text := nullif(btrim(coalesce(p_section_code, '')), '');
  v_block text := nullif(btrim(coalesce(p_block_code, '')), '');
  v_id bigint;
  v_count integer;
begin
  if v_apt is null then
    property_id := null;
    error_code := 'required:apartment_number';
    return next;
    return;
  end if;

  if v_section is not null or v_block is not null then
    select p.id into v_id
    from public.properties as p
    where p.archived_at is null
      and public.property_book_object_identity_key(p.apartment_number, p.section_code, p.block_code)
        = public.property_book_object_identity_key(v_apt, v_section, v_block)
    limit 1;
    if v_id is null then
      property_id := null;
      error_code := 'unknown_apartment';
    else
      property_id := v_id;
      error_code := null;
    end if;
    return next;
    return;
  end if;

  select count(*)::integer, min(p.id)
  into v_count, v_id
  from public.properties as p
  where p.archived_at is null
    and lower(btrim(p.apartment_number)) = lower(v_apt);

  if coalesce(v_count, 0) = 0 then
    property_id := null;
    error_code := 'unknown_apartment';
  elsif v_count > 1 then
    property_id := null;
    error_code := 'section_code_required_for_disambiguation';
  else
    property_id := v_id;
    error_code := null;
  end if;
  return next;
end;
$fn$;

revoke all on function public.resolve_property_id_for_opening_import(text, text, text) from public, anon;
grant execute on function public.resolve_property_id_for_opening_import(text, text, text) to authenticated;
grant execute on function public.resolve_property_id_for_opening_import(text, text, text) to service_role;


-- Patched SF/CR coverage: ignore archived properties
CREATE OR REPLACE FUNCTION public.admin_import_support_fee_opening(p_rows jsonb, p_dry_run boolean DEFAULT true, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_resolve_err text;
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

  perform public.admin_assert_module_initial_setup_writable('support_fee');  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_support_fee_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_support_fee_opening: not allowed' using errcode = '42501';
  end if;

  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('support_fee');
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
      select r.property_id, r.error_code into v_property_id, v_resolve_err
      from public.resolve_property_id_for_opening_import(
        v_apt,
        v_elem->>'section_code',
        v_elem->>'block_code'
      ) as r;
      if v_resolve_err is not null then
        v_row_errors := array_append(v_row_errors, v_resolve_err);
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
      select string_agg(p.apartment_number || coalesce('/' || nullif(btrim(p.section_code), ''), ''), ', ' order by p.apartment_number, p.section_code)
      into v_missing
      from public.properties as p
      where p.archived_at is null
        and not exists (
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_import_capital_repair_opening(p_rows jsonb, p_dry_run boolean DEFAULT true, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_resolve_err text;
  v_year int;
  v_obl text;
  v_title text;
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
  v_missing text;
  v_scope text;
  v_scopes text[] := '{}';
  v_row_errors text[];
  v_outcome text;
  v_assessment_id uuid;
begin

  perform public.admin_assert_module_initial_setup_writable('capital_repair');  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_capital_repair_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_capital_repair_opening: not allowed' using errcode = '42501';
  end if;

  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('capital_repair');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_capital_repair_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if coalesce(p_dry_run, true) then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'batch_id', v_batch,
        'row_count', 0,
        'created_count', 0,
        'skipped_existing_count', 0,
        'error_count', 1,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0, 'field', 'rows', 'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch')
        )),
        'rows', '[]'::jsonb,
        'synthetic_payments', false,
        'charges_generated', false,
        'tariff_required', false,
        'reason', 'empty_batch'
      );
    end if;
    raise exception 'admin_import_capital_repair_opening: empty batch not allowed'
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
    v_title := nullif(btrim(coalesce(v_elem->>'assessment_title', '')), '');
    v_obl := lower(btrim(coalesce(v_elem->>'obligation_type', 'capital_repair')));

    if v_apt is null then
      v_row_errors := array_append(v_row_errors, 'required:apartment_number');
    else
      select r.property_id, r.error_code into v_property_id, v_resolve_err
      from public.resolve_property_id_for_opening_import(
        v_apt,
        v_elem->>'section_code',
        v_elem->>'block_code'
      ) as r;
      if v_resolve_err is not null then
        v_row_errors := array_append(v_row_errors, v_resolve_err);
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

    if v_obl is distinct from 'capital_repair' then
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

    if v_assessed is null or v_paid is null or v_remaining is null
       or v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over < 0 then
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
        'field', 'capital_repair_opening'
      ));
      continue;
    end if;

    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = v_property_id
        and i.billing_year = v_year
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
        'field', 'capital_repair_opening'
      ));
      continue;
    end if;

    -- Resolve assessment title for operational-charge conflict checks.
    v_assessment_id := null;
    if v_title is not null then
      select a.id into v_assessment_id
      from public.capital_repair_assessments as a
      where a.title = v_title
        and coalesce(a.status, 'active') is distinct from 'cancelled'
      order by a.created_at asc
      limit 1;
    else
      select a.id into v_assessment_id
      from public.capital_repair_assessments as a
      where a.title = 'Капитальный ремонт ' || v_year::text
        and coalesce(a.status, 'active') is distinct from 'cancelled'
      order by a.created_at asc
      limit 1;
    end if;

    if v_assessment_id is not null and exists (
      select 1 from public.capital_repair_ledger as l
      where l.property_id = v_property_id
        and l.assessment_id = v_assessment_id
        and l.kind = 'charge'
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_operational_charge'),
        'reason', 'conflict:existing_operational_charge',
        'field', 'capital_repair_opening'
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      if exists (
        select 1 from public.capital_repair_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
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

    v_idem := coalesce(
      nullif(btrim(coalesce(v_elem->>'idempotency_key', '')), '')::uuid,
      gen_random_uuid()
    );
    v_res := public.import_capital_repair_opening_state(
      v_property_id,
      v_year,
      'capital_repair',
      v_assessed,
      v_paid,
      v_remaining,
      v_over,
      v_transition,
      v_src,
      v_notes,
      v_idem,
      v_title,
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
      'remaining_debt', coalesce((v_res->>'remaining_debt')::numeric, v_remaining),
      'opening_overpayment', v_over,
      'assessment_id', v_res->>'assessment_id',
      'import_id', v_res->>'import_id'
    ));
  end loop;

  select array_agg(distinct (split_part(s, '|', 2))::int)
  into v_years
  from unnest(v_scopes) as s;
  if v_years is not null then
    foreach v_year_one in array v_years
    loop
      select string_agg(p.apartment_number || coalesce('/' || nullif(btrim(p.section_code), ''), ''), ', ' order by p.apartment_number, p.section_code)
      into v_missing
      from public.properties as p
      where p.archived_at is null
        and not exists (
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
    raise exception 'admin_import_capital_repair_opening: apply aborted - % errors',
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
        select coalesce(sum((r->>'remaining_debt')::numeric), 0)
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
$function$;

notify pgrst, 'reload schema';
