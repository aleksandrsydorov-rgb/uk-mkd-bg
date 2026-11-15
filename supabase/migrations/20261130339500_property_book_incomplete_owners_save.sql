-- Allow saving incomplete / identity-only Property Book owner drafts.
-- Soft clarification replaces hard "not creatable"; drafts get voting_eligible=false.
-- Identity-only rows create one stub only when the apartment has no active owners.
-- Re-import of identity-only must not wipe existing owners.

-- 1) Relax name CHECKs so draft natural/legal rows can be stored incomplete.
alter table public.property_registry_people
  drop constraint if exists property_registry_people_natural_name_chk;
alter table public.property_registry_people
  drop constraint if exists property_registry_people_legal_name_chk;

-- Keep entity_kind domain; empty kind is coerced to natural_person on insert.
alter table public.property_registry_people
  drop constraint if exists property_registry_people_entity_chk;
alter table public.property_registry_people
  add constraint property_registry_people_entity_chk
  check (entity_kind = any (array['natural_person'::text, 'legal_entity'::text, 'sole_trader'::text]));

-- 2) Saveable owners: keep incomplete rows (and identity stubs), not only fully named ones.
create or replace function public.property_book_owner_row_has_payload(p_own jsonb)
returns boolean
language sql
immutable
as $fn$
  select
    nullif(btrim(coalesce(p_own ->> 'entity_kind', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'first_name', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'last_name', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'entity_name', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'eik_bulstat', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'email', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'phone', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'phone_secondary', '')), '') is not null
    or nullif(btrim(coalesce(p_own ->> 'ownership_share_percent', '')), '') is not null;
    -- middle_name intentionally ignored (fully optional; alone does not make a payload)
$fn$;

revoke all on function public.property_book_owner_row_has_payload(jsonb) from public, anon;
grant execute on function public.property_book_owner_row_has_payload(jsonb) to authenticated, service_role;

-- Keep legacy name for callers; now returns ALL owner rows (incomplete included).
create or replace function public.property_book_filter_creatable_owners(p_owners jsonb)
returns jsonb
language plpgsql
stable
set search_path to ''
as $fn$
declare
  v_own jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    return '[]'::jsonb;
  end if;
  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    -- Drop fully empty objects (no apartment identity either is handled upstream).
    v_out := v_out || jsonb_build_array(v_own);
  end loop;
  return v_out;
end;
$fn$;

-- 3) Validation: no ownership_identity_incomplete; soft field warns; owners_required for empty set.
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
  v_payload_n integer := 0;
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
    if public.property_book_owner_row_has_payload(v_own) then
      v_payload_n := v_payload_n + 1;
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
      -- Infer side for mixed check when names hint a person/org.
      if nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is not null
         or nullif(btrim(coalesce(v_own ->> 'eik_bulstat', '')), '') is not null then
        v_legal_n := v_legal_n + 1;
      elsif nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is not null
         or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is not null then
        v_natural_n := v_natural_n + 1;
        if nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null then
          v_soft := array_append(v_soft, 'natural_name_required');
        end if;
      end if;
    else
      v_hard := array_append(v_hard, 'invalid_entity_kind');
    end if;
  end loop;

  if v_owner_n = 0 then
    v_soft := array_append(v_soft, 'owners_required');
  elsif v_payload_n = 0 then
    -- Identity-only stubs: one clarify message, not "cannot create".
    v_soft := array_append(v_soft, 'owners_required');
  end if;

  if v_owner_n > 0 and v_payload_n > 0 then
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
    'creatable_owner_count', v_payload_n,
    'share_sum', v_share_sum,
    'ideal_sum', 0
  );
end;
$fn$;

-- 4) Replace owners: allow incomplete; default entity_kind; voting_eligible=false for drafts;
--    identity-only payload does not wipe existing owners.
create or replace function public.admin_replace_property_book_owners(p_property_id bigint, p_owners jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_old_emails text[];
  v_payload_legal integer := 0;
  v_payload_natural integer := 0;
  v_before_composition text;
  v_prev jsonb;
  v_prev_owners jsonb := '[]'::jsonb;
  v_phone text;
  v_phone_secondary text;
  v_email text;
  v_existing_n integer := 0;
  v_payload_n integer := 0;
  v_owner_n integer := 0;
  v_all_identity_only boolean := true;
  v_share numeric;
  v_eligible boolean;
  v_first text;
  v_last text;
  v_ename text;
  v_ideal numeric;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_replace_property_book_owners: not found'
      using errcode = 'P0002';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_replace_property_book_owners: owners array required'
      using errcode = '22023';
  end if;

  select count(*)::integer into v_existing_n
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_owner_n := v_owner_n + 1;
    if public.property_book_owner_row_has_payload(v_item) then
      v_payload_n := v_payload_n + 1;
      v_all_identity_only := false;
    end if;
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind = 'legal_entity' then
      v_payload_legal := v_payload_legal + 1;
    elsif v_kind in ('natural_person', 'sole_trader') then
      v_payload_natural := v_payload_natural + 1;
    elsif v_kind is null then
      if nullif(btrim(coalesce(v_item ->> 'entity_name', '')), '') is not null then
        v_payload_legal := v_payload_legal + 1;
      elsif nullif(btrim(coalesce(v_item ->> 'first_name', '')), '') is not null
         or nullif(btrim(coalesce(v_item ->> 'last_name', '')), '') is not null then
        v_payload_natural := v_payload_natural + 1;
      end if;
    end if;
  end loop;

  -- Identity-only file rows must not wipe / stack stubs on apartments that already have owners.
  if v_owner_n > 0 and v_all_identity_only and v_existing_n > 0 then
    return public.admin_get_property_book(p_property_id);
  end if;

  v_before_composition := public.property_ownership_composition(p_property_id);
  if v_payload_legal > 0 and v_payload_natural > 0
     and v_before_composition is distinct from 'mixed' then
    raise exception 'ownership: mixed natural and legal entity is not supported'
      using errcode = '22023';
  end if;
  if v_before_composition = 'mixed' then
    perform set_config('app.property_book_allow_existing_mixed', 'on', true);
  end if;

  select coalesce(array_agg(lower(btrim(r.email))), array[]::text[])
    into v_old_emails
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and nullif(btrim(coalesce(r.email, '')), '') is not null;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
    into v_prev_owners
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;

  update public.property_registry_people as r
     set deregistered_at = coalesce(r.deregistered_at, current_date),
         updated_at = now()
   where r.property_id = p_property_id
     and r.relation_type = 'owner'
     and r.deregistered_at is null;

  -- Identity-only → exactly one empty draft stub.
  if v_all_identity_only then
    insert into public.property_registry_people (
      property_id, relation_type, entity_kind,
      first_name, middle_name, last_name, entity_name, eik_bulstat, email,
      phone, phone_secondary,
      ownership_share_percent, ideal_parts_percent,
      registered_at, lives_on_property, voting_eligible, admin_status
    ) values (
      p_property_id, 'owner', 'natural_person',
      null, null, null, null, null, null,
      null, null,
      null, null,
      current_date, null, false, 'active'
    );
  else
    for v_item in select value from jsonb_array_elements(p_owners) as t(value)
    loop
      -- Mixed payload+identity rows: keep payload only (do not stack empty stubs).
      if not public.property_book_owner_row_has_payload(v_item) then
        continue;
      end if;

      v_kind := lower(nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), ''));
      if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
        if nullif(btrim(coalesce(v_item ->> 'entity_name', '')), '') is not null
           or nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), '') is not null then
          v_kind := 'legal_entity';
        else
          v_kind := 'natural_person';
        end if;
      end if;

      v_email := lower(nullif(btrim(coalesce(v_item ->> 'email', '')), ''));
      v_first := nullif(btrim(coalesce(v_item ->> 'first_name', '')), '');
      v_last := nullif(btrim(coalesce(v_item ->> 'last_name', '')), '');
      v_ename := nullif(btrim(coalesce(v_item ->> 'entity_name', '')), '');

      select x.value into v_prev
      from jsonb_array_elements(v_prev_owners) as x(value)
      where (
          v_email is not null
          and lower(btrim(coalesce(x.value ->> 'email', ''))) = v_email
        )
         or (
          v_email is null
          and (x.value ->> 'entity_kind') = v_kind
          and coalesce(nullif(btrim(coalesce(x.value ->> 'first_name', '')), ''), '')
              = coalesce(v_first, '')
          and coalesce(nullif(btrim(coalesce(x.value ->> 'last_name', '')), ''), '')
              = coalesce(v_last, '')
          and coalesce(nullif(btrim(coalesce(x.value ->> 'entity_name', '')), ''), '')
              = coalesce(v_ename, '')
        )
      order by (x.value ->> 'id')::bigint
      limit 1;
      if not found then
        v_prev := null;
      end if;

      if v_item ? 'phone' then
        v_phone := nullif(btrim(coalesce(v_item ->> 'phone', '')), '');
      elsif v_prev is not null then
        v_phone := nullif(btrim(coalesce(v_prev ->> 'phone', '')), '');
      else
        v_phone := null;
      end if;

      if v_item ? 'phone_secondary' then
        v_phone_secondary := nullif(btrim(coalesce(v_item ->> 'phone_secondary', '')), '');
      elsif v_prev is not null then
        v_phone_secondary := nullif(btrim(coalesce(v_prev ->> 'phone_secondary', '')), '');
      else
        v_phone_secondary := null;
      end if;

      begin
        v_share := nullif(btrim(coalesce(v_item ->> 'ownership_share_percent', '')), '')::numeric;
      exception when others then
        v_share := null;
      end;
      begin
        if v_item ? 'ideal_parts_percent'
           and nullif(btrim(coalesce(v_item ->> 'ideal_parts_percent', '')), '') is not null then
          v_ideal := nullif(btrim(v_item ->> 'ideal_parts_percent'), '')::numeric;
        elsif v_prev is not null then
          v_ideal := nullif(btrim(coalesce(v_prev ->> 'ideal_parts_percent', '')), '')::numeric;
        else
          v_ideal := null;
        end if;
      exception when others then
        v_ideal := null;
      end;

      -- Drafts: no cabinet access / vote until complete (access_ready also gates portal).
      v_eligible :=
        v_email is not null
        and position('@' in v_email) > 0
        and v_share is not null and v_share > 0
        and (
          (v_kind = 'natural_person' and v_first is not null and v_last is not null)
          or (v_kind = 'legal_entity' and v_ename is not null
              and nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), '') is not null)
          or (v_kind = 'sole_trader' and (
                v_ename is not null or (v_first is not null and v_last is not null)
              ))
        );

      insert into public.property_registry_people (
        property_id, relation_type, entity_kind,
        first_name, middle_name, last_name, entity_name, eik_bulstat, email,
        phone, phone_secondary,
        ownership_share_percent, ideal_parts_percent,
        registered_at, lives_on_property, voting_eligible, admin_status
      ) values (
        p_property_id,
        'owner',
        v_kind,
        v_first,
        nullif(btrim(coalesce(v_item ->> 'middle_name', '')), ''),
        v_last,
        v_ename,
        nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), ''),
        v_email,
        v_phone,
        v_phone_secondary,
        v_share,
        v_ideal,
        current_date,
        null,
        v_eligible,
        'active'
      );
    end loop;
  end if;

  update public.property_access_invites as i
     set status = 'expired'
   where i.property_id = p_property_id
     and i.status = 'pending'
     and not exists (
       select 1
       from public.property_registry_people as r
       where r.property_id = p_property_id
         and r.relation_type = 'owner'
         and r.deregistered_at is null
         and lower(btrim(coalesce(r.email, ''))) = lower(btrim(i.email))
     );

  perform set_config('app.property_book_allow_existing_mixed', 'off', true);
  perform public.property_book_sync_portal_owner_fields(p_property_id);

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_replace_property_book_owners(bigint, jsonb) from public, anon;
grant execute on function public.admin_replace_property_book_owners(bigint, jsonb) to authenticated;
grant execute on function public.admin_replace_property_book_owners(bigint, jsonb) to service_role;

-- Access-ready: require share (vote weight = apt ideal × share); do not require owner ideal_parts.
create or replace function public.property_book_owner_row_access_ready(
  p_owner public.property_registry_people
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_prop public.properties%rowtype;
begin
  if p_owner.relation_type is distinct from 'owner' then
    return false;
  end if;
  if p_owner.deregistered_at is not null then
    return false;
  end if;
  if coalesce(p_owner.voting_eligible, false) is not true then
    return false;
  end if;
  if nullif(btrim(coalesce(p_owner.email, '')), '') is null
     or position('@' in p_owner.email) = 0 then
    return false;
  end if;
  if p_owner.ownership_share_percent is null or p_owner.ownership_share_percent <= 0 then
    return false;
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = p_owner.property_id;
  if not found then
    return false;
  end if;
  if v_prop.ideal_parts_percent is null then
    return false;
  end if;
  if v_prop.ownership_type is null
     or v_prop.ownership_type not in ('sole', 'shared') then
    return false;
  end if;

  if p_owner.entity_kind = 'legal_entity' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null then
      return false;
    end if;
    if nullif(btrim(coalesce(p_owner.eik_bulstat, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'natural_person' then
    if nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
       or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'sole_trader' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null
       and (
         nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
         or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null
       ) then
      return false;
    end if;
  else
    return false;
  end if;

  return true;
end;
$fn$;
