-- =============================================================================
-- R1-RC8 — Guest invitation permissions (action grants)
-- =============================================================================
-- Extends property_guest_accesses with permissions jsonb (default {}).
-- Old grants keep empty permissions → no personal-history access until owner
-- configures actions explicitly. New modules never auto-expand old grants.
-- Server checks: active + in-force + not revoked + apartment + action.
-- =============================================================================

begin;

alter table public.property_guest_accesses
  add column if not exists permissions jsonb not null default '{}'::jsonb;

comment on column public.property_guest_accesses.permissions is
  'Explicit guest action grants. Missing/false keys mean denied. Never auto-filled when modules are enabled later.';

alter table public.announcements
  add column if not exists guest_visible boolean not null default false;

alter table public.building_documents
  add column if not exists guest_visible boolean not null default false;

comment on column public.announcements.guest_visible is
  'When true, guests with announcements.guest_audience may read this announcement.';
comment on column public.building_documents.guest_visible is
  'When true, guests with documents.guest_audience may read this published document.';

-- ---------------------------------------------------------------------------
-- Catalog + helpers
-- ---------------------------------------------------------------------------

create or replace function public.guest_action_keys()
returns text[]
language sql
immutable
as $fn$
  select array[
    'water.submit_readings',
    'electricity.submit_readings',
    'chat.with_uk',
    'requests.own',
    'security.own',
    'announcements.guest_audience',
    'documents.guest_audience',
    'services.overview'
  ]::text[];
$fn$;

revoke all on function public.guest_action_keys() from public, anon;
grant execute on function public.guest_action_keys() to authenticated;

create or replace function public.guest_action_required_module(p_action text)
returns text
language sql
immutable
as $fn$
  select case btrim(coalesce(p_action, ''))
    when 'water.submit_readings' then 'water'
    when 'electricity.submit_readings' then 'electricity'
    when 'chat.with_uk' then 'chat'
    when 'requests.own' then 'requests'
    when 'security.own' then 'security'
    when 'announcements.guest_audience' then 'announcements'
    when 'documents.guest_audience' then 'building_documents'
    when 'services.overview' then null
    else '__unknown__'
  end;
$fn$;

revoke all on function public.guest_action_required_module(text) from public, anon;
grant execute on function public.guest_action_required_module(text) to authenticated;

create or replace function public.guest_module_enabled(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.building_modules as m
    where m.module_key = p_module_key
      and m.enabled is true
  );
$fn$;

revoke all on function public.guest_module_enabled(text) from public, anon;
grant execute on function public.guest_module_enabled(text) to authenticated;

create or replace function public.guest_sanitize_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_in jsonb := coalesce(p_permissions, '{}'::jsonb);
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_mod text;
  v_allowed boolean;
begin
  if jsonb_typeof(v_in) is distinct from 'object' then
    raise exception 'guest permissions must be an object' using errcode = '22023';
  end if;
  foreach v_key in array public.guest_action_keys()
  loop
    v_allowed := coalesce((v_in ->> v_key)::boolean, false)
      or coalesce(v_in ->> v_key, '') in ('true', 't', '1', 'yes');
    if not v_allowed then
      continue;
    end if;
    v_mod := public.guest_action_required_module(v_key);
    if v_mod is not null and not public.guest_module_enabled(v_mod) then
      continue; -- cannot grant disabled/unimplemented module
    end if;
    v_out := v_out || jsonb_build_object(v_key, true);
  end loop;
  return v_out;
end;
$fn$;

revoke all on function public.guest_sanitize_permissions(jsonb) from public, anon;
grant execute on function public.guest_sanitize_permissions(jsonb) to authenticated;

create or replace function public.guest_permissions_nonempty(p_permissions jsonb)
returns boolean
language sql
immutable
as $fn$
  select exists (
    select 1
    from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) as e(k, v)
    where coalesce((e.v #>> '{}')::boolean, false)
       or coalesce(e.v #>> '{}', '') in ('true', 't', '1', 'yes')
  );
$fn$;

revoke all on function public.guest_permissions_nonempty(jsonb) from public, anon;
grant execute on function public.guest_permissions_nonempty(jsonb) to authenticated;

create or replace function public.guest_active_access_row(p_property_id bigint)
returns public.property_guest_accesses
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_guest_accesses%rowtype;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  if v_email is null or p_property_id is null then
    return null;
  end if;
  select g.*
    into v_row
  from public.property_guest_accesses as g
  where g.property_id = p_property_id
    and g.status = 'active'
    and lower(btrim(g.email)) = v_email
    and g.valid_from <= now()
    and (g.valid_until is null or g.valid_until >= now())
  order by g.created_at desc
  limit 1;
  return v_row;
end;
$fn$;

revoke all on function public.guest_active_access_row(bigint) from public, anon;
grant execute on function public.guest_active_access_row(bigint) to authenticated;

create or replace function public.guest_has_action(p_property_id bigint, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_guest_accesses%rowtype;
  v_action text := btrim(coalesce(p_action, ''));
  v_mod text;
begin
  if v_action = '' or p_property_id is null then
    return false;
  end if;
  if v_action <> all (public.guest_action_keys()) then
    return false;
  end if;
  v_mod := public.guest_action_required_module(v_action);
  if v_mod is not null and not public.guest_module_enabled(v_mod) then
    return false;
  end if;
  if not public.guest_mode_module_enabled() then
    return false;
  end if;
  v_row := public.guest_active_access_row(p_property_id);
  if v_row.id is null then
    return false;
  end if;
  return coalesce((v_row.permissions ->> v_action)::boolean, false)
    or coalesce(v_row.permissions ->> v_action, '') in ('true', 't', '1', 'yes');
end;
$fn$;

revoke all on function public.guest_has_action(bigint, text) from public, anon;
grant execute on function public.guest_has_action(bigint, text) to authenticated;

create or replace function public.guest_caller_access_id(p_property_id bigint)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select (public.guest_active_access_row(p_property_id)).id;
$fn$;

revoke all on function public.guest_caller_access_id(bigint) from public, anon;
grant execute on function public.guest_caller_access_id(bigint) to authenticated;

-- Grantable actions for owner UI (enabled modules only; never admin actions).
create or replace function public.owner_list_grantable_guest_actions(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_mod text;
  v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'Not authorized.';
  end if;
  if not public.guest_mode_module_enabled() then
    return '[]'::jsonb;
  end if;
  foreach v_key in array public.guest_action_keys()
  loop
    v_mod := public.guest_action_required_module(v_key);
    if v_mod is not null and not public.guest_module_enabled(v_mod) then
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'action', v_key,
      'module_key', v_mod,
      'category', case
        when v_key like 'water.%' or v_key like 'electricity.%' then 'meters'
        when v_key like 'chat.%' then 'communication'
        when v_key like 'requests.%' or v_key like 'security.%' then 'requests'
        when v_key like 'announcements.%' or v_key like 'documents.%' then 'info'
        else 'services'
      end
    ));
  end loop;
  return v_out;
end;
$fn$;

revoke all on function public.owner_list_grantable_guest_actions(bigint) from public, anon;
grant execute on function public.owner_list_grantable_guest_actions(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Create / update with permissions
-- ---------------------------------------------------------------------------

create or replace function public.owner_create_guest_access(
  p_property_id bigint,
  p_email text,
  p_relation_type text,
  p_valid_from timestamptz default null,
  p_valid_until timestamptz default null,
  p_permissions jsonb default '{}'::jsonb
)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_creator text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_from timestamptz := coalesce(p_valid_from, now());
  v_until timestamptz := p_valid_until;
  v_perms jsonb;
  v_active int;
  v_row public.property_guest_accesses%rowtype;
begin
  if auth.uid() is null or v_creator is null then
    raise exception 'owner_create_guest_access: not authenticated' using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_create_guest_access: not allowed' using errcode = '42501';
  end if;
  if not public.guest_mode_module_enabled() then
    raise exception 'owner_create_guest_access: guest_mode module disabled' using errcode = 'P0001';
  end if;
  if v_email is null then
    raise exception 'owner_create_guest_access: email required' using errcode = '22023';
  end if;
  if p_relation_type not in ('living_with_owner','co_owner','long_term_tenant','short_term_tenant') then
    raise exception 'owner_create_guest_access: invalid relation_type' using errcode = '22023';
  end if;
  if p_relation_type = 'short_term_tenant' and v_until is null then
    raise exception 'owner_create_guest_access: short_term_tenant requires valid_until'
      using errcode = '22023';
  end if;
  if v_until is not null and v_until < v_from then
    raise exception 'owner_create_guest_access: invalid validity range' using errcode = '22023';
  end if;

  v_perms := public.guest_sanitize_permissions(p_permissions);
  if not public.guest_permissions_nonempty(v_perms) then
    raise exception 'owner_create_guest_access: select at least one permission'
      using errcode = '22023';
  end if;

  perform public.guest_access_expire_stale();

  select count(*)::int into v_active
  from public.property_guest_accesses as g
  where g.property_id = p_property_id and g.status = 'active';
  if v_active >= 2 then
    raise exception 'owner_create_guest_access: max 2 active guests per property'
      using errcode = 'P0001';
  end if;

  insert into public.property_guest_accesses (
    property_id, email, relation_type, valid_from, valid_until, status,
    created_by_email, permissions
  ) values (
    p_property_id, v_email, p_relation_type, v_from, v_until, 'active',
    v_creator, v_perms
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz, jsonb
) from public, anon;
grant execute on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz, jsonb
) to authenticated;

-- Keep old 5-arg signature callable: defaults to empty perms → reject with clear error
create or replace function public.owner_create_guest_access(
  p_property_id bigint,
  p_email text,
  p_relation_type text,
  p_valid_from timestamptz default null,
  p_valid_until timestamptz default null
)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.owner_create_guest_access(
    p_property_id, p_email, p_relation_type, p_valid_from, p_valid_until, '{}'::jsonb
  );
end;
$fn$;

revoke all on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz
) from public, anon;
grant execute on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz
) to authenticated;

create or replace function public.owner_update_guest_permissions(
  p_access_id uuid,
  p_permissions jsonb,
  p_valid_until timestamptz default null,
  p_update_until boolean default false
)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_guest_accesses%rowtype;
  v_perms jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  select g.* into v_row
  from public.property_guest_accesses as g
  where g.id = p_access_id
  for update;
  if not found then
    raise exception 'owner_update_guest_permissions: not found' using errcode = 'P0002';
  end if;
  if not public.owns_property(v_row.property_id) then
    raise exception 'Not authorized.';
  end if;
  if v_row.status not in ('active', 'pending') then
    raise exception 'owner_update_guest_permissions: not editable' using errcode = 'P0001';
  end if;
  v_perms := public.guest_sanitize_permissions(p_permissions);
  if not public.guest_permissions_nonempty(v_perms) then
    raise exception 'owner_update_guest_permissions: select at least one permission'
      using errcode = '22023';
  end if;
  update public.property_guest_accesses as g
  set
    permissions = v_perms,
    valid_until = case when p_update_until then p_valid_until else g.valid_until end
  where g.id = p_access_id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.owner_update_guest_permissions(uuid, jsonb, timestamptz, boolean)
  from public, anon;
grant execute on function public.owner_update_guest_permissions(uuid, jsonb, timestamptz, boolean)
  to authenticated;

drop function if exists public.list_my_guest_access_contexts();

create or replace function public.list_my_guest_access_contexts()
returns table (
  access_id uuid,
  property_id bigint,
  apartment_number text,
  relation_type text,
  valid_from timestamptz,
  valid_until timestamptz,
  email text,
  permissions jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    g.id,
    g.property_id,
    p.apartment_number::text,
    g.relation_type,
    g.valid_from,
    g.valid_until,
    g.email,
    coalesce(g.permissions, '{}'::jsonb)
  from public.property_guest_accesses as g
  join public.properties as p on p.id = g.property_id
  where auth.email() is not null
    and g.status = 'active'
    and lower(btrim(g.email)) = lower(btrim(auth.email()))
    and g.valid_from <= now()
    and (g.valid_until is null or g.valid_until >= now())
  order by p.apartment_number::text, g.created_at desc;
$fn$;

revoke all on function public.list_my_guest_access_contexts() from public, anon;
grant execute on function public.list_my_guest_access_contexts() to authenticated;

-- Minimal meters for guest reading submit (no balances / history / finance).
create or replace function public.guest_list_meters_for_submit(p_property_id bigint, p_utility text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_util text := lower(btrim(coalesce(p_utility, '')));
  v_action text;
  v_out jsonb := '[]'::jsonb;
begin
  if v_util = 'water' then
    v_action := 'water.submit_readings';
  elsif v_util = 'electricity' then
    v_action := 'electricity.submit_readings';
  else
    raise exception 'guest_list_meters_for_submit: utility invalid' using errcode = '22023';
  end if;
  if not public.guest_has_action(p_property_id, v_action) then
    raise exception 'Not authorized.';
  end if;
  if v_util = 'water' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'meter_id', m.id,
      'meter_number', m.meter_number,
      'unit', 'm3',
      'last_value', (
        select r.current_value
        from public.water_readings as r
        where r.meter_id = m.id
          and coalesce(r.status, 'active') = 'active'
        order by r.reading_date desc, r.created_at desc
        limit 1
      )
    ) order by m.meter_number), '[]'::jsonb)
    into v_out
    from public.water_meters as m
    where m.property_id = p_property_id
      and coalesce(m.is_active, true) is true;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'meter_id', m.id,
      'meter_number', m.meter_number,
      'has_day_night', true,
      'last_day_value', (
        select r.value
        from public.meter_readings as r
        where r.electricity_meter_id = m.id
          and r.meter_type = 'electricity_day'
          and coalesce(r.status, 'active') = 'active'
        order by r.reading_date desc, r.created_at desc
        limit 1
      ),
      'last_night_value', (
        select r.value
        from public.meter_readings as r
        where r.electricity_meter_id = m.id
          and r.meter_type = 'electricity_night'
          and coalesce(r.status, 'active') = 'active'
        order by r.reading_date desc, r.created_at desc
        limit 1
      )
    ) order by m.meter_number), '[]'::jsonb)
    into v_out
    from public.electricity_meters as m
    where m.property_id = p_property_id
      and coalesce(m.is_active, true) is true;
  end if;
  return coalesce(v_out, '[]'::jsonb);
end;
$fn$;

revoke all on function public.guest_list_meters_for_submit(bigint, text) from public, anon;
grant execute on function public.guest_list_meters_for_submit(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: permission-scoped + own-row isolation for guests
-- ---------------------------------------------------------------------------

drop policy if exists requests_admin_owner_select on public.requests;
create policy requests_admin_owner_select
on public.requests
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or (
    public.guest_has_action(property_id, 'requests.own')
    and created_by_role = 'guest'
    and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
  )
);

drop policy if exists requests_owner_guest_insert on public.requests;
create policy requests_owner_guest_insert
on public.requests
for insert
to authenticated
with check (
  (
    (
      public.owns_property(property_id)
      and coalesce(created_by_role, 'owner') = 'owner'
    )
    or (
      public.guest_has_action(property_id, 'requests.own')
      and created_by_role = 'guest'
      and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
    )
  )
  and lower(btrim(coalesce(status, ''))) = 'новая'
);

drop policy if exists chat_messages_admin_owner_select on public.chat_messages;
create policy chat_messages_admin_owner_select
on public.chat_messages
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or (
    public.guest_has_action(property_id, 'chat.with_uk')
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
  )
);

drop policy if exists chat_messages_admin_owner_update on public.chat_messages;
create policy chat_messages_admin_owner_update
on public.chat_messages
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or (
    public.guest_has_action(property_id, 'chat.with_uk')
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
  )
)
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or (
    public.guest_has_action(property_id, 'chat.with_uk')
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
  )
);

drop policy if exists chat_messages_owner_guest_insert on public.chat_messages;
create policy chat_messages_owner_guest_insert
on public.chat_messages
for insert
to authenticated
with check (
  (
    (
      public.owns_property(property_id)
      and sender = 'owner'
      and guest_access_id is null
    )
    or (
      public.guest_has_action(property_id, 'chat.with_uk')
      and sender = 'guest'
      and guest_access_id is not null
      and public.guest_access_matches_caller(guest_access_id, property_id)
    )
  )
  and coalesce(read_by_uk, false) = false
);

drop policy if exists chat_messages_admin_insert on public.chat_messages;
create policy chat_messages_admin_insert
on public.chat_messages
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  and sender = 'uk'
  and coalesce(read_by_owner, false) = false
  -- UK may reply into a guest thread (guest_access_id set) or owner thread (null).
);

drop policy if exists security_requests_select on public.security_requests;
create policy security_requests_select on public.security_requests
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('охрана')
    or public.owns_property(property_id)
    or (
      public.guest_has_action(property_id, 'security.own')
      and created_by_role = 'guest'
      and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
    )
  );

create or replace function public.owner_create_security_request(
  p_property_id bigint,
  p_kind text,
  p_post_id uuid default null,
  p_guest_id bigint default null,
  p_guest_name text default null,
  p_expected_at timestamptz default null,
  p_courier_name text default null,
  p_delivery_note text default null,
  p_handover_item text default null,
  p_note text default null,
  p_delivery_mode text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'owner_create_security_request: not authenticated'
      using errcode = '28000';
  end if;
  if public.owns_property(p_property_id) then
    v_role := 'owner';
  elsif public.guest_has_action(p_property_id, 'security.own') then
    v_role := 'guest';
  else
    raise exception 'owner_create_security_request: not allowed'
      using errcode = '42501';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'security');
  return public.security_insert_request(
    p_property_id, p_post_id, p_kind, v_role,
    p_guest_id, p_guest_name, p_expected_at,
    p_courier_name, p_delivery_note, p_handover_item, p_note, p_delivery_mode
  );
end;
$fn$;

create or replace function public.enforce_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resident_ack boolean;
  staff_ack boolean;
begin
  resident_ack :=
    (
      public.owns_property(OLD.property_id)
      or (
        public.guest_has_action(OLD.property_id, 'chat.with_uk')
        and OLD.guest_access_id is not null
        and OLD.guest_access_id = public.guest_caller_access_id(OLD.property_id)
      )
    )
    and OLD.sender = 'uk'
    and NEW.read_by_owner is true
    and (to_jsonb(NEW) - 'read_by_owner') = (to_jsonb(OLD) - 'read_by_owner');

  staff_ack :=
    public.has_staff_role('администрация')
    and OLD.sender is distinct from 'uk'
    and NEW.read_by_uk is true
    and (to_jsonb(NEW) - 'read_by_uk') = (to_jsonb(OLD) - 'read_by_uk');

  if resident_ack or staff_ack then
    return NEW;
  end if;

  raise exception 'chat_messages: only read acknowledgement is allowed'
    using errcode = '42501';
end;
$function$;

-- Announcements / documents with explicit guest audience
drop policy if exists announcements_owner_staff_select on public.announcements;
create policy announcements_owner_staff_select
on public.announcements
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.is_owner()
  or (
    guest_visible is true
    and exists (
      select 1
      from public.property_guest_accesses as g
      where g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(coalesce(auth.email(), '')))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
        and coalesce((g.permissions ->> 'announcements.guest_audience')::boolean, false)
    )
  )
);

-- building_documents guest read via helper if present
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'can_read_building_document'
      and pronamespace = 'public'::regnamespace
  ) then
    execute $f$
      create or replace function public.can_read_building_document(p_document_id uuid)
      returns boolean
      language plpgsql
      stable
      security definer
      set search_path = ''
      as $fn$
      declare
        v_doc public.building_documents%rowtype;
      begin
        select d.* into v_doc from public.building_documents as d where d.id = p_document_id;
        if not found then
          return false;
        end if;
        if public.has_staff_role('администрация') then
          return true;
        end if;
        if public.is_owner() and v_doc.status = 'published' then
          return true;
        end if;
        if v_doc.status = 'published'
           and coalesce(v_doc.guest_visible, false)
           and exists (
             select 1
             from public.property_guest_accesses as g
             where g.status = 'active'
               and lower(btrim(g.email)) = lower(btrim(coalesce(auth.email(), '')))
               and g.valid_from <= now()
               and (g.valid_until is null or g.valid_until >= now())
               and coalesce((g.permissions ->> 'documents.guest_audience')::boolean, false)
           ) then
          return true;
        end if;
        return false;
      end;
      $fn$;
    $f$;
  end if;
end $$;

-- Storage helpers: permission-aware
create or replace function public.can_upload_request_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
begin
  if public.private_object_name_ok(p_name, 'security') then
    v_property_id := split_part(p_name, '/', 2)::bigint;
    if not exists (select 1 from public.properties as p where p.id = v_property_id) then
      return false;
    end if;
    return public.has_staff_role('охрана')
      or public.has_staff_role('администрация');
  end if;

  if not public.private_object_name_ok(p_name, 'requests') then
    return false;
  end if;
  v_property_id := split_part(p_name, '/', 2)::bigint;
  if not exists (select 1 from public.properties as p where p.id = v_property_id) then
    return false;
  end if;
  return public.has_staff_role('администрация')
    or public.owns_property(v_property_id)
    or public.guest_has_action(v_property_id, 'requests.own');
end;
$fn$;

create or replace function public.can_read_request_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    exists (
      select 1
      from public.requests as r
      where r.photo_url = p_name
        and p_name like 'requests/' || r.property_id::text || '/%'
        and (
          public.has_staff_role('администрация')
          or public.owns_property(r.property_id)
          or (
            public.guest_has_action(r.property_id, 'requests.own')
            and r.created_by_role = 'guest'
            and lower(btrim(coalesce(r.created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
          )
        )
    )
    or exists (
      select 1
      from public.security_requests as sr
      where p_name in (sr.accepted_photo_path, sr.handed_over_photo_path)
        and p_name like 'security/' || sr.property_id::text || '/%'
        and (
          public.has_staff_role('администрация')
          or public.has_staff_role('охрана')
          or public.owns_property(sr.property_id)
          or (
            public.guest_has_action(sr.property_id, 'security.own')
            and sr.created_by_role = 'guest'
            and lower(btrim(coalesce(sr.created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
          )
        )
    );
$fn$;

create or replace function public.can_upload_chat_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
begin
  if not public.private_object_name_ok(p_name, 'properties') then
    return false;
  end if;
  v_property_id := split_part(p_name, '/', 2)::bigint;
  if not exists (select 1 from public.properties as p where p.id = v_property_id) then
    return false;
  end if;
  return public.has_staff_role('администрация')
    or public.owns_property(v_property_id)
    or public.guest_has_action(v_property_id, 'chat.with_uk');
end;
$fn$;

create or replace function public.can_read_chat_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_messages as m
    where to_jsonb(m) ->> 'photo_url' = p_name
      and p_name like 'properties/' || m.property_id::text || '/%'
      and (
        public.has_staff_role('администрация')
        or public.owns_property(m.property_id)
        or (
          public.guest_has_action(m.property_id, 'chat.with_uk')
          and m.guest_access_id is not null
          and m.guest_access_id = public.guest_caller_access_id(m.property_id)
        )
      )
  );
$fn$;

commit;


-- =============================================================================
-- Meter submit: allow guest with explicit action (no rate confirm for guests)
-- =============================================================================
begin;

CREATE OR REPLACE FUNCTION public.submit_water_reading(p_property_id bigint, p_current_value numeric, p_reading_date date, p_idempotency_key uuid)
 RETURNS TABLE(reading_id uuid, property_id bigint, meter_id uuid, meter_number text, reading_date date, previous_value numeric, current_value numeric, consumption_m3 numeric, tariff_eur_per_m3 numeric, charge_amount_eur numeric, charge_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text;
  v_via text;
  v_meter public.water_meters%rowtype;
  v_last public.water_readings%rowtype;
  v_prev numeric;
  v_current numeric(12, 3);
  v_resolved record;
  v_rate numeric;
  v_version_id uuid;
  v_reading public.water_readings%rowtype;
  v_charge_created boolean;
  v_mode text;
  v_is_owner boolean;
  v_is_water_staff boolean;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if p_reading_date is null then
    raise exception 'Reading date is required.';
  end if;

  if p_current_value is null then
    raise exception 'Current reading is required.';
  end if;

  v_current := round(p_current_value, 1);

  if v_current < 0 then
    raise exception 'Current reading cannot be negative.';
  end if;

  if p_reading_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'Reading date cannot be in the future.';
  end if;

  select coalesce(nullif(btrim(bs.water_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  v_is_owner := public.owns_property(p_property_id);
  v_is_water_staff :=
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер');

  if v_mode = 'disabled' then
    raise exception 'Water readings are disabled.';
  elsif v_mode = 'staff_only' then
    if not v_is_water_staff then
      raise exception 'Not authorized.';
    end if;
    v_via := 'staff';
  elsif v_mode = 'owner_and_staff' then
    if v_is_water_staff then
      v_via := 'staff';
    elsif v_is_owner then
      v_via := 'owner';
    elsif public.guest_has_action(p_property_id, 'water.submit_readings') then
      v_via := 'guest';
    else
      raise exception 'Not authorized.';
    end if;
  else
    raise exception 'Not authorized.';
  end if;

  select r.*
    into v_reading
  from public.water_readings as r
  where r.idempotency_key = p_idempotency_key;

  if found then
    if v_reading.property_id is distinct from p_property_id
       or v_reading.current_value is distinct from v_current
       or v_reading.reading_date is distinct from p_reading_date then
      raise exception 'Idempotency key conflict.';
    end if;

    select exists (
      select 1
      from public.water_ledger as l
      where l.reading_id = v_reading.id
        and l.kind = 'charge'
    )
      into v_charge_created;

    return query
    select
      v_reading.id,
      v_reading.property_id,
      v_reading.meter_id,
      m.meter_number,
      v_reading.reading_date,
      v_reading.previous_value,
      v_reading.current_value,
      v_reading.consumption_m3,
      v_reading.tariff_eur_per_m3,
      v_reading.charge_amount_eur,
      coalesce(v_charge_created, false)
    from public.water_meters as m
    where m.id = v_reading.meter_id;

    return;
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  select r.*
    into v_reading
  from public.water_readings as r
  where r.idempotency_key = p_idempotency_key;

  if found then
    if v_reading.property_id is distinct from p_property_id
       or v_reading.current_value is distinct from v_current
       or v_reading.reading_date is distinct from p_reading_date then
      raise exception 'Idempotency key conflict.';
    end if;

    select exists (
      select 1
      from public.water_ledger as l
      where l.reading_id = v_reading.id
        and l.kind = 'charge'
    )
      into v_charge_created;

    return query
    select
      v_reading.id,
      v_reading.property_id,
      v_reading.meter_id,
      m.meter_number,
      v_reading.reading_date,
      v_reading.previous_value,
      v_reading.current_value,
      v_reading.consumption_m3,
      v_reading.tariff_eur_per_m3,
      v_reading.charge_amount_eur,
      coalesce(v_charge_created, false)
    from public.water_meters as m
    where m.id = v_reading.meter_id;

    return;
  end if;

  select *
    into v_meter
  from public.water_meters as m
  where m.property_id = p_property_id
    and m.retired_at is null
  for update;

  if not found then
    raise exception 'No active water meter assigned.';
  end if;

  if p_reading_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  -- Deterministic previous baseline for same physical meter.
  -- Same reading_date: greatest current_value wins.
  select r.*
    into v_last
  from public.water_readings as r
  where r.meter_id = v_meter.id
    and r.status = 'active'
  order by r.reading_date desc, r.current_value desc, r.created_at desc, r.id desc
  limit 1
  for update;

  if found then
    v_prev := round(v_last.current_value, 1);
    if p_reading_date < v_last.reading_date then
      raise exception 'Reading date cannot be earlier than previous reading.';
    end if;
  else
    v_prev := round(v_meter.initial_reading, 1);
  end if;

  if v_current < v_prev then
    raise exception 'Current reading cannot be lower than previous reading.';
  end if;

  select r.* into v_resolved
  from public.resolve_utility_tariff('water', p_reading_date) as r;

  v_version_id := v_resolved.tariff_version_id;
  v_rate := (v_resolved.rates ->> 'base')::numeric;

  begin
    insert into public.water_readings (
      property_id,
      meter_id,
      reading_date,
      previous_value,
      current_value,
      tariff_id,
      tariff_version_id,
      tariff_eur_per_m3,
      submitted_by_email,
      submitted_via,
      idempotency_key,
      status
    )
    values (
      p_property_id,
      v_meter.id,
      p_reading_date,
      v_prev,
      v_current,
      null,
      v_version_id,
      v_rate,
      v_email,
      v_via,
      p_idempotency_key,
      'active'
    )
    returning * into v_reading;
  exception
    when unique_violation then
      select r.*
        into v_reading
      from public.water_readings as r
      where r.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_reading.property_id is distinct from p_property_id
         or v_reading.current_value is distinct from v_current
         or v_reading.reading_date is distinct from p_reading_date then
        raise exception 'Idempotency key conflict.';
      end if;

      select exists (
        select 1
        from public.water_ledger as l
        where l.reading_id = v_reading.id
          and l.kind = 'charge'
      )
        into v_charge_created;

      return query
      select
        v_reading.id,
        v_reading.property_id,
        v_reading.meter_id,
        m.meter_number,
        v_reading.reading_date,
        v_reading.previous_value,
        v_reading.current_value,
        v_reading.consumption_m3,
        v_reading.tariff_eur_per_m3,
        v_reading.charge_amount_eur,
        coalesce(v_charge_created, false)
      from public.water_meters as m
      where m.id = v_reading.meter_id;

      return;
  end;

  v_charge_created := false;

  if v_reading.charge_amount_eur > 0 then
    begin
      insert into public.water_ledger (
        property_id,
        reading_id,
        kind,
        amount_eur,
        recorded_by_email,
        idempotency_key
      )
      values (
        v_reading.property_id,
        v_reading.id,
        'charge',
        v_reading.charge_amount_eur,
        v_email,
        p_idempotency_key
      );
      v_charge_created := true;
    exception
      when unique_violation then
        -- Concurrent/retry path: charge ledger already recorded for this key.
        select exists (
          select 1
          from public.water_ledger as l
          where l.reading_id = v_reading.id
            and l.kind = 'charge'
        )
          into v_charge_created;
    end;
  end if;

  return query
  select
    v_reading.id,
    v_reading.property_id,
    v_reading.meter_id,
    v_meter.meter_number,
    v_reading.reading_date,
    v_reading.previous_value,
    v_reading.current_value,
    v_reading.consumption_m3,
    v_reading.tariff_eur_per_m3,
    v_reading.charge_amount_eur,
    v_charge_created;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_electricity_reading(p_property_id bigint, p_day_reading numeric, p_night_reading numeric, p_reading_date date, p_idempotency_key uuid)
 RETURNS TABLE(day_reading_id bigint, night_reading_id bigint, property_id bigint, reading_date date, previous_day numeric, current_day numeric, consumption_day numeric, previous_night numeric, current_night numeric, consumption_night numeric, submitted_source text, day_tariff_eur_per_kwh numeric, night_tariff_eur_per_kwh numeric, day_amount_eur numeric, night_amount_eur numeric, total_amount_eur numeric, charge_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text;
  v_mode text;
  v_is_owner boolean;
  v_is_el_staff boolean;
  v_via text;
  v_day numeric(12, 3);
  v_night numeric(12, 3);
  v_prev_day numeric;
  v_prev_night numeric;
  v_last_day public.meter_readings%rowtype;
  v_last_night public.meter_readings%rowtype;
  v_existing_day public.meter_readings%rowtype;
  v_existing_night public.meter_readings%rowtype;
  v_day_id bigint;
  v_night_id bigint;
  v_now timestamptz := now();
  v_meter public.electricity_meters%rowtype;
  v_resolved record;
  v_version_id uuid;
  v_day_rate numeric;
  v_night_rate numeric;
  v_charge public.electricity_charges%rowtype;
  v_cons_day numeric;
  v_cons_night numeric;
  v_day_amt numeric(12, 2);
  v_night_amt numeric(12, 2);
  v_total numeric(12, 2);
  v_charge_created boolean := false;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if p_reading_date is null then
    raise exception 'Reading date is required.';
  end if;

  if p_day_reading is null or p_night_reading is null then
    raise exception 'Current reading is required.';
  end if;

  v_day := round(p_day_reading, 3);
  v_night := round(p_night_reading, 3);

  if v_day < 0 or v_night < 0 then
    raise exception 'Current reading cannot be negative.';
  end if;

  if p_reading_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'Reading date cannot be in the future.';
  end if;

  select coalesce(nullif(btrim(bs.electricity_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  v_is_owner := public.owns_property(p_property_id);
  v_is_el_staff :=
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер');

  if v_mode = 'disabled' then
    raise exception 'Electricity readings are disabled.';
  elsif v_mode = 'staff_only' then
    if not v_is_el_staff then
      raise exception 'Not authorized.';
    end if;
    v_via := 'staff';
  elsif v_mode = 'owner_and_staff' then
    if v_is_el_staff then
      v_via := 'staff';
    elsif v_is_owner then
      v_via := 'owner';
    elsif public.guest_has_action(p_property_id, 'electricity.submit_readings') then
      v_via := 'guest';
    else
      raise exception 'Not authorized.';
    end if;
  else
    raise exception 'Not authorized.';
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  select m.*
    into v_meter
  from public.electricity_meters as m
  where m.property_id = p_property_id
    and m.retired_at is null
  for update;

  if not found then
    raise exception 'Electricity meter is not assigned.';
  end if;

  if p_reading_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  -- Idempotency BEFORE live tariff resolve (never reprice old ops).
  select d.*
    into v_existing_day
  from public.meter_readings as d
  where d.idempotency_key = p_idempotency_key
    and d.meter_type = 'electricity_day';

  select n.*
    into v_existing_night
  from public.meter_readings as n
  where n.idempotency_key = p_idempotency_key
    and n.meter_type = 'electricity_night';

  if v_existing_day.id is not null or v_existing_night.id is not null then
    if v_existing_day.id is null or v_existing_night.id is null
       or v_existing_day.property_id is distinct from p_property_id
       or v_existing_night.property_id is distinct from p_property_id
       or v_existing_day.value is distinct from v_day
       or v_existing_night.value is distinct from v_night
       or v_existing_day.reading_date is distinct from p_reading_date
       or v_existing_night.reading_date is distinct from p_reading_date then
      raise exception 'Idempotency key conflict.';
    end if;

    select c.*
      into v_charge
    from public.electricity_charges as c
    where c.idempotency_key = p_idempotency_key;

    if v_charge.id is null then
      -- A reading pair without a charge is pending. Replay must not invent a tariff charge,
      -- even when ownership later changes.
      select b.previous_value
        into v_prev_day
      from public.electricity_register_baseline(v_existing_day.id) as b;
      select b.previous_value
        into v_prev_night
      from public.electricity_register_baseline(v_existing_night.id) as b;
      if v_prev_day is null then
        v_prev_day := v_existing_day.value;
      end if;
      if v_prev_night is null then
        v_prev_night := v_existing_night.value;
      end if;
      return query
      select
        v_existing_day.id,
        v_existing_night.id,
        p_property_id,
        p_reading_date,
        v_prev_day,
        v_existing_day.value,
        v_existing_day.value - v_prev_day,
        v_prev_night,
        v_existing_night.value,
        v_existing_night.value - v_prev_night,
        coalesce(v_existing_day.submitted_source, v_via),
        null::numeric,
        null::numeric,
        null::numeric,
        null::numeric,
        null::numeric,
        false;
      return;
    end if;

    v_charge_created := exists (
      select 1
      from public.electricity_ledger as l
      where l.charge_id = v_charge.id
        and l.kind = 'charge'
    );

    return query
    select
      v_existing_day.id,
      v_existing_night.id,
      p_property_id,
      p_reading_date,
      v_charge.previous_day,
      v_charge.current_day,
      v_charge.consumption_day,
      v_charge.previous_night,
      v_charge.current_night,
      v_charge.consumption_night,
      coalesce(v_existing_day.submitted_source, v_via),
      v_charge.day_tariff_eur_per_kwh,
      v_charge.night_tariff_eur_per_kwh,
      v_charge.day_amount_eur,
      v_charge.night_amount_eur,
      v_charge.total_amount_eur,
      v_charge_created;
    return;
  end if;

  -- Deterministic previous baselines per physical meter + register.
  select r.*
    into v_last_day
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_day'
    and r.electricity_meter_id = v_meter.id
    and coalesce(r.status, 'active') = 'active'
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
  limit 1
  for update;

  select r.*
    into v_last_night
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_night'
    and r.electricity_meter_id = v_meter.id
    and coalesce(r.status, 'active') = 'active'
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
  limit 1
  for update;

  if v_last_day.id is null then
    v_prev_day := v_meter.initial_day_reading;
  else
    v_prev_day := v_last_day.value;
  end if;

  if v_last_night.id is null then
    v_prev_night := v_meter.initial_night_reading;
  else
    v_prev_night := v_last_night.value;
  end if;

  if v_last_day.reading_date is not null and p_reading_date < v_last_day.reading_date then
    raise exception 'Reading date cannot be earlier than previous reading.';
  end if;

  if v_last_night.reading_date is not null and p_reading_date < v_last_night.reading_date then
    raise exception 'Reading date cannot be earlier than previous reading.';
  end if;

  if v_day < v_prev_day then
    raise exception 'Current reading cannot be lower than previous.';
  end if;

  if v_night < v_prev_night then
    raise exception 'Current reading cannot be lower than previous.';
  end if;

  if public.property_ownership_composition(p_property_id) in ('legal', 'mixed', 'unknown') then
    -- Legal, mixed, and unknown apartments store the reading only.
    -- The general natural-person tariff is not applied and no debt is posted.
    insert into public.meter_readings (
      property_id, meter_type, value, reading_date, submitted_by, submitted_source,
      idempotency_key, electricity_meter_id, created_at
    ) values (
      p_property_id, 'electricity_day', v_day, p_reading_date, v_email, v_via,
      p_idempotency_key, v_meter.id, v_now
    )
    returning id into v_day_id;

    insert into public.meter_readings (
      property_id, meter_type, value, reading_date, submitted_by, submitted_source,
      idempotency_key, electricity_meter_id, created_at
    ) values (
      p_property_id, 'electricity_night', v_night, p_reading_date, v_email, v_via,
      p_idempotency_key, v_meter.id, v_now
    )
    returning id into v_night_id;

    return query
    select
      v_day_id,
      v_night_id,
      p_property_id,
      p_reading_date,
      v_prev_day,
      v_day,
      v_day - v_prev_day,
      v_prev_night,
      v_night,
      v_night - v_prev_night,
      v_via,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric,
      false;
    return;
  end if;

  -- Resolve Core tariff only for NEW natural-person operations.
  select r.* into v_resolved
  from public.resolve_utility_tariff('electricity', p_reading_date) as r;

  v_version_id := v_resolved.tariff_version_id;
  v_day_rate := (v_resolved.rates ->> 'day')::numeric;
  v_night_rate := (v_resolved.rates ->> 'night')::numeric;

  insert into public.meter_readings (
    property_id,
    meter_type,
    value,
    reading_date,
    submitted_by,
    submitted_source,
    idempotency_key,
    electricity_meter_id,
    created_at
  )
  values (
    p_property_id,
    'electricity_day',
    v_day,
    p_reading_date,
    v_email,
    v_via,
    p_idempotency_key,
    v_meter.id,
    v_now
  )
  returning id into v_day_id;

  insert into public.meter_readings (
    property_id,
    meter_type,
    value,
    reading_date,
    submitted_by,
    submitted_source,
    idempotency_key,
    electricity_meter_id,
    created_at
  )
  values (
    p_property_id,
    'electricity_night',
    v_night,
    p_reading_date,
    v_email,
    v_via,
    p_idempotency_key,
    v_meter.id,
    v_now
  )
  returning id into v_night_id;

  v_cons_day := v_day - v_prev_day;
  v_cons_night := v_night - v_prev_night;
  v_day_amt := round(v_cons_day * v_day_rate, 2);
  v_night_amt := round(v_cons_night * v_night_rate, 2);
  v_total := v_day_amt + v_night_amt;

  insert into public.electricity_charges (
    property_id,
    day_reading_id,
    night_reading_id,
    reading_date,
    previous_day,
    current_day,
    previous_night,
    current_night,
    tariff_id,
    tariff_version_id,
    day_tariff_eur_per_kwh,
    night_tariff_eur_per_kwh,
    recorded_by_email,
    idempotency_key
  )
  values (
    p_property_id,
    v_day_id,
    v_night_id,
    p_reading_date,
    v_prev_day,
    v_day,
    v_prev_night,
    v_night,
    null,
    v_version_id,
    v_day_rate,
    v_night_rate,
    v_email,
    p_idempotency_key
  )
  returning * into v_charge;

  if v_charge.total_amount_eur > 0 then
    insert into public.electricity_ledger (
      property_id,
      charge_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    )
    values (
      p_property_id,
      v_charge.id,
      'charge',
      v_charge.total_amount_eur,
      null,
      v_email,
      p_idempotency_key
    );
    v_charge_created := true;
  end if;

  return query
  select
    v_day_id,
    v_night_id,
    p_property_id,
    p_reading_date,
    v_charge.previous_day,
    v_charge.current_day,
    v_charge.consumption_day,
    v_charge.previous_night,
    v_charge.current_night,
    v_charge.consumption_night,
    v_via,
    v_charge.day_tariff_eur_per_kwh,
    v_charge.night_tariff_eur_per_kwh,
    v_charge.day_amount_eur,
    v_charge.night_amount_eur,
    v_charge.total_amount_eur,
    v_charge_created;
end;
$function$;

-- Guests must never confirm legal-entity electricity charges / set rates.
-- confirm_electricity_legal_charge remains staff-only (unchanged).

commit;

