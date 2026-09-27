-- Cleaning module v1: resident apartment cleaning service orders (no billing).
-- Separate from complex cleaning via requests/work-orders category «уборка».

begin;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

update public.module_catalog
   set implemented = true,
       default_name = 'Уборка',
       category = 'services',
       sort_order = coalesce(sort_order, 12)
 where module_key = 'cleaning';

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'cleaning', false, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'cleaning'
);

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.cleaning_orders (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  service_kind text not null
    constraint cleaning_orders_service_kind_check
      check (service_kind in ('standard', 'deep', 'after_guests')),
  status text not null default 'pending'
    constraint cleaning_orders_status_check
      check (status in ('pending', 'confirmed', 'done', 'cancelled')),
  preferred_date date null,
  time_slot text not null default 'any'
    constraint cleaning_orders_time_slot_check
      check (time_slot in ('morning', 'afternoon', 'any')),
  note text null,
  admin_note text null,
  created_by_role text not null
    constraint cleaning_orders_created_by_role_check
      check (created_by_role in ('owner', 'admin')),
  created_by_email text not null,
  work_order_id uuid null
    references public.work_orders (id) on delete set null,
  confirmed_by integer null
    references public.staff (id) on delete set null,
  confirmed_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cleaning_orders_property_idx
  on public.cleaning_orders (property_id, created_at desc);

create index if not exists cleaning_orders_status_idx
  on public.cleaning_orders (status, created_at desc);

alter table public.cleaning_orders enable row level security;

revoke all on table public.cleaning_orders from public;
revoke all on table public.cleaning_orders from anon;
revoke all on table public.cleaning_orders from authenticated;
grant select on table public.cleaning_orders to authenticated;

drop policy if exists cleaning_orders_select on public.cleaning_orders;
create policy cleaning_orders_select
  on public.cleaning_orders
  for select
  to authenticated
  using (
    public.has_staff_role('администрация')
    or public.owns_property(property_id)
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.cleaning_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bm.enabled from public.building_modules as bm where bm.module_key = 'cleaning'),
    false
  );
$$;

revoke all on function public.cleaning_module_enabled() from public;
revoke all on function public.cleaning_module_enabled() from anon;
revoke all on function public.cleaning_module_enabled() from authenticated;

create or replace function public.cleaning_assert_module()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.cleaning_module_enabled() then
    raise exception 'cleaning: module disabled'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.cleaning_assert_module() from public;
revoke all on function public.cleaning_assert_module() from anon;

create or replace function public.cleaning_insert_order(
  p_property_id bigint,
  p_service_kind text,
  p_preferred_date date,
  p_time_slot text,
  p_note text,
  p_created_by_role text
)
returns public.cleaning_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind text := nullif(btrim(coalesce(p_service_kind, '')), '');
  v_slot text := coalesce(nullif(btrim(coalesce(p_time_slot, '')), ''), 'any');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_row public.cleaning_orders%rowtype;
begin
  perform public.cleaning_assert_module();

  if p_property_id is null then
    raise exception 'cleaning: property required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'cleaning: property not found'
      using errcode = 'P0002';
  end if;
  if v_kind is null or v_kind not in ('standard', 'deep', 'after_guests') then
    raise exception 'cleaning: invalid service_kind'
      using errcode = '22023';
  end if;
  if v_slot not in ('morning', 'afternoon', 'any') then
    raise exception 'cleaning: invalid time_slot'
      using errcode = '22023';
  end if;
  if p_created_by_role not in ('owner', 'admin') then
    raise exception 'cleaning: invalid created_by_role'
      using errcode = '22023';
  end if;
  if v_email is null then
    raise exception 'cleaning: email required'
      using errcode = '28000';
  end if;

  insert into public.cleaning_orders (
    property_id, service_kind, preferred_date, time_slot, note,
    created_by_role, created_by_email
  ) values (
    p_property_id, v_kind, p_preferred_date, v_slot, v_note,
    p_created_by_role, v_email
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.cleaning_insert_order(
  bigint, text, date, text, text, text
) from public;
revoke all on function public.cleaning_insert_order(
  bigint, text, date, text, text, text
) from anon;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------

create or replace function public.owner_create_cleaning_order(
  p_property_id bigint,
  p_service_kind text,
  p_preferred_date date default null,
  p_time_slot text default 'any',
  p_note text default null
)
returns public.cleaning_orders
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_create_cleaning_order: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_create_cleaning_order: not allowed'
      using errcode = '42501';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'cleaning');
  return public.cleaning_insert_order(
    p_property_id, p_service_kind, p_preferred_date, p_time_slot, p_note, 'owner'
  );
end;
$fn$;

revoke all on function public.owner_create_cleaning_order(
  bigint, text, date, text, text
) from public;
revoke all on function public.owner_create_cleaning_order(
  bigint, text, date, text, text
) from anon;
grant execute on function public.owner_create_cleaning_order(
  bigint, text, date, text, text
) to authenticated;

create or replace function public.owner_list_my_cleaning_orders(p_property_id bigint)
returns setof public.cleaning_orders
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_list_my_cleaning_orders: not authenticated'
      using errcode = '28000';
  end if;
  perform public.cleaning_assert_module();
  if not public.owns_property(p_property_id) then
    raise exception 'owner_list_my_cleaning_orders: not allowed'
      using errcode = '42501';
  end if;
  return query
  select o.*
  from public.cleaning_orders as o
  where o.property_id = p_property_id
  order by o.created_at desc
  limit 100;
end;
$fn$;

revoke all on function public.owner_list_my_cleaning_orders(bigint) from public;
revoke all on function public.owner_list_my_cleaning_orders(bigint) from anon;
grant execute on function public.owner_list_my_cleaning_orders(bigint) to authenticated;

create or replace function public.owner_cancel_cleaning_order(p_order_id uuid)
returns public.cleaning_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.cleaning_orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'owner_cancel_cleaning_order: not authenticated'
      using errcode = '28000';
  end if;
  perform public.cleaning_assert_module();

  select o.* into v_row
  from public.cleaning_orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'owner_cancel_cleaning_order: not found'
      using errcode = 'P0002';
  end if;
  if not public.owns_property(v_row.property_id) then
    raise exception 'owner_cancel_cleaning_order: not allowed'
      using errcode = '42501';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'owner_cancel_cleaning_order: only pending'
      using errcode = 'P0001';
  end if;

  update public.cleaning_orders as o
     set status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   where o.id = p_order_id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.owner_cancel_cleaning_order(uuid) from public;
revoke all on function public.owner_cancel_cleaning_order(uuid) from anon;
grant execute on function public.owner_cancel_cleaning_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_cleaning_orders(p_limit integer default 100)
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  service_kind text,
  status text,
  preferred_date date,
  time_slot text,
  note text,
  admin_note text,
  created_by_role text,
  created_by_email text,
  work_order_id uuid,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_cleaning_orders: not allowed'
      using errcode = '42501';
  end if;
  perform public.cleaning_assert_module();

  return query
  select
    o.id,
    o.property_id,
    p.apartment_number::text,
    o.service_kind,
    o.status,
    o.preferred_date,
    o.time_slot,
    o.note,
    o.admin_note,
    o.created_by_role,
    o.created_by_email,
    o.work_order_id,
    o.confirmed_at,
    o.completed_at,
    o.cancelled_at,
    o.created_at
  from public.cleaning_orders as o
  join public.properties as p on p.id = o.property_id
  order by o.created_at desc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_cleaning_orders(integer) from public;
revoke all on function public.admin_list_cleaning_orders(integer) from anon;
grant execute on function public.admin_list_cleaning_orders(integer) to authenticated;

create or replace function public.admin_create_cleaning_order(
  p_property_id bigint,
  p_service_kind text,
  p_preferred_date date default null,
  p_time_slot text default 'any',
  p_note text default null
)
returns public.cleaning_orders
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_create_cleaning_order: not allowed'
      using errcode = '42501';
  end if;
  return public.cleaning_insert_order(
    p_property_id, p_service_kind, p_preferred_date, p_time_slot, p_note, 'admin'
  );
end;
$fn$;

revoke all on function public.admin_create_cleaning_order(
  bigint, text, date, text, text
) from public;
revoke all on function public.admin_create_cleaning_order(
  bigint, text, date, text, text
) from anon;
grant execute on function public.admin_create_cleaning_order(
  bigint, text, date, text, text
) to authenticated;

create or replace function public.admin_set_cleaning_order_status(
  p_order_id uuid,
  p_status text,
  p_admin_note text default null,
  p_create_work_order boolean default false
)
returns public.cleaning_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_row public.cleaning_orders%rowtype;
  v_staff integer := public.current_staff_id();
  v_apt text;
  v_wo_id uuid := null;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_set_cleaning_order_status: not allowed'
      using errcode = '42501';
  end if;
  perform public.cleaning_assert_module();

  if v_status is null or v_status not in ('confirmed', 'done', 'cancelled') then
    raise exception 'admin_set_cleaning_order_status: invalid status'
      using errcode = '22023';
  end if;

  select o.* into v_row
  from public.cleaning_orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'admin_set_cleaning_order_status: not found'
      using errcode = 'P0002';
  end if;

  if v_status = 'confirmed' then
    if v_row.status is distinct from 'pending' then
      raise exception 'admin_set_cleaning_order_status: confirm only from pending'
        using errcode = 'P0001';
    end if;

    if coalesce(p_create_work_order, false) and v_row.work_order_id is null then
      select p.apartment_number::text into v_apt
      from public.properties as p where p.id = v_row.property_id;

      v_wo_id := (
        public.create_work_order(
          'Уборка кв. ' || coalesce(v_apt, '?'),
          coalesce(v_row.note, '') || case
            when v_row.preferred_date is not null
            then E'\nДата: ' || v_row.preferred_date::text
            else ''
          end || E'\nВид: ' || v_row.service_kind || E'\nСлот: ' || v_row.time_slot,
          'normal',
          null,
          case
            when v_row.preferred_date is not null
            then (v_row.preferred_date::timestamp at time zone 'Europe/Sofia')
            else null
          end,
          v_row.property_id,
          'Квартира ' || coalesce(v_apt, ''),
          null
        )
      ).id;
    end if;

    update public.cleaning_orders as o
       set status = 'confirmed',
           confirmed_by = v_staff,
           confirmed_at = now(),
           admin_note = coalesce(v_note, o.admin_note),
           work_order_id = coalesce(v_wo_id, o.work_order_id),
           updated_at = now()
     where o.id = p_order_id
    returning * into v_row;

  elsif v_status = 'done' then
    if v_row.status not in ('pending', 'confirmed') then
      raise exception 'admin_set_cleaning_order_status: done only from pending/confirmed'
        using errcode = 'P0001';
    end if;
    update public.cleaning_orders as o
       set status = 'done',
           completed_at = now(),
           confirmed_by = coalesce(o.confirmed_by, v_staff),
           confirmed_at = coalesce(o.confirmed_at, now()),
           admin_note = coalesce(v_note, o.admin_note),
           updated_at = now()
     where o.id = p_order_id
    returning * into v_row;

  else -- cancelled
    if v_row.status in ('done', 'cancelled') then
      raise exception 'admin_set_cleaning_order_status: cannot cancel terminal'
        using errcode = 'P0001';
    end if;
    update public.cleaning_orders as o
       set status = 'cancelled',
           cancelled_at = now(),
           admin_note = coalesce(v_note, o.admin_note),
           updated_at = now()
     where o.id = p_order_id
    returning * into v_row;
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_set_cleaning_order_status(
  uuid, text, text, boolean
) from public;
revoke all on function public.admin_set_cleaning_order_status(
  uuid, text, text, boolean
) from anon;
grant execute on function public.admin_set_cleaning_order_status(
  uuid, text, text, boolean
) to authenticated;

-- Allow cleaning in service-lock scopes
create or replace function public.admin_lock_property_services(
  p_property_id bigint,
  p_note text default null,
  p_scopes text[] default null
)
returns public.property_service_locks
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text := nullif(btrim(auth.email()), '');
  v_row public.property_service_locks%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_scopes text[];
  v_allowed text[] := array[
    'all',
    'requests',
    'chat',
    'polls',
    'water',
    'electricity',
    'internet',
    'occupancy',
    'security',
    'cleaning',
    'elevator',
    'parking',
    'access_control'
  ];
begin
  if v_uid is null then
    raise exception 'admin_lock_property_services: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_lock_property_services: not allowed'
      using errcode = '42501';
  end if;
  if not public.service_lock_module_enabled() then
    raise exception 'admin_lock_property_services: module disabled'
      using errcode = '42501';
  end if;
  if p_property_id is null then
    raise exception 'admin_lock_property_services: property required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_lock_property_services: property not found'
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct s order by s), array[]::text[])
    into v_scopes
  from unnest(coalesce(p_scopes, array['all']::text[])) as s
  where nullif(btrim(s), '') is not null
    and btrim(s) = any (v_allowed);

  if v_scopes is null or cardinality(v_scopes) < 1 then
    raise exception 'admin_lock_property_services: scopes required'
      using errcode = '22023';
  end if;

  if 'all' = any (v_scopes) then
    v_scopes := array['all']::text[];
  end if;

  if exists (
    select 1 from public.property_service_locks as l
    where l.property_id = p_property_id and l.active is true
  ) then
    raise exception 'admin_lock_property_services: already locked'
      using errcode = 'P0001';
  end if;

  insert into public.property_service_locks (
    property_id, active, reason_code, admin_note, locked_by, locked_at, scopes
  ) values (
    p_property_id, true, 'debt', v_note, v_uid, now(), v_scopes
  )
  returning * into v_row;

  insert into public.property_service_lock_events (
    property_id, lock_id, event_type, reason_code, admin_note, actor_email
  ) values (
    p_property_id, v_row.id, 'lock', 'debt',
    coalesce(v_note, '') || ' · scopes=' || array_to_string(v_scopes, ','),
    v_email
  );

  return v_row;
end;
$fn$;

revoke all on function public.admin_lock_property_services(bigint, text, text[]) from public;
revoke all on function public.admin_lock_property_services(bigint, text, text[]) from anon;
grant execute on function public.admin_lock_property_services(bigint, text, text[]) to authenticated;

commit;
