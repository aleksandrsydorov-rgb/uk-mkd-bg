-- =============================================================================
-- R1-RC8 fresh-install — Property Book shared natural+legal co-ownership
-- =============================================================================
-- Catalog/validate helpers only (package phase). Full import dry-run parity +
-- empty READY/ACTIVE gate land via chronological
-- 20261124120000_r1_rc8_property_book_shared_mixed_owners.sql.
-- =============================================================================
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


