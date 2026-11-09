-- Property Book: optional owner phone (text) + portal mirror to properties.owner_phone.
-- Phone must keep leading + / zeros; never stored as numeric.

begin;

alter table public.property_registry_people
  add column if not exists phone text;

comment on column public.property_registry_people.phone is
  'Optional contact phone for the Book person (plain text; preserves + and leading zeros).';

create or replace function public.property_book_sync_portal_owner_fields(p_property_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner public.property_registry_people%rowtype;
  v_name text;
begin
  perform public.property_book_set_mutating(true);

  select r.* into v_owner
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id
  limit 1;

  if not found then
    update public.properties as p
       set owner_email = null,
           owner_name = null,
           owner_phone = null
     where p.id = p_property_id;
    return;
  end if;

  if v_owner.entity_kind in ('legal_entity', 'sole_trader') then
    v_name := nullif(btrim(coalesce(v_owner.entity_name, '')), '');
  else
    v_name := nullif(btrim(concat_ws(' ',
      nullif(btrim(coalesce(v_owner.first_name, '')), ''),
      nullif(btrim(coalesce(v_owner.middle_name, '')), ''),
      nullif(btrim(coalesce(v_owner.last_name, '')), '')
    )), '');
  end if;

  update public.properties as p
     set owner_email = lower(nullif(btrim(coalesce(v_owner.email, '')), '')),
         owner_name = v_name,
         owner_phone = nullif(btrim(coalesce(v_owner.phone, '')), ''),
         owner_type = case
           when v_owner.entity_kind = 'legal_entity' then 'юридическое лицо'
           when v_owner.entity_kind = 'sole_trader' then 'ЕТ'
           else 'физическое лицо'
         end,
         company_name = case
           when v_owner.entity_kind in ('legal_entity', 'sole_trader')
             then nullif(btrim(coalesce(v_owner.entity_name, '')), '')
           else p.company_name
         end
   where p.id = p_property_id;
end;
$fn$;

create or replace function public.admin_replace_property_book_owners(
  p_property_id bigint,
  p_owners jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_old_emails text[];
  v_payload_legal integer := 0;
  v_payload_natural integer := 0;
  v_before_composition text;
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

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind = 'legal_entity' then
      v_payload_legal := v_payload_legal + 1;
    elsif v_kind in ('natural_person', 'sole_trader') then
      v_payload_natural := v_payload_natural + 1;
    end if;
  end loop;

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

  update public.property_registry_people as r
     set deregistered_at = coalesce(r.deregistered_at, current_date),
         updated_at = now()
   where r.property_id = p_property_id
     and r.relation_type = 'owner'
     and r.deregistered_at is null;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
      raise exception 'admin_replace_property_book_owners: invalid entity_kind'
        using errcode = '22023';
    end if;
    insert into public.property_registry_people (
      property_id, relation_type, entity_kind,
      first_name, middle_name, last_name, entity_name, eik_bulstat, email, phone,
      ownership_share_percent, ideal_parts_percent,
      registered_at, lives_on_property
    ) values (
      p_property_id,
      'owner',
      v_kind,
      nullif(btrim(coalesce(v_item ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'middle_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'entity_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), ''),
      lower(nullif(btrim(coalesce(v_item ->> 'email', '')), '')),
      nullif(btrim(coalesce(v_item ->> 'phone', '')), ''),
      nullif(v_item ->> 'ownership_share_percent', '')::numeric,
      nullif(v_item ->> 'ideal_parts_percent', '')::numeric,
      current_date,
      null
    );
  end loop;

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

create or replace function public.admin_get_property_book(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
  v_owners jsonb;
begin
  perform public.admin_assert_book_admin();
  select p.* into v_prop
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    raise exception 'admin_get_property_book: not found'
      using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_owners
  from public.property_book_active_owners(p_property_id) as o;

  return jsonb_build_object(
    'property', jsonb_build_object(
      'id', v_prop.id,
      'apartment_number', v_prop.apartment_number,
      'floor', v_prop.floor,
      'section_code', v_prop.section_code,
      'block_code', v_prop.block_code,
      'purpose', v_prop.purpose,
      'area_sqm', v_prop.area_sqm,
      'ideal_parts_percent', v_prop.ideal_parts_percent,
      'ideal_parts_source', v_prop.ideal_parts_source,
      'ideal_parts_note', v_prop.ideal_parts_note,
      'ideal_parts_meeting_ref', v_prop.ideal_parts_meeting_ref,
      'ownership_type', v_prop.ownership_type,
      'owner_email', v_prop.owner_email,
      'owner_name', v_prop.owner_name,
      'owner_phone', v_prop.owner_phone
    ),
    'owners', v_owners,
    'validation', public.property_book_validate(p_property_id)
  );
end;
$fn$;

revoke all on function public.admin_get_property_book(bigint) from public, anon;
grant execute on function public.admin_get_property_book(bigint) to authenticated;

commit;
