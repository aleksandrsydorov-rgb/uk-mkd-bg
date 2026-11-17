-- R1-RC8: water meters opening — signed amount balance (no kind column required).
-- Empty amount = no claim; explicit 0 = zero; second claim per apartment = conflict.
-- Prefill/download is client-side; this migration updates import RPC validation.
CREATE OR REPLACE FUNCTION public.admin_import_water_meters_opening(p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_created int := 0;
  v_deferred int := 0;
  v_skipped int := 0;
  v_skipped_blank int := 0;
  v_preserved int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_section text;
  v_block text;
  v_fmt text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_reading numeric;
  v_reading_raw text;
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
  v_incomplete boolean;
  v_has_confirmed boolean;
  v_keys text[] := array[
    'apartment_number','section_code','block_code','meter_number','initial_reading',
    'installed_at','opening_balance_kind','opening_balance_eur'
  ];
begin
  perform public.admin_assert_module_setup();
  perform public.admin_assert_module_initial_setup_writable('water');
  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('water');
  end if;
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_water_meters_opening: rows array required' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    if public.opening_import_row_is_blank(v_row, v_keys) then
      v_skipped_blank := v_skipped_blank + 1;
      continue;
    end if;

    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_section := nullif(btrim(coalesce(v_row ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_row ->> 'block_code', '')), '');
    v_bal_kind := null; -- resolved below from kind column and/or signed amount
    v_reading_raw := v_row ->> 'initial_reading';

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required',
        'expected_format', 'apartment_2_section_b_block_3'
      ));
      continue;
    end if;

    v_fmt := public.opening_import_section_block_format_error(v_section, v_block);
    if v_fmt = 'section_block_fields_swapped' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'section_code',
        'code', 'section_block_fields_swapped', 'reason', 'section_block_fields_swapped',
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'expected_format', 'apartment_2_section_b_block_3',
        'hint', 'section_must_be_entrance_letter'
      ));
      continue;
    end if;

    select r.property_id, r.error_code into v_prop_id, v_resolve_err
    from public.resolve_property_id_for_opening_import(v_apt, v_section, v_block) as r;
    if v_resolve_err is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx,
        'field', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code' else 'apartment_number' end,
        'code', v_resolve_err, 'reason', v_resolve_err,
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'expected_format', 'apartment_2_section_b_block_3',
        'hint', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'fill_section_code' else null end
      ));
      continue;
    end if;

    -- Numeric-only section advisory when letter entrances exist for this apt number
    if v_fmt = 'section_code_looks_like_block_number' and v_section is not null then
      if exists (
        select 1 from public.properties p
        where lower(btrim(coalesce(p.apartment_number::text, ''))) = lower(v_apt)
          and nullif(btrim(coalesce(p.section_code, '')), '') ~* '^[A-Za-zА-Яа-яЁёІіЇїЄє]'
      ) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'section_code',
          'code', 'section_code_looks_like_block_number',
          'reason', 'section_code_looks_like_block_number',
          'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
          'expected_format', 'apartment_2_section_b_block_3',
          'hint', 'section_must_be_entrance_letter'
        ));
        continue;
      end if;
    end if;

    begin
      v_reading := nullif(btrim(coalesce(v_reading_raw, '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if v_reading is not null and v_reading < 0 then
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
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if v_installed is not null and v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    -- Opening balance: signed amount (new) or legacy kind column. Empty amount = no claim.
    v_bal_amt := null;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
      if btrim(coalesce(v_row ->> 'opening_balance_eur', '')) in ('-', '−', '–') then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
          'code', 'invalid', 'reason', 'opening_balance_eur_hyphen',
          'apartment_number', v_apt
        ));
        continue;
      end if;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if btrim(coalesce(v_row ->> 'opening_balance_eur', '')) in ('-', '−', '–') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_hyphen',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if nullif(btrim(coalesce(v_row ->> 'opening_balance_kind', '')), '') is not null then
      v_bal_kind := public.normalize_meter_opening_balance_kind(v_row ->> 'opening_balance_kind');
      if v_bal_kind not in ('zero', 'debt', 'overpayment') then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
          'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
          'apartment_number', v_apt
        ));
        continue;
      end if;
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
    elsif v_bal_amt is null and nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '') is null then
      v_bal_kind := null; -- unknown / defer
    elsif v_bal_amt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_invalid',
        'apartment_number', v_apt
      ));
      continue;
    else
      -- Signed amount encodes kind
      if v_bal_amt < 0 then
        v_bal_kind := 'overpayment';
        v_bal_amt := abs(v_bal_amt);
      elsif v_bal_amt > 0 then
        v_bal_kind := 'debt';
      else
        v_bal_kind := 'zero';
        v_bal_amt := 0;
      end if;
    end if;

    -- One claim per apartment (including explicit zero). Empty = no claim.
    if v_bal_kind is not null then
      v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
      if v_prev_kind is not null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
          'code', 'opening_balance_conflict',
          'reason', 'opening_balance_conflict_same_apartment',
          'apartment_number', v_apt
        ));
        continue;
      end if;
      v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
      v_norm_amt := coalesce(v_bal_amt, 0)::text;
      v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
    end if;

    v_incomplete := (v_serial is null) or (v_reading is null);

    -- Preserve: blank meter/reading on re-import when property already has meter or confirmed pending
    if v_incomplete and v_serial is null and v_reading is null then
      select exists (
        select 1 from public.water_meters m
        where m.property_id = v_prop_id and m.retired_at is null
      ) or exists (
        select 1 from public.utility_opening_pending u
        where u.property_id = v_prop_id and u.utility = 'water' and u.status = 'confirmed'
      ) into v_has_confirmed;
      if v_has_confirmed then
        v_preserved := v_preserved + 1;
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    if v_serial is not null then
      if exists (select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
          'apartment_number', v_apt, 'meter_number', v_serial
        ));
        continue;
      end if;
      v_seen_serials := array_append(v_seen_serials, v_serial);

      select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
      from public.water_meters as m where m.meter_number = v_serial limit 1;
      if v_existing_meter_id is not null then
        if v_existing_prop_id is distinct from v_prop_id then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
            'code', 'meter_number_other_apartment',
            'reason', 'meter_number_belongs_to_other_apartment',
            'apartment_number', v_apt, 'meter_number', v_serial
          ));
          continue;
        end if;
        -- Existing meter: do not wipe; optional balance only
        v_skipped := v_skipped + 1;
        v_preserved := v_preserved + 1;
        if not coalesce(p_dry_run, true)
           and v_bal_kind is not null
           and not (v_prop_id = any (v_bal_done)) then
          v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
          if coalesce((v_result ->> 'applied')::boolean, false) then
            v_balances := v_balances + 1;
          end if;
          v_bal_done := array_append(v_bal_done, v_prop_id);
        end if;
        continue;
      end if;
    end if;

    if v_incomplete then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', case when v_serial is null then 'meter_number' else 'initial_reading' end,
        'code', 'needs_initial_readings', 'reason', 'needs_initial_readings',
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'severity', 'defer'
      ));
      v_deferred := v_deferred + 1;
      if coalesce(p_dry_run, true) then
        continue;
      end if;
      perform public.upsert_utility_opening_pending(
        v_prop_id, 'water', v_serial,
        jsonb_build_object(
          'initial_reading', v_reading,
          'installed_at', v_installed,
          'opening_balance_kind', v_bal_kind,
          'opening_balance_eur', v_bal_amt,
          'section_code', v_section,
          'block_code', v_block
        )
      );
      if v_bal_kind is not null and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    -- Complete row: create meter + opening reading + confirm baseline
    if v_installed is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_water_meter(v_prop_id, v_serial, v_reading, v_installed) as m
    limit 1;

    update public.water_meters
       set opening_confirmed_at = now()
     where id = v_meter_id and opening_confirmed_at is null;

    perform public.register_water_opening_reading(
      v_prop_id, v_reading, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    -- Clear pending slot for this property/meter
    update public.utility_opening_pending u
       set status = 'confirmed', confirmed_at = now(), updated_at = now()
     where u.property_id = v_prop_id
       and u.utility = 'water'
       and u.status = 'needs_initial'
       and coalesce(nullif(btrim(u.meter_number), ''), '') = coalesce(v_serial, '');

    if v_bal_kind is not null and not (v_prop_id = any (v_bal_done)) then
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
    'warnings', v_warnings,
    'created_count', v_created,
    'deferred_count', v_deferred,
    'skipped_existing_count', v_skipped,
    'skipped_blank_count', v_skipped_blank,
    'preserved_count', v_preserved,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$function$;



revoke all on function public.admin_import_water_meters_opening(jsonb, boolean) from public, anon;
grant execute on function public.admin_import_water_meters_opening(jsonb, boolean) to authenticated;
