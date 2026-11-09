-- R1-RC8: first-run opening commits require prepared tariff_prep (not published).
-- Post-activation imports are not gated by this rule.

create or replace function public.first_run_assert_prepared_tariff_for_opening(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_status text;
  v_item jsonb;
begin
  if v_key not in ('water', 'electricity', 'support_fee', 'capital_repair', 'internet') then
    raise exception 'first_run: invalid tariff key' using errcode = 'P0001';
  end if;

  select i.first_run_status
    into v_status
  from public.platform_installations as i
  order by i.created_at desc nulls last
  limit 1;

  if v_status is null or v_status = 'complete' then
    return;
  end if;

  select coalesce(i.first_run_draft, '{}'::jsonb) -> 'tariff_prep' -> v_key
    into v_item
  from public.platform_installations as i
  order by i.created_at desc nulls last
  limit 1;

  if not public.first_run_tariff_prep_ok(v_key, v_item) then
    raise exception 'first_run: tariff_prep_missing:%', v_key using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_prepared_tariff_for_opening(text) from public, anon;
grant execute on function public.first_run_assert_prepared_tariff_for_opening(text) to authenticated;


create or replace function public.admin_import_water_meters_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
    v_bal_kind := lower(btrim(coalesce(v_row ->> 'opening_balance_kind', 'zero')));
    if v_bal_kind = '' then v_bal_kind := 'zero'; end if;

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

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;
    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'unknown_apartment', 'reason', 'unknown_apartment',
        'apartment_number', v_apt
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

    -- Conflicting opening balances for the same apartment in one file.
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
$fn$;


create or replace function public.admin_import_electricity_meters_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
    v_bal_kind := lower(btrim(coalesce(v_row ->> 'opening_balance_kind', 'zero')));
    if v_bal_kind = '' then v_bal_kind := 'zero'; end if;

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

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;
    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'unknown_apartment', 'reason', 'unknown_apartment',
        'apartment_number', v_apt
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


create or replace function public.admin_import_capital_repair_opening(
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
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
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
$fn$;


create or replace function public.import_internet_opening_state(
  p_property_id bigint,
  p_status text,
  p_tariff_key text,
  p_connection_date date,
  p_transition_date date,
  p_paid_through date,
  p_opening_debt numeric,
  p_opening_credit numeric,
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
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_tariff_key text := lower(btrim(coalesce(p_tariff_key, 'internet')));
  v_debt numeric(12, 2);
  v_credit numeric(12, 2);
  v_sofia date := public.tariff_sofia_today();
  v_conn date;
  v_billing_day smallint;
  v_next date;
  v_anchor date;
  v_period_start date;
  v_version_id uuid;
  v_sub public.internet_subscriptions;
  v_import public.internet_opening_imports;
  v_sub_id uuid;
  v_import_id uuid;
  v_ledger_debt uuid;
  v_ledger_credit uuid;
  v_bal numeric(12, 2);
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_internet_opening_state: authentication required' using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_internet_opening_state: not allowed' using errcode = '42501';
  end if;

  perform public.first_run_assert_prepared_tariff_for_opening('internet');

  if p_idempotency_key is null then
    raise exception 'import_internet_opening_state: idempotency key is required' using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_internet_opening_state: invalid property' using errcode = '22023';
  end if;

  if p_transition_date is null then
    raise exception 'import_internet_opening_state: transition date required' using errcode = '22023';
  end if;

  if p_transition_date > v_sofia then
    raise exception 'import_internet_opening_state: transition date in future' using errcode = '22023';
  end if;

  if v_status not in ('active', 'inactive') then
    raise exception 'import_internet_opening_state: unsupported status' using errcode = '22023';
  end if;

  if v_tariff_key is distinct from 'internet' then
    raise exception 'import_internet_opening_state: unsupported tariff_key' using errcode = '22023';
  end if;

  v_debt := round(coalesce(p_opening_debt, 0), 2);
  v_credit := round(coalesce(p_opening_credit, 0), 2);
  if v_debt < 0 or v_credit < 0 then
    raise exception 'import_internet_opening_state: amounts must be nonnegative' using errcode = '22023';
  end if;

  -- Published tariff must exist
  begin
    select r.tariff_version_id into v_version_id
    from public.resolve_internet_tariff(p_transition_date) as r;
  exception
    when sqlstate 'P0002' then
      raise exception 'import_internet_opening_state: no internet tariff configured'
        using errcode = 'P0002';
  end;

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'import_internet_opening_state: property not found' using errcode = 'P0002';
  end if;

  -- Idempotent replay
  select * into v_import
  from public.internet_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    select b.balance_eur into v_bal
    from public.get_internet_balance(p_property_id) as b;
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', 'SKIPPED_EXISTING',
      'import_id', v_import.id,
      'subscription_id', v_import.subscription_id,
      'property_id', v_import.property_id,
      'status', v_import.status,
      'next_charge_on', v_import.next_charge_on,
      'opening_debt', v_import.opening_debt,
      'opening_credit', v_import.opening_credit,
      'balance_eur', v_bal,
      'synthetic_payments', false,
      'work_orders_created', false
    );
  end if;

  -- Pending Internet work orders (Q5)
  if exists (
    select 1
    from public.work_orders as wo
    where wo.target_property_id = p_property_id
      and wo.internet_action is not null
      and wo.status in ('open', 'in_progress')
  ) then
    raise exception 'import_internet_opening_state: conflict pending internet work order'
      using errcode = '23505';
  end if;

  -- Prior opening import for property (different idempotency)
  if exists (
    select 1 from public.internet_opening_imports as i where i.property_id = p_property_id
  ) then
    raise exception 'import_internet_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  -- Lock subscription row if any — Q4: never overwrite existing subscription
  select * into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if found then
    raise exception 'import_internet_opening_state: conflict existing subscription'
      using errcode = '23505';
  end if;

  -- Existing opening ledger for property → conflict
  if exists (
    select 1
    from public.internet_ledger as l
    where l.property_id = p_property_id
      and l.kind in ('opening_debit', 'opening_credit')
  ) then
    raise exception 'import_internet_opening_state: conflict existing opening ledger'
      using errcode = '23505';
  end if;

  -- Existing operational charges/payments: do not inventarise on top (manual reconcile)
  if exists (
    select 1
    from public.internet_ledger as l
    where l.property_id = p_property_id
  ) then
    raise exception 'import_internet_opening_state: conflict existing ledger'
      using errcode = '23505';
  end if;

  v_conn := coalesce(p_connection_date, p_transition_date);
  if v_conn > p_transition_date then
    raise exception 'import_internet_opening_state: connection_date after transition'
      using errcode = '22023';
  end if;

  v_billing_day := public.internet_billing_day_from_date(v_conn);
  v_anchor := v_conn;
  v_period_start := v_conn;

  if v_status = 'active' then
    if p_paid_through is null then
      raise exception 'import_internet_opening_state: paid_through required for active'
        using errcode = '22023';
    end if;
    if p_paid_through < v_conn then
      raise exception 'import_internet_opening_state: paid_through before connection'
        using errcode = '22023';
    end if;
    v_next := public.internet_next_charge_after_paid_through(
      p_paid_through, v_billing_day, v_sofia
    );
  else
    -- inactive: no cron schedule
    v_next := null;
    v_billing_day := null;
    v_anchor := null;
    -- paid_through optional for inactive (audit only)
  end if;

  insert into public.internet_subscriptions (
    property_id,
    status,
    period_start,
    period_end,
    pending_days,
    billing_day,
    billing_anchor_date,
    next_charge_on,
    opening_import,
    opening_transition_date,
    opening_paid_through,
    opening_source_reference,
    opening_notes
  ) values (
    p_property_id,
    v_status,
    case when v_status = 'active' then v_period_start else null end,
    case when v_status = 'inactive' then p_transition_date else null end,
    null,
    v_billing_day,
    v_anchor,
    v_next,
    true,
    p_transition_date,
    p_paid_through,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_sub_id;

  if v_debt > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'opening_debit',
      v_debt,
      null,
      v_version_id,
      'IS-5 opening debt; source=' || coalesce(nullif(btrim(coalesce(p_source_reference, '')), ''), 'n/a'),
      v_email,
      p_idempotency_key
    )
    returning id into v_ledger_debt;
  end if;

  if v_credit > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'opening_credit',
      v_credit,
      null,
      v_version_id,
      'IS-5 opening credit; source=' || coalesce(nullif(btrim(coalesce(p_source_reference, '')), ''), 'n/a'),
      v_email,
      case when v_debt > 0 then gen_random_uuid() else p_idempotency_key end
    )
    returning id into v_ledger_credit;
  end if;

  insert into public.internet_opening_imports (
    property_id,
    subscription_id,
    status,
    tariff_key,
    tariff_version_id,
    connection_date,
    transition_date,
    paid_through,
    next_charge_on,
    billing_day,
    opening_debt,
    opening_credit,
    source_reference,
    notes,
    idempotency_key,
    batch_id,
    created_by_email
  ) values (
    p_property_id,
    v_sub_id,
    v_status,
    v_tariff_key,
    v_version_id,
    p_connection_date,
    p_transition_date,
    p_paid_through,
    v_next,
    v_billing_day,
    v_debt,
    v_credit,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    p_batch_id,
    v_email
  )
  returning id into v_import_id;

  select b.balance_eur into v_bal
  from public.get_internet_balance(p_property_id) as b;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'subscription_id', v_sub_id,
    'property_id', p_property_id,
    'status', v_status,
    'tariff_key', v_tariff_key,
    'tariff_version_id', v_version_id,
    'billing_day', v_billing_day,
    'next_charge_on', v_next,
    'paid_through', p_paid_through,
    'opening_debt', v_debt,
    'opening_credit', v_credit,
    'balance_eur', v_bal,
    'synthetic_payments', false,
    'work_orders_created', false,
    'ledger_debt_id', v_ledger_debt,
    'ledger_credit_id', v_ledger_credit
  );
end;
$fn$;

