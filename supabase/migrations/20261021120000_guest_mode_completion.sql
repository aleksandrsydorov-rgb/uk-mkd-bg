-- Guest Mode completion (AMADEUS 11)
-- Closes insert/storage/chat identity gaps; DB-level max-2 + expiry enforcement.
-- Does NOT enable email sending or debt gate. Does NOT apply legal guest terms UI.
-- NOT APPLIED until separate approval.

begin;

-- ---------------------------------------------------------------------------
-- Chat: distinguish guest vs owner messages (preserve history)
-- ---------------------------------------------------------------------------

alter table public.chat_messages
  add column if not exists guest_access_id uuid null
    references public.property_guest_accesses (id) on delete set null;

alter table public.chat_messages
  add column if not exists sender_email text null;

create index if not exists chat_messages_guest_access_idx
  on public.chat_messages (guest_access_id)
  where guest_access_id is not null;

-- ---------------------------------------------------------------------------
-- Requests: identify guest vs owner creators
-- ---------------------------------------------------------------------------

alter table public.requests
  add column if not exists created_by_role text null;

alter table public.requests
  add column if not exists created_by_email text null;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requests_created_by_role_chk'
      and conrelid = 'public.requests'::regclass
  ) then
    alter table public.requests
      add constraint requests_created_by_role_chk
      check (
        created_by_role is null
        or created_by_role in ('owner', 'guest', 'admin')
      );
  end if;
end;
$chk$;

-- ---------------------------------------------------------------------------
-- Security requests: allow created_by_role = guest
-- ---------------------------------------------------------------------------

alter table public.security_requests
  drop constraint if exists security_requests_created_by_role_check;

alter table public.security_requests
  add constraint security_requests_created_by_role_check
  check (created_by_role in ('owner', 'admin', 'guest'));

-- ---------------------------------------------------------------------------
-- DB-level: one active grant per email/property; max 2 active per property
-- ---------------------------------------------------------------------------

create unique index if not exists property_guest_accesses_one_active_email_uidx
  on public.property_guest_accesses (property_id, lower(btrim(email)))
  where status = 'active';

create or replace function public.trg_property_guest_accesses_enforce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_active_count integer;
begin
  perform public.guest_access_expire_stale();

  if NEW.status = 'active'
     and NEW.valid_until is not null
     and NEW.valid_until < now() then
    NEW.status := 'expired';
  end if;

  if NEW.status = 'active' then
    select count(*)::integer into v_active_count
    from public.property_guest_accesses as g
    where g.property_id = NEW.property_id
      and g.status = 'active'
      and (TG_OP = 'INSERT' or g.id is distinct from NEW.id);

    if v_active_count >= 2 then
      raise exception 'property_guest_accesses: max 2 active guests per property'
        using errcode = '23505';
    end if;
  end if;

  return NEW;
end;
$fn$;

drop trigger if exists property_guest_accesses_enforce_biu on public.property_guest_accesses;
create trigger property_guest_accesses_enforce_biu
  before insert or update of status, valid_until, valid_from, email, property_id
  on public.property_guest_accesses
  for each row
  execute function public.trg_property_guest_accesses_enforce();

revoke all on function public.trg_property_guest_accesses_enforce() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Module gate helper (local; does not change Module Core product rules)
-- ---------------------------------------------------------------------------

create or replace function public.guest_mode_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select bm.enabled from public.building_modules as bm where bm.module_key = 'guest_mode'),
    false
  );
$fn$;

revoke all on function public.guest_mode_module_enabled() from public, anon;
grant execute on function public.guest_mode_module_enabled() to authenticated;

-- ---------------------------------------------------------------------------
-- Owner create: module on, short-term needs until, duplicate email blocked
-- ---------------------------------------------------------------------------

create or replace function public.owner_create_guest_access(
  p_property_id bigint,
  p_email text,
  p_relation_type text,
  p_valid_from timestamptz default now(),
  p_valid_until timestamptz default null
)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_creator text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_row public.property_guest_accesses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'owner_create_guest_access: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_create_guest_access: not allowed'
      using errcode = '42501';
  end if;
  if not public.guest_mode_module_enabled() then
    raise exception 'owner_create_guest_access: guest_mode module disabled'
      using errcode = '42501';
  end if;
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'owner_create_guest_access: email required'
      using errcode = '22023';
  end if;
  if p_relation_type not in (
    'living_with_owner', 'co_owner', 'long_term_tenant', 'short_term_tenant'
  ) then
    raise exception 'owner_create_guest_access: invalid relation_type'
      using errcode = '22023';
  end if;
  if p_relation_type = 'short_term_tenant' and p_valid_until is null then
    raise exception 'owner_create_guest_access: short_term_tenant requires valid_until'
      using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until < coalesce(p_valid_from, now()) then
    raise exception 'owner_create_guest_access: invalid validity range'
      using errcode = '22023';
  end if;

  perform public.guest_access_expire_stale();

  insert into public.property_guest_accesses (
    property_id,
    email,
    relation_type,
    valid_from,
    valid_until,
    status,
    created_by_email
  ) values (
    p_property_id,
    v_email,
    p_relation_type,
    coalesce(p_valid_from, now()),
    p_valid_until,
    'active',
    v_creator
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz
) from public, anon;
grant execute on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest context RPCs (for UI labels / chat payload)
-- ---------------------------------------------------------------------------

create or replace function public.get_my_active_guest_access(p_property_id bigint)
returns public.property_guest_accesses
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_guest_accesses%rowtype;
begin
  if auth.email() is null then
    raise exception 'get_my_active_guest_access: not authenticated'
      using errcode = '28000';
  end if;

  select g.* into v_row
  from public.property_guest_accesses as g
  where g.property_id = p_property_id
    and g.status = 'active'
    and lower(btrim(g.email)) = lower(btrim(auth.email()))
    and g.valid_from <= now()
    and (g.valid_until is null or g.valid_until >= now())
  order by g.created_at desc
  limit 1;

  if not found then
    raise exception 'get_my_active_guest_access: not found'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.get_my_active_guest_access(bigint) from public, anon;
grant execute on function public.get_my_active_guest_access(bigint) to authenticated;

create or replace function public.list_my_guest_access_contexts()
returns table (
  access_id uuid,
  property_id bigint,
  apartment_number text,
  relation_type text,
  valid_from timestamptz,
  valid_until timestamptz,
  email text
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
    g.email
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

-- ---------------------------------------------------------------------------
-- RLS: guests may INSERT requests / chat (owners unchanged)
-- ---------------------------------------------------------------------------

drop policy if exists requests_owner_insert on public.requests;
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
      public.has_active_guest_access(property_id)
      and created_by_role = 'guest'
      and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
    )
  )
  and lower(btrim(coalesce(status, ''))) = 'новая'
);

drop policy if exists chat_messages_owner_insert on public.chat_messages;
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
      public.has_active_guest_access(property_id)
      and sender = 'guest'
      and guest_access_id is not null
      and exists (
        select 1
        from public.property_guest_accesses as g
        where g.id = guest_access_id
          and g.property_id = property_id
          and g.status = 'active'
          and lower(btrim(g.email)) = lower(btrim(coalesce(auth.email(), '')))
          and g.valid_from <= now()
          and (g.valid_until is null or g.valid_until >= now())
      )
    )
  )
  and coalesce(read_by_uk, false) = false
);

-- Keep staff UK insert
drop policy if exists chat_messages_admin_insert on public.chat_messages;
create policy chat_messages_admin_insert
on public.chat_messages
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  and sender = 'uk'
  and coalesce(read_by_owner, false) = false
  and guest_access_id is null
);

-- ---------------------------------------------------------------------------
-- Chat read-ack: guests may acknowledge UK messages on their apartment
-- ---------------------------------------------------------------------------

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
      or public.has_active_guest_access(OLD.property_id)
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

revoke all on function public.enforce_chat_message_update() from public;
revoke execute on function public.enforce_chat_message_update() from anon;
revoke execute on function public.enforce_chat_message_update() from authenticated;

-- ---------------------------------------------------------------------------
-- Security create: mark guest creators as guest (not owner)
-- ---------------------------------------------------------------------------

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
  elsif public.has_active_guest_access(p_property_id) then
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

revoke all on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) from public, anon;
grant execute on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) to authenticated;

-- Preserve security_lifecycle_v2 validation; only extend creator role to guest.
create or replace function public.security_insert_request(
  p_property_id bigint,
  p_post_id uuid,
  p_kind text,
  p_created_by_role text,
  p_guest_id bigint,
  p_guest_name text,
  p_expected_at timestamptz,
  p_courier_name text,
  p_delivery_note text,
  p_handover_item text,
  p_note text,
  p_delivery_mode text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.security_requests%rowtype;
  v_post uuid;
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_email text := nullif(btrim(auth.email()), '');
  v_guest_name text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_courier text := nullif(btrim(coalesce(p_courier_name, '')), '');
  v_delivery text := nullif(btrim(coalesce(p_delivery_note, '')), '');
  v_handover text := nullif(btrim(coalesce(p_handover_item, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_mode text := nullif(btrim(coalesce(p_delivery_mode, '')), '');
begin
  if not public.security_module_enabled() then
    raise exception 'security: module disabled'
      using errcode = '42501';
  end if;
  if v_email is null then
    raise exception 'security: not authenticated'
      using errcode = '28000';
  end if;
  if p_property_id is null
     or not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'security: property required'
      using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('guest_pass', 'delivery', 'handover') then
    raise exception 'security: invalid kind'
      using errcode = '22023';
  end if;
  if p_created_by_role not in ('owner', 'admin', 'guest') then
    raise exception 'security: invalid creator'
      using errcode = '22023';
  end if;

  v_post := public.security_resolve_post_id(p_post_id);

  if v_kind = 'guest_pass' and v_guest_name is null and p_guest_id is null then
    raise exception 'security: guest name required'
      using errcode = '22023';
  end if;
  if v_kind = 'delivery' then
    if v_courier is null and v_delivery is null then
      raise exception 'security: delivery details required'
        using errcode = '22023';
    end if;
    if v_mode is null then
      v_mode := 'hold_at_post';
    end if;
    if v_mode not in ('hold_at_post', 'courier_pass') then
      raise exception 'security: invalid delivery mode'
        using errcode = '22023';
    end if;
  else
    v_mode := null;
  end if;
  if v_kind = 'handover' and (
       v_handover is null
       or v_handover not in ('documents', 'keys', 'parcel')
     ) then
    raise exception 'security: handover item required'
      using errcode = '22023';
  end if;

  if p_guest_id is not null then
    if not exists (
      select 1 from public.apartment_guests as g
      where g.id = p_guest_id and g.property_id = p_property_id
    ) then
      raise exception 'security: guest not found'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.security_requests (
    property_id, post_id, kind, status, created_by_role, created_by_email,
    guest_id, guest_name, expected_at, courier_name, delivery_note,
    handover_item, note, delivery_mode
  ) values (
    p_property_id, v_post, v_kind, 'pending', p_created_by_role, v_email,
    p_guest_id, v_guest_name, p_expected_at, v_courier, v_delivery,
    case when v_kind = 'handover' then v_handover else null end,
    v_note, v_mode
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Storage helpers: guests may upload/read own apartment request/chat files
-- ---------------------------------------------------------------------------

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
    or public.has_active_guest_access(v_property_id);
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
          or public.has_active_guest_access(r.property_id)
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
          or public.has_active_guest_access(sr.property_id)
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
    or public.has_active_guest_access(v_property_id);
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
        or public.has_active_guest_access(m.property_id)
      )
  );
$fn$;

commit;
