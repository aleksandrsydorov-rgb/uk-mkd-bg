-- =============================================================================
-- R1-RC8 — Property Book: allow shared natural + legal co-ownership
-- =============================================================================
-- Initial Setup commit of property_book_opening_55_TEST.xlsx rolled back because
-- property_book_validate rejected apartments with ownership_type=shared and
-- owners natural_person + legal_entity (mixed_natural_legal_forbidden /
-- shared_legal_forbidden). Preview skipped that server validation, so UI showed
-- CREATE / 0 errors then failed on commit with a generic message.
--
-- This migration:
--   1) Allows shared ownership with natural/sole_trader + at most one legal
--      (keeps multiple_legal_forbidden, share/ideal sums, sole rules).
--   2) Adds property_book_validate_owners_payload for dry-run parity.
--   3) Runs that payload check inside admin_import_property_book before write.
--   4) Blocks property_book → READY/ACTIVE when public.properties is empty;
--      demotes empty READY/ACTIVE back to SETUP_REQUIRED (no object wipe).
-- Does NOT enable Rental. Does NOT reset Book rows.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Shared validation core (DB row + import payload)
-- ---------------------------------------------------------------------------
create or replace function public.property_book_validate_owners_payload(
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_owners jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_errors text[] := array[]::text[];
  v_own jsonb;
  v_share_sum numeric := 0;
  v_ideal_sum numeric := 0;
  v_natural_n integer := 0;
  v_legal_n integer := 0;
  v_owner_n integer := 0;
  v_kind text;
  v_share numeric;
  v_ideal numeric;
  v_own_type text := lower(btrim(coalesce(p_ownership_type, '')));
  v_prop_ideal numeric := p_ideal_parts_percent;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('owners_required'),
      'owner_count', 0,
      'share_sum', 0,
      'ideal_sum', 0
    );
  end if;

  if nullif(btrim(coalesce(p_purpose, '')), '') is null then
    v_errors := array_append(v_errors, 'purpose_required');
  end if;
  if p_area_sqm is null or p_area_sqm <= 0 then
    v_errors := array_append(v_errors, 'area_required');
  end if;
  if v_prop_ideal is null then
    v_errors := array_append(v_errors, 'object_ideal_parts_required');
  end if;
  if v_own_type is null or v_own_type not in ('sole', 'shared') then
    v_errors := array_append(v_errors, 'ownership_type_required');
  end if;

  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_owner_n := v_owner_n + 1;
    begin
      v_share := nullif(btrim(coalesce(v_own ->> 'ownership_share_percent', '')), '')::numeric;
    exception when others then
      v_share := null;
    end;
    if v_share is null or v_share <= 0 then
      v_errors := array_append(v_errors, 'owner_share_required');
    else
      v_share_sum := v_share_sum + v_share;
    end if;

    begin
      v_ideal := nullif(btrim(coalesce(v_own ->> 'ideal_parts_percent', '')), '')::numeric;
    exception when others then
      v_ideal := null;
    end;
    if v_ideal is null or v_ideal < 0 then
      v_errors := array_append(v_errors, 'owner_ideal_parts_required');
    else
      v_ideal_sum := v_ideal_sum + v_ideal;
    end if;

    if nullif(btrim(coalesce(v_own ->> 'email', '')), '') is null then
      v_errors := array_append(v_errors, 'owner_email_required');
    end if;

    v_kind := lower(btrim(coalesce(v_own ->> 'entity_kind', '')));
    if v_kind = 'legal_entity' then
      v_legal_n := v_legal_n + 1;
      if nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is null then
        v_errors := array_append(v_errors, 'legal_name_required');
      end if;
      if nullif(btrim(coalesce(v_own ->> 'eik_bulstat', '')), '') is null then
        v_errors := array_append(v_errors, 'eik_required');
      end if;
    elsif v_kind in ('natural_person', 'sole_trader') then
      v_natural_n := v_natural_n + 1;
      if v_kind = 'natural_person'
         and (
           nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null
         ) then
        v_errors := array_append(v_errors, 'natural_name_required');
      end if;
      if v_kind = 'sole_trader'
         and nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is null
         and (
           nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null
         ) then
        v_errors := array_append(v_errors, 'sole_trader_name_required');
      end if;
    else
      v_errors := array_append(v_errors, 'invalid_entity_kind');
    end if;
  end loop;

  if v_owner_n = 0 then
    v_errors := array_append(v_errors, 'owners_required');
  else
    -- Shared may mix natural/sole_trader with at most one legal entity.
    -- Sole remains a single owner (natural OR legal), so mix cannot occur.
    if v_legal_n > 1 then
      v_errors := array_append(v_errors, 'multiple_legal_forbidden');
    end if;

    if v_own_type = 'sole' then
      if v_owner_n <> 1 then
        v_errors := array_append(v_errors, 'sole_requires_one_owner');
      elsif abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'sole_share_must_be_100');
      end if;
      if v_prop_ideal is not null
         and v_owner_n = 1
         and abs(v_ideal_sum - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'sole_ideal_parts_mismatch');
      end if;
      if v_legal_n = 1 and abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'legal_must_own_100');
      end if;
    elsif v_own_type = 'shared' then
      if v_owner_n < 2 then
        v_errors := array_append(v_errors, 'shared_requires_two_owners');
      end if;
      if abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'shares_must_sum_100');
      end if;
      if v_prop_ideal is not null and abs(v_ideal_sum - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'owner_ideal_parts_sum_mismatch');
      end if;
    end if;
  end if;

  select coalesce(array_agg(distinct e), array[]::text[])
    into v_errors
  from unnest(v_errors) as e;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors),
    'owner_count', v_owner_n,
    'share_sum', v_share_sum,
    'ideal_sum', v_ideal_sum
  );
end;
$fn$;

revoke all on function public.property_book_validate_owners_payload(text, numeric, numeric, text, jsonb)
  from public, anon;
grant execute on function public.property_book_validate_owners_payload(text, numeric, numeric, text, jsonb)
  to authenticated;

create or replace function public.property_book_validate(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
  v_owners jsonb := '[]'::jsonb;
begin
  select p.* into v_prop
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('property_not_found'));
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
    into v_owners
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;

  return public.property_book_validate_owners_payload(
    v_prop.purpose,
    v_prop.area_sqm,
    v_prop.ideal_parts_percent,
    v_prop.ownership_type,
    v_owners
  );
end;
$fn$;

revoke all on function public.property_book_validate(bigint) from public;
revoke all on function public.property_book_validate(bigint) from anon;
grant execute on function public.property_book_validate(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Empty book cannot be READY/ACTIVE
-- ---------------------------------------------------------------------------
create or replace function public.admin_transition_module_lifecycle(
  p_module_key text,
  p_to_state text,
  p_reason text default null
)
returns table (
  module_key text,
  state text,
  last_transition_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_from text;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_to text := upper(btrim(coalesce(p_to_state, '')));
  v_object_count bigint;
begin
  perform public.admin_assert_module_setup();

  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  if v_install is null then
    raise exception 'module_setup: installation missing' using errcode = 'P0001';
  end if;

  select ml.state into v_from
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key
  for update;

  if not found then
    insert into public.module_lifecycle (installation_id, module_key, state)
    values (v_install, v_key, 'DISABLED')
    returning public.module_lifecycle.state into v_from;
  end if;

  if not public.module_lifecycle_transition_allowed(v_from, v_to) then
    raise exception 'module_setup: invalid transition % → %', v_from, v_to
      using errcode = '22023';
  end if;

  if v_key = 'property_book' and v_to in ('READY', 'ACTIVE') then
    select count(*)::bigint into v_object_count from public.properties;
    if coalesce(v_object_count, 0) = 0 then
      raise exception 'module_setup: property_book requires at least one object before %', v_to
        using errcode = 'P0001';
    end if;
  end if;

  -- IS-1: lifecycle transitions do NOT mutate building_modules.enabled.
  update public.module_lifecycle as ml
  set
    state = v_to,
    last_transition_at = now(),
    last_transition_by = auth.uid(),
    notes = nullif(btrim(coalesce(p_reason, '')), '')
  where ml.installation_id = v_install
    and ml.module_key = v_key;

  insert into public.module_lifecycle_audit (
    installation_id, module_key, from_state, to_state, actor_uid, actor_email, reason
  ) values (
    v_install, v_key, v_from, v_to, auth.uid(), auth.email(),
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  return query
  select ml.module_key, ml.state, ml.last_transition_at
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key;
end;
$fn$;

revoke all on function public.admin_transition_module_lifecycle(text, text, text) from public, anon;
grant execute on function public.admin_transition_module_lifecycle(text, text, text) to authenticated;

-- Demote empty READY/ACTIVE book (state only; no property wipe).
update public.module_lifecycle as ml
   set state = 'SETUP_REQUIRED',
       last_transition_at = now(),
       notes = 'empty_book_requires_setup'
 where ml.module_key = 'property_book'
   and ml.state in ('READY', 'ACTIVE')
   and not exists (select 1 from public.properties limit 1);

commit;

-- admin_import_property_book (5-arg) with dry-run payload validation — applied after commit
-- so a failure here does not roll back catalog/lifecycle fixes above.

-- ---------------------------------------------------------------------------
-- admin_import_property_book: dry-run runs same ownership validation as commit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_import_property_book(p_objects jsonb, p_owners jsonb, p_dry_run boolean DEFAULT true, p_allow_create_missing boolean DEFAULT false, p_allow_overwrite boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obj jsonb;
  v_own jsonb;
  v_apt text;
  v_apt_num bigint;
  v_prop_id bigint;
  v_errors jsonb := '[]'::jsonb;
  v_existing jsonb := '[]'::jsonb;
  v_new_props jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
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
  v_section text;
  v_block text;
  v_seen_apts text[] := array[]::text[];
  v_prop public.properties%rowtype;
  v_would_create boolean;
  v_would_change boolean;
  v_owner_count int;
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
    v_would_create := false;
    v_would_change := false;
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_required', 'row', v_obj
      ));
      continue;
    end if;

    if v_apt = any (v_seen_apts) then
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'duplicate_apartment', 'apartment_number', v_apt
      ));
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'duplicate_apartment', 'apartment_number', v_apt
      ));
      continue;
    end if;
    v_seen_apts := array_append(v_seen_apts, v_apt);

    begin
      v_apt_num := v_apt::bigint;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'apartment_number_invalid', 'apartment_number', v_apt
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
    v_section := nullif(btrim(coalesce(v_obj ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_obj ->> 'block_code', '')), '');
    begin
      v_floor := nullif(btrim(coalesce(v_obj ->> 'floor', '')), '')::bigint;
    exception when others then
      v_floor := null;
    end;

    select p.* into v_prop
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;

    if not found then
      v_would_create := true;
      v_new_props := v_new_props || jsonb_build_array(jsonb_build_object(
        'apartment_number', v_apt,
        'purpose', v_purpose,
        'area_sqm', v_area,
        'ideal_parts_percent', v_ideal,
        'ownership_type', v_own_type
      ));
      if not coalesce(p_allow_create_missing, false) and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'code', 'create_missing_requires_confirmation',
          'apartment_number', v_apt
        ));
        continue;
      end if;
      if not coalesce(p_allow_create_missing, false) and coalesce(p_dry_run, true) then
        -- preview lists new; apply blocked without confirm
        null;
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
         or (v_ideal is distinct from v_prop.ideal_parts_percent)
         or (v_own_type is distinct from v_prop.ownership_type)
         or (v_section is distinct from v_prop.section_code)
         or (v_block is distinct from v_prop.block_code)
         or (v_floor is distinct from v_prop.floor)
         or coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) <> v_owner_count
         or coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) > 0
      then
        v_would_change := true;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'property_id', v_prop.id,
          'apartment_number', v_apt,
          'object_fields_differ', true,
          'owners_in_file', coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0),
          'active_owners_now', v_owner_count
        ));
      end if;

      if v_would_change
         and not coalesce(p_allow_overwrite, false)
         and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'code', 'overwrite_requires_confirmation',
          'apartment_number', v_apt,
          'property_id', v_prop.id
        ));
        continue;
      end if;
    end if;

    if coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) = 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'code', 'owners_required', 'apartment_number', v_apt
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

    v_validation := public.property_book_validate_owners_payload(
      v_purpose,
      v_area,
      v_ideal,
      v_own_type,
      coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
    );
    if not coalesce((v_validation ->> 'ok')::boolean, false) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'validation',
        'apartment_number', v_apt,
        'codes', v_validation -> 'errors'
      ));
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    -- Apply path (atomic within this function transaction)
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

    perform public.admin_upsert_property_book_object(
      v_prop_id,
      v_purpose,
      v_area,
      v_ideal,
      v_own_type,
      v_obj ->> 'ideal_parts_source',
      v_apt_num,
      v_floor,
      null,
      null,
      v_section,
      v_block
    );
    perform public.admin_replace_property_book_owners(
      v_prop_id,
      coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
    );

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

    v_touched := array_append(v_touched, v_prop_id);
  end loop;

  for v_apt in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_objects) as o(value)
      where btrim(coalesce(o.value ->> 'apartment_number', '')) = v_apt
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'code', 'object_row_missing', 'apartment_number', v_apt
      ));
    end if;
  end loop;

  -- Fail apply atomically if any errors
  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_property_book: apply aborted - % errors', jsonb_array_length(v_errors)
      using errcode = 'P0001',
            detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'existing_properties', v_existing,
    'new_properties', v_new_props,
    'changes', v_changes,
    'duplicates', v_duplicates,
    'requires_create_confirmation', jsonb_array_length(v_new_props) > 0,
    'requires_overwrite_confirmation', jsonb_array_length(v_changes) > 0,
    'allow_create_missing', coalesce(p_allow_create_missing, false),
    'allow_overwrite', coalesce(p_allow_overwrite, false),
    'touched_property_ids', to_jsonb(v_touched),
    'created_property_ids', to_jsonb(v_created),
    'complete_count', v_ok_count
  );
end;
$function$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) to authenticated;


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
begin
  return public.admin_import_property_book(
    p_objects, p_owners, p_dry_run, false, false
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean) to authenticated;

-- apartment_number column is text; upsert historically took bigint � cast for coalesce.
do $fix_upsert$
declare
  def text;
begin
  def := pg_get_functiondef(
    'public.admin_upsert_property_book_object(bigint,text,numeric,numeric,text,text,bigint,bigint,text,text,text,text)'::regprocedure
  );
  if position('coalesce(p_apartment_number::text, p.apartment_number)' in def) > 0 then
    raise notice 'upsert already text-safe';
    return;
  end if;
  if position('apartment_number = coalesce(p_apartment_number, p.apartment_number)' in def) = 0 then
    raise exception 'upsert apartment coalesce pattern not found';
  end if;
  def := replace(
    def,
    'apartment_number = coalesce(p_apartment_number, p.apartment_number)',
    'apartment_number = coalesce(p_apartment_number::text, p.apartment_number)'
  );
  -- pg_get_functiondef omits trailing semicolon sometimes
  if right(btrim(def), 1) <> ';' then
    def := def || ';';
  end if;
  execute def;
end;
$fix_upsert$;
