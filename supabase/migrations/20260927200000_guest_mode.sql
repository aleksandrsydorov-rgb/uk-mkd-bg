-- Guest mode: limited resident access (max 2 active guests per property).

begin;

-- ---------------------------------------------------------------------------
-- Module catalog
-- ---------------------------------------------------------------------------

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('guest_mode', 'Гостевой доступ', 'services', true, 45)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'guest_mode', false, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'guest_mode'
);

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.property_guest_accesses (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  email text not null,
  relation_type text not null
    check (relation_type in (
      'living_with_owner',
      'co_owner',
      'long_term_tenant',
      'short_term_tenant'
    )),
  valid_from timestamptz not null default now(),
  valid_until timestamptz null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked', 'expired')),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  constraint property_guest_accesses_email_chk
    check (btrim(email) <> ''),
  constraint property_guest_accesses_created_by_chk
    check (btrim(created_by_email) <> ''),
  constraint property_guest_accesses_valid_range_chk
    check (valid_until is null or valid_until >= valid_from)
);

create index if not exists property_guest_accesses_property_email_idx
  on public.property_guest_accesses (property_id, lower(email));

create index if not exists property_guest_accesses_active_idx
  on public.property_guest_accesses (property_id, status)
  where status = 'active';

alter table public.property_guest_accesses enable row level security;

revoke all on table public.property_guest_accesses from public;
revoke all on table public.property_guest_accesses from anon;
revoke all on table public.property_guest_accesses from authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.guest_access_expire_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.property_guest_accesses as g
     set status = 'expired'
   where g.status = 'active'
     and g.valid_until is not null
     and g.valid_until < now();
end;
$fn$;

revoke all on function public.guest_access_expire_stale() from public;
revoke all on function public.guest_access_expire_stale() from anon;
revoke all on function public.guest_access_expire_stale() from authenticated;

create or replace function public.has_active_guest_access(p_property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.email() is null then
    return false;
  end if;
  perform public.guest_access_expire_stale();
  return exists (
    select 1
    from public.property_guest_accesses as g
    where g.property_id = p_property_id
      and g.status = 'active'
      and lower(btrim(g.email)) = lower(btrim(auth.email()))
      and g.valid_from <= now()
      and (g.valid_until is null or g.valid_until >= now())
  );
end;
$fn$;

revoke all on function public.has_active_guest_access(bigint) from public;
revoke all on function public.has_active_guest_access(bigint) from anon;
grant execute on function public.has_active_guest_access(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------

create or replace function public.owner_list_guest_accesses(p_property_id bigint)
returns setof public.property_guest_accesses
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_list_guest_accesses: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_list_guest_accesses: not allowed'
      using errcode = '42501';
  end if;
  perform public.guest_access_expire_stale();
  return query
  select g.*
  from public.property_guest_accesses as g
  where g.property_id = p_property_id
  order by g.created_at desc
  limit 50;
end;
$fn$;

revoke all on function public.owner_list_guest_accesses(bigint) from public;
revoke all on function public.owner_list_guest_accesses(bigint) from anon;
grant execute on function public.owner_list_guest_accesses(bigint) to authenticated;

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
  v_active_count integer;
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
  if p_valid_until is not null and p_valid_until < coalesce(p_valid_from, now()) then
    raise exception 'owner_create_guest_access: invalid validity range'
      using errcode = '22023';
  end if;

  perform public.guest_access_expire_stale();

  select count(*)::integer into v_active_count
  from public.property_guest_accesses as g
  where g.property_id = p_property_id
    and g.status = 'active';

  if v_active_count >= 2 then
    raise exception 'owner_create_guest_access: max 2 active guests per property'
      using errcode = '23505';
  end if;

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
) from public;
revoke all on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz
) from anon;
grant execute on function public.owner_create_guest_access(
  bigint, text, text, timestamptz, timestamptz
) to authenticated;

create or replace function public.owner_revoke_guest_access(p_access_id uuid)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_guest_accesses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'owner_revoke_guest_access: not authenticated'
      using errcode = '28000';
  end if;
  update public.property_guest_accesses as g
     set status = 'revoked'
   where g.id = p_access_id
     and g.status in ('pending', 'active')
     and public.owns_property(g.property_id)
  returning * into v_row;
  if not found then
    raise exception 'owner_revoke_guest_access: not found or not allowed'
      using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.owner_revoke_guest_access(uuid) from public;
revoke all on function public.owner_revoke_guest_access(uuid) from anon;
grant execute on function public.owner_revoke_guest_access(uuid) to authenticated;

create or replace function public.list_my_guest_properties()
returns setof public.properties
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_my_guest_properties: not authenticated'
      using errcode = '28000';
  end if;
  perform public.guest_access_expire_stale();
  return query
  select p.*
  from public.properties as p
  where exists (
    select 1
    from public.property_guest_accesses as g
    where g.property_id = p.id
      and g.status = 'active'
      and lower(btrim(g.email)) = lower(btrim(auth.email()))
      and g.valid_from <= now()
      and (g.valid_until is null or g.valid_until >= now())
  )
  order by p.apartment_number::text;
end;
$fn$;

revoke all on function public.list_my_guest_properties() from public;
revoke all on function public.list_my_guest_properties() from anon;
grant execute on function public.list_my_guest_properties() to authenticated;

-- ---------------------------------------------------------------------------
-- Resident RLS: guests may use requests, chat, security (same as owners)
-- ---------------------------------------------------------------------------

drop policy if exists requests_admin_owner_select on public.requests;
create policy requests_admin_owner_select
on public.requests
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or public.has_active_guest_access(property_id)
);

drop policy if exists chat_messages_admin_owner_select on public.chat_messages;
create policy chat_messages_admin_owner_select
on public.chat_messages
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or public.has_active_guest_access(property_id)
);

drop policy if exists chat_messages_admin_owner_update on public.chat_messages;
create policy chat_messages_admin_owner_update
on public.chat_messages
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or public.has_active_guest_access(property_id)
)
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or public.has_active_guest_access(property_id)
);

drop policy if exists security_requests_select on public.security_requests;
create policy security_requests_select on public.security_requests
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('охрана')
    or public.owns_property(property_id)
    or public.has_active_guest_access(property_id)
  );

create or replace function public.owner_list_my_security_requests(p_property_id bigint default null)
returns setof public.security_requests
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_list_my_security_requests: not authenticated'
      using errcode = '28000';
  end if;
  return query
  select r.*
  from public.security_requests as r
  where (
    public.owns_property(r.property_id)
    or public.has_active_guest_access(r.property_id)
  )
    and (p_property_id is null or r.property_id = p_property_id)
  order by r.created_at desc
  limit 200;
end;
$fn$;

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
begin
  if auth.uid() is null then
    raise exception 'owner_create_security_request: not authenticated'
      using errcode = '28000';
  end if;
  if not (
    public.owns_property(p_property_id)
    or public.has_active_guest_access(p_property_id)
  ) then
    raise exception 'owner_create_security_request: not allowed'
      using errcode = '42501';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'security');
  return public.security_insert_request(
    p_property_id, p_post_id, p_kind, 'owner',
    p_guest_id, p_guest_name, p_expected_at,
    p_courier_name, p_delivery_note, p_handover_item, p_note, p_delivery_mode
  );
end;
$fn$;

commit;
