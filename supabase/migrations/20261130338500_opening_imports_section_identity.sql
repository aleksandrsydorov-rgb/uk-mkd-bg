-- Dependent opening imports: resolve apartment by number + section/block (385).
-- Unique apartment numbers still resolve without section; ambiguous numbers require section_code.

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
    where public.property_book_object_identity_key(p.apartment_number, p.section_code, p.block_code)
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
  where lower(btrim(p.apartment_number)) = lower(v_apt);

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

-- Patched opening RPCs (identity-aware apartment resolve)

CREATE OR REPLACE FUNCTION public.admin_import_water_meters_opening(p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_reading numeric;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_resolve_err text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_bal_kind_by_prop jsonb := '{}'::jsonb;
  v_bal_amt_by_prop jsonb := '{}'::jsonb;
  v_prev_kind text;
  v_prev_amt numeric;
  v_existing_meter_id uuid;
  v_existing_prop_id bigint;
  v_result jsonb;
  v_norm_amt text;
begin
  perform public.admin_assert_module_setup();
  perform public.admin_assert_module_initial_setup_writable('water');

  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('water');
  end if;
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_water_meters_opening: rows array required'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_bal_kind := public.normalize_meter_opening_balance_kind(v_row ->> 'opening_balance_kind');

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required'
      ));
      continue;
    end if;
    if v_serial is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'required', 'reason', 'meter_number_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if exists (
      select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
        'apartment_number', v_apt, 'meter_number', v_serial
      ));
      continue;
    end if;
    v_seen_serials := array_append(v_seen_serials, v_serial);

    select r.property_id, r.error_code into v_prop_id, v_resolve_err
    from public.resolve_property_id_for_opening_import(
      v_apt,
      v_row ->> 'section_code',
      v_row ->> 'block_code'
    ) as r;
    if v_resolve_err is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx,
        'field', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code' else 'apartment_number' end,
        'code', v_resolve_err, 'reason', v_resolve_err,
        'apartment_number', v_apt,
        'section_code', nullif(btrim(coalesce(v_row ->> 'section_code', '')), ''),
        'hint', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'fill_section_code' else null end
      ));
      continue;
    end if;

    begin
      v_reading := nullif(btrim(coalesce(v_row ->> 'initial_reading', '')), '')::numeric;
    exception when others then
      v_reading := null;
    end;
    if v_reading is null or v_reading < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_installed := null;
    end;
    if v_installed is null or v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if v_bal_kind = 'zero' then
      v_bal_amt := 0;
    elsif v_bal_amt is null or v_bal_amt <= 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    -- Opening balance is once per apartment. zero/empty on a meter row = no claim
    -- (additional meters allowed). Conflicting debt/overpayment values are rejected.
    if v_bal_kind <> 'zero' then
      v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
      if v_prev_kind is not null then
        v_prev_amt := nullif(v_bal_amt_by_prop ->> v_prop_id::text, '')::numeric;
        if v_prev_kind is distinct from v_bal_kind
           or coalesce(v_prev_amt, 0) is distinct from coalesce(v_bal_amt, 0) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
            'code', 'opening_balance_conflict',
            'reason', 'opening_balance_conflict_same_apartment',
            'apartment_number', v_apt
          ));
          continue;
        end if;
      else
        v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
        v_norm_amt := coalesce(v_bal_amt, 0)::text;
        v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
      end if;
    end if;

    select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
    from public.water_meters as m
    where m.meter_number = v_serial
    limit 1;

    if v_existing_meter_id is not null then
      if v_existing_prop_id is distinct from v_prop_id then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'meter_number_other_apartment',
          'reason', 'meter_number_belongs_to_other_apartment',
          'apartment_number', v_apt,
          'meter_number', v_serial
        ));
        continue;
      end if;
      v_skipped := v_skipped + 1;
      if not coalesce(p_dry_run, true)
         and v_bal_kind <> 'zero'
         and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_water_meter(v_prop_id, v_serial, v_reading, v_installed) as m
    limit 1;

    perform public.register_water_opening_reading(
      v_prop_id, v_reading, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    if v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_water_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'water',
    'errors', v_errors,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_import_electricity_meters_opening(p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_day numeric;
  v_night numeric;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_resolve_err text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_bal_kind_by_prop jsonb := '{}'::jsonb;
  v_bal_amt_by_prop jsonb := '{}'::jsonb;
  v_prev_kind text;
  v_prev_amt numeric;
  v_existing_meter_id uuid;
  v_existing_prop_id bigint;
  v_result jsonb;
  v_norm_amt text;
begin
  perform public.admin_assert_module_setup();
  perform public.admin_assert_module_initial_setup_writable('electricity');

  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('electricity');
  end if;
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_electricity_meters_opening: rows array required'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_bal_kind := public.normalize_meter_opening_balance_kind(v_row ->> 'opening_balance_kind');

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required'
      ));
      continue;
    end if;
    if v_serial is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'required', 'reason', 'meter_number_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if exists (
      select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    v_seen_serials := array_append(v_seen_serials, v_serial);

    select r.property_id, r.error_code into v_prop_id, v_resolve_err
    from public.resolve_property_id_for_opening_import(
      v_apt,
      v_row ->> 'section_code',
      v_row ->> 'block_code'
    ) as r;
    if v_resolve_err is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx,
        'field', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code' else 'apartment_number' end,
        'code', v_resolve_err, 'reason', v_resolve_err,
        'apartment_number', v_apt,
        'section_code', nullif(btrim(coalesce(v_row ->> 'section_code', '')), ''),
        'hint', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'fill_section_code' else null end
      ));
      continue;
    end if;

    begin
      v_day := nullif(btrim(coalesce(v_row ->> 'initial_day_reading', '')), '')::numeric;
      v_night := nullif(btrim(coalesce(v_row ->> 'initial_night_reading', '')), '')::numeric;
    exception when others then
      v_day := null; v_night := null;
    end;
    if v_day is null or v_day < 0 or v_night is null or v_night < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_day_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_installed := null;
    end;
    if v_installed is null or v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if v_bal_kind = 'zero' then
      v_bal_amt := 0;
    elsif v_bal_amt is null or v_bal_amt <= 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

-- Opening balance is once per apartment. zero/empty on a meter row = no claim
    -- (additional meters allowed). Conflicting debt/overpayment values are rejected.
    if v_bal_kind <> 'zero' then
      v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
      if v_prev_kind is not null then
        v_prev_amt := nullif(v_bal_amt_by_prop ->> v_prop_id::text, '')::numeric;
        if v_prev_kind is distinct from v_bal_kind
           or coalesce(v_prev_amt, 0) is distinct from coalesce(v_bal_amt, 0) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
            'code', 'opening_balance_conflict',
            'reason', 'opening_balance_conflict_same_apartment',
            'apartment_number', v_apt
          ));
          continue;
        end if;
      else
        v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
        v_norm_amt := coalesce(v_bal_amt, 0)::text;
        v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
      end if;
    end if;

    select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
    from public.electricity_meters as m
    where m.meter_number = v_serial
    limit 1;

    if v_existing_meter_id is not null then
      if v_existing_prop_id is distinct from v_prop_id then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'meter_number_other_apartment',
          'reason', 'meter_number_belongs_to_other_apartment',
          'apartment_number', v_apt,
          'meter_number', v_serial
        ));
        continue;
      end if;
      v_skipped := v_skipped + 1;
      if not coalesce(p_dry_run, true)
         and v_bal_kind <> 'zero'
         and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_electricity_meter(
      v_prop_id, v_serial, v_day, v_night, v_installed
    ) as m
    limit 1;

    perform public.register_electricity_opening_reading(
      v_prop_id, v_day, v_night, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    if v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_electricity_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'electricity',
    'errors', v_errors,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.admin_import_internet_opening(p_rows jsonb, p_dry_run boolean DEFAULT true, p_confirm_corrections boolean DEFAULT false, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := auth.email();
  v_dry boolean := coalesce(p_dry_run, true);
  v_confirm boolean := coalesce(p_confirm_corrections, false);
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_today date := public.tariff_sofia_today();
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_parsed jsonb := '[]'::jsonb;
  v_tainted bigint[] := '{}';
  v_elem jsonb;
  v_idx integer := 0;
  v_row_num integer;
  v_codes text[];
  v_apt text;
  v_property_id bigint;
  v_resolve_err text;
  v_raw text;
  v_state text;
  v_conn date;
  v_pstart date;
  v_pend date;
  v_trans date;
  v_debt numeric;
  v_credit numeric;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_g record;
  v_n_state integer;
  v_n_conn integer;
  v_n_trans integer;
  v_n_debt integer;
  v_n_credit integer;
  v_n_idem integer;
  v_n_full integer;
  v_n_only integer;
  v_n_only_distinct integer;
  v_periods jsonb;
  v_paid_through date;
  v_min_start date;
  v_max_end date;
  v_has_gap boolean;
  v_covers_today boolean;
  v_pay_status text;
  v_warnings text[];
  v_billing_mode text;
  v_res jsonb;
  v_outcome text;
  v_failed boolean;
  v_reason text;
  v_msg text;
  v_row jsonb;
  v_pid bigint;
  v_summary jsonb;
begin

  perform public.admin_assert_module_initial_setup_writable('internet');  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_internet_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_internet_opening: not allowed' using errcode = '42501';
  end if;

  if not v_dry then
    perform public.first_run_assert_prepared_tariff_for_opening('internet');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_internet_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if v_dry then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'batch_id', v_batch,
        'row_count', 0,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0, 'field', 'rows', 'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch')
        )),
        'rows', '[]'::jsonb,
        'summary', jsonb_build_object(
          'as_of', v_today, 'total', 0, 'active', 0, 'inactive', 0,
          'paid_active', 0, 'paid_expired', 0, 'paid_unknown', 0, 'paid_future', 0,
          'debt_sum', 0, 'credit_sum', 0,
          'create_count', 0, 'skip_count', 0, 'correct_count', 0, 'error_count', 1
        ),
        'synthetic_payments', false,
        'charges_generated', false,
        'work_orders_created', false
      );
    end if;
    raise exception 'admin_import_internet_opening: empty batch not allowed' using errcode = '22023';
  end if;

  -- -------------------------------------------------------------------------
  -- Pass 1: parse and validate each input row
  -- -------------------------------------------------------------------------
  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_codes := '{}';
    v_property_id := null;
    v_state := null;
    v_conn := null;
    v_pstart := null;
    v_pend := null;
    v_trans := null;
    v_debt := null;
    v_credit := null;
    v_idem := null;

    if jsonb_typeof(v_elem) is distinct from 'object' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_idx + 1,
        'apartment_number', '',
        'codes', jsonb_build_array('invalid:row_not_object'),
        'reason', 'invalid:row_not_object',
        'field', 'internet_opening'
      ));
      continue;
    end if;

    v_row_num := coalesce(
      public.internet_opening_try_numeric(
        public.internet_opening_pick(v_elem, array['rowNumber', 'row_number', 'row'])
      )::integer,
      v_idx + 1
    );

    v_apt := public.internet_opening_pick(
      v_elem, array['apartment_number', 'apartmentNumber', 'apartment', 'apt']
    );
    if v_apt is null then
      v_codes := array_append(v_codes, 'required:apartment_number');
    else
      select r.property_id, r.error_code into v_property_id, v_resolve_err
      from public.resolve_property_id_for_opening_import(
        v_apt,
        public.internet_opening_pick(v_elem, array['section_code', 'sectionCode', 'section', 'entrance']),
        public.internet_opening_pick(v_elem, array['block_code', 'blockCode', 'block'])
      ) as r;
      if v_resolve_err is not null then
        v_codes := array_append(v_codes, v_resolve_err);
      end if;
    end if;

    -- connection state (aliases; anything else is rejected)
    v_raw := public.internet_opening_pick(
      v_elem, array['connection_state', 'connectionState', 'status']
    );
    if v_raw is not null then
      if lower(v_raw) in ('active', 'connected', 'подключён', 'подключен', 'активен', 'включен')
         or v_raw in ('Подключён', 'Подключен') then
        v_state := 'active';
      elsif lower(v_raw) in ('inactive', 'disconnected', 'отключён', 'отключен', 'неактивен', 'изключен')
         or v_raw in ('Отключён', 'Отключен') then
        v_state := 'inactive';
      else
        v_codes := array_append(v_codes, 'invalid:connection_state');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['tariff_code', 'tariffCode', 'tariff_key']);
    if v_raw is not null and lower(v_raw) is distinct from 'internet' then
      v_codes := array_append(v_codes, 'unsupported:tariff_code');
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['connection_date', 'connectionDate']);
    if v_raw is not null then
      v_conn := public.internet_opening_try_date(v_raw);
      if v_conn is null then
        v_codes := array_append(v_codes, 'invalid:connection_date');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['paid_period_start', 'paidPeriodStart']);
    if v_raw is not null then
      v_pstart := public.internet_opening_try_date(v_raw);
      if v_pstart is null then
        v_codes := array_append(v_codes, 'invalid:paid_period_start');
      end if;
    end if;

    v_raw := public.internet_opening_pick(
      v_elem, array['paid_period_end', 'paidPeriodEnd', 'paid_through', 'paidThrough']
    );
    if v_raw is not null then
      v_pend := public.internet_opening_try_date(v_raw);
      if v_pend is null then
        v_codes := array_append(v_codes, 'invalid:paid_period_end');
      end if;
    end if;

    if v_pstart is not null and v_pend is null
       and public.internet_opening_pick(
         v_elem, array['paid_period_end', 'paidPeriodEnd', 'paid_through', 'paidThrough']
       ) is null then
      v_codes := array_append(v_codes, 'incomplete:paid_period_end');
    end if;
    if v_pstart is not null and v_pend is not null and v_pstart > v_pend then
      v_codes := array_append(v_codes, 'invalid:paid_period_range');
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['transition_date', 'transitionDate']);
    if v_raw is not null then
      v_trans := public.internet_opening_try_date(v_raw);
      if v_trans is null then
        v_codes := array_append(v_codes, 'invalid:transition_date');
      elsif v_trans > v_today then
        v_codes := array_append(v_codes, 'invalid:transition_date_future');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['opening_debt', 'openingDebt', 'debt']);
    if v_raw is not null then
      v_debt := public.internet_opening_try_numeric(v_raw);
      if v_debt is null then
        v_codes := array_append(v_codes, 'invalid:opening_debt');
      elsif v_debt < 0 then
        v_codes := array_append(v_codes, 'negative:opening_debt');
      else
        v_debt := round(v_debt, 2);
      end if;
    end if;

    v_raw := public.internet_opening_pick(
      v_elem,
      array['opening_credit', 'openingCredit', 'opening_overpayment', 'openingOverpayment', 'overpayment']
    );
    if v_raw is not null then
      v_credit := public.internet_opening_try_numeric(v_raw);
      if v_credit is null then
        v_codes := array_append(v_codes, 'invalid:opening_credit');
      elsif v_credit < 0 then
        v_codes := array_append(v_codes, 'negative:opening_credit');
      else
        v_credit := round(v_credit, 2);
      end if;
    end if;
    -- Debt and overpayment may both be present: separate opening_debit / opening_credit rows (no netting).

    v_src := public.internet_opening_pick(v_elem, array['source_reference', 'sourceReference']);
    v_notes := public.internet_opening_pick(v_elem, array['comment', 'notes', 'note']);

    v_raw := public.internet_opening_pick(v_elem, array['idempotency_key', 'idempotencyKey']);
    if v_raw is not null then
      begin
        v_idem := v_raw::uuid;
      exception
        when others then
          v_codes := array_append(v_codes, 'invalid:idempotency_key');
      end;
    end if;

    if coalesce(array_length(v_codes, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'property_id', v_property_id,
        'codes', to_jsonb(v_codes),
        'reason', v_codes[1],
        'field', 'internet_opening'
      ));
      if v_property_id is not null then
        v_tainted := array_append(v_tainted, v_property_id);
      end if;
      continue;
    end if;

    v_parsed := v_parsed || jsonb_build_array(jsonb_build_object(
      'row', v_row_num,
      'property_id', v_property_id,
      'state', v_state,
      'conn', v_conn,
      'pstart', v_pstart,
      'pend', v_pend,
      'trans', v_trans,
      'debt', v_debt,
      'credit', v_credit,
      'src', v_src,
      'notes', v_notes,
      'idem', v_idem
    ));
  end loop;

  -- -------------------------------------------------------------------------
  -- Pass 2: merge rows per apartment, classify, optionally apply
  -- -------------------------------------------------------------------------
  for v_g in
    select
      (r ->> 'property_id')::bigint as pid,
      min((r ->> 'row')::integer) as first_row,
      jsonb_agg(r order by (r ->> 'row')::integer) as grp_rows
    from jsonb_array_elements(v_parsed) as r
    group by 1
    order by 2
  loop
    if v_g.pid = any (v_tainted) then
      continue;
    end if;

    v_codes := '{}';
    v_failed := false;
    v_warnings := '{}';
    v_apt := (select p.apartment_number from public.properties as p where p.id = v_g.pid);

    select
      count(distinct r ->> 'state'),
      count(distinct r ->> 'conn'),
      count(distinct r ->> 'trans'),
      count(distinct (r ->> 'debt')::numeric),
      count(distinct (r ->> 'credit')::numeric),
      count(distinct r ->> 'idem'),
      min(r ->> 'state'),
      min(r ->> 'conn')::date,
      min(r ->> 'trans')::date,
      min((r ->> 'debt')::numeric),
      min((r ->> 'credit')::numeric),
      min(r ->> 'idem')::uuid,
      (array_agg(r ->> 'src' order by (r ->> 'row')::integer)
         filter (where r ->> 'src' is not null))[1],
      string_agg(distinct r ->> 'notes', ' | ') filter (where r ->> 'notes' is not null),
      count(*) filter (where r ->> 'pstart' is not null),
      count(*) filter (where r ->> 'pstart' is null and r ->> 'pend' is not null),
      count(distinct r ->> 'pend') filter (where r ->> 'pstart' is null),
      max(r ->> 'pend') filter (where r ->> 'pstart' is null)
    into
      v_n_state, v_n_conn, v_n_trans, v_n_debt, v_n_credit, v_n_idem,
      v_state, v_conn, v_trans, v_debt, v_credit, v_idem,
      v_src, v_notes,
      v_n_full, v_n_only, v_n_only_distinct, v_raw
    from jsonb_array_elements(v_g.grp_rows) as r;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object('start', r ->> 'pstart', 'end', r ->> 'pend')
          order by (r ->> 'pstart')::date
        ) filter (where r ->> 'pstart' is not null),
        '[]'::jsonb
      )
    into v_periods
    from jsonb_array_elements(v_g.grp_rows) as r;

    if v_n_state > 1 then
      v_codes := array_append(v_codes, 'inconsistent:connection_state');
    elsif v_state is null then
      v_codes := array_append(v_codes, 'required:connection_state');
    end if;
    if v_n_conn > 1 then
      v_codes := array_append(v_codes, 'inconsistent:connection_date');
    end if;
    if v_n_trans > 1 then
      v_codes := array_append(v_codes, 'inconsistent:transition_date');
    end if;
    if v_n_debt > 1 then
      v_codes := array_append(v_codes, 'inconsistent:opening_debt');
    end if;
    if v_n_credit > 1 then
      v_codes := array_append(v_codes, 'inconsistent:opening_credit');
    end if;
    if v_n_idem > 1 then
      v_codes := array_append(v_codes, 'inconsistent:idempotency_key');
    end if;
    -- Debt and overpayment may both be present: separate opening_debit / opening_credit rows (no netting).
    if v_n_full > 0 and v_n_only > 0 then
      v_codes := array_append(v_codes, 'mixed:paid_through_only_and_periods');
    end if;
    if v_n_only_distinct > 1 then
      v_codes := array_append(v_codes, 'inconsistent:paid_through');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_periods) with ordinality as a(v, n)
      join jsonb_array_elements(v_periods) with ordinality as b(v, n) on a.n < b.n
      where daterange((a.v ->> 'start')::date, (a.v ->> 'end')::date, '[]')
            && daterange((b.v ->> 'start')::date, (b.v ->> 'end')::date, '[]')
    ) then
      v_codes := array_append(v_codes, 'overlapping_paid_periods');
    end if;

    if coalesce(array_length(v_codes, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', to_jsonb(v_codes),
        'reason', v_codes[1],
        'field', 'internet_opening'
      ));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'ERROR',
        'reasons', to_jsonb(v_codes)
      ));
      continue;
    end if;

    v_debt := coalesce(v_debt, 0);
    v_credit := coalesce(v_credit, 0);

    if jsonb_array_length(v_periods) > 0 then
      select min((x ->> 'start')::date), max((x ->> 'end')::date)
        into v_min_start, v_max_end
      from jsonb_array_elements(v_periods) as x;
      v_paid_through := v_max_end;
    else
      v_min_start := null;
      v_max_end := null;
      v_paid_through := nullif(v_raw, '')::date;
    end if;

    v_idem := coalesce(v_idem, gen_random_uuid());

    -- Classification (no writes). allow_correction = true so CORRECT is detectable.
    begin
      v_res := public.internet_opening_apply(
        v_g.pid, v_state, 'internet', v_conn, v_trans, v_paid_through, v_periods,
        v_debt, v_credit, v_src, v_notes, v_idem, v_batch, true, true
      );
      v_outcome := v_res ->> 'outcome';
    exception
      when others then
        v_failed := true;
        v_msg := SQLERRM;
        v_reason := btrim(
          regexp_replace(
            lower(regexp_replace(v_msg, '^[a-z_]+:\s*', '')),
            '[^a-z0-9]+', '_', 'g'
          ),
          '_'
        );
    end;

    if v_failed then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', jsonb_build_array(v_reason),
        'reason', v_reason,
        'message', v_msg,
        'field', 'internet_opening'
      ));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'ERROR',
        'reasons', jsonb_build_array(v_reason)
      ));
      continue;
    end if;

    -- Payment status as of Sofia today
    if jsonb_array_length(v_periods) > 0 then
      select exists (
        select 1
        from jsonb_array_elements(v_periods) as x
        where (x ->> 'start')::date <= v_today and (x ->> 'end')::date >= v_today
      ) into v_covers_today;
      select exists (
        select 1
        from (
          select (t.v ->> 'start')::date as s,
                 lag((t.v ->> 'end')::date) over (order by (t.v ->> 'start')::date) as pe
          from jsonb_array_elements(v_periods) as t(v)
        ) as q
        where q.pe is not null and q.s > q.pe + 1
      ) into v_has_gap;

      if v_covers_today then
        v_pay_status := 'active_paid';
      elsif v_max_end < v_today then
        v_pay_status := 'expired';
      elsif v_min_start > v_today then
        v_pay_status := 'future';
      else
        v_pay_status := 'expired';
        v_warnings := array_append(v_warnings, 'paid_period_gap_today');
      end if;
      if v_has_gap then
        v_warnings := array_append(v_warnings, 'paid_period_gap');
      end if;
    elsif v_paid_through is not null then
      v_pay_status := case when v_today <= v_paid_through then 'active_paid' else 'expired' end;
      v_warnings := array_append(v_warnings, 'paid_through_only_no_period_start');
    else
      v_pay_status := 'unknown';
      v_warnings := array_append(v_warnings, 'payment_unknown');
    end if;

    if v_conn is null then
      v_warnings := array_append(v_warnings, 'connection_date_unknown');
    end if;
    -- next_charge_on is only meaningful for legacy monthly billing.
    -- prepaid_period (package_30/day opening) never schedules monthly charges — not a warning.
    v_billing_mode := public.internet_opening_choose_billing_mode(
      nullif(v_res ->> 'billing_mode', ''),
      v_outcome = 'CREATE',
      v_today
    );
    if v_billing_mode = 'monthly'
       and v_state = 'active'
       and v_paid_through is not null
       and (v_res ->> 'next_charge_on') is null then
      if v_paid_through < v_today then
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_period_expired');
      elsif v_paid_through = v_today then
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_today');
      else
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_not_after_today');
      end if;
    end if;
    if v_state = 'inactive' and v_pay_status = 'active_paid' then
      v_warnings := array_append(v_warnings, 'inactive_with_active_paid_period');
    end if;

    -- Corrections need explicit confirmation (dry-run previews the apply result).
    if v_outcome = 'CORRECT' and not v_confirm then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('opening_correction_requires_confirm'),
        'reason', 'opening_correction_requires_confirm',
        'field', 'internet_opening'
      ));
    elsif not v_dry and v_outcome in ('CREATE', 'CORRECT') then
      begin
        v_res := public.internet_opening_apply(
          v_g.pid, v_state, 'internet', v_conn, v_trans, v_paid_through, v_periods,
          v_debt, v_credit, v_src, v_notes, v_idem, v_batch, v_confirm, false
        );
      exception
        when others then
          v_failed := true;
          v_msg := SQLERRM;
          v_reason := btrim(
            regexp_replace(
              lower(regexp_replace(v_msg, '^[a-z_]+:\s*', '')),
              '[^a-z0-9]+', '_', 'g'
            ),
            '_'
          );
      end;
      if v_failed then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'codes', jsonb_build_array(v_reason),
          'reason', v_reason,
          'message', v_msg,
          'field', 'internet_opening'
        ));
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'property_id', v_g.pid,
          'outcome', 'ERROR',
          'reasons', jsonb_build_array(v_reason)
        ));
        continue;
      end if;
    end if;

    v_row := jsonb_build_object(
      'row', v_g.first_row,
      'apartment_number', v_apt,
      'property_id', v_g.pid,
      'outcome', v_outcome,
      'status', v_state,
      'connection_date', v_conn,
      'paid_period_start', v_min_start,
      'paid_period_end', v_paid_through,
      'periods', v_periods,
      'payment_status', v_pay_status,
      'payment_status_as_of', v_today,
      'opening_debt', v_debt,
      'opening_credit', v_credit,
      'next_charge_on', v_res -> 'next_charge_on',
      'billing_mode', to_jsonb(v_billing_mode),
      'warnings', to_jsonb(v_warnings),
      'applied', coalesce((v_res ->> 'applied')::boolean, false),
      'import_id', v_res -> 'import_id'
    );
    if v_outcome = 'CORRECT' then
      v_row := v_row || jsonb_build_object('was', v_res -> 'was', 'will', v_res -> 'will');
    end if;
    v_results := v_results || jsonb_build_array(v_row);
  end loop;

  -- Apartments whose input rows were invalid get an ERROR row each.
  for v_pid in select distinct t from unnest(v_tainted) as t
  loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', (
        select min((e ->> 'row')::integer)
        from jsonb_array_elements(v_errors) as e
        where (e ->> 'property_id')::bigint = v_pid
      ),
      'apartment_number', (select p.apartment_number from public.properties as p where p.id = v_pid),
      'property_id', v_pid,
      'outcome', 'ERROR',
      'reasons', coalesce((
        select jsonb_agg(distinct e ->> 'reason')
        from jsonb_array_elements(v_errors) as e
        where (e ->> 'property_id')::bigint = v_pid
      ), '[]'::jsonb)
    ));
  end loop;

  select jsonb_build_object(
    'as_of', v_today,
    'total', count(*),
    'active', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'status' = 'active'),
    'inactive', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'status' = 'inactive'),
    'paid_active', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'active_paid'),
    'paid_expired', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'expired'),
    'paid_unknown', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'unknown'),
    'paid_future', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'future'),
    'debt_sum', coalesce(sum((r ->> 'opening_debt')::numeric) filter (where r ->> 'outcome' <> 'ERROR'), 0),
    'credit_sum', coalesce(sum((r ->> 'opening_credit')::numeric) filter (where r ->> 'outcome' <> 'ERROR'), 0),
    'create_count', count(*) filter (where r ->> 'outcome' = 'CREATE'),
    'skip_count', count(*) filter (where r ->> 'outcome' = 'SKIP'),
    'correct_count', count(*) filter (where r ->> 'outcome' = 'CORRECT'),
    'error_count', jsonb_array_length(v_errors)
  )
  into v_summary
  from jsonb_array_elements(v_results) as r;

  if not v_dry and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_internet_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'dry_run', v_dry,
    'batch_id', v_batch,
    'row_count', jsonb_array_length(p_rows),
    'errors', v_errors,
    'rows', v_results,
    'summary', v_summary,
    'synthetic_payments', false,
    'charges_generated', false,
    'work_orders_created', false
  );
end;
$function$;
