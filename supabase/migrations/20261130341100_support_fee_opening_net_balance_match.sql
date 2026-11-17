-- R1-RC8: support-fee opening — conflict / skip by factual net balance.
-- Net = remaining_debt - opening_overpayment. Same net → already saved (SKIP).
-- Different net → mismatch with saved/new amounts (no overwrite).
-- Assessed/paid technical fields and transition/source are not conflict drivers.

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
  v_assessed_raw text;
  v_paid_raw text;
  v_remaining_raw text;
  v_over_raw text;
  v_amounts_blank boolean;
  v_transition date;
  v_transition_raw text;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_res jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_deferred int := 0;
  v_blank_skipped int := 0;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_years int[];
  v_year_one int;
  v_missing text;
  v_scope text;
  v_scopes text[] := '{}';
  v_deferred_pids bigint[] := '{}';
  v_row_errors text[];
  v_outcome text;
  v_field text;
  v_has_any_field boolean;
  v_sec text;
  v_saved_rem numeric(12, 2);
  v_saved_over numeric(12, 2);
  v_saved_net numeric(12, 2);
  v_new_net numeric(12, 2);
begin
  -- Dry-run (preview / reimport check) stays available after initial setup.
  -- Apply still requires writable initial-setup (wizard) unless only soft-blank rows.
  if not coalesce(p_dry_run, true) then
    perform public.admin_assert_module_initial_setup_writable('support_fee');
  end if;

  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
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
        'deferred_count', 0,
        'blank_skipped_count', 0,
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
    v_field := 'support_fee_opening';
    v_apt := nullif(btrim(coalesce(v_elem->>'apartment_number', '')), '');
    v_property_id := null;
    v_year := null;
    v_assessed := null;
    v_paid := null;
    v_remaining := null;
    v_over := null;
    v_transition := null;
    v_src := nullif(btrim(coalesce(v_elem->>'source_reference', '')), '');
    v_notes := nullif(btrim(coalesce(v_elem->>'notes', '')), '');
    v_obl := lower(btrim(coalesce(v_elem->>'obligation_type', 'support_fee')));
    v_assessed_raw := nullif(btrim(coalesce(v_elem->>'assessed_amount', '')), '');
    v_paid_raw := nullif(btrim(coalesce(v_elem->>'historically_paid_amount', '')), '');
    v_remaining_raw := nullif(btrim(coalesce(v_elem->>'remaining_debt', '')), '');
    v_over_raw := nullif(btrim(coalesce(v_elem->>'opening_overpayment', '')), '');
    v_transition_raw := nullif(btrim(coalesce(v_elem->>'transition_date', '')), '');

    v_has_any_field :=
      v_apt is not null
      or nullif(btrim(coalesce(v_elem->>'section_code', '')), '') is not null
      or nullif(btrim(coalesce(v_elem->>'block_code', '')), '') is not null
      or nullif(btrim(coalesce(v_elem->>'billing_year', '')), '') is not null
      or v_assessed_raw is not null
      or v_paid_raw is not null
      or v_remaining_raw is not null
      or v_over_raw is not null
      or v_transition_raw is not null
      or v_src is not null
      or v_notes is not null
      or (
        nullif(btrim(coalesce(v_elem->>'obligation_type', '')), '') is not null
        and lower(btrim(coalesce(v_elem->>'obligation_type', ''))) is distinct from 'support_fee'
      );

    -- Fully blank Excel row → silent skip (do not block).
    if not v_has_any_field then
      v_blank_skipped := v_blank_skipped + 1;
      continue;
    end if;

    if v_apt is null then
      v_row_errors := array_append(v_row_errors, 'required:apartment_number');
      v_field := 'apartment_number';
    else
      select r.property_id, r.error_code into v_property_id, v_resolve_err
      from public.resolve_property_id_for_opening_import(
        v_apt,
        v_elem->>'section_code',
        v_elem->>'block_code'
      ) as r;
      if v_resolve_err is not null then
        v_row_errors := array_append(v_row_errors, v_resolve_err);
        v_field := case
          when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code'
          else 'apartment_number'
        end;
      end if;
    end if;

    begin
      v_year := nullif(btrim(coalesce(v_elem->>'billing_year', '')), '')::int;
    exception when others then
      v_year := null;
      v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
      v_field := 'billing_year';
    end;
    -- Opening year = complex activation year (stamped once; not browser/server drift).
    if v_year is null and not ('invalid:billing_year' = any (v_row_errors)) then
      v_year := public.ensure_complex_launch_year();
    end if;

    if v_obl is distinct from 'support_fee' then
      v_row_errors := array_append(v_row_errors, 'unsupported:obligation_type');
      v_field := 'obligation_type';
    end if;

    -- Parse amounts without substituting zeros for blanks.
    begin
      if v_assessed_raw is not null then
        v_assessed := round(v_assessed_raw::numeric, 2);
      end if;
      if v_paid_raw is not null then
        v_paid := round(v_paid_raw::numeric, 2);
      end if;
      if v_remaining_raw is not null then
        v_remaining := round(v_remaining_raw::numeric, 2);
      end if;
      if v_over_raw is not null then
        v_over := round(v_over_raw::numeric, 2);
      end if;
    exception when others then
      v_row_errors := array_append(v_row_errors, 'invalid:amounts');
      v_field := 'assessed_amount';
      v_assessed := null;
      v_paid := null;
      v_remaining := null;
      v_over := null;
    end;

    v_amounts_blank :=
      v_assessed_raw is null
      and v_paid_raw is null
      and v_remaining_raw is null
      and v_over_raw is null;

    if not v_amounts_blank then
      -- Partial / invalid amounts: name the missing/invalid field.
      if v_assessed_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:assessed_amount');
        v_field := 'assessed_amount';
      elsif v_assessed is null or v_assessed < 0 then
        v_row_errors := array_append(v_row_errors, 'invalid:assessed_amount');
        v_field := 'assessed_amount';
      end if;

      if v_paid_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:historically_paid_amount');
        if v_field = 'support_fee_opening' then v_field := 'historically_paid_amount'; end if;
      elsif v_paid is null or v_paid < 0 then
        v_row_errors := array_append(v_row_errors, 'invalid:historically_paid_amount');
        if v_field = 'support_fee_opening' then v_field := 'historically_paid_amount'; end if;
      end if;

      if v_remaining_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:remaining_debt');
        if v_field = 'support_fee_opening' then v_field := 'remaining_debt'; end if;
      elsif v_remaining is null or v_remaining < 0 then
        v_row_errors := array_append(v_row_errors, 'invalid:remaining_debt');
        if v_field = 'support_fee_opening' then v_field := 'remaining_debt'; end if;
      end if;

      if v_over_raw is not null and (v_over is null or v_over < 0) then
        v_row_errors := array_append(v_row_errors, 'invalid:opening_overpayment');
        if v_field = 'support_fee_opening' then v_field := 'opening_overpayment'; end if;
      end if;

      if v_assessed is not null and v_paid is not null and v_remaining is not null
         and v_assessed <> round(v_paid + v_remaining, 2) then
        v_row_errors := array_append(v_row_errors, 'inconsistent:assessed_ne_paid_plus_remaining');
        v_field := 'assessed_amount';
      end if;

      if coalesce(v_remaining, 0) > 0 and coalesce(v_over, 0) > 0 then
        v_row_errors := array_append(v_row_errors, 'mutually_exclusive:debt_and_overpayment');
        v_field := 'opening_overpayment';
      end if;

      -- Complete amounts: year from activation model; transition/source optional (technical defaults).
      if v_year is null or v_year < 2000 or v_year > 2100 then
        if not ('invalid:billing_year' = any (v_row_errors)) then
          v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
        end if;
        if v_field = 'support_fee_opening' then v_field := 'billing_year'; end if;
      end if;

      begin
        v_transition := v_transition_raw::date;
      exception when others then
        v_transition := null;
      end;
      if v_transition_raw is null then
        -- Technical date from activation model (Sofia today); no fictional document.
        v_transition := v_today;
      elsif v_transition is null then
        v_row_errors := array_append(v_row_errors, 'invalid:transition_date');
        if v_field = 'support_fee_opening' then v_field := 'transition_date'; end if;
      elsif v_transition > v_today then
        v_row_errors := array_append(v_row_errors, 'invalid:transition_date_future');
        if v_field = 'support_fee_opening' then v_field := 'transition_date'; end if;
      end if;
      -- source_reference stays optional (null allowed); never invent a document number.
    else
      -- Soft-defer path: year defaults to activation year; transition/source optional.
      if v_year is null then
        v_year := public.ensure_complex_launch_year();
      end if;
      if nullif(btrim(coalesce(v_elem->>'billing_year', '')), '') is not null
         and (v_year is null or v_year < 2000 or v_year > 2100) then
        if not ('invalid:billing_year' = any (v_row_errors)) then
          v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
        end if;
        v_field := 'billing_year';
      end if;
      if v_transition_raw is not null then
        begin
          v_transition := v_transition_raw::date;
        exception when others then
          v_transition := null;
          v_row_errors := array_append(v_row_errors, 'invalid:transition_date');
          v_field := 'transition_date';
        end;
        if v_transition is not null and v_transition > v_today then
          v_row_errors := array_append(v_row_errors, 'invalid:transition_date_future');
          v_field := 'transition_date';
        end if;
      end if;
    end if;

    if v_property_id is not null and v_year is not null and v_year >= 2000 and v_year <= 2100 then
      v_scope := v_property_id::text || '|' || v_year::text;
      if v_scope = any (v_scopes) then
        v_row_errors := array_append(v_row_errors, 'duplicate_in_file:apartment_year');
        v_field := 'billing_year';
      else
        v_scopes := array_append(v_scopes, v_scope);
      end if;
    elsif v_property_id is not null and v_amounts_blank then
      if not (v_property_id = any (v_deferred_pids)) then
        v_deferred_pids := array_append(v_deferred_pids, v_property_id);
      end if;
    end if;

    if coalesce(array_length(v_row_errors, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'codes', to_jsonb(v_row_errors),
        'reason', v_row_errors[1],
        'field', v_field,
        'action', 'fix_field_and_reupload'
      ));
      continue;
    end if;

    -- Soft defer: apartment resolved, amounts omitted.
    if v_amounts_blank then
      -- Already confirmed opening for this year → preserve, do not re-defer.
      if v_year is not null and exists (
        select 1 from public.support_fee_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
          and i.obligation_type = 'support_fee'
      ) then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'apartment_number', v_apt,
          'property_id', v_property_id,
          'billing_year', v_year,
          'outcome', 'SKIP',
          'warnings', jsonb_build_array('preserved_confirmed_opening'),
          'remaining_debt', null,
          'opening_overpayment', null,
          'assessed_amount', null
        ));
        continue;
      end if;

      -- Any confirmed opening on property without year in file → preserve.
      if v_year is null and exists (
        select 1 from public.support_fee_opening_imports as i
        where i.property_id = v_property_id
          and i.obligation_type = 'support_fee'
      ) then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'apartment_number', v_apt,
          'property_id', v_property_id,
          'billing_year', v_year,
          'outcome', 'SKIP',
          'warnings', jsonb_build_array('preserved_confirmed_opening'),
          'remaining_debt', null,
          'opening_overpayment', null,
          'assessed_amount', null
        ));
        continue;
      end if;

      if not coalesce(p_dry_run, true) then
        perform public.upsert_support_fee_opening_pending(
          v_property_id,
          v_year,
          jsonb_build_object(
            'transition_date', v_transition,
            'source_reference', v_src,
            'notes', v_notes,
            'excel_row', v_row_num
          )
        );
      end if;

      v_deferred := v_deferred + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'property_id', v_property_id,
        'billing_year', v_year,
        'outcome', 'DEFER',
        'status', 'needs_initial',
        'warnings', jsonb_build_array('can_enter_later'),
        'remaining_debt', null,
        'opening_overpayment', null,
        'assessed_amount', null,
        'applied', not coalesce(p_dry_run, true)
      ));
      continue;
    end if;

    -- Factual net balance = remaining_debt - opening_overpayment.
    -- Same net → skip path below; different → mismatch (no overwrite). Ignore assessed/paid split.
    v_saved_rem := null;
    v_saved_over := null;
    select i.remaining_debt, i.opening_overpayment
      into v_saved_rem, v_saved_over
    from public.support_fee_opening_imports as i
    where i.property_id = v_property_id
      and i.billing_year = v_year
      and i.obligation_type = 'support_fee'
    limit 1;
    if found then
      v_saved_net := round(coalesce(v_saved_rem, 0) - coalesce(v_saved_over, 0), 2);
      v_new_net := round(coalesce(v_remaining, 0) - coalesce(v_over, 0), 2);
      if v_saved_net is distinct from v_new_net then
        v_sec := nullif(btrim(coalesce(v_elem->>'section_code', '')), '');
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'apartment_number', v_apt,
          'section_code', v_sec,
          'billing_year', v_year,
          'codes', jsonb_build_array('conflict:existing_opening_import_mismatch'),
          'reason', 'conflict:existing_opening_import_mismatch',
          'field', 'opening_balance_eur',
          'action', 'keep_existing_or_correct_file',
          'saved_net', v_saved_net,
          'new_net', v_new_net,
          'saved_remaining_debt', coalesce(v_saved_rem, 0),
          'saved_opening_overpayment', coalesce(v_saved_over, 0),
          'new_remaining_debt', coalesce(v_remaining, 0),
          'new_opening_overpayment', coalesce(v_over, 0)
        ));
        continue;
      end if;
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
        'field', 'billing_year',
        'action', 'choose_other_year_or_void_existing'
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      if exists (
        select 1 from public.support_fee_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
          and i.obligation_type = 'support_fee'
          and round(coalesce(i.remaining_debt, 0) - coalesce(i.opening_overpayment, 0), 2)
              = round(coalesce(v_remaining, 0) - coalesce(v_over, 0), 2)
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
        'opening_overpayment', coalesce(v_over, 0),
        'assessed_amount', v_assessed
      ));
      continue;
    end if;

    -- Commit path for complete amounts
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
      coalesce(v_over, 0),
      v_transition,
      v_src,
      v_notes,
      v_idem,
      v_batch
    );
    v_outcome := coalesce(v_res->>'outcome', 'CREATED');
    if v_outcome = 'CREATED' then
      v_created := v_created + 1;
      -- Confirm any open pending for this apartment.
      update public.support_fee_opening_pending as u
         set status = 'confirmed',
             confirmed_at = now(),
             confirmed_by_email = v_email,
             updated_at = now(),
             billing_year = coalesce(u.billing_year, v_year)
       where u.property_id = v_property_id
         and u.status = 'needs_initial';
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
      'opening_overpayment', coalesce(v_over, 0),
      'assessment_id', v_res->>'assessment_id',
      'import_id', v_res->>'import_id'
    ));
  end loop;

  -- All apartments must be covered for each billing_year present in the file.
  -- Deferred apartments (no year in file) count as covered for every year in batch.
  select array_agg(distinct (split_part(s, '|', 2))::int)
  into v_years
  from unnest(v_scopes) as s;
  if v_years is not null then
    foreach v_year_one in array v_years
    loop
      select string_agg(
               p.apartment_number || coalesce('/' || nullif(btrim(p.section_code), ''), ''),
               ', ' order by p.apartment_number, p.section_code
             )
      into v_missing
      from public.properties as p
      where p.archived_at is null
        and not exists (
          select 1
          from unnest(v_scopes) as s
          where split_part(s, '|', 1)::bigint = p.id
            and split_part(s, '|', 2)::int = v_year_one
        )
        and not (p.id = any (v_deferred_pids));
      if v_missing is not null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', 0,
          'apartment_number', '',
          'codes', jsonb_build_array('missing_apartment_coverage'),
          'reason', 'missing_apartment_coverage',
          'field', 'billing_year',
          'billing_year', v_year_one,
          'missing', v_missing,
          'action', 'add_missing_apartments_or_defer_rows'
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
    'row_count', jsonb_array_length(p_rows) - v_blank_skipped,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'deferred_count', v_deferred,
    'blank_skipped_count', v_blank_skipped,
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
      'apartment_rows', jsonb_array_length(v_results),
      'deferred_count', v_deferred
    )
  );
end;
$function$;

revoke all on function public.admin_import_support_fee_opening(jsonb, boolean, uuid) from public, anon;
grant execute on function public.admin_import_support_fee_opening(jsonb, boolean, uuid) to authenticated;

-- Soften card confirm: optional transition/source; year defaults to launch.

CREATE OR REPLACE FUNCTION public.import_support_fee_opening_state(p_property_id bigint, p_billing_year integer, p_obligation_type text, p_assessed_amount numeric, p_historically_paid_amount numeric, p_remaining_debt numeric, p_opening_overpayment numeric, p_transition_date date, p_source_reference text, p_notes text, p_idempotency_key uuid, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if not exists (
    select 1 from public.support_fee_opening_pending as u
    where u.property_id = p_property_id
      and u.status = 'needs_initial'
  ) then
    perform public.admin_assert_module_initial_setup_writable('support_fee');
  end if;  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
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

  -- Source document optional for first-run inventarisation (no fictional document).
  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');

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
    -- Match on factual net balance; do not require identical assessed/paid technical split.
    if round(coalesce(v_existing_import.remaining_debt, 0) - coalesce(v_existing_import.opening_overpayment, 0), 2)
       = round(coalesce(v_remaining, 0) - coalesce(v_over_in, 0), 2) then
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
$function$;
