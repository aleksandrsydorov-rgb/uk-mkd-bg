-- Property change history: log field diffs on properties + owner book rows.

begin;

create table if not exists public.property_change_log (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by_email text null,
  changed_by_uid uuid null,
  source text not null default 'system'
    check (source in (
      'admin_ui',
      'book_ui',
      'book_import',
      'system',
      'trigger'
    )),
  entity text not null default 'property'
    check (entity in ('property', 'owner', 'book')),
  action text not null default 'update'
    check (action in ('insert', 'update', 'delete', 'replace_owners')),
  changes jsonb not null default '{}'::jsonb,
  note text null
);

create index if not exists property_change_log_property_idx
  on public.property_change_log (property_id, changed_at desc);

alter table public.property_change_log enable row level security;

revoke all on table public.property_change_log from public;
revoke all on table public.property_change_log from anon;
revoke all on table public.property_change_log from authenticated;

drop policy if exists property_change_log_admin_select on public.property_change_log;
create policy property_change_log_admin_select
on public.property_change_log
for select
to authenticated
using (public.has_staff_role('администрация'));

grant select on table public.property_change_log to authenticated;

create or replace function public.property_change_actor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(coalesce(auth.email(), '')), '');
$$;

revoke all on function public.property_change_actor_email() from public;
revoke all on function public.property_change_actor_email() from anon;

create or replace function public.property_change_json_diff(p_before jsonb, p_after jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_key text;
  v_out jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  if p_before is null and p_after is null then
    return '{}'::jsonb;
  end if;
  for v_key in
    select distinct k
    from (
      select jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) as k
      union
      select jsonb_object_keys(coalesce(p_after, '{}'::jsonb)) as k
    ) as keys
  loop
    v_old := case when p_before ? v_key then p_before -> v_key else 'null'::jsonb end;
    v_new := case when p_after ? v_key then p_after -> v_key else 'null'::jsonb end;
    if v_old is distinct from v_new then
      v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('old', v_old, 'new', v_new));
    end if;
  end loop;
  return v_out;
end;
$fn$;

revoke all on function public.property_change_json_diff(jsonb, jsonb) from public;

create or replace function public.log_property_change(
  p_property_id bigint,
  p_source text,
  p_entity text,
  p_action text,
  p_changes jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_property_id is null then
    return;
  end if;
  if p_changes is null or p_changes = '{}'::jsonb then
    return;
  end if;
  insert into public.property_change_log (
    property_id, changed_by_email, changed_by_uid, source, entity, action, changes, note
  ) values (
    p_property_id,
    public.property_change_actor_email(),
    auth.uid(),
    coalesce(nullif(btrim(p_source), ''), 'system'),
    coalesce(nullif(btrim(p_entity), ''), 'property'),
    coalesce(nullif(btrim(p_action), ''), 'update'),
    p_changes,
    nullif(btrim(coalesce(p_note, '')), '')
  );
end;
$fn$;

revoke all on function public.log_property_change(bigint, text, text, text, jsonb, text) from public;
revoke all on function public.log_property_change(bigint, text, text, text, jsonb, text) from anon;

-- Snapshot tracked property fields
create or replace function public.property_tracked_snapshot(p public.properties)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'apartment_number', p.apartment_number,
    'floor', p.floor,
    'area_sqm', p.area_sqm,
    'purpose', p.purpose,
    'ideal_parts_percent', p.ideal_parts_percent,
    'ideal_parts_source', p.ideal_parts_source,
    'ideal_parts_note', p.ideal_parts_note,
    'ideal_parts_meeting_ref', p.ideal_parts_meeting_ref,
    'ownership_type', p.ownership_type,
    'status', p.status,
    'occupancy_status', p.occupancy_status,
    'owner_name', p.owner_name,
    'owner_email', p.owner_email,
    'owner_phone', p.owner_phone,
    'owner_type', p.owner_type,
    'company_name', p.company_name,
    'occupant_kind', p.occupant_kind,
    'occupant_name', p.occupant_name,
    'occupant_phone', p.occupant_phone,
    'occupant_email', p.occupant_email,
    'occupant_until', p.occupant_until,
    'pet_info', p.pet_info,
    'electricity_meter_number', p.electricity_meter_number
  ));
$$;

revoke all on function public.property_tracked_snapshot(public.properties) from public;

create or replace function public.properties_change_log_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_diff jsonb;
begin
  if TG_OP = 'UPDATE' then
    v_diff := public.property_change_json_diff(
      public.property_tracked_snapshot(OLD),
      public.property_tracked_snapshot(NEW)
    );
    if v_diff <> '{}'::jsonb then
      perform public.log_property_change(
        NEW.id,
        'trigger',
        'property',
        'update',
        v_diff,
        null
      );
    end if;
    return NEW;
  elsif TG_OP = 'INSERT' then
    perform public.log_property_change(
      NEW.id,
      'trigger',
      'property',
      'insert',
      jsonb_build_object('snapshot', public.property_tracked_snapshot(NEW)),
      null
    );
    return NEW;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists properties_change_log_aiu on public.properties;
create trigger properties_change_log_aiu
  after insert or update on public.properties
  for each row
  execute function public.properties_change_log_trg();

-- Owner registry history (active owner rows)
create or replace function public.owner_tracked_snapshot(p public.property_registry_people)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id,
    'relation_type', p.relation_type,
    'entity_kind', p.entity_kind,
    'first_name', p.first_name,
    'middle_name', p.middle_name,
    'last_name', p.last_name,
    'entity_name', p.entity_name,
    'eik_bulstat', p.eik_bulstat,
    'email', p.email,
    'ownership_share_percent', p.ownership_share_percent,
    'ideal_parts_percent', p.ideal_parts_percent,
    'deregistered_at', p.deregistered_at
  ));
$$;

revoke all on function public.owner_tracked_snapshot(public.property_registry_people) from public;

create or replace function public.property_registry_people_change_log_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_diff jsonb;
  v_property_id bigint;
begin
  if TG_OP = 'DELETE' then
    if OLD.relation_type is distinct from 'owner' then
      return OLD;
    end if;
    perform public.log_property_change(
      OLD.property_id,
      'trigger',
      'owner',
      'delete',
      jsonb_build_object('snapshot', public.owner_tracked_snapshot(OLD)),
      null
    );
    return OLD;
  end if;

  if NEW.relation_type is distinct from 'owner'
     and (TG_OP = 'INSERT' or OLD.relation_type is distinct from 'owner') then
    return NEW;
  end if;

  v_property_id := NEW.property_id;
  if TG_OP = 'INSERT' then
    perform public.log_property_change(
      v_property_id,
      'trigger',
      'owner',
      'insert',
      jsonb_build_object('snapshot', public.owner_tracked_snapshot(NEW)),
      null
    );
  else
    v_diff := public.property_change_json_diff(
      public.owner_tracked_snapshot(OLD),
      public.owner_tracked_snapshot(NEW)
    );
    if v_diff <> '{}'::jsonb then
      perform public.log_property_change(
        v_property_id,
        'trigger',
        'owner',
        'update',
        v_diff,
        null
      );
    end if;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists property_registry_people_change_log_aiud on public.property_registry_people;
create trigger property_registry_people_change_log_aiud
  after insert or update or delete on public.property_registry_people
  for each row
  execute function public.property_registry_people_change_log_trg();

-- Expand book object upsert: apartment_number + floor editable
create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null,
  p_apartment_number bigint default null,
  p_floor bigint default null,
  p_ideal_parts_note text default null,
  p_ideal_parts_meeting_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text := nullif(btrim(coalesce(p_ownership_type, '')), '');
begin
  perform public.admin_assert_book_admin();
  if v_type is null or v_type not in ('sole', 'shared') then
    raise exception 'admin_upsert_property_book_object: invalid ownership_type'
      using errcode = '22023';
  end if;

  update public.properties as p
     set purpose = nullif(btrim(coalesce(p_purpose, '')), ''),
         area_sqm = p_area_sqm,
         ideal_parts_percent = p_ideal_parts_percent,
         ownership_type = v_type,
         ideal_parts_source = coalesce(
           nullif(btrim(coalesce(p_ideal_parts_source, '')), ''),
           p.ideal_parts_source
         ),
         ideal_parts_note = case
           when p_ideal_parts_note is null then p.ideal_parts_note
           else nullif(btrim(p_ideal_parts_note), '')
         end,
         ideal_parts_meeting_ref = case
           when p_ideal_parts_meeting_ref is null then p.ideal_parts_meeting_ref
           else nullif(btrim(p_ideal_parts_meeting_ref), '')
         end,
         apartment_number = coalesce(p_apartment_number, p.apartment_number),
         floor = coalesce(p_floor, p.floor)
   where p.id = p_property_id;

  if not found then
    raise exception 'admin_upsert_property_book_object: not found'
      using errcode = 'P0002';
  end if;

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text
) from public;
revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text
) from anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text
) to authenticated;

-- Keep 6-arg overload for import / older clients
create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select public.admin_upsert_property_book_object(
    p_property_id, p_purpose, p_area_sqm, p_ideal_parts_percent,
    p_ownership_type, p_ideal_parts_source, null::bigint, null::bigint, null::text, null::text
  );
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) from public;
revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) from anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) to authenticated;

create or replace function public.admin_list_property_change_log(
  p_property_id bigint,
  p_limit integer default 50
)
returns setof public.property_change_log
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.admin_assert_book_admin();
  return query
  select l.*
  from public.property_change_log as l
  where l.property_id = p_property_id
  order by l.changed_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$fn$;

revoke all on function public.admin_list_property_change_log(bigint, integer) from public;
revoke all on function public.admin_list_property_change_log(bigint, integer) from anon;
grant execute on function public.admin_list_property_change_log(bigint, integer) to authenticated;

-- Include floor / notes in book get payload
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
      'purpose', v_prop.purpose,
      'area_sqm', v_prop.area_sqm,
      'ideal_parts_percent', v_prop.ideal_parts_percent,
      'ideal_parts_source', v_prop.ideal_parts_source,
      'ideal_parts_note', v_prop.ideal_parts_note,
      'ideal_parts_meeting_ref', v_prop.ideal_parts_meeting_ref,
      'ownership_type', v_prop.ownership_type,
      'owner_email', v_prop.owner_email,
      'owner_name', v_prop.owner_name
    ),
    'owners', v_owners,
    'validation', public.property_book_validate(p_property_id)
  );
end;
$fn$;

revoke all on function public.admin_get_property_book(bigint) from public;
revoke all on function public.admin_get_property_book(bigint) from anon;
grant execute on function public.admin_get_property_book(bigint) to authenticated;

commit;
