-- Emit soft clarification warnings even when hard errors exist for the same apartment,
-- so preview cards can show both a blocking action and remaining field remarks.
-- Also attach section/block/row on hard owner validation errors.

do $patch$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select replace(
    pg_get_functiondef('public.admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean)'::regprocedure),
    E'\r\n',
    E'\n'
  ) into v_def;
  if v_def is null then
    raise exception 'admin_import_property_book not found';
  end if;

  if position('when v_code in (''invalid_entity_kind''' in v_def) > 0
     and position('elsif jsonb_array_length(v_soft) > 0 then' in v_def) = 0 then
    raise notice 'admin_import_property_book: soft-with-hard patch already applied';
    return;
  end if;

  v_old := $old$
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
          'sheet', case
            when v_code in ('owner_email_required', 'owners_required') then 'owners'
            else 'objects'
          end,
          'row', v_row_no,
          'field', case v_code
            when 'purpose_required' then 'purpose'
            when 'area_required' then 'area_sqm'
            when 'object_ideal_parts_required' then 'ideal_parts_percent'
            when 'ownership_type_required' then 'ownership_type'
            when 'owner_email_required' then 'email'
            when 'owner_vote_weight_mismatch' then 'ownership_share_percent'
            when 'owners_required' then 'owners'
            else 'owners'
          end,
          'apartment_number', v_apt,
          'section_code', v_section,
          'block_code', v_block,
          'code', v_code,
          'reason', v_code,
          'severity', 'warning'
        ));
      end loop;
    end if;
  $old$;

  v_new := $new$
    if jsonb_array_length(v_hard) > 0 then
      for v_code in select jsonb_array_elements_text(v_hard)
      loop
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'owners',
          'row', v_row_no,
          'field', case
            when v_code in ('invalid_entity_kind', 'entity_kind_invalid', 'invalid:entity_kind') then 'entity_kind'
            when v_code in ('ownership_type_invalid', 'invalid_ownership_type', 'invalid:ownership_type') then 'ownership_type'
            else 'owners'
          end,
          'apartment_number', v_apt,
          'section_code', v_section,
          'block_code', v_block,
          'code', v_code,
          'codes', v_hard,
          'reason', v_code,
          'severity', 'error'
        ));
      end loop;
      v_identical := false;
    end if;
    if jsonb_array_length(v_soft) > 0 then
      for v_code in select jsonb_array_elements_text(v_soft)
      loop
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'sheet', case
            when v_code in (
              'owner_email_required', 'owners_required', 'entity_kind_required',
              'owner_share_required', 'natural_name_required', 'legal_name_required',
              'eik_required', 'sole_trader_name_required', 'owner_vote_weight_mismatch'
            ) then 'owners'
            else 'objects'
          end,
          'row', v_row_no,
          'field', case v_code
            when 'purpose_required' then 'purpose'
            when 'area_required' then 'area_sqm'
            when 'object_ideal_parts_required' then 'ideal_parts_percent'
            when 'ownership_type_required' then 'ownership_type'
            when 'owner_email_required' then 'email'
            when 'owner_share_required' then 'ownership_share_percent'
            when 'owner_vote_weight_mismatch' then 'ownership_share_percent'
            when 'entity_kind_required' then 'entity_kind'
            when 'natural_name_required' then 'first_name'
            when 'legal_name_required' then 'entity_name'
            when 'eik_required' then 'eik_bulstat'
            when 'owners_required' then 'owners'
            else 'owners'
          end,
          'apartment_number', v_apt,
          'section_code', v_section,
          'block_code', v_block,
          'code', v_code,
          'reason', v_code,
          'severity', 'warning'
        ));
      end loop;
    end if;
  $new$;

  if position(v_old in v_def) = 0 then
    raise exception 'admin_import_property_book: expected hard/soft elsif block not found';
  end if;

  execute replace(v_def, v_old, v_new);
end;
$patch$;
