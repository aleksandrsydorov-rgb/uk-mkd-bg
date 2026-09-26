-- Internet work-order visibility: admin full movement list + open-task counts for overview.

begin;

create or replace function public.list_internet_work_orders()
returns table (
  id uuid,
  title text,
  instructions text,
  status text,
  priority text,
  internet_action text,
  assigned_staff_id integer,
  assignee_name text,
  apartment_number text,
  property_id bigint,
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
    raise exception 'list_internet_work_orders: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'list_internet_work_orders: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    wo.id,
    wo.title,
    wo.instructions,
    wo.status,
    wo.priority,
    wo.internet_action,
    wo.assigned_staff_id,
    s.name,
    case when p.id is null then null else p.apartment_number::text end,
    wo.target_property_id,
    wo.created_at,
    wo.updated_at,
    wo.completed_at,
    wo.completion_note
  from public.work_orders as wo
  left join public.staff as s on s.id = wo.assigned_staff_id
  left join public.properties as p on p.id = wo.target_property_id
  where wo.source_type = 'system'
    and wo.internet_action is not null
  order by
    case wo.status
      when 'open' then 1
      when 'in_progress' then 2
      when 'completed' then 3
      else 4
    end,
    wo.created_at desc;
end;
$fn$;

revoke all on function public.list_internet_work_orders() from public;
revoke all on function public.list_internet_work_orders() from anon;
grant execute on function public.list_internet_work_orders() to authenticated;

-- Engineer/admin overview: open internet technical tasks (claimable + in flight).
create or replace function public.get_internet_open_task_counts()
returns table (
  claimable_count integer,
  my_open_count integer,
  open_total integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
  v_claimable integer := 0;
  v_mine integer := 0;
  v_total integer := 0;
begin
  if auth.uid() is null then
    raise exception 'get_internet_open_task_counts: not authenticated'
      using errcode = '28000';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'get_internet_open_task_counts: not allowed'
      using errcode = '42501';
  end if;

  if public.has_staff_role('инженер') then
    select count(*)::int into v_claimable
    from public.work_orders as wo
    where wo.source_type = 'system'
      and wo.internet_action is not null
      and wo.status = 'open'
      and wo.assigned_staff_id is null;

    select count(*)::int into v_mine
    from public.work_orders as wo
    where wo.source_type = 'system'
      and wo.internet_action is not null
      and wo.assigned_staff_id = v_staff_id
      and wo.status in ('open', 'in_progress');

    v_total := v_claimable + v_mine;
  elsif public.has_staff_role('администрация')
     or public.has_staff_role('бухгалтер') then
    select count(*)::int into v_total
    from public.work_orders as wo
    where wo.source_type = 'system'
      and wo.internet_action is not null
      and wo.status in ('open', 'in_progress');
    v_claimable := v_total;
    v_mine := 0;
  else
    raise exception 'get_internet_open_task_counts: not allowed'
      using errcode = '42501';
  end if;

  return query select v_claimable, v_mine, v_total;
end;
$fn$;

revoke all on function public.get_internet_open_task_counts() from public;
revoke all on function public.get_internet_open_task_counts() from anon;
grant execute on function public.get_internet_open_task_counts() to authenticated;

-- Extend admin WO list with internet_action (technical flag, no finance).
drop function if exists public.list_work_orders_admin();

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
  internet_action text,
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
    wo.internet_action,
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

commit;
