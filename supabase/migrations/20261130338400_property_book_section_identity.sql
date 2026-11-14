-- Property Book identity: apartment + section (entrance) + block.
-- Fixes wizard count for complexes where numbering restarts per entrance,
-- and accepts European decimal commas in area fields.

create or replace function public.property_book_object_identity_key(
  p_apartment_number text,
  p_section_code text default null,
  p_block_code text default null
)
returns text
language sql
immutable
parallel safe
as $identity$
  select lower(btrim(coalesce(p_apartment_number, '')))
    || E'\x01'
    || lower(btrim(coalesce(p_section_code, '')))
    || E'\x01'
    || lower(btrim(coalesce(p_block_code, '')));
$identity$;

create or replace function public.property_book_parse_decimal(p_value text)
returns numeric
language plpgsql
immutable
as $dec$
declare
  v text := btrim(coalesce(p_value, ''));
  v_comma int;
  v_dot int;
begin
  if v = '' then
    return null;
  end if;
  v := replace(replace(v, chr(160), ''), ' ', '');
  v_comma := position(',' in v);
  v_dot := position('.' in v);
  if v_comma > 0 and v_dot > 0 then
    if v_comma > v_dot then
      v := replace(replace(v, '.', ''), ',', '.');
    else
      v := replace(v, ',', '');
    end if;
  elsif v_comma > 0 then
    v := replace(v, ',', '.');
  end if;
  if v !~ '^[+-]?[0-9]+(\.[0-9]+)?$' then
    raise exception 'invalid decimal: %', p_value using errcode = '22P02';
  end if;
  return v::numeric;
end;
$dec$;

create or replace function public.admin_import_property_book(
  p_objects jsonb,
  p_owners jsonb,
  p_dry_run boolean default true,
  p_allow_create_missing boolean default false,
  p_allow_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_obj jsonb;
  v_own jsonb;
  v_apt text;
  v_apt_num bigint;
  v_prop_id bigint;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_existing jsonb := '[]'::jsonb;
  v_new_props jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_touched bigint[] := array[]::bigint[];
  v_created bigint[] := array[]::bigint[];
  v_skipped_identical bigint[] := array[]::bigint[];
  v_owners_by_apt jsonb := '{}'::jsonb;
  v_list jsonb;
  v_validation jsonb;
  v_ok_count integer := 0;
  v_importable_count integer := 0;
  v_clarification_count integer := 0;
  v_purpose text;
  v_area numeric;
  v_living numeric;
  v_ideal numeric;
  v_own_type text;
  v_floor bigint;
  v_section text;
  v_block text;
  v_seen_keys text[] := array[]::text[];
  v_seen_key_rows int[] := array[]::int[];
  v_identity_key text;
  v_row_no int;
  v_prev_row int;
  v_area_raw text;
  v_living_raw text;
  v_ideal_raw text;
  i int;
  v_prop public.properties%rowtype;
  v_would_create boolean;
  v_would_change boolean;
  v_identical boolean;
  v_owner_count int;
  v_allow_create boolean;
  v_expected_count integer;
  v_unique_count integer;
  v_book_empty boolean;
  v_creatable jsonb;
  v_hard jsonb;
  v_soft jsonb;
  v_code text;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'admin_import_property_book: objects array required'
      using errcode = '22023';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_import_property_book: owners array required'
      using errcode = '22023';
  end if;

  select not exists (select 1 from public.properties limit 1) into v_book_empty;
  v_allow_create := coalesce(p_allow_create_missing, false) or v_book_empty;

  select i.apartment_count
  into v_expected_count
  from public.platform_installations as i
  where i.id = public.first_run_default_installation_id();

  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_apt := nullif(btrim(coalesce(v_own ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners',
        'row', coalesce((v_own ->> '_row')::int, null),
        'field', 'apartment_number',
        'code', 'apartment_number_required',
        'reason', 'apartment_number_required',
        'severity', 'error',
        'row_data', v_own
      ));
      continue;
    end if;
    v_section := nullif(btrim(coalesce(v_own ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_own ->> 'block_code', '')), '');
    v_identity_key := public.property_book_object_identity_key(v_apt, v_section, v_block);
    v_list := coalesce(v_owners_by_apt -> v_identity_key, '[]'::jsonb);
    v_owners_by_apt := jsonb_set(
      v_owners_by_apt,
      array[v_identity_key],
      v_list || jsonb_build_array(v_own)
    );
  end loop;

  for v_obj in select value from jsonb_array_elements(p_objects) as t(value)
  loop
    v_would_create := false;
    v_would_change := false;
    v_identical := false;
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    v_row_no := coalesce((v_obj ->> '_row')::int, null);
    v_section := nullif(btrim(coalesce(v_obj ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_obj ->> 'block_code', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', v_row_no,
        'field', 'apartment_number',
        'code', 'apartment_number_required',
        'reason', 'apartment_number_required',
        'severity', 'error'
      ));
      continue;
    end if;

    v_identity_key := public.property_book_object_identity_key(v_apt, v_section, v_block);
    v_prev_row := null;
    for i in 1 .. coalesce(cardinality(v_seen_keys), 0) loop
      if v_seen_keys[i] = v_identity_key then
        v_prev_row := v_seen_key_rows[i];
        exit;
      end if;
    end loop;
    if v_prev_row is not null then
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'code', 'duplicate_apartment',
        'apartment_number', v_apt,
        'section_code', v_section,
        'block_code', v_block,
        'rows', jsonb_build_array(v_prev_row, v_row_no)
      ));
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', v_row_no,
        'field', 'apartment_number',
        'code', 'duplicate_apartment',
        'reason', 'duplicate_apartment',
        'severity', 'error',
        'apartment_number', v_apt,
        'section_code', v_section,
        'block_code', v_block,
        'duplicate_rows', jsonb_build_array(v_prev_row, v_row_no),
        'hint', case
          when v_section is null and v_block is null then 'fill_section_code'
          else null
        end
      ));
      continue;
    end if;
    v_seen_keys := array_append(v_seen_keys, v_identity_key);
    v_seen_key_rows := array_append(v_seen_key_rows, v_row_no);

    begin
      v_apt_num := v_apt::bigint;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'field', 'apartment_number',
        'code', 'apartment_number_invalid',
        'reason', 'apartment_number_invalid',
        'severity', 'error',
        'apartment_number', v_apt
      ));
      continue;
    end;

    v_purpose := nullif(btrim(coalesce(v_obj ->> 'purpose', '')), '');
    v_area_raw := nullif(btrim(coalesce(v_obj ->> 'area_sqm', '')), '');
    begin
      v_area := public.property_book_parse_decimal(v_area_raw);
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', v_row_no,
        'field', 'area_sqm',
        'code', 'area_sqm_invalid',
        'reason', 'area_sqm_invalid',
        'severity', 'error',
        'apartment_number', v_apt,
        'section_code', v_section,
        'value', v_area_raw
      ));
      continue;
    end;
    if v_area_raw is not null and (v_area is null or v_area <= 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', v_row_no,
        'field', 'area_sqm',
        'code', 'area_sqm_invalid',
        'reason', 'area_sqm_invalid',
        'severity', 'error',
        'apartment_number', v_apt,
        'section_code', v_section,
        'value', v_area_raw
      ));
      continue;
    end if;
    v_living := null;
    v_living_raw := nullif(btrim(coalesce(v_obj ->> 'living_area_sqm', '')), '');
    if v_living_raw is not null then
      begin
        v_living := public.property_book_parse_decimal(v_living_raw);
      exception when others then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'row', v_row_no,
          'field', 'living_area_sqm',
          'code', 'living_area_sqm_invalid',
          'reason', 'living_area_sqm_invalid',
          'severity', 'error',
          'apartment_number', v_apt,
          'section_code', v_section,
          'value', v_living_raw
        ));
        continue;
      end;
      if v_living is null or v_living <= 0 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'row', v_row_no,
          'field', 'living_area_sqm',
          'code', 'living_area_sqm_invalid',
          'reason', 'living_area_sqm_invalid',
          'severity', 'error',
          'apartment_number', v_apt,
          'section_code', v_section,
          'value', v_living_raw
        ));
        continue;
      end if;
    end if;
    v_ideal_raw := nullif(btrim(coalesce(v_obj ->> 'ideal_parts_percent', '')), '');
    begin
      v_ideal := public.property_book_parse_decimal(v_ideal_raw);
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', v_row_no,
        'field', 'ideal_parts_percent',
        'code', 'ideal_parts_invalid',
        'reason', 'ideal_parts_invalid',
        'severity', 'error',
        'apartment_number', v_apt,
        'section_code', v_section,
        'value', v_ideal_raw
      ));
      continue;
    end;
    v_own_type := nullif(btrim(coalesce(v_obj ->> 'ownership_type', '')), '');
    if v_own_type is not null and v_own_type not in ('sole', 'shared') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'ownership_type', 'code', 'ownership_type_invalid',
        'reason', 'ownership_type_invalid', 'severity', 'error', 'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_floor := public.property_book_parse_decimal(nullif(btrim(coalesce(v_obj ->> 'floor', '')), ''))::bigint;
    exception when others then
      v_floor := null;
    end;

    select p.* into v_prop
    from public.properties as p
    where p.apartment_number = v_apt
      and lower(coalesce(nullif(btrim(p.section_code), ''), ''))
          = lower(coalesce(v_section, ''))
      and lower(coalesce(nullif(btrim(p.block_code), ''), ''))
          = lower(coalesce(v_block, ''))
    limit 1;

    if not found and v_section is null and v_block is null then
      if (select count(*)::int from public.properties as p where p.apartment_number = v_apt) > 1 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'row', v_row_no,
          'field', 'section_code',
          'code', 'section_code_required_for_disambiguation',
          'reason', 'section_code_required_for_disambiguation',
          'severity', 'error',
          'apartment_number', v_apt,
          'hint', 'fill_section_code'
        ));
        continue;
      end if;
      -- Legacy single match: file omitted section/block and DB has one unit with this number.
      select p.* into v_prop
      from public.properties as p
      where p.apartment_number = v_apt
      limit 1;
    end if;

    if not found then
      v_would_create := true;
      v_new_props := v_new_props || jsonb_build_array(jsonb_build_object(
        'apartment_number', v_apt,
        'purpose', v_purpose,
        'area_sqm', v_area,
        'ideal_parts_percent', v_ideal,
        'ownership_type', v_own_type
      ));
      if not v_allow_create and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'field', 'apartment_number',
          'code', 'create_missing_requires_confirmation',
          'reason', 'create_missing_requires_confirmation',
          'severity', 'error',
          'apartment_number', v_apt
        ));
        continue;
      end if;
      v_prop_id := null;
    else
      v_prop_id := v_prop.id;
      v_existing := v_existing || jsonb_build_array(jsonb_build_object(
        'property_id', v_prop.id,
        'apartment_number', v_apt
      ));

      select count(*)::int into v_owner_count
      from public.property_registry_people as r
      where r.property_id = v_prop.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null;

      if (v_purpose is distinct from v_prop.purpose)
         or (v_area is distinct from v_prop.area_sqm)
         or (v_living is not null and v_living is distinct from v_prop.living_area_sqm)
         or (v_ideal is distinct from v_prop.ideal_parts_percent)
         or (v_own_type is distinct from v_prop.ownership_type)
         or (v_section is distinct from v_prop.section_code)
         or (v_block is distinct from v_prop.block_code)
         or (v_floor is distinct from v_prop.floor)
         or coalesce(jsonb_array_length(v_owners_by_apt -> v_identity_key), 0) <> v_owner_count
      then
        v_would_change := true;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'property_id', v_prop.id,
          'apartment_number', v_apt,
          'object_fields_differ', true,
          'owners_in_file', coalesce(jsonb_array_length(v_owners_by_apt -> v_identity_key), 0),
          'active_owners_now', v_owner_count
        ));
      else
        v_identical := true;
      end if;

      if v_would_change
         and not coalesce(p_allow_overwrite, false)
         and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'field', 'apartment_number',
          'code', 'overwrite_requires_confirmation',
          'reason', 'overwrite_requires_confirmation',
          'severity', 'error',
          'apartment_number', v_apt,
          'property_id', v_prop.id
        ));
        continue;
      end if;
    end if;

    v_validation := public.property_book_validate_owners_payload(
      v_purpose,
      v_area,
      v_ideal,
      v_own_type,
      coalesce(v_owners_by_apt -> v_identity_key, '[]'::jsonb)
    );
    v_hard := coalesce(v_validation -> 'errors', '[]'::jsonb);
    v_soft := coalesce(v_validation -> 'warnings', '[]'::jsonb);

    if jsonb_array_length(v_hard) > 0 then
      for v_code in select jsonb_array_elements_text(v_hard)
      loop
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'validation',
          'field', 'owners',
          'apartment_number', v_apt,
          'code', v_code,
          'codes', v_hard,
          'reason', v_code,
          'severity', 'error'
        ));
      end loop;
      v_identical := false;
    elsif jsonb_array_length(v_soft) > 0 then
      for v_code in select jsonb_array_elements_text(v_soft)
      loop
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'sheet', 'validation',
          'field', case v_code
            when 'purpose_required' then 'purpose'
            when 'area_required' then 'area_sqm'
            when 'object_ideal_parts_required' then 'ideal_parts_percent'
            when 'ownership_type_required' then 'ownership_type'
            when 'owner_email_required' then 'email'
            when 'owners_required' then 'owners'
            else 'owners'
          end,
          'apartment_number', v_apt,
          'code', v_code,
          'reason', v_code,
          'severity', 'warning'
        ));
      end loop;
    end if;

    if coalesce(p_dry_run, true) then
      if jsonb_array_length(v_hard) = 0 then
        v_importable_count := v_importable_count + 1;
        if jsonb_array_length(v_soft) > 0 then
          v_clarification_count := v_clarification_count + 1;
        elsif coalesce((v_validation ->> 'ok')::boolean, false) then
          v_ok_count := v_ok_count + 1;
        end if;
      end if;
      continue;
    end if;

    if jsonb_array_length(v_hard) > 0 then
      continue;
    end if;

    if v_identical and not v_would_create and not coalesce(p_allow_overwrite, false) then
      v_importable_count := v_importable_count + 1;
      if jsonb_array_length(v_soft) > 0 then
        v_clarification_count := v_clarification_count + 1;
      else
        v_ok_count := v_ok_count + 1;
      end if;
      v_skipped_identical := array_append(v_skipped_identical, v_prop_id);
      v_touched := array_append(v_touched, v_prop_id);
      continue;
    end if;

    if v_would_create then
      if v_floor is null then
        v_floor := case
          when v_apt_num between 1 and 99 then 1
          else greatest(1, (v_apt_num / 100)::bigint)
        end;
      end if;
      insert into public.properties (
        apartment_number, floor, section_code, block_code,
        area_sqm, purpose, ideal_parts_percent, ownership_type, status
      ) values (
        v_apt, v_floor, v_section, v_block,
        v_area, v_purpose, v_ideal, v_own_type, 'vacant'
      )
      returning id into v_prop_id;
      v_created := array_append(v_created, v_prop_id);
    end if;

    -- Preserve filled values: blank import cells do not wipe existing on overwrite path
    -- unless allow_overwrite and the file cell was explicitly provided as empty for
    -- optional fields — object upsert still writes provided nulls only when overwrite.
    if coalesce(p_allow_overwrite, false) or v_would_create then
      perform public.admin_upsert_property_book_object(
        v_prop_id,
        case when v_would_create or v_purpose is not null then v_purpose else v_prop.purpose end,
        case when v_would_create or v_area is not null then v_area else v_prop.area_sqm end,
        case when v_would_create or v_ideal is not null then v_ideal else v_prop.ideal_parts_percent end,
        case when v_would_create or v_own_type is not null then v_own_type else v_prop.ownership_type end,
        v_obj ->> 'ideal_parts_source',
        v_apt,
        coalesce(v_floor, v_prop.floor),
        null,
        null,
        coalesce(v_section, v_prop.section_code),
        coalesce(v_block, v_prop.block_code)
      );

      -- Empty cell and a missing column both leave v_living null and keep the saved value.
      update public.properties as p
         set living_area_sqm = case
           when v_would_create or v_living is not null then v_living
           else p.living_area_sqm
         end
       where p.id = v_prop_id;

      v_creatable := public.property_book_filter_creatable_owners(
        coalesce(v_owners_by_apt -> v_identity_key, '[]'::jsonb)
      );
      -- Replace owners only when file has creatable rows, or create with empty,
      -- or overwrite explicitly requested (may clear non-creatable-only payloads).
      if jsonb_array_length(v_creatable) > 0
         or v_would_create
         or coalesce(p_allow_overwrite, false) then
        perform public.admin_replace_property_book_owners(v_prop_id, v_creatable);
      end if;
    end if;

    v_validation := public.property_book_validate(v_prop_id);
    v_importable_count := v_importable_count + 1;
    if coalesce((v_validation ->> 'ok')::boolean, false) then
      v_ok_count := v_ok_count + 1;
    elsif coalesce((v_validation ->> 'importable')::boolean, false) then
      v_clarification_count := v_clarification_count + 1;
    end if;

    v_touched := array_append(v_touched, v_prop_id);
  end loop;

  v_unique_count := coalesce(cardinality(v_seen_keys), 0);
  if v_expected_count is not null and v_unique_count <> v_expected_count then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'sheet', 'objects',
      'field', 'apartment_count',
      'code', 'apartment_count_mismatch',
      'reason', 'apartment_count_mismatch',
      'severity', 'error',
      'expected', v_expected_count,
      'actual', v_unique_count
    ));
  end if;

  for v_identity_key in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not (v_identity_key = any (v_seen_keys)) then
      v_apt := split_part(v_identity_key, E'\x01', 1);
      v_section := nullif(split_part(v_identity_key, E'\x01', 2), '');
      v_block := nullif(split_part(v_identity_key, E'\x01', 3), '');
      if not exists (
        select 1 from public.properties p
        where p.apartment_number = v_apt
          and lower(coalesce(nullif(btrim(p.section_code), ''), '')) = lower(coalesce(v_section, ''))
          and lower(coalesce(nullif(btrim(p.block_code), ''), '')) = lower(coalesce(v_block, ''))
      ) and not (
        v_section is null and v_block is null and exists (
          select 1 from public.properties p where p.apartment_number = v_apt
        )
      ) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'owners',
          'field', case when v_section is null and v_block is null then 'section_code' else 'apartment_number' end,
          'code', case
            when v_section is null and v_block is null
              and (select count(*) from public.properties p where p.apartment_number = v_apt) > 1
            then 'section_code_required_for_disambiguation'
            else 'object_row_missing'
          end,
          'reason', case
            when v_section is null and v_block is null
              and (select count(*) from public.properties p where p.apartment_number = v_apt) > 1
            then 'section_code_required_for_disambiguation'
            else 'object_row_missing'
          end,
          'severity', 'error',
          'apartment_number', v_apt,
          'section_code', v_section,
          'block_code', v_block,
          'hint', 'fill_section_code'
        ));
      end if;
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_property_book: apply aborted - % errors', jsonb_array_length(v_errors)
      using errcode = 'P0001',
            detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'warnings', v_warnings,
    'existing_properties', v_existing,
    'new_properties', v_new_props,
    'changes', v_changes,
    'duplicates', v_duplicates,
    'requires_create_confirmation', jsonb_array_length(v_new_props) > 0 and not v_book_empty,
    'requires_overwrite_confirmation', jsonb_array_length(v_changes) > 0,
    'allow_create_missing', v_allow_create,
    'allow_overwrite', coalesce(p_allow_overwrite, false),
    'book_empty_auto_create', v_book_empty,
    'expected_apartment_count', v_expected_count,
    'unique_apartment_count', v_unique_count,
    'found_apartment_count', v_unique_count,
    'object_row_count', jsonb_array_length(p_objects),
    'error_row_count', jsonb_array_length(v_errors),
    'touched_property_ids', to_jsonb(v_touched),
    'created_property_ids', to_jsonb(v_created),
    'skipped_identical_property_ids', to_jsonb(v_skipped_identical),
    'complete_count', v_ok_count,
    'importable_count', v_importable_count,
    'clarification_count', v_clarification_count,
    'blocking_error_count', jsonb_array_length(v_errors)
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) to service_role;

revoke all on function public.property_book_object_identity_key(text, text, text) from public, anon;
grant execute on function public.property_book_object_identity_key(text, text, text) to authenticated;
grant execute on function public.property_book_object_identity_key(text, text, text) to service_role;

revoke all on function public.property_book_parse_decimal(text) from public, anon;
grant execute on function public.property_book_parse_decimal(text) to authenticated;
grant execute on function public.property_book_parse_decimal(text) to service_role;

-- Same apartment number may exist in different entrances/blocks; not twice in one place.
create unique index if not exists properties_apartment_section_block_uidx
  on public.properties (
    lower(btrim(apartment_number)),
    lower(coalesce(nullif(btrim(section_code), ''), '')),
    lower(coalesce(nullif(btrim(block_code), ''), ''))
  );

