-- Owners import: stop requiring/summing owner-level ideal_parts_percent.
-- Vote weight = apartment ideal_parts × ownership_share ÷ 100.
-- Legacy owner ideal_parts in XLSX is accepted; does not rewrite apartment ideal parts;
-- documented owner ideal_parts are preserved on replace when the file omits them.
-- Existing meeting snapshots are not recalculated.

create or replace function public.property_book_owner_vote_weight(
  p_apartment_ideal_parts numeric,
  p_ownership_share_percent numeric
)
returns numeric
language sql
immutable
as $fn$
  select case
    when p_apartment_ideal_parts is null then null
    when p_ownership_share_percent is null then null
    when p_ownership_share_percent <= 0 then null
    else round(p_apartment_ideal_parts * p_ownership_share_percent / 100.0, 6)
  end;
$fn$;

revoke all on function public.property_book_owner_vote_weight(numeric, numeric) from public, anon;
grant execute on function public.property_book_owner_vote_weight(numeric, numeric) to authenticated;
grant execute on function public.property_book_owner_vote_weight(numeric, numeric) to service_role;

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
set search_path to ''
as $fn$
declare
  v_hard text[] := array[]::text[];
  v_soft text[] := array[]::text[];
  v_own jsonb;
  v_share_sum numeric := 0;
  v_natural_n integer := 0;
  v_legal_n integer := 0;
  v_owner_n integer := 0;
  v_creatable_n integer := 0;
  v_kind text;
  v_share numeric;
  v_documented numeric;
  v_computed numeric;
  v_own_type text := lower(btrim(coalesce(p_ownership_type, '')));
  v_prop_ideal numeric := p_ideal_parts_percent;
  v_has_any_share boolean := false;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'importable', true,
      'errors', '[]'::jsonb,
      'warnings', jsonb_build_array('owners_required'),
      'owner_count', 0,
      'creatable_owner_count', 0,
      'share_sum', 0,
      'ideal_sum', 0
    );
  end if;

  if nullif(btrim(coalesce(p_purpose, '')), '') is null then
    v_soft := array_append(v_soft, 'purpose_required');
  end if;
  if p_area_sqm is null or p_area_sqm <= 0 then
    v_soft := array_append(v_soft, 'area_required');
  end if;
  if v_prop_ideal is null then
    v_soft := array_append(v_soft, 'object_ideal_parts_required');
  end if;
  if v_own_type is null or v_own_type not in ('sole', 'shared') then
    v_soft := array_append(v_soft, 'ownership_type_required');
  end if;

  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_owner_n := v_owner_n + 1;
    if public.property_book_owner_identity_creatable(v_own) then
      v_creatable_n := v_creatable_n + 1;
    end if;

    begin
      v_share := nullif(btrim(coalesce(v_own ->> 'ownership_share_percent', '')), '')::numeric;
    exception when others then
      v_hard := array_append(v_hard, 'owner_share_invalid');
      v_share := null;
    end;
    if v_share is null or v_share <= 0 then
      v_soft := array_append(v_soft, 'owner_share_required');
    else
      v_has_any_share := true;
      v_share_sum := v_share_sum + v_share;
    end if;

    -- Legacy owner ideal_parts: accept numeric form only; never require.
    begin
      v_documented := nullif(btrim(coalesce(v_own ->> 'ideal_parts_percent', '')), '')::numeric;
    exception when others then
      v_hard := array_append(v_hard, 'owner_ideal_parts_invalid');
      v_documented := null;
    end;
    v_computed := public.property_book_owner_vote_weight(v_prop_ideal, v_share);
    if v_documented is not null and v_computed is not null
       and abs(v_documented - v_computed) > 0.01 then
      v_soft := array_append(v_soft, 'owner_vote_weight_mismatch');
    end if;

    if nullif(btrim(coalesce(v_own ->> 'email', '')), '') is null then
      v_soft := array_append(v_soft, 'owner_email_required');
    end if;

    v_kind := lower(btrim(coalesce(v_own ->> 'entity_kind', '')));
    if v_kind = 'legal_entity' then
      v_legal_n := v_legal_n + 1;
      if nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is null then
        v_soft := array_append(v_soft, 'legal_name_required');
      end if;
      if nullif(btrim(coalesce(v_own ->> 'eik_bulstat', '')), '') is null then
        v_soft := array_append(v_soft, 'eik_required');
      end if;
    elsif v_kind in ('natural_person', 'sole_trader') then
      v_natural_n := v_natural_n + 1;
      if v_kind = 'natural_person'
         and (
           nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null
         ) then
        v_soft := array_append(v_soft, 'natural_name_required');
      end if;
      if v_kind = 'sole_trader'
         and nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is null
         and (
           nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null
         ) then
        v_soft := array_append(v_soft, 'sole_trader_name_required');
      end if;
    elsif v_kind = '' then
      v_soft := array_append(v_soft, 'entity_kind_required');
    else
      v_hard := array_append(v_hard, 'invalid_entity_kind');
    end if;
  end loop;

  if v_owner_n = 0 or v_creatable_n = 0 then
    v_soft := array_append(v_soft, 'owners_required');
    if v_owner_n > 0 and v_creatable_n = 0 then
      v_soft := array_append(v_soft, 'ownership_identity_incomplete');
    end if;
  else
    if v_legal_n > 0 and v_natural_n > 0 then
      v_hard := array_append(v_hard, 'mixed_natural_legal_forbidden');
    end if;

    if v_own_type = 'sole' then
      if v_owner_n <> 1 then
        v_hard := array_append(v_hard, 'sole_requires_one_owner');
      elsif v_has_any_share and abs(v_share_sum - 100) > 0.01 then
        v_hard := array_append(v_hard, 'sole_share_must_be_100');
      end if;
      if v_legal_n = 1 and v_has_any_share and abs(v_share_sum - 100) > 0.01 then
        v_hard := array_append(v_hard, 'legal_must_own_100');
      end if;
    elsif v_own_type = 'shared' then
      if v_owner_n < 2 then
        v_hard := array_append(v_hard, 'shared_requires_two_owners');
      elsif v_creatable_n < 2 then
        v_soft := array_append(v_soft, 'ownership_identity_incomplete');
      end if;
      if v_has_any_share and abs(v_share_sum - 100) > 0.01 then
        v_hard := array_append(v_hard, 'shares_must_sum_100');
      end if;
    end if;
  end if;

  select coalesce(array_agg(distinct e), array[]::text[]) into v_hard from unnest(v_hard) as e;
  select coalesce(array_agg(distinct e), array[]::text[]) into v_soft from unnest(v_soft) as e;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_hard, 1), 0) = 0 and coalesce(array_length(v_soft, 1), 0) = 0,
    'importable', coalesce(array_length(v_hard, 1), 0) = 0,
    'errors', to_jsonb(v_hard),
    'warnings', to_jsonb(v_soft),
    'owner_count', v_owner_n,
    'creatable_owner_count', v_creatable_n,
    'share_sum', v_share_sum,
    'ideal_sum', 0
  );
end;
$fn$;

-- Preserve documented owner ideal_parts on replace when import omits/empties the legacy column.
do $patch_replace$
declare
  v_def text;
  v_old text := $old$
      nullif(v_item ->> 'ownership_share_percent', '')::numeric,
      nullif(v_item ->> 'ideal_parts_percent', '')::numeric,
$old$;
  v_new text := $new$
      nullif(v_item ->> 'ownership_share_percent', '')::numeric,
      case
        when v_item ? 'ideal_parts_percent'
             and nullif(btrim(coalesce(v_item ->> 'ideal_parts_percent', '')), '') is not null
          then nullif(btrim(v_item ->> 'ideal_parts_percent'), '')::numeric
        when v_prev is not null
          then nullif(btrim(coalesce(v_prev ->> 'ideal_parts_percent', '')), '')::numeric
        else null
      end,
$new$;
begin
  select pg_get_functiondef('public.admin_replace_property_book_owners(bigint,jsonb)'::regprocedure)
    into v_def;
  if v_def is null then
    raise exception 'admin_replace_property_book_owners(bigint,jsonb) not found';
  end if;
  if position(v_old in v_def) = 0 then
    if position('v_prev is not null' in v_def) > 0
       and position('ideal_parts_percent' in v_def) > 0 then
      raise notice 'admin_replace_property_book_owners: ideal_parts preserve already present';
      return;
    end if;
    raise exception 'admin_replace_property_book_owners: expected ideal_parts insert args not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch_replace$;

-- Live roster / freeze weight: apt ideal × share / 100 (share unknown → 0).
do $patch_weight$
declare
  v_def text;
  v_old text := 'coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)';
  v_new text := 'coalesce(public.property_book_owner_vote_weight(p.ideal_parts_percent, r.ownership_share_percent), 0)';
  v_proc regprocedure;
begin
  foreach v_proc in array array[
    'public.gm_book_roster_hash()'::regprocedure,
    'public.gm_freeze_notice_snapshot(uuid)'::regprocedure,
    'public.gm_freeze_voting_snapshot(uuid)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_proc) into v_def;
    if v_def is null then
      raise exception '% not found', v_proc;
    end if;
    if position(v_new in v_def) > 0 then
      raise notice '%: vote weight already patched', v_proc;
      continue;
    end if;
    if position(v_old in v_def) = 0 then
      raise exception '%: expected ideal_parts coalesce not found', v_proc;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end;
$patch_weight$;

-- Soft-warning field map in import: owner_vote_weight_mismatch → ownership_share_percent.
do $patch_import_field$
declare
  v_def text;
  v_old text := $old$
            when 'owner_email_required' then 'email'
            when 'owners_required' then 'owners'
$old$;
  v_new text := $new$
            when 'owner_email_required' then 'email'
            when 'owner_vote_weight_mismatch' then 'ownership_share_percent'
            when 'owners_required' then 'owners'
$new$;
begin
  select pg_get_functiondef(
    'public.admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean)'::regprocedure
  ) into v_def;
  if v_def is null then
    raise notice 'admin_import_property_book: not found, skip field map';
    return;
  end if;
  if position('owner_vote_weight_mismatch' in v_def) > 0 then
    raise notice 'admin_import_property_book: vote-weight field map already present';
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise notice 'admin_import_property_book: soft field case block not found, skip';
    return;
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch_import_field$;
