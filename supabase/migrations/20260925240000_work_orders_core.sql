-- AMADEUS 11 Work Orders Phase 1 foundation.
-- Internal staff tasks only. Never creates owner debt/payment.
-- Closing a work order does NOT close the source Request.
-- Does not change Requests workflow, Finance, or Module Core.

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
    and s.role in ('администрация', 'бухгалтер', 'инженер', 'уборщик')
  order by s.id
  limit 1;
$$;

revoke all on function public.current_staff_id() from public;
revoke all on function public.current_staff_id() from anon;
grant execute on function public.current_staff_id() to authenticated;

create or replace function public.is_work_order_assignee_role(p_staff_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where s.id = p_staff_id
      and s.active is true
      and s.role in ('уборщик', 'инженер')
  );
$$;

revoke all on function public.is_work_order_assignee_role(integer) from public;
revoke all on function public.is_work_order_assignee_role(integer) from anon;
grant execute on function public.is_work_order_assignee_role(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  instructions text null,
  status text not null default 'open'
    constraint work_orders_status_check
      check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'normal'
    constraint work_orders_priority_check
      check (priority in ('low', 'normal', 'high')),
  assigned_staff_id integer null
    references public.staff (id)
    on delete set null,
  scheduled_for timestamptz null,
  target_property_id bigint null
    references public.properties (id)
    on delete set null,
  location_description text null,
  source_type text not null
    constraint work_orders_source_type_check
      check (source_type in ('request', 'admin')),
  request_id bigint null
    references public.requests (id)
    on delete set null,
  created_by uuid not null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  completion_note text null,
  idempotency_key uuid null,
  constraint work_orders_source_request_ck check (
    (source_type = 'request' and request_id is not null)
    or (source_type = 'admin' and request_id is null)
  )
);

comment on table public.work_orders is
  'Internal staff work orders. Never creates owner debt/payment. Independent of Request status.';

create unique index if not exists work_orders_idempotency_key_uidx
  on public.work_orders (idempotency_key)
  where idempotency_key is not null;

create index if not exists work_orders_assigned_staff_id_idx
  on public.work_orders (assigned_staff_id);

create index if not exists work_orders_status_idx
  on public.work_orders (status);

create index if not exists work_orders_request_id_idx
  on public.work_orders (request_id);

alter table public.work_orders enable row level security;

revoke all on table public.work_orders from public;
revoke all on table public.work_orders from anon;
revoke all on table public.work_orders from authenticated;

-- ---------------------------------------------------------------------------
-- Read RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_work_orders_admin()
returns table (
  id uuid,
  title text,
  instructions text,
  status text,
  priority text,
  assigned_staff_id integer,
  assignee_name text,
  assignee_role text,
  scheduled_for timestamptz,
  target_property_id bigint,
  apartment_number text,
  location_description text,
  source_type text,
  request_id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  completion_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_work_orders_admin: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'list_work_orders_admin: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    wo.id,
    wo.title,
    wo.instructions,
    wo.status,
    wo.priority,
    wo.assigned_staff_id,
    s.name,
    s.role,
    wo.scheduled_for,
    wo.target_property_id,
    case when p.id is null then null else p.apartment_number::text end,
    wo.location_description,
    wo.source_type,
    wo.request_id,
    wo.created_at,
    wo.updated_at,
    wo.completed_at,
    wo.completion_note
  from public.work_orders as wo
  left join public.staff as s on s.id = wo.assigned_staff_id
  left join public.properties as p on p.id = wo.target_property_id
  order by
    case wo.status
      when 'open' then 1
      when 'in_progress' then 2
      when 'completed' then 3
      else 4
    end,
    wo.scheduled_for nulls last,
    wo.created_at desc;
end;
$fn$;

revoke all on function public.list_work_orders_admin() from public;
revoke execute on function public.list_work_orders_admin() from anon;
grant execute on function public.list_work_orders_admin() to authenticated;

-- Worker-safe list: no request payload, owner contacts, or photos.
create or replace function public.list_my_work_orders()
returns table (
  id uuid,
  title text,
  instructions text,
  status text,
  priority text,
  scheduled_for timestamptz,
  apartment_number text,
  location_description text,
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
begin
  if auth.uid() is null then
    raise exception 'list_my_work_orders: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.has_staff_role('уборщик')
    or public.has_staff_role('инженер')
  ) then
    raise exception 'list_my_work_orders: not allowed'
      using errcode = '42501';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'list_my_work_orders: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    wo.id,
    wo.title,
    wo.instructions,
    wo.status,
    wo.priority,
    wo.scheduled_for,
    case when p.id is null then null else p.apartment_number::text end,
    wo.location_description,
    wo.completed_at,
    wo.completion_note,
    wo.created_at
  from public.work_orders as wo
  left join public.properties as p on p.id = wo.target_property_id
  where wo.assigned_staff_id = v_staff_id
    and wo.status in ('open', 'in_progress', 'completed')
  order by
    case wo.status
      when 'open' then 1
      when 'in_progress' then 2
      when 'completed' then 3
      else 4
    end,
    wo.scheduled_for nulls last,
    wo.created_at desc;
end;
$fn$;

revoke all on function public.list_my_work_orders() from public;
revoke execute on function public.list_my_work_orders() from anon;
grant execute on function public.list_my_work_orders() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin mutations
-- ---------------------------------------------------------------------------

create or replace function public.create_work_order(
  p_title text,
  p_instructions text default null,
  p_priority text default 'normal',
  p_assigned_staff_id integer default null,
  p_scheduled_for timestamptz default null,
  p_target_property_id bigint default null,
  p_location_description text default null,
  p_idempotency_key uuid default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_title text;
  v_priority text;
  v_row public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'create_work_order: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'create_work_order: not allowed'
      using errcode = '42501';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then
    raise exception 'create_work_order: title required'
      using errcode = '22023';
  end if;

  v_priority := btrim(coalesce(p_priority, 'normal'));
  if v_priority not in ('low', 'normal', 'high') then
    raise exception 'create_work_order: invalid priority'
      using errcode = '22023';
  end if;

  if p_assigned_staff_id is not null
     and not public.is_work_order_assignee_role(p_assigned_staff_id) then
    raise exception 'create_work_order: assignee must be active cleaner or engineer'
      using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select wo.*
      into v_row
    from public.work_orders as wo
    where wo.idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  insert into public.work_orders (
    title,
    instructions,
    status,
    priority,
    assigned_staff_id,
    scheduled_for,
    target_property_id,
    location_description,
    source_type,
    request_id,
    created_by,
    updated_by,
    idempotency_key
  ) values (
    v_title,
    nullif(btrim(coalesce(p_instructions, '')), ''),
    'open',
    v_priority,
    p_assigned_staff_id,
    p_scheduled_for,
    p_target_property_id,
    nullif(btrim(coalesce(p_location_description, '')), ''),
    'admin',
    null,
    auth.uid(),
    auth.uid(),
    p_idempotency_key
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.create_work_order(text, text, text, integer, timestamptz, bigint, text, uuid) from public;
revoke execute on function public.create_work_order(text, text, text, integer, timestamptz, bigint, text, uuid) from anon;
grant execute on function public.create_work_order(text, text, text, integer, timestamptz, bigint, text, uuid) to authenticated;

create or replace function public.create_work_order_from_request(
  p_request_id bigint,
  p_title text default null,
  p_instructions text default null,
  p_priority text default 'normal',
  p_assigned_staff_id integer default null,
  p_scheduled_for timestamptz default null,
  p_location_description text default null,
  p_idempotency_key uuid default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_req public.requests;
  v_title text;
  v_instructions text;
  v_priority text;
  v_row public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'create_work_order_from_request: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'create_work_order_from_request: not allowed'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'create_work_order_from_request: request required'
      using errcode = '22023';
  end if;

  select r.*
    into v_req
  from public.requests as r
  where r.id = p_request_id;

  if not found then
    raise exception 'create_work_order_from_request: request not found'
      using errcode = 'P0002';
  end if;

  -- Does not change request status/workflow.
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := nullif(btrim(coalesce(v_req.subject, '')), '');
  end if;
  if v_title is null then
    v_title := 'Work order';
  end if;

  v_instructions := nullif(btrim(coalesce(p_instructions, '')), '');
  if v_instructions is null then
    v_instructions := nullif(btrim(coalesce(v_req.description, '')), '');
  end if;

  v_priority := btrim(coalesce(p_priority, 'normal'));
  if v_priority not in ('low', 'normal', 'high') then
    raise exception 'create_work_order_from_request: invalid priority'
      using errcode = '22023';
  end if;

  if p_assigned_staff_id is not null
     and not public.is_work_order_assignee_role(p_assigned_staff_id) then
    raise exception 'create_work_order_from_request: assignee must be active cleaner or engineer'
      using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select wo.*
      into v_row
    from public.work_orders as wo
    where wo.idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  insert into public.work_orders (
    title,
    instructions,
    status,
    priority,
    assigned_staff_id,
    scheduled_for,
    target_property_id,
    location_description,
    source_type,
    request_id,
    created_by,
    updated_by,
    idempotency_key
  ) values (
    v_title,
    v_instructions,
    'open',
    v_priority,
    p_assigned_staff_id,
    p_scheduled_for,
    v_req.property_id,
    nullif(btrim(coalesce(p_location_description, '')), ''),
    'request',
    v_req.id,
    auth.uid(),
    auth.uid(),
    p_idempotency_key
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.create_work_order_from_request(bigint, text, text, text, integer, timestamptz, text, uuid) from public;
revoke execute on function public.create_work_order_from_request(bigint, text, text, text, integer, timestamptz, text, uuid) from anon;
grant execute on function public.create_work_order_from_request(bigint, text, text, text, integer, timestamptz, text, uuid) to authenticated;

create or replace function public.assign_work_order(
  p_work_order_id uuid,
  p_assigned_staff_id integer
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'assign_work_order: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'assign_work_order: not allowed'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'assign_work_order: id required'
      using errcode = '22023';
  end if;

  if p_assigned_staff_id is not null
     and not public.is_work_order_assignee_role(p_assigned_staff_id) then
    raise exception 'assign_work_order: assignee must be active cleaner or engineer'
      using errcode = '22023';
  end if;

  update public.work_orders as wo
     set assigned_staff_id = p_assigned_staff_id,
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = p_work_order_id
     and wo.status in ('open', 'in_progress')
  returning * into v_row;

  if not found then
    raise exception 'assign_work_order: not found or not assignable'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.assign_work_order(uuid, integer) from public;
revoke execute on function public.assign_work_order(uuid, integer) from anon;
grant execute on function public.assign_work_order(uuid, integer) to authenticated;

create or replace function public.cancel_work_order(
  p_work_order_id uuid
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'cancel_work_order: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'cancel_work_order: not allowed'
      using errcode = '42501';
  end if;

  update public.work_orders as wo
     set status = 'cancelled',
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = p_work_order_id
     and wo.status in ('open', 'in_progress')
  returning * into v_row;

  if not found then
    raise exception 'cancel_work_order: not found or not cancellable'
      using errcode = 'P0002';
  end if;

  -- Does not change linked Request status.
  return v_row;
end;
$fn$;

revoke all on function public.cancel_work_order(uuid) from public;
revoke execute on function public.cancel_work_order(uuid) from anon;
grant execute on function public.cancel_work_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker mutations (own assigned tasks only)
-- ---------------------------------------------------------------------------

create or replace function public.start_work_order(
  p_work_order_id uuid
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
  v_row public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'start_work_order: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.has_staff_role('уборщик')
    or public.has_staff_role('инженер')
  ) then
    raise exception 'start_work_order: not allowed'
      using errcode = '42501';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'start_work_order: not allowed'
      using errcode = '42501';
  end if;

  update public.work_orders as wo
     set status = 'in_progress',
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = p_work_order_id
     and wo.assigned_staff_id = v_staff_id
     and wo.status = 'open'
  returning * into v_row;

  if not found then
    raise exception 'start_work_order: not found or not startable'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.start_work_order(uuid) from public;
revoke execute on function public.start_work_order(uuid) from anon;
grant execute on function public.start_work_order(uuid) to authenticated;

create or replace function public.complete_work_order(
  p_work_order_id uuid,
  p_completion_note text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
  v_row public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'complete_work_order: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.has_staff_role('уборщик')
    or public.has_staff_role('инженер')
  ) then
    raise exception 'complete_work_order: not allowed'
      using errcode = '42501';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'complete_work_order: not allowed'
      using errcode = '42501';
  end if;

  update public.work_orders as wo
     set status = 'completed',
         completion_note = nullif(btrim(coalesce(p_completion_note, '')), ''),
         completed_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = p_work_order_id
     and wo.assigned_staff_id = v_staff_id
     and wo.status = 'in_progress'
  returning * into v_row;

  if not found then
    raise exception 'complete_work_order: not found or not completable'
      using errcode = 'P0002';
  end if;

  -- Does not change linked Request status. Never creates finance entries.
  return v_row;
end;
$fn$;

revoke all on function public.complete_work_order(uuid, text) from public;
revoke execute on function public.complete_work_order(uuid, text) from anon;
grant execute on function public.complete_work_order(uuid, text) to authenticated;

commit;
