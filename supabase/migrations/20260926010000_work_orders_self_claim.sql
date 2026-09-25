-- AMADEUS 11 Work Orders Phase 1 finish:
-- generic worker self-claim (capability + category responsibility)
-- request context on list RPCs
-- one active work order per request (race-safe claim)
-- Does not modify 20260925240000. Does not change Request/Finance workflows.

begin;

-- ---------------------------------------------------------------------------
-- A. Capability + responsibility (future-safe; no tenant_id)
-- ---------------------------------------------------------------------------

create table if not exists public.staff_work_capabilities (
  staff_id integer primary key
    references public.staff (id)
    on delete cascade,
  can_self_claim_requests boolean not null default false,
  can_receive_work_orders boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

comment on table public.staff_work_capabilities is
  'Per-staff work-order capabilities. can_self_claim_requests = may claim Requests; can_receive_work_orders = may be assigned.';

create table if not exists public.staff_request_category_scope (
  staff_id integer not null
    references public.staff (id)
    on delete cascade,
  category text not null
    constraint staff_request_category_scope_category_check
      check (category in ('сантехника', 'электрика', 'уборка', 'отопление', 'другое')),
  primary key (staff_id, category)
);

comment on table public.staff_request_category_scope is
  'Responsibility: request categories a staff member may self-claim. Property scope can be added later.';

alter table public.staff_work_capabilities enable row level security;
alter table public.staff_request_category_scope enable row level security;

revoke all on table public.staff_work_capabilities from public, anon, authenticated;
revoke all on table public.staff_request_category_scope from public, anon, authenticated;

-- Race-safe: at most one active WO per Request.
create unique index if not exists work_orders_one_active_per_request_uidx
  on public.work_orders (request_id)
  where request_id is not null
    and status in ('open', 'in_progress');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.map_request_priority_to_work_order(p_priority text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case btrim(coalesce(p_priority, ''))
    when 'низкий' then 'low'
    when 'высокий' then 'high'
    when 'low' then 'low'
    when 'high' then 'high'
    else 'normal'
  end;
$$;

revoke all on function public.map_request_priority_to_work_order(text) from public;
revoke all on function public.map_request_priority_to_work_order(text) from anon;
grant execute on function public.map_request_priority_to_work_order(text) to authenticated;

create or replace function public.is_request_claimable_status(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(p_status, '')) not in ('выполнена', 'отклонена', 'закрыта');
$$;

revoke all on function public.is_request_claimable_status(text) from public;
revoke all on function public.is_request_claimable_status(text) from anon;
grant execute on function public.is_request_claimable_status(text) to authenticated;

-- Assignee: capability row wins when present; otherwise legacy cleaner/engineer.
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
    left join public.staff_work_capabilities as c on c.staff_id = s.id
    where s.id = p_staff_id
      and s.active is true
      and (
        c.can_receive_work_orders is true
        or (
          c.staff_id is null
          and s.role in ('уборщик', 'инженер')
        )
      )
  );
$$;

revoke all on function public.is_work_order_assignee_role(integer) from public;
revoke all on function public.is_work_order_assignee_role(integer) from anon;
grant execute on function public.is_work_order_assignee_role(integer) to authenticated;

create or replace function public.staff_can_self_claim_requests(p_staff_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    inner join public.staff_work_capabilities as c on c.staff_id = s.id
    where s.id = p_staff_id
      and s.active is true
      and c.can_self_claim_requests is true
  );
$$;

revoke all on function public.staff_can_self_claim_requests(integer) from public;
revoke all on function public.staff_can_self_claim_requests(integer) from anon;
grant execute on function public.staff_can_self_claim_requests(integer) to authenticated;

create or replace function public.staff_covers_request_category(p_staff_id integer, p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_request_category_scope as sc
    where sc.staff_id = p_staff_id
      and sc.category = btrim(coalesce(p_category, ''))
  );
$$;

revoke all on function public.staff_covers_request_category(integer, text) from public;
revoke all on function public.staff_covers_request_category(integer, text) from anon;
grant execute on function public.staff_covers_request_category(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin profile management
-- ---------------------------------------------------------------------------

create or replace function public.get_staff_work_profile(p_staff_id integer)
returns table (
  staff_id integer,
  can_self_claim_requests boolean,
  can_receive_work_orders boolean,
  categories text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_staff_work_profile: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'get_staff_work_profile: not allowed' using errcode = '42501';
  end if;

  return query
  select
    p_staff_id,
    coalesce(c.can_self_claim_requests, false),
    coalesce(c.can_receive_work_orders, false),
    coalesce(
      (select array_agg(sc.category order by sc.category)
       from public.staff_request_category_scope as sc
       where sc.staff_id = p_staff_id),
      '{}'::text[]
    )
  from (select 1) as _
  left join public.staff_work_capabilities as c on c.staff_id = p_staff_id;
end;
$fn$;

revoke all on function public.get_staff_work_profile(integer) from public;
revoke execute on function public.get_staff_work_profile(integer) from anon;
grant execute on function public.get_staff_work_profile(integer) to authenticated;

create or replace function public.set_staff_work_profile(
  p_staff_id integer,
  p_can_self_claim_requests boolean,
  p_can_receive_work_orders boolean,
  p_categories text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cat text;
  v_clean text[] := '{}'::text[];
begin
  if auth.uid() is null then
    raise exception 'set_staff_work_profile: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'set_staff_work_profile: not allowed' using errcode = '42501';
  end if;
  if p_staff_id is null then
    raise exception 'set_staff_work_profile: staff required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff as s where s.id = p_staff_id) then
    raise exception 'set_staff_work_profile: staff not found' using errcode = 'P0002';
  end if;

  if p_categories is not null then
    foreach v_cat in array p_categories loop
      v_cat := btrim(coalesce(v_cat, ''));
      if v_cat = '' then
        continue;
      end if;
      if v_cat not in ('сантехника', 'электрика', 'уборка', 'отопление', 'другое') then
        raise exception 'set_staff_work_profile: invalid category' using errcode = '22023';
      end if;
      if not (v_cat = any (v_clean)) then
        v_clean := array_append(v_clean, v_cat);
      end if;
    end loop;
  end if;

  insert into public.staff_work_capabilities as c (
    staff_id, can_self_claim_requests, can_receive_work_orders, updated_at, updated_by
  ) values (
    p_staff_id,
    coalesce(p_can_self_claim_requests, false),
    coalesce(p_can_receive_work_orders, false),
    now(),
    auth.uid()
  )
  on conflict (staff_id) do update
    set can_self_claim_requests = excluded.can_self_claim_requests,
        can_receive_work_orders = excluded.can_receive_work_orders,
        updated_at = now(),
        updated_by = auth.uid();

  delete from public.staff_request_category_scope as sc
  where sc.staff_id = p_staff_id;

  if array_length(v_clean, 1) is not null then
    insert into public.staff_request_category_scope (staff_id, category)
    select p_staff_id, x
    from unnest(v_clean) as x;
  end if;
end;
$fn$;

revoke all on function public.set_staff_work_profile(integer, boolean, boolean, text[]) from public;
revoke execute on function public.set_staff_work_profile(integer, boolean, boolean, text[]) from anon;
grant execute on function public.set_staff_work_profile(integer, boolean, boolean, text[]) to authenticated;

create or replace function public.get_my_work_claim_profile()
returns table (
  staff_id integer,
  can_self_claim_requests boolean,
  can_receive_work_orders boolean,
  can_see_my_tasks boolean,
  categories text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
  v_self_claim boolean;
  v_receive boolean;
begin
  if auth.uid() is null then
    raise exception 'get_my_work_claim_profile: not authenticated' using errcode = '28000';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'get_my_work_claim_profile: not allowed' using errcode = '42501';
  end if;

  v_self_claim := public.staff_can_self_claim_requests(v_staff_id);
  v_receive := public.is_work_order_assignee_role(v_staff_id);

  return query
  select
    v_staff_id,
    v_self_claim,
    v_receive,
    (
      v_self_claim
      or v_receive
      or exists (
        select 1 from public.work_orders as wo
        where wo.assigned_staff_id = v_staff_id
      )
    ),
    coalesce(
      (select array_agg(sc.category order by sc.category)
       from public.staff_request_category_scope as sc
       where sc.staff_id = v_staff_id),
      '{}'::text[]
    );
end;
$fn$;

revoke all on function public.get_my_work_claim_profile() from public;
revoke execute on function public.get_my_work_claim_profile() from anon;
grant execute on function public.get_my_work_claim_profile() to authenticated;

create or replace function public.list_work_order_assignees()
returns table (
  id integer,
  name text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_work_order_assignees: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'list_work_order_assignees: not allowed' using errcode = '42501';
  end if;

  return query
  select s.id, s.name, s.role
  from public.staff as s
  where public.is_work_order_assignee_role(s.id)
  order by s.name;
end;
$fn$;

revoke all on function public.list_work_order_assignees() from public;
revoke execute on function public.list_work_order_assignees() from anon;
grant execute on function public.list_work_order_assignees() to authenticated;

-- ---------------------------------------------------------------------------
-- Request context for admin prefill
-- ---------------------------------------------------------------------------

create or replace function public.get_request_work_order_context(p_request_id bigint)
returns table (
  request_id bigint,
  subject text,
  description text,
  category text,
  priority text,
  status text,
  owner_name text,
  owner_phone text,
  property_id bigint,
  apartment_number text,
  created_at timestamptz,
  work_priority text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_request_work_order_context: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'get_request_work_order_context: not allowed' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.subject,
    r.description,
    r.category,
    r.priority,
    r.status,
    r.owner_name,
    r.owner_phone,
    r.property_id,
    case when p.id is null then null else p.apartment_number::text end,
    r.created_at,
    public.map_request_priority_to_work_order(r.priority)
  from public.requests as r
  left join public.properties as p on p.id = r.property_id
  where r.id = p_request_id;
end;
$fn$;

revoke all on function public.get_request_work_order_context(bigint) from public;
revoke execute on function public.get_request_work_order_context(bigint) from anon;
grant execute on function public.get_request_work_order_context(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Extended list RPCs (request context via join; no duplicated columns on WO)
-- DROP required: RETURNS TABLE shape changed vs 20260925240000.
-- ---------------------------------------------------------------------------

drop function if exists public.list_work_orders_admin();
drop function if exists public.list_my_work_orders();

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
  request_subject text,
  requester_name text,
  requester_phone text,
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
    raise exception 'list_work_orders_admin: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'list_work_orders_admin: not allowed' using errcode = '42501';
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
    r.subject,
    r.owner_name,
    r.owner_phone,
    wo.created_at,
    wo.updated_at,
    wo.completed_at,
    wo.completion_note
  from public.work_orders as wo
  left join public.staff as s on s.id = wo.assigned_staff_id
  left join public.properties as p on p.id = wo.target_property_id
  left join public.requests as r on r.id = wo.request_id
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
  request_id bigint,
  request_subject text,
  requester_name text,
  requester_phone text,
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
    raise exception 'list_my_work_orders: not authenticated' using errcode = '28000';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'list_my_work_orders: not allowed' using errcode = '42501';
  end if;

  -- Own assigned tasks only (any active staff who can receive / was assigned).
  if not public.is_work_order_assignee_role(v_staff_id)
     and not exists (
       select 1 from public.work_orders as w
       where w.assigned_staff_id = v_staff_id
     ) then
    raise exception 'list_my_work_orders: not allowed' using errcode = '42501';
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
    wo.request_id,
    r.subject,
    r.owner_name,
    r.owner_phone,
    wo.completed_at,
    wo.completion_note,
    wo.created_at
  from public.work_orders as wo
  left join public.properties as p on p.id = wo.target_property_id
  left join public.requests as r on r.id = wo.request_id
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

-- start/complete: assigned worker only (no hardcoded role list)
create or replace function public.start_work_order(p_work_order_id uuid)
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
    raise exception 'start_work_order: not authenticated' using errcode = '28000';
  end if;
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'start_work_order: not allowed' using errcode = '42501';
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
    raise exception 'start_work_order: not found or not startable' using errcode = 'P0002';
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
    raise exception 'complete_work_order: not authenticated' using errcode = '28000';
  end if;
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'complete_work_order: not allowed' using errcode = '42501';
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
    raise exception 'complete_work_order: not found or not completable' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.complete_work_order(uuid, text) from public;
revoke execute on function public.complete_work_order(uuid, text) from anon;
grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- Guard admin create-from-request against duplicate active WO
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
    raise exception 'create_work_order_from_request: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'create_work_order_from_request: not allowed' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'create_work_order_from_request: request required' using errcode = '22023';
  end if;

  select r.* into v_req from public.requests as r where r.id = p_request_id for update;
  if not found then
    raise exception 'create_work_order_from_request: request not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.work_orders as wo
    where wo.request_id = v_req.id
      and wo.status in ('open', 'in_progress')
  ) then
    raise exception 'create_work_order_from_request: request already has an active work order'
      using errcode = '23505';
  end if;

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

  v_priority := btrim(coalesce(nullif(btrim(coalesce(p_priority, '')), ''), public.map_request_priority_to_work_order(v_req.priority)));
  if v_priority not in ('low', 'normal', 'high') then
    raise exception 'create_work_order_from_request: invalid priority' using errcode = '22023';
  end if;

  if p_assigned_staff_id is not null
     and not public.is_work_order_assignee_role(p_assigned_staff_id) then
    raise exception 'create_work_order_from_request: assignee must be eligible worker'
      using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select wo.* into v_row from public.work_orders as wo where wo.idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  insert into public.work_orders (
    title, instructions, status, priority, assigned_staff_id, scheduled_for,
    target_property_id, location_description, source_type, request_id,
    created_by, updated_by, idempotency_key
  ) values (
    v_title, v_instructions, 'open', v_priority, p_assigned_staff_id, p_scheduled_for,
    v_req.property_id,
    coalesce(nullif(btrim(coalesce(p_location_description, '')), ''),
             case when v_req.property_id is not null then null else null end),
    'request', v_req.id, auth.uid(), auth.uid(), p_idempotency_key
  )
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'create_work_order_from_request: request already has an active work order'
      using errcode = '23505';
end;
$fn$;

revoke all on function public.create_work_order_from_request(bigint, text, text, text, integer, timestamptz, text, uuid) from public;
revoke execute on function public.create_work_order_from_request(bigint, text, text, text, integer, timestamptz, text, uuid) from anon;
grant execute on function public.create_work_order_from_request(bigint, text, text, text, integer, timestamptz, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Claimable list + atomic claim
-- ---------------------------------------------------------------------------

create or replace function public.list_claimable_requests()
returns table (
  request_id bigint,
  subject text,
  description text,
  category text,
  priority text,
  owner_name text,
  owner_phone text,
  property_id bigint,
  apartment_number text,
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
    raise exception 'list_claimable_requests: not authenticated' using errcode = '28000';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'list_claimable_requests: not allowed' using errcode = '42501';
  end if;

  if not public.staff_can_self_claim_requests(v_staff_id) then
    return;
  end if;

  return query
  select
    r.id,
    r.subject,
    r.description,
    r.category,
    r.priority,
    r.owner_name,
    r.owner_phone,
    r.property_id,
    case when p.id is null then null else p.apartment_number::text end,
    r.created_at
  from public.requests as r
  left join public.properties as p on p.id = r.property_id
  where public.is_request_claimable_status(r.status)
    and public.staff_covers_request_category(v_staff_id, r.category)
    and not exists (
      select 1 from public.work_orders as wo
      where wo.request_id = r.id
        and wo.status in ('open', 'in_progress')
    )
  order by r.created_at desc;
end;
$fn$;

revoke all on function public.list_claimable_requests() from public;
revoke execute on function public.list_claimable_requests() from anon;
grant execute on function public.list_claimable_requests() to authenticated;

create or replace function public.claim_request_as_work_order(p_request_id bigint)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
  v_req public.requests;
  v_row public.work_orders;
  v_title text;
  v_location text;
begin
  if auth.uid() is null then
    raise exception 'claim_request_as_work_order: not authenticated' using errcode = '28000';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'claim_request_as_work_order: not allowed' using errcode = '42501';
  end if;

  if not public.staff_can_self_claim_requests(v_staff_id) then
    raise exception 'claim_request_as_work_order: no self-claim permission'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'claim_request_as_work_order: request required' using errcode = '22023';
  end if;

  select r.* into v_req
  from public.requests as r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'claim_request_as_work_order: request not found' using errcode = 'P0002';
  end if;

  if not public.is_request_claimable_status(v_req.status) then
    raise exception 'claim_request_as_work_order: request not claimable' using errcode = '22023';
  end if;

  if not public.staff_covers_request_category(v_staff_id, v_req.category) then
    raise exception 'claim_request_as_work_order: not in your responsibility'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.work_orders as wo
    where wo.request_id = v_req.id
      and wo.status in ('open', 'in_progress')
  ) then
    raise exception 'claim_request_as_work_order: already taken' using errcode = '23505';
  end if;

  v_title := nullif(btrim(coalesce(v_req.subject, '')), '');
  if v_title is null then
    v_title := 'Work order';
  end if;

  select case when p.id is null then null else ('№ ' || p.apartment_number::text) end
    into v_location
  from public.properties as p
  where p.id = v_req.property_id;

  insert into public.work_orders (
    title, instructions, status, priority, assigned_staff_id, scheduled_for,
    target_property_id, location_description, source_type, request_id,
    created_by, updated_by
  ) values (
    v_title,
    nullif(btrim(coalesce(v_req.description, '')), ''),
    'open',
    public.map_request_priority_to_work_order(v_req.priority),
    v_staff_id,
    null,
    v_req.property_id,
    v_location,
    'request',
    v_req.id,
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  -- Request status intentionally unchanged. No finance writes.
  return v_row;
exception
  when unique_violation then
    raise exception 'claim_request_as_work_order: already taken' using errcode = '23505';
end;
$fn$;

revoke all on function public.claim_request_as_work_order(bigint) from public;
revoke execute on function public.claim_request_as_work_order(bigint) from anon;
grant execute on function public.claim_request_as_work_order(bigint) to authenticated;

commit;
