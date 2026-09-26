-- Fix ambiguous internet_create_system_work_order overload.
-- 6-arg had DEFAULT null on period args, so 4-arg calls were ambiguous
-- and owner disconnect (and debt/expiry disable) failed at runtime.

begin;

drop function if exists public.internet_create_system_work_order(uuid, bigint, text, uuid);
drop function if exists public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date);

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

-- 4-arg wrapper: no defaults on 6-arg, so this is unambiguous.
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

revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date) from public;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date) from anon;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid, date, date) from authenticated;

revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from public;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from anon;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from authenticated;

-- Surface disconnect errors more clearly on next client bump (RPC message mapping).
-- Also harden request_internet_disconnect: stop recurring billing when owner requests disconnect.
create or replace function public.request_internet_disconnect(p_property_id bigint)
returns public.internet_subscriptions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_sub public.internet_subscriptions%rowtype;
  v_wo uuid;
begin
  if v_uid is null then
    raise exception 'request_internet_disconnect: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'request_internet_disconnect: not allowed'
      using errcode = '42501';
  end if;

  select s.* into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if not found or v_sub.status <> 'active' then
    raise exception 'request_internet_disconnect: not active'
      using errcode = 'P0001';
  end if;

  v_wo := public.internet_create_system_work_order(v_sub.id, p_property_id, 'disable', v_uid);

  update public.internet_subscriptions as s
     set status = 'pending_disable',
         disable_reason = 'owner_early',
         disable_work_order_id = v_wo,
         next_charge_on = null,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_disconnect(bigint) from public;
revoke all on function public.request_internet_disconnect(bigint) from anon;
grant execute on function public.request_internet_disconnect(bigint) to authenticated;

commit;
