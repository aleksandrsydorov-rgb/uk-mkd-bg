-- Request ↔ Work Order lifecycle.
-- Linked WO completion → Request FINAL status "выполнена" (no admin confirmation).
-- Standalone WO completion does not touch Requests.
-- Admin may return completed Request to "в работе"; historical WO stays completed.
-- Self-claim blocks only active (open/in_progress) WOs so reopen remains actionable.
-- Does not alter finance / tariff / Module Core.

begin;

-- ---------------------------------------------------------------------------
-- Request update guard (canonical statuses only; no intermediate awaiting)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_requests_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') then
    raise exception 'requests: only status may be updated'
      using errcode = '42501';
  end if;

  if NEW.status is distinct from 'новая'
     and NEW.status is distinct from 'в работе'
     and NEW.status is distinct from 'выполнена'
     and NEW.status is distinct from 'отклонена' then
    raise exception 'requests: invalid status'
      using errcode = '22023';
  end if;

  return NEW;
end;
$function$;

revoke all on function public.enforce_requests_update() from public;
revoke execute on function public.enforce_requests_update() from anon;
revoke execute on function public.enforce_requests_update() from authenticated;

-- Completed / rejected / closed / unknown statuses are not claimable (fail-closed).
create or replace function public.is_request_claimable_status(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(p_status, '')) in ('новая', 'в работе');
$$;

revoke all on function public.is_request_claimable_status(text) from public;
revoke all on function public.is_request_claimable_status(text) from anon;
grant execute on function public.is_request_claimable_status(text) to authenticated;

-- Active WO only. Historical completed WO must not permanently block reopen + reclaim.
-- Primary post-complete guard: Request status "выполнена" via is_request_claimable_status.
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
      and wo.status in ('open', 'in_progress')
  );
$$;

comment on function public.request_blocks_self_claim(bigint) is
  'True when Request has an active open/in_progress Work Order. Completed historical WOs do not block; cancelled does not block.';

revoke all on function public.request_blocks_self_claim(bigint) from public;
revoke all on function public.request_blocks_self_claim(bigint) from anon;
grant execute on function public.request_blocks_self_claim(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- When linking a WO, move Request to "в работе" if still new
-- ---------------------------------------------------------------------------

create or replace function public.mark_request_in_progress_for_work_order(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_request_id is null then
    return;
  end if;
  update public.requests as r
     set status = 'в работе'
   where r.id = p_request_id
     and r.status in ('новая', 'в работе');
end;
$fn$;

revoke all on function public.mark_request_in_progress_for_work_order(bigint) from public;
revoke all on function public.mark_request_in_progress_for_work_order(bigint) from anon;
-- Internal only (called from DEFINER WO RPCs).

-- ---------------------------------------------------------------------------
-- complete_work_order: linked Request → выполнена (atomic, idempotent)
-- ---------------------------------------------------------------------------

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
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'complete_work_order: not authenticated' using errcode = '28000';
  end if;
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'complete_work_order: not allowed' using errcode = '42501';
  end if;

  select wo.* into v_row
  from public.work_orders as wo
  where wo.id = p_work_order_id
  for update;

  if not found then
    raise exception 'complete_work_order: not found or not completable' using errcode = 'P0002';
  end if;

  if v_row.assigned_staff_id is distinct from v_staff_id then
    raise exception 'complete_work_order: not allowed' using errcode = '42501';
  end if;

  -- Idempotent retry: already completed → no second Request transition.
  if v_row.status = 'completed' then
    return v_row;
  end if;

  if v_row.status <> 'in_progress' then
    raise exception 'complete_work_order: not found or not completable' using errcode = 'P0002';
  end if;

  v_note := nullif(btrim(coalesce(p_completion_note, '')), '');

  update public.work_orders as wo
     set status = 'completed',
         completion_note = coalesce(v_note, wo.completion_note),
         completed_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = v_row.id
  returning * into v_row;

  -- Linked Request only. Standalone WO (request_id null) leaves Requests untouched.
  -- No finance entries. Final close — no admin confirmation step.
  if v_row.request_id is not null then
    update public.requests as r
       set status = 'выполнена'
     where r.id = v_row.request_id
       and r.status in ('новая', 'в работе');
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.complete_work_order(uuid, text) from public;
revoke execute on function public.complete_work_order(uuid, text) from anon;
grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- Drop unused confirm RPC if a prior local draft created it (unapplied / re-run safe).
drop function if exists public.confirm_request_after_work(bigint);

-- ---------------------------------------------------------------------------
-- Admin return completed Request to work (does not reopen historical WO)
-- ---------------------------------------------------------------------------

create or replace function public.return_request_to_work(
  p_request_id bigint
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.requests;
begin
  if auth.uid() is null then
    raise exception 'return_request_to_work: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'return_request_to_work: not allowed' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'return_request_to_work: request required' using errcode = '22023';
  end if;

  select r.* into v_row from public.requests as r where r.id = p_request_id for update;
  if not found then
    raise exception 'return_request_to_work: not found' using errcode = 'P0002';
  end if;

  if v_row.status = 'в работе' then
    return v_row;
  end if;

  if v_row.status is distinct from 'выполнена' then
    raise exception 'return_request_to_work: only completed requests can be returned'
      using errcode = '22023';
  end if;

  -- Previous completed Work Orders remain completed (history).
  update public.requests as r
     set status = 'в работе'
   where r.id = v_row.id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.return_request_to_work(bigint) from public;
revoke execute on function public.return_request_to_work(bigint) from anon;
grant execute on function public.return_request_to_work(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Linked Work Order summary for admin Request detail
-- ---------------------------------------------------------------------------

create or replace function public.list_request_work_orders(p_request_id bigint)
returns table (
  id uuid,
  title text,
  status text,
  assigned_staff_id integer,
  assignee_name text,
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_request_work_orders: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'list_request_work_orders: not allowed' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'list_request_work_orders: request required' using errcode = '22023';
  end if;

  return query
  select
    wo.id,
    wo.title,
    wo.status,
    wo.assigned_staff_id,
    s.name,
    wo.completed_at,
    wo.completion_note,
    wo.created_at
  from public.work_orders as wo
  left join public.staff as s on s.id = wo.assigned_staff_id
  where wo.request_id = p_request_id
  order by wo.created_at desc;
end;
$fn$;

revoke all on function public.list_request_work_orders(bigint) from public;
revoke execute on function public.list_request_work_orders(bigint) from anon;
grant execute on function public.list_request_work_orders(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Mark Request in progress on create-from-request / claim
-- ---------------------------------------------------------------------------

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

  if v_req.status is distinct from 'новая'
     and v_req.status is distinct from 'в работе' then
    raise exception 'create_work_order_from_request: request status must be новая or в работе'
      using errcode = '22023';
  end if;

  -- Idempotency before active-WO rejection (safe retries).
  if p_idempotency_key is not null then
    select wo.* into v_row
    from public.work_orders as wo
    where wo.idempotency_key = p_idempotency_key;

    if found then
      if v_row.request_id is distinct from v_req.id then
        raise exception 'create_work_order_from_request: idempotency key conflict'
          using errcode = '23505';
      end if;
      return v_row;
    end if;
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

  insert into public.work_orders (
    title, instructions, status, priority, assigned_staff_id, scheduled_for,
    target_property_id, location_description, source_type, request_id,
    created_by, updated_by, idempotency_key
  ) values (
    v_title, v_instructions, 'open', v_priority, p_assigned_staff_id, p_scheduled_for,
    v_req.property_id,
    nullif(btrim(coalesce(p_location_description, '')), ''),
    'request', v_req.id, auth.uid(), auth.uid(), p_idempotency_key
  )
  returning * into v_row;

  perform public.mark_request_in_progress_for_work_order(v_req.id);

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

  perform public.mark_request_in_progress_for_work_order(v_req.id);

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
