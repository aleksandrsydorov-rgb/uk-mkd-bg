-- Hotfix: self-claim must not re-offer a Request after a completed Work Order.
-- Cancelled WO may allow reclaim. Admin create-from-request unchanged (still only
-- blocks active open/in_progress via existing unique index + create RPC).
-- Does not modify 20260926010000. Does not auto-close Requests. No finance changes.

begin;

create or replace function public.request_blocks_self_claim(p_request_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.work_orders as wo
    where wo.request_id = p_request_id
      and wo.status in ('open', 'in_progress', 'completed')
  );
$$;

comment on function public.request_blocks_self_claim(bigint) is
  'True when Request already has open, in_progress, or completed Work Order (blocks worker self-claim). Cancelled does not block.';

revoke all on function public.request_blocks_self_claim(bigint) from public;
revoke all on function public.request_blocks_self_claim(bigint) from anon;
grant execute on function public.request_blocks_self_claim(bigint) to authenticated;

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
    and not public.request_blocks_self_claim(r.id)
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

  if public.request_blocks_self_claim(v_req.id) then
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
