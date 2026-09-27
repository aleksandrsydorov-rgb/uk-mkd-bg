-- Book import: create missing apartments from Excel (was hard error apartment_not_found).

begin;

create or replace function public.admin_import_property_book(
  p_objects jsonb,
  p_owners jsonb,
  p_dry_run boolean default true
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
  v_touched bigint[] := array[]::bigint[];
  v_created bigint[] := array[]::bigint[];
  v_owners_by_apt jsonb := '{}'::jsonb;
  v_list jsonb;
  v_validation jsonb;
  v_ok_count integer := 0;
  v_purpose text;
  v_area numeric;
  v_ideal numeric;
  v_own_type text;
  v_floor bigint;
  v_created_flag boolean;
begin
  perform public.admin_assert_book_admin();
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'admin_import_property_book: objects array required'
      using errcode = '22023';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_import_property_book: owners array required'
      using errcode = '22023';
  end if;

  -- group owners by apartment_number
  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_apt := nullif(btrim(coalesce(v_own ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'code', 'apartment_number_required', 'row', v_own
      ));
      continue;
    end if;
    v_list := coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb);
    v_owners_by_apt := jsonb_set(
      v_owners_by_apt,
      array[v_apt],
      v_list || jsonb_build_array(v_own)
    );
  end loop;

  for v_obj in select value from jsonb_array_elements(p_objects) as t(value)
  loop
    v_created_flag := false;
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_required', 'row', v_obj
      ));
      continue;
    end if;

    begin
      v_apt_num := v_apt::bigint;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'code', 'apartment_number_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;

    v_purpose := nullif(btrim(coalesce(v_obj ->> 'purpose', '')), '');
    begin
      v_area := nullif(btrim(coalesce(v_obj ->> 'area_sqm', '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'area_sqm_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;
    begin
      v_ideal := nullif(btrim(coalesce(v_obj ->> 'ideal_parts_percent', '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'ideal_parts_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;
    v_own_type := nullif(btrim(coalesce(v_obj ->> 'ownership_type', '')), '');
    if v_own_type is not null and v_own_type not in ('sole', 'shared') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'ownership_type_invalid', 'apartment_number', v_apt
      ));
      continue;
    end if;

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt_num
    limit 1;

    if v_prop_id is null then
      -- Create missing apartment from Excel row
      begin
        v_floor := nullif(btrim(coalesce(v_obj ->> 'floor', '')), '')::bigint;
      exception when others then
        v_floor := null;
      end;
      if v_floor is null then
        v_floor := case
          when v_apt_num between 1 and 99 then 1
          else greatest(1, (v_apt_num / 100)::bigint)
        end;
      end if;

      if p_dry_run then
        -- dry-run: pretend create succeeded for further owner checks
        v_created_flag := true;
        v_prop_id := -v_apt_num; -- synthetic id for touched list only
      else
        insert into public.properties (
          apartment_number,
          floor,
          area_sqm,
          purpose,
          ideal_parts_percent,
          ownership_type,
          status
        ) values (
          v_apt_num,
          v_floor,
          v_area,
          v_purpose,
          v_ideal,
          v_own_type,
          'vacant'
        )
        returning id into v_prop_id;
        v_created := array_append(v_created, v_prop_id);
        v_created_flag := true;
      end if;
    end if;

    if not p_dry_run then
      perform public.admin_upsert_property_book_object(
        v_prop_id,
        v_purpose,
        v_area,
        v_ideal,
        v_own_type,
        v_obj ->> 'ideal_parts_source'
      );
      perform public.admin_replace_property_book_owners(
        v_prop_id,
        coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
      );

      -- Keep legacy owner_email in sync with first book owner email (if any)
      update public.properties as p
         set owner_email = coalesce(
               (
                 select nullif(btrim(o ->> 'email'), '')
                 from jsonb_array_elements(coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)) as o
                 where nullif(btrim(o ->> 'email'), '') is not null
                 limit 1
               ),
               p.owner_email
             ),
             owner_name = coalesce(
               (
                 select nullif(
                   btrim(concat_ws(' ',
                     nullif(btrim(o ->> 'first_name'), ''),
                     nullif(btrim(o ->> 'last_name'), ''),
                     nullif(btrim(o ->> 'entity_name'), '')
                   )),
                   ''
                 )
                 from jsonb_array_elements(coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)) as o
                 limit 1
               ),
               p.owner_name
             )
       where p.id = v_prop_id;
    end if;

    if p_dry_run then
      if coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) = 0 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'owners',
          'code', 'owners_required',
          'apartment_number', v_apt
        ));
      end if;
      if v_purpose is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects', 'code', 'purpose_required', 'apartment_number', v_apt
        ));
      end if;
      if v_area is null or v_area <= 0 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects', 'code', 'area_required', 'apartment_number', v_apt
        ));
      end if;
      if v_ideal is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects', 'code', 'object_ideal_parts_required', 'apartment_number', v_apt
        ));
      end if;
      if v_own_type is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects', 'code', 'ownership_type_required', 'apartment_number', v_apt
        ));
      end if;
    else
      v_validation := public.property_book_validate(v_prop_id);
      if not coalesce((v_validation ->> 'ok')::boolean, false) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'validation',
          'apartment_number', v_apt,
          'property_id', v_prop_id,
          'codes', v_validation -> 'errors'
        ));
      else
        v_ok_count := v_ok_count + 1;
      end if;
    end if;

    if v_prop_id is not null and v_prop_id > 0 then
      v_touched := array_append(v_touched, v_prop_id);
    end if;

    -- silence unused warning for dry-run create flag in older analyzers
    if v_created_flag and p_dry_run then
      null;
    end if;
  end loop;

  for v_apt in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_objects) as o(value)
      where btrim(coalesce(o.value ->> 'apartment_number', '')) = v_apt
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners',
        'code', 'object_row_missing',
        'apartment_number', v_apt
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'touched_property_ids', to_jsonb(v_touched),
    'created_property_ids', to_jsonb(v_created),
    'complete_count', v_ok_count
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from public;
revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean) to authenticated;

commit;
