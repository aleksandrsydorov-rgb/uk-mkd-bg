-- Security (Охрана) module v1: posts, shifts, requests, role охрана.

begin;

-- ---------------------------------------------------------------------------
-- Module catalog: promote security
-- ---------------------------------------------------------------------------

update public.module_catalog
   set implemented = true,
       default_name = 'Охрана',
       category = 'services',
       sort_order = coalesce(sort_order, 10)
 where module_key = 'security';

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'security', false, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'security'
);

-- ---------------------------------------------------------------------------
-- Staff role whitelist: add охрана
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where lower(btrim(s.email)) = lower(btrim(auth.email()))
      and s.active is true
      and s.role in ('администрация', 'бухгалтер', 'инженер', 'уборщик', 'охрана')
  );
$$;

create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_role in ('администрация', 'бухгалтер', 'инженер', 'уборщик', 'охрана')
    and exists (
      select 1
      from public.staff as s
      where lower(btrim(s.email)) = lower(btrim(auth.email()))
        and s.active is true
        and s.role = p_role
    );
$$;

create or replace function public.current_staff_id()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff as s
  where lower(btrim(s.email)) = lower(btrim(auth.email()))
    and s.active is true
    and s.role in ('администрация', 'бухгалтер', 'инженер', 'уборщик', 'охрана')
  order by s.id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.security_posts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint security_posts_name_nonempty check (length(btrim(name)) > 0)
);

create index if not exists security_posts_active_sort_idx
  on public.security_posts (active, sort_order, name);

create table if not exists public.security_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id integer not null
    references public.staff (id) on delete restrict,
  post_id uuid not null
    references public.security_posts (id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  constraint security_shifts_ended_after_start
    check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists security_shifts_one_active_per_staff_uidx
  on public.security_shifts (staff_id)
  where ended_at is null;

create index if not exists security_shifts_post_active_idx
  on public.security_shifts (post_id, started_at desc)
  where ended_at is null;

create table if not exists public.security_requests (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  post_id uuid not null
    references public.security_posts (id) on delete restrict,
  kind text not null
    constraint security_requests_kind_check
      check (kind in ('guest_pass', 'delivery', 'handover')),
  status text not null default 'pending'
    constraint security_requests_status_check
      check (status in ('pending', 'accepted', 'handed_over', 'cancelled', 'expired')),
  created_by_role text not null
    constraint security_requests_created_by_role_check
      check (created_by_role in ('owner', 'admin')),
  created_by_email text not null,
  guest_id bigint null
    references public.apartment_guests (id) on delete set null,
  guest_name text null,
  expected_at timestamptz null,
  courier_name text null,
  delivery_note text null,
  handover_item text null
    constraint security_requests_handover_item_check
      check (
        handover_item is null
        or handover_item in ('documents', 'keys', 'parcel')
      ),
  note text null,
  accepted_by integer null
    references public.staff (id) on delete set null,
  accepted_at timestamptz null,
  handed_over_by integer null
    references public.staff (id) on delete set null,
  handed_over_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists security_requests_post_status_idx
  on public.security_requests (post_id, status, created_at desc);

create index if not exists security_requests_property_idx
  on public.security_requests (property_id, created_at desc);

alter table public.security_posts enable row level security;
alter table public.security_shifts enable row level security;
alter table public.security_requests enable row level security;

revoke all on table public.security_posts from public;
revoke all on table public.security_posts from anon;
revoke all on table public.security_posts from authenticated;
revoke all on table public.security_shifts from public;
revoke all on table public.security_shifts from anon;
revoke all on table public.security_shifts from authenticated;
revoke all on table public.security_requests from public;
revoke all on table public.security_requests from anon;
revoke all on table public.security_requests from authenticated;

grant select on table public.security_posts to authenticated;
grant select on table public.security_shifts to authenticated;
grant select on table public.security_requests to authenticated;

drop policy if exists security_posts_select on public.security_posts;
create policy security_posts_select on public.security_posts
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('охрана')
    or public.is_staff()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

drop policy if exists security_shifts_select on public.security_shifts;
create policy security_shifts_select on public.security_shifts
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or staff_id = public.current_staff_id()
  );

drop policy if exists security_requests_select on public.security_requests;
create policy security_requests_select on public.security_requests
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('охрана')
    or public.owns_property(property_id)
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.security_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bm.enabled from public.building_modules as bm where bm.module_key = 'security'),
    false
  );
$$;

revoke all on function public.security_module_enabled() from public;
revoke all on function public.security_module_enabled() from anon;
revoke all on function public.security_module_enabled() from authenticated;

create or replace function public.security_default_post_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.security_posts as p
  where p.active is true;

  if v_count = 1 then
    select p.id into v_id
    from public.security_posts as p
    where p.active is true
    limit 1;
  end if;

  return v_id;
end;
$fn$;

revoke all on function public.security_default_post_id() from public;
revoke all on function public.security_default_post_id() from anon;
revoke all on function public.security_default_post_id() from authenticated;

create or replace function public.security_resolve_post_id(p_post_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid := p_post_id;
begin
  if v_id is null then
    v_id := public.security_default_post_id();
  end if;
  if v_id is null then
    raise exception 'security: post required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.security_posts as p
    where p.id = v_id and p.active is true
  ) then
    raise exception 'security: post not found'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.security_resolve_post_id(uuid) from public;
revoke all on function public.security_resolve_post_id(uuid) from anon;
revoke all on function public.security_resolve_post_id(uuid) from authenticated;

create or replace function public.guard_active_shift()
returns public.security_shifts
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_row public.security_shifts%rowtype;
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    return null;
  end if;
  select s.* into v_row
  from public.security_shifts as s
  where s.staff_id = v_staff
    and s.ended_at is null
  order by s.started_at desc
  limit 1;
  if not found then
    return null;
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.guard_active_shift() from public;
revoke all on function public.guard_active_shift() from anon;
grant execute on function public.guard_active_shift() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin posts
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_security_posts()
returns setof public.security_posts
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_list_security_posts: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('охрана') then
    raise exception 'admin_list_security_posts: not allowed'
      using errcode = '42501';
  end if;
  return query
  select p.*
  from public.security_posts as p
  order by p.sort_order, p.name, p.created_at;
end;
$fn$;

revoke all on function public.admin_list_security_posts() from public;
revoke all on function public.admin_list_security_posts() from anon;
grant execute on function public.admin_list_security_posts() to authenticated;

-- Owner-facing active posts (for create form)
create or replace function public.list_active_security_posts()
returns table (
  id uuid,
  name text,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_active_security_posts: not authenticated'
      using errcode = '28000';
  end if;
  if not public.security_module_enabled() then
    return;
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('охрана')
     and not exists (select 1 from public.properties as p where public.owns_property(p.id)) then
    raise exception 'list_active_security_posts: not allowed'
      using errcode = '42501';
  end if;
  return query
  select p.id, p.name, p.sort_order
  from public.security_posts as p
  where p.active is true
  order by p.sort_order, p.name;
end;
$fn$;

revoke all on function public.list_active_security_posts() from public;
revoke all on function public.list_active_security_posts() from anon;
grant execute on function public.list_active_security_posts() to authenticated;

create or replace function public.admin_create_security_post(
  p_name text,
  p_sort_order integer default 0
)
returns public.security_posts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.security_posts%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'admin_create_security_post: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_create_security_post: not allowed'
      using errcode = '42501';
  end if;
  if not public.security_module_enabled() then
    raise exception 'admin_create_security_post: module disabled'
      using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'admin_create_security_post: name required'
      using errcode = '22023';
  end if;
  insert into public.security_posts (name, sort_order)
  values (v_name, coalesce(p_sort_order, 0))
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.admin_create_security_post(text, integer) from public;
revoke all on function public.admin_create_security_post(text, integer) from anon;
grant execute on function public.admin_create_security_post(text, integer) to authenticated;

create or replace function public.admin_update_security_post(
  p_post_id uuid,
  p_name text default null,
  p_active boolean default null,
  p_sort_order integer default null
)
returns public.security_posts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.security_posts%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'admin_update_security_post: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_update_security_post: not allowed'
      using errcode = '42501';
  end if;
  if not public.security_module_enabled() then
    raise exception 'admin_update_security_post: module disabled'
      using errcode = '42501';
  end if;
  update public.security_posts as p
     set name = coalesce(v_name, p.name),
         active = coalesce(p_active, p.active),
         sort_order = coalesce(p_sort_order, p.sort_order)
   where p.id = p_post_id
  returning * into v_row;
  if not found then
    raise exception 'admin_update_security_post: not found'
      using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.admin_update_security_post(uuid, text, boolean, integer) from public;
revoke all on function public.admin_update_security_post(uuid, text, boolean, integer) from anon;
grant execute on function public.admin_update_security_post(uuid, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Create request (shared validation)
-- ---------------------------------------------------------------------------

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
  p_note text
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
  if p_created_by_role not in ('owner', 'admin') then
    raise exception 'security: invalid creator'
      using errcode = '22023';
  end if;

  v_post := public.security_resolve_post_id(p_post_id);

  if v_kind = 'guest_pass' and v_guest_name is null and p_guest_id is null then
    raise exception 'security: guest name required'
      using errcode = '22023';
  end if;
  if v_kind = 'delivery' and v_courier is null and v_delivery is null then
    raise exception 'security: delivery details required'
      using errcode = '22023';
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
    handover_item, note
  ) values (
    p_property_id, v_post, v_kind, 'pending', p_created_by_role, v_email,
    p_guest_id, v_guest_name, p_expected_at, v_courier, v_delivery,
    case when v_kind = 'handover' then v_handover else null end,
    v_note
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.security_insert_request(
  bigint, uuid, text, text, bigint, text, timestamptz, text, text, text, text
) from public;
revoke all on function public.security_insert_request(
  bigint, uuid, text, text, bigint, text, timestamptz, text, text, text, text
) from anon;

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
  p_note text default null
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
  if not public.owns_property(p_property_id) then
    raise exception 'owner_create_security_request: not allowed'
      using errcode = '42501';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'security');
  return public.security_insert_request(
    p_property_id, p_post_id, p_kind, 'owner',
    p_guest_id, p_guest_name, p_expected_at,
    p_courier_name, p_delivery_note, p_handover_item, p_note
  );
end;
$fn$;

revoke all on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
) from public;
revoke all on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
) from anon;
grant execute on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
) to authenticated;

create or replace function public.admin_create_security_request(
  p_property_id bigint,
  p_kind text,
  p_post_id uuid default null,
  p_guest_id bigint default null,
  p_guest_name text default null,
  p_expected_at timestamptz default null,
  p_courier_name text default null,
  p_delivery_note text default null,
  p_handover_item text default null,
  p_note text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_create_security_request: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_create_security_request: not allowed'
      using errcode = '42501';
  end if;
  return public.security_insert_request(
    p_property_id, p_post_id, p_kind, 'admin',
    p_guest_id, p_guest_name, p_expected_at,
    p_courier_name, p_delivery_note, p_handover_item, p_note
  );
end;
$fn$;

revoke all on function public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
) from public;
revoke all on function public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
) from anon;
grant execute on function public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
) to authenticated;

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
  where public.owns_property(r.property_id)
    and (p_property_id is null or r.property_id = p_property_id)
  order by r.created_at desc
  limit 200;
end;
$fn$;

revoke all on function public.owner_list_my_security_requests(bigint) from public;
revoke all on function public.owner_list_my_security_requests(bigint) from anon;
grant execute on function public.owner_list_my_security_requests(bigint) to authenticated;

create or replace function public.owner_cancel_security_request(p_request_id uuid)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.security_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'owner_cancel_security_request: not authenticated'
      using errcode = '28000';
  end if;
  select r.* into v_row
  from public.security_requests as r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'owner_cancel_security_request: not found'
      using errcode = 'P0002';
  end if;
  if not public.owns_property(v_row.property_id) then
    raise exception 'owner_cancel_security_request: not allowed'
      using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'owner_cancel_security_request: not pending'
      using errcode = 'P0001';
  end if;
  update public.security_requests as r
     set status = 'cancelled',
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.owner_cancel_security_request(uuid) from public;
revoke all on function public.owner_cancel_security_request(uuid) from anon;
grant execute on function public.owner_cancel_security_request(uuid) to authenticated;

create or replace function public.admin_list_security_requests(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  post_id uuid,
  post_name text,
  kind text,
  status text,
  created_by_role text,
  created_by_email text,
  guest_name text,
  expected_at timestamptz,
  courier_name text,
  delivery_note text,
  handover_item text,
  note text,
  accepted_at timestamptz,
  handed_over_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if auth.uid() is null then
    raise exception 'admin_list_security_requests: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_security_requests: not allowed'
      using errcode = '42501';
  end if;
  return query
  select
    r.id,
    r.property_id,
    coalesce(p.apartment_number::text, ''),
    r.post_id,
    sp.name,
    r.kind,
    r.status,
    r.created_by_role,
    r.created_by_email,
    r.guest_name,
    r.expected_at,
    r.courier_name,
    r.delivery_note,
    r.handover_item,
    r.note,
    r.accepted_at,
    r.handed_over_at,
    r.created_at
  from public.security_requests as r
  join public.properties as p on p.id = r.property_id
  join public.security_posts as sp on sp.id = r.post_id
  where (v_status is null or r.status = v_status)
  order by r.created_at desc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_security_requests(text, integer) from public;
revoke all on function public.admin_list_security_requests(text, integer) from anon;
grant execute on function public.admin_list_security_requests(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Guard shift + queue
-- ---------------------------------------------------------------------------

create or replace function public.guard_open_shift(p_post_id uuid)
returns public.security_shifts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_post uuid;
  v_row public.security_shifts%rowtype;
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard_open_shift: not allowed'
      using errcode = '42501';
  end if;
  if not public.security_module_enabled() then
    raise exception 'guard_open_shift: module disabled'
      using errcode = '42501';
  end if;
  v_post := public.security_resolve_post_id(p_post_id);

  if exists (
    select 1 from public.security_shifts as s
    where s.staff_id = v_staff and s.ended_at is null
  ) then
    raise exception 'guard_open_shift: already on shift'
      using errcode = 'P0001';
  end if;

  insert into public.security_shifts (staff_id, post_id)
  values (v_staff, v_post)
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_open_shift(uuid) from public;
revoke all on function public.guard_open_shift(uuid) from anon;
grant execute on function public.guard_open_shift(uuid) to authenticated;

create or replace function public.guard_close_shift()
returns public.security_shifts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_row public.security_shifts%rowtype;
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard_close_shift: not allowed'
      using errcode = '42501';
  end if;
  select s.* into v_row
  from public.security_shifts as s
  where s.staff_id = v_staff and s.ended_at is null
  for update;
  if not found then
    raise exception 'guard_close_shift: no active shift'
      using errcode = 'P0001';
  end if;
  update public.security_shifts as s
     set ended_at = now()
   where s.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_close_shift() from public;
revoke all on function public.guard_close_shift() from anon;
grant execute on function public.guard_close_shift() to authenticated;

create or replace function public.guard_my_shift()
returns table (
  shift_id uuid,
  post_id uuid,
  post_name text,
  started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_shift public.security_shifts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'guard_my_shift: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('охрана') then
    raise exception 'guard_my_shift: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    return;
  end if;
  return query
  select v_shift.id, v_shift.post_id, p.name, v_shift.started_at
  from public.security_posts as p
  where p.id = v_shift.post_id;
end;
$fn$;

revoke all on function public.guard_my_shift() from public;
revoke all on function public.guard_my_shift() from anon;
grant execute on function public.guard_my_shift() to authenticated;

create or replace function public.guard_list_post_queue()
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  post_id uuid,
  kind text,
  status text,
  guest_name text,
  expected_at timestamptz,
  courier_name text,
  delivery_note text,
  handover_item text,
  note text,
  created_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_shift public.security_shifts%rowtype;
begin
  if not public.has_staff_role('охрана') then
    raise exception 'guard_list_post_queue: not allowed'
      using errcode = '42501';
  end if;
  if not public.security_module_enabled() then
    raise exception 'guard_list_post_queue: module disabled'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    raise exception 'guard_list_post_queue: no active shift'
      using errcode = 'P0001';
  end if;
  return query
  select
    r.id,
    r.property_id,
    coalesce(p.apartment_number::text, ''),
    r.post_id,
    r.kind,
    r.status,
    r.guest_name,
    r.expected_at,
    r.courier_name,
    r.delivery_note,
    r.handover_item,
    r.note,
    r.created_at,
    r.accepted_at
  from public.security_requests as r
  join public.properties as p on p.id = r.property_id
  where r.post_id = v_shift.post_id
    and r.status in ('pending', 'accepted')
  order by
    case when r.status = 'pending' then 0 else 1 end,
    r.created_at asc;
end;
$fn$;

revoke all on function public.guard_list_post_queue() from public;
revoke all on function public.guard_list_post_queue() from anon;
grant execute on function public.guard_list_post_queue() to authenticated;

create or replace function public.guard_accept_request(p_request_id uuid)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_shift public.security_shifts%rowtype;
  v_row public.security_requests%rowtype;
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard_accept_request: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    raise exception 'guard_accept_request: no active shift'
      using errcode = 'P0001';
  end if;
  select r.* into v_row
  from public.security_requests as r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'guard_accept_request: not found'
      using errcode = 'P0002';
  end if;
  if v_row.post_id <> v_shift.post_id then
    raise exception 'guard_accept_request: wrong post'
      using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'guard_accept_request: not pending'
      using errcode = 'P0001';
  end if;
  update public.security_requests as r
     set status = 'accepted',
         accepted_by = v_staff,
         accepted_at = now(),
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_accept_request(uuid) from public;
revoke all on function public.guard_accept_request(uuid) from anon;
grant execute on function public.guard_accept_request(uuid) to authenticated;

create or replace function public.guard_handover_request(p_request_id uuid)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_shift public.security_shifts%rowtype;
  v_row public.security_requests%rowtype;
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard_handover_request: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    raise exception 'guard_handover_request: no active shift'
      using errcode = 'P0001';
  end if;
  select r.* into v_row
  from public.security_requests as r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'guard_handover_request: not found'
      using errcode = 'P0002';
  end if;
  if v_row.post_id <> v_shift.post_id then
    raise exception 'guard_handover_request: wrong post'
      using errcode = '42501';
  end if;
  if v_row.status not in ('pending', 'accepted') then
    raise exception 'guard_handover_request: invalid status'
      using errcode = 'P0001';
  end if;
  update public.security_requests as r
     set status = 'handed_over',
         accepted_by = coalesce(r.accepted_by, v_staff),
         accepted_at = coalesce(r.accepted_at, now()),
         handed_over_by = v_staff,
         handed_over_at = now(),
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_handover_request(uuid) from public;
revoke all on function public.guard_handover_request(uuid) from anon;
grant execute on function public.guard_handover_request(uuid) to authenticated;

commit;
