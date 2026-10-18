-- =============================================================================
-- EML-5 — Cleaning schedule update RPC + ticket chat enqueue authz extension
-- Does NOT enable sending. Does NOT change debt gate.
-- =============================================================================

begin;

-- Canonical cleaning schedule update (preferred_date / time_slot).
-- Syncs linked work_order.scheduled_for when present. No-op when unchanged.
create or replace function public.admin_update_cleaning_order_schedule(
  p_order_id uuid,
  p_preferred_date date default null,
  p_time_slot text default null
)
returns table (
  order_id uuid,
  changed boolean,
  preferred_date date,
  time_slot text,
  work_order_id uuid,
  assignee_staff_id integer,
  assignee_email text,
  previous_preferred_date date,
  previous_time_slot text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.cleaning_orders%rowtype;
  v_slot text := nullif(btrim(coalesce(p_time_slot, '')), '');
  v_changed boolean := false;
  v_prev_date date;
  v_prev_slot text;
  v_assignee_id integer := null;
  v_assignee_email text := null;
  v_wo_ts timestamptz := null;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_update_cleaning_order_schedule: not allowed'
      using errcode = '42501';
  end if;
  perform public.cleaning_assert_module();

  if v_slot is not null and v_slot not in ('morning', 'afternoon', 'any') then
    raise exception 'admin_update_cleaning_order_schedule: invalid time_slot'
      using errcode = '22023';
  end if;

  select o.* into v_row
  from public.cleaning_orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'admin_update_cleaning_order_schedule: not found'
      using errcode = 'P0002';
  end if;

  if v_row.status in ('done', 'cancelled') then
    raise exception 'admin_update_cleaning_order_schedule: terminal order'
      using errcode = 'P0001';
  end if;

  v_prev_date := v_row.preferred_date;
  v_prev_slot := v_row.time_slot;

  if coalesce(p_preferred_date, v_row.preferred_date) is distinct from v_row.preferred_date then
    v_changed := true;
  end if;
  if coalesce(v_slot, v_row.time_slot) is distinct from v_row.time_slot then
    v_changed := true;
  end if;

  if not v_changed then
    if v_row.work_order_id is not null then
      select wo.assigned_staff_id, public.email_core_normalize_email(s.email)
        into v_assignee_id, v_assignee_email
      from public.work_orders as wo
      left join public.staff as s on s.id = wo.assigned_staff_id
      where wo.id = v_row.work_order_id;
    end if;

    order_id := v_row.id;
    changed := false;
    preferred_date := v_row.preferred_date;
    time_slot := v_row.time_slot;
    work_order_id := v_row.work_order_id;
    assignee_staff_id := v_assignee_id;
    assignee_email := v_assignee_email;
    previous_preferred_date := v_prev_date;
    previous_time_slot := v_prev_slot;
    return next;
    return;
  end if;

  update public.cleaning_orders as o
     set preferred_date = coalesce(p_preferred_date, o.preferred_date),
         time_slot = coalesce(v_slot, o.time_slot),
         updated_at = now()
   where o.id = p_order_id
  returning * into v_row;

  if v_row.work_order_id is not null then
    if v_row.preferred_date is not null then
      v_wo_ts := (v_row.preferred_date::timestamp at time zone 'Europe/Sofia');
    else
      v_wo_ts := null;
    end if;

    update public.work_orders as wo
       set scheduled_for = v_wo_ts,
           updated_at = now()
     where wo.id = v_row.work_order_id
       and wo.status in ('open', 'in_progress');

    select wo.assigned_staff_id, public.email_core_normalize_email(s.email)
      into v_assignee_id, v_assignee_email
    from public.work_orders as wo
    left join public.staff as s on s.id = wo.assigned_staff_id
    where wo.id = v_row.work_order_id;
  end if;

  order_id := v_row.id;
  changed := true;
  preferred_date := v_row.preferred_date;
  time_slot := v_row.time_slot;
  work_order_id := v_row.work_order_id;
  assignee_staff_id := v_assignee_id;
  assignee_email := v_assignee_email;
  previous_preferred_date := v_prev_date;
  previous_time_slot := v_prev_slot;
  return next;
end;
$fn$;

revoke all on function public.admin_update_cleaning_order_schedule(uuid, date, text)
  from public, anon;
grant execute on function public.admin_update_cleaning_order_schedule(uuid, date, text)
  to authenticated;

-- EML-5: extend system enqueue authz — ticket_* may target staff admins from property owners.
create or replace function public.email_core_assert_can_enqueue(
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_module text := nullif(btrim(coalesce(p_module_key, '')), '');
  v_tpl text := lower(nullif(btrim(coalesce(p_template_key, '')), ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_property_id bigint := null;
  v_transfer_id bigint := null;
  v_is_admin boolean := false;
  v_raw text;
  v_to text := public.email_core_normalize_email(p_to_email);
  v_system_ok boolean := false;
  v_staff_admin boolean := false;
begin
  if v_module is null then
    raise exception 'email_core_enqueue: invalid module_key'
      using errcode = '22023';
  end if;

  if auth.role() is not distinct from 'service_role' then
    return;
  end if;

  if auth.uid() is null then
    raise exception 'email_core_enqueue: not authenticated'
      using errcode = '28000';
  end if;

  v_is_admin := public.has_staff_role('администрация');

  if v_tpl is null then
    raise exception 'email_core_enqueue: template_key required'
      using errcode = '22023';
  end if;

  if v_module = 'pb1_invite' and v_tpl not like 'pb1_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'user_activation' and v_tpl not like 'ua_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'pkg_xfer' and v_tpl not like 'ownership_change_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'meeting' and v_tpl not like 'meeting_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'email_test' and v_tpl not like 'email_test%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;

  if v_module = 'system' then
    v_system_ok :=
      v_tpl like 'meters_%'
      or v_tpl like 'uk_%'
      or v_tpl like 'internet_%'
      or v_tpl like 'ticket_%'
      or v_tpl like 'residence_%'
      or v_tpl like 'cleaning_%'
      or v_tpl like 'support_fee_%'
      or v_tpl like 'capital_repair_%'
      or v_tpl like 'inventory_%'
      or v_tpl like 'email_digest%';
    if not v_system_ok then
      raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    if v_is_admin then
      return;
    end if;

    if v_property_id is not null
       and v_to is not null
       and public.owns_property(v_property_id) then
      if public.property_book_active_owner_by_email(v_property_id, v_to) then
        return;
      end if;
      -- Owner may notify complex admins about ticket/chat activity only.
      if v_tpl like 'ticket_%' then
        select exists (
          select 1
          from public.staff as s
          where s.role = 'администрация'
            and coalesce(s.active, true)
            and public.email_core_normalize_email(s.email) = v_to
        ) into v_staff_admin;
        if v_staff_admin then
          return;
        end if;
      end if;
    end if;

    raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
  end if;

  if v_module in ('pb1_invite', 'user_activation', 'email_test', 'meeting') then
    if not v_is_admin then
      raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
    end if;
    return;
  end if;

  if v_module = 'pkg_xfer' then
    if v_is_admin then
      return;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'transfer_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_transfer_id := v_raw::bigint;
    end if;

    if v_property_id is null and v_transfer_id is not null then
      select t.property_id
        into v_property_id
      from public.owner_transfers as t
      where t.id = v_transfer_id;
    end if;

    if v_property_id is not null and public.owns_property(v_property_id) then
      return;
    end if;

    raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
  end if;

  raise exception 'email_core_enqueue: invalid module_key' using errcode = '22023';
end;
$fn$;

revoke all on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to service_role;

commit;
