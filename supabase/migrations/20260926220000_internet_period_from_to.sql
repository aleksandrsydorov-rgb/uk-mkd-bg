-- Internet connect/extend: owner chooses period from–to (inclusive dates).

begin;

-- WO helper: include technical period in instructions (no finance).
create or replace function public.internet_create_system_work_order(
  p_subscription_id uuid,
  p_property_id bigint,
  p_action text,
  p_created_by uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_apt text;
  v_title text;
  v_instr text;
  v_period text := '';
begin
  if p_action not in ('enable', 'disable') then
    raise exception 'internet_create_system_work_order: invalid action'
      using errcode = '22023';
  end if;

  v_apt := public.internet_apt_label(p_property_id);
  if p_period_start is not null and p_period_end is not null then
    v_period := ' Период: ' || p_period_start::text || ' — ' || p_period_end::text || '.';
  end if;

  if p_action = 'enable' then
    v_title := 'Включить интернет · ' || v_apt;
    v_instr := 'Подключить интернет в апартаменте ' || v_apt || '.' || v_period;
  else
    v_title := 'Отключить интернет · ' || v_apt;
    v_instr := 'Отключить интернет в апартаменте ' || v_apt || '.' || v_period;
  end if;

  insert into public.work_orders (
    title, instructions, status, priority,
    assigned_staff_id, scheduled_for, target_property_id, location_description,
    source_type, request_id, created_by, internet_action, internet_subscription_id
  ) values (
    v_title, v_instr, 'open', 'normal',
    null, null, p_property_id, null,
    'system', null, p_created_by, p_action, p_subscription_id
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date) from public;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date) from anon;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date) from authenticated;

-- Keep 4-arg overload for existing callers (debt/expiry/disconnect).
-- No defaults on 6-arg — otherwise 4-arg calls are ambiguous.
create or replace function public.internet_create_system_work_order(
  p_subscription_id uuid,
  p_property_id bigint,
  p_action text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.internet_create_system_work_order(
    p_subscription_id, p_property_id, p_action, p_created_by, null::date, null::date
  );
end;
$fn$;

revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from public;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from anon;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from authenticated;

drop function if exists public.request_internet_connect(bigint, integer, uuid);
drop function if exists public.request_internet_extend(bigint, integer, uuid);

create or replace function public.request_internet_connect(
  p_property_id bigint,
  p_period_start date,
  p_period_end date,
  p_idempotency_key uuid default null
)
returns public.internet_subscriptions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_uid uuid := auth.uid();
  v_today date := public.tariff_sofia_today();
  v_sub public.internet_subscriptions%rowtype;
  v_days integer;
  v_amount numeric;
  v_version_id uuid;
  v_wo uuid;
begin
  if v_uid is null or v_email is null then
    raise exception 'request_internet_connect: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'request_internet_connect: not allowed'
      using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'request_internet_connect: period required'
      using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'request_internet_connect: invalid period'
      using errcode = '22023';
  end if;
  if p_period_start < v_today then
    raise exception 'request_internet_connect: start in the past'
      using errcode = '22023';
  end if;

  v_days := (p_period_end - p_period_start) + 1;
  if v_days < 1 or v_days > 3650 then
    raise exception 'request_internet_connect: invalid days'
      using errcode = '22023';
  end if;

  select c.days, c.amount_eur, c.tariff_version_id
    into v_days, v_amount, v_version_id
  from public.compute_internet_amount(v_days, v_today) as c;

  select s.* into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if found then
    if v_sub.status in ('pending_enable', 'active', 'pending_disable') then
      raise exception 'request_internet_connect: already connected or pending'
        using errcode = 'P0001';
    end if;
    update public.internet_subscriptions as s
       set status = 'pending_enable',
           period_start = p_period_start,
           period_end = p_period_end,
           pending_days = v_days,
           disable_reason = null,
           disable_work_order_id = null,
           updated_at = now()
     where s.id = v_sub.id
    returning * into v_sub;
  else
    insert into public.internet_subscriptions (
      property_id, status, period_start, period_end, pending_days
    ) values (
      p_property_id, 'pending_enable', p_period_start, p_period_end, v_days
    )
    returning * into v_sub;
  end if;

  perform public.internet_insert_charge(
    p_property_id, v_days, v_amount, v_version_id,
    'Подключение интернета ' || p_period_start::text || ' — ' || p_period_end::text,
    v_email, p_idempotency_key
  );

  v_wo := public.internet_create_system_work_order(
    v_sub.id, p_property_id, 'enable', v_uid, p_period_start, p_period_end
  );

  update public.internet_subscriptions as s
     set enable_work_order_id = v_wo,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_connect(bigint, date, date, uuid) from public;
revoke all on function public.request_internet_connect(bigint, date, date, uuid) from anon;
grant execute on function public.request_internet_connect(bigint, date, date, uuid) to authenticated;

create or replace function public.request_internet_extend(
  p_property_id bigint,
  p_period_start date,
  p_period_end date,
  p_idempotency_key uuid default null
)
returns public.internet_subscriptions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_today date := public.tariff_sofia_today();
  v_sub public.internet_subscriptions%rowtype;
  v_seg_start date;
  v_days integer;
  v_amount numeric;
  v_version_id uuid;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'request_internet_extend: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'request_internet_extend: not allowed'
      using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'request_internet_extend: period required'
      using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'request_internet_extend: invalid period'
      using errcode = '22023';
  end if;

  select s.* into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if not found or v_sub.status <> 'active' or v_sub.period_end is null then
    raise exception 'request_internet_extend: not active'
      using errcode = 'P0001';
  end if;

  -- Extension segment must start on/after the day after current end.
  v_seg_start := v_sub.period_end + 1;
  if p_period_start < v_seg_start then
    raise exception 'request_internet_extend: start must be after current period'
      using errcode = '22023';
  end if;
  if p_period_start > v_seg_start then
    -- Allow gap-free only: start must be exactly next day.
    raise exception 'request_internet_extend: start must continue current period'
      using errcode = '22023';
  end if;

  v_days := (p_period_end - p_period_start) + 1;
  if v_days < 1 or v_days > 3650 then
    raise exception 'request_internet_extend: invalid days'
      using errcode = '22023';
  end if;

  select c.days, c.amount_eur, c.tariff_version_id
    into v_days, v_amount, v_version_id
  from public.compute_internet_amount(v_days, v_today) as c;

  perform public.internet_insert_charge(
    p_property_id, v_days, v_amount, v_version_id,
    'Продление интернета ' || p_period_start::text || ' — ' || p_period_end::text,
    v_email, p_idempotency_key
  );

  update public.internet_subscriptions as s
     set period_end = p_period_end,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_extend(bigint, date, date, uuid) from public;
revoke all on function public.request_internet_extend(bigint, date, date, uuid) from anon;
grant execute on function public.request_internet_extend(bigint, date, date, uuid) to authenticated;

-- On enable complete: keep owner-chosen period dates (already stored).
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
  v_today date := public.tariff_sofia_today();
  v_sub public.internet_subscriptions%rowtype;
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

  if v_row.request_id is not null then
    update public.requests as r
       set status = 'выполнена'
     where r.id = v_row.request_id
       and r.status in ('новая', 'в работе');
  end if;

  if v_row.internet_subscription_id is not null and v_row.internet_action is not null then
    select s.* into v_sub
    from public.internet_subscriptions as s
    where s.id = v_row.internet_subscription_id
    for update;

    if found then
      if v_row.internet_action = 'enable'
         and v_sub.status = 'pending_enable' then
        update public.internet_subscriptions as s
           set status = 'active',
               period_start = coalesce(s.period_start, v_today),
               period_end = coalesce(
                 s.period_end,
                 coalesce(s.period_start, v_today) + greatest(coalesce(s.pending_days, 1) - 1, 0)
               ),
               pending_days = null,
               disable_reason = null,
               updated_at = now()
         where s.id = v_sub.id;
      elsif v_row.internet_action = 'disable'
            and v_sub.status = 'pending_disable' then
        update public.internet_subscriptions as s
           set status = 'inactive',
               pending_days = null,
               updated_at = now()
         where s.id = v_sub.id;
      end if;
    end if;
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.complete_work_order(uuid, text) from public;
revoke execute on function public.complete_work_order(uuid, text) from anon;
grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- Owner may cancel connect request only while enable WO is open and unassigned.
create or replace function public.cancel_internet_connect_request(p_property_id bigint)
returns public.internet_subscriptions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_sub public.internet_subscriptions%rowtype;
  v_wo public.work_orders%rowtype;
  v_charge numeric;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'cancel_internet_connect_request: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'cancel_internet_connect_request: not allowed'
      using errcode = '42501';
  end if;

  select s.* into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if not found or v_sub.status <> 'pending_enable' then
    raise exception 'cancel_internet_connect_request: not pending'
      using errcode = 'P0001';
  end if;

  if v_sub.enable_work_order_id is null then
    raise exception 'cancel_internet_connect_request: no work order'
      using errcode = 'P0002';
  end if;

  select wo.* into v_wo
  from public.work_orders as wo
  where wo.id = v_sub.enable_work_order_id
  for update;

  if not found then
    raise exception 'cancel_internet_connect_request: no work order'
      using errcode = 'P0002';
  end if;

  -- Only before engineer claims (assigned) or starts work.
  if v_wo.assigned_staff_id is not null or v_wo.status <> 'open' then
    raise exception 'cancel_internet_connect_request: already taken'
      using errcode = 'P0001';
  end if;

  update public.work_orders as wo
     set status = 'cancelled',
         updated_at = now(),
         updated_by = auth.uid(),
         completion_note = coalesce(wo.completion_note, 'Отменено собственником')
   where wo.id = v_wo.id;

  -- Reverse the connect charge (no auto-refund path elsewhere).
  select l.amount_eur into v_charge
  from public.internet_ledger as l
  where l.property_id = p_property_id
    and l.kind = 'charge'
  order by l.created_at desc
  limit 1;

  if v_charge is not null and v_charge > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'adjustment_credit',
      v_charge,
      v_sub.pending_days,
      null,
      'Отмена заявки на подключение',
      v_email,
      gen_random_uuid()
    );
  end if;

  update public.internet_subscriptions as s
     set status = 'inactive',
         period_start = null,
         period_end = null,
         pending_days = null,
         disable_reason = null,
         enable_work_order_id = null,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.cancel_internet_connect_request(bigint) from public;
revoke all on function public.cancel_internet_connect_request(bigint) from anon;
grant execute on function public.cancel_internet_connect_request(bigint) to authenticated;

commit;
