-- Owners first-run: do not invent entity_kind=natural_person (or share 100%).
-- Draft / clarification rows may store null entity_kind; access_ready already rejects null kind.

alter table public.property_registry_people
  alter column entity_kind drop default;

alter table public.property_registry_people
  alter column entity_kind drop not null;

alter table public.property_registry_people
  drop constraint if exists property_registry_people_entity_chk;

alter table public.property_registry_people
  add constraint property_registry_people_entity_chk
  check (
    entity_kind is null
    or entity_kind = any (array['natural_person'::text, 'legal_entity'::text, 'sole_trader'::text])
  );

do $patch$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select replace(
    pg_get_functiondef('public.admin_replace_property_book_owners(bigint,jsonb)'::regprocedure),
    E'\r\n',
    E'\n'
  ) into v_def;
  if v_def is null then
    raise exception 'admin_replace_property_book_owners not found';
  end if;

  if position('Do not invent natural_person' in v_def) > 0 then
    raise notice 'admin_replace_property_book_owners: no-auto-defaults already applied';
    return;
  end if;

  v_old := $old$
      v_kind := lower(nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), ''));
      if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
        if nullif(btrim(coalesce(v_item ->> 'entity_name', '')), '') is not null
           or nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), '') is not null then
          v_kind := 'legal_entity';
        else
          v_kind := 'natural_person';
        end if;
      end if;
$old$;

  v_new := $new$
      -- Do not invent natural_person / legal_entity when the file omits the type.
      v_kind := lower(nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), ''));
      if v_kind is not null and v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
        v_kind := null;
      end if;
$new$;

  if position(v_old in v_def) = 0 then
    raise exception 'admin_replace_property_book_owners: entity_kind coercion block not found';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old2$
      p_property_id, 'owner', 'natural_person',
      null, null, null, null, null, null,
$old2$;
  v_new := $new2$
      p_property_id, 'owner', null,
      null, null, null, null, null, null,
$new2$;

  if position(v_old in v_def) = 0 then
    raise exception 'admin_replace_property_book_owners: identity stub natural_person not found';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old3$
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
$old3$;
  v_new := $new3$
      v_eligible :=
        v_kind is not null
        and v_email is not null
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
$new3$;

  if position(v_old in v_def) = 0 then
    raise exception 'admin_replace_property_book_owners: eligible block not found';
  end if;
  v_def := replace(v_def, v_old, v_new);

  execute v_def;
end;
$patch$;

-- Mixed person+org without ownership_type: soft clarify (kinds optional in new template).
-- Keep hard block only for sole + mixed.
do $patch_validate$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select replace(
    pg_get_functiondef(
      'public.property_book_validate_owners_payload(text,numeric,numeric,text,jsonb)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ) into v_def;
  if v_def is null then
    raise exception 'property_book_validate_owners_payload not found';
  end if;

  if position('Keep a soft clarify when both sides appear without an ownership_type' in v_def) > 0 then
    raise notice 'property_book_validate_owners_payload: mixed soft patch already applied';
    return;
  end if;

  v_old := $old$
  if v_owner_n > 0 and v_payload_n > 0 then
    if v_legal_n > 0 and v_natural_n > 0 then
      v_hard := array_append(v_hard, 'mixed_natural_legal_forbidden');
    end if;
$old$;

  v_new := $new$
  if v_owner_n > 0 and v_payload_n > 0 then
    -- Mixed person+org is allowed on the simplified owners template (kinds/shares optional).
    -- Keep a soft clarify when both sides appear without an ownership_type declaration.
    if v_legal_n > 0 and v_natural_n > 0 and v_own_type = '' then
      v_soft := array_append(v_soft, 'entity_kind_required');
    elsif v_legal_n > 0 and v_natural_n > 0 and v_own_type = 'sole' then
      v_hard := array_append(v_hard, 'mixed_natural_legal_forbidden');
    end if;
$new$;

  if position(v_old in v_def) = 0 then
    raise exception 'property_book_validate_owners_payload: mixed block not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch_validate$;

-- Allow creating person+org owner drafts (clarification) without a prior mixed composition.
do $patch_mixed_raise$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select replace(
    pg_get_functiondef('public.admin_replace_property_book_owners(bigint,jsonb)'::regprocedure),
    E'\r\n',
    E'\n'
  ) into v_def;
  if v_def is null then
    raise exception 'admin_replace_property_book_owners not found';
  end if;
  if position('Simplified owners import may create person+org drafts' in v_def) > 0 then
    raise notice 'admin_replace_property_book_owners: mixed raise already softened';
    return;
  end if;

  v_old := $old$
  v_before_composition := public.property_ownership_composition(p_property_id);
  if v_payload_legal > 0 and v_payload_natural > 0
     and v_before_composition is distinct from 'mixed' then
    raise exception 'ownership: mixed natural and legal entity is not supported'
      using errcode = '22023';
  end if;
  if v_before_composition = 'mixed' then
    perform set_config('app.property_book_allow_existing_mixed', 'on', true);
  end if;
$old$;

  v_new := $new$
  v_before_composition := public.property_ownership_composition(p_property_id);
  -- Simplified owners import may create person+org drafts without ownership_type.
  -- Allow mixed composition; sync helpers still gate access_ready until complete.
  if v_payload_legal > 0 and v_payload_natural > 0 then
    perform set_config('app.property_book_allow_existing_mixed', 'on', true);
  elsif v_before_composition = 'mixed' then
    perform set_config('app.property_book_allow_existing_mixed', 'on', true);
  end if;
$new$;

  if position(v_old in v_def) = 0 then
    raise exception 'admin_replace_property_book_owners: mixed raise block not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch_mixed_raise$;
