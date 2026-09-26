-- Service lock scopes: admin picks which owner actions to restrict.
-- scopes text[] — keys like requests, water, internet, elevator (future-ready).
-- Special key 'all' = restrict every owner mutation (legacy v1 behavior).

begin;

alter table public.property_service_locks
  add column if not exists scopes text[] not null default array['all']::text[];

comment on column public.property_service_locks.scopes is
  'Restricted service keys. all = full soft lock. Future keys (elevator, security) stored for later enforcement.';

-- Existing active locks stay as full lock.
update public.property_service_locks
   set scopes = array['all']::text[]
 where scopes is null or cardinality(scopes) = 0;

alter table public.property_service_locks
  drop constraint if exists property_service_locks_scopes_nonempty;

alter table public.property_service_locks
  add constraint property_service_locks_scopes_nonempty
  check (cardinality(scopes) >= 1);

-- ---------------------------------------------------------------------------
-- Assert by scope (staff bypass unchanged)
-- ---------------------------------------------------------------------------

create or replace function public.assert_property_not_service_locked(
  p_property_id bigint,
  p_scope text default 'all'
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_scopes text[];
  v_scope text := nullif(btrim(coalesce(p_scope, '')), '');
begin
  if p_property_id is null then
    return;
  end if;
  if public.current_staff_id() is not null then
    return;
  end if;
  if not public.service_lock_module_enabled() then
    return;
  end if;

  select l.scopes into v_scopes
  from public.property_service_locks as l
  where l.property_id = p_property_id
    and l.active is true
  order by l.locked_at desc
  limit 1;

  if v_scopes is null then
    return;
  end if;

  -- Full lock or matching scope
  if 'all' = any (v_scopes) then
    raise exception 'service_lock: restricted'
      using errcode = 'P0001';
  end if;

  if v_scope is null or v_scope = 'all' then
    -- Caller asked "any lock?" without a specific scope → block if any lock exists
    raise exception 'service_lock: restricted'
      using errcode = 'P0001';
  end if;

  if v_scope = any (v_scopes) then
    raise exception 'service_lock: restricted'
      using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.assert_property_not_service_locked(bigint, text) from public;
revoke all on function public.assert_property_not_service_locked(bigint, text) from anon;
revoke all on function public.assert_property_not_service_locked(bigint, text) from authenticated;

-- Keep 1-arg overload as "any active lock blocks" for generic callers
create or replace function public.assert_property_not_service_locked(p_property_id bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_property_not_service_locked(p_property_id, 'all');
end;
$fn$;

revoke all on function public.assert_property_not_service_locked(bigint) from public;
revoke all on function public.assert_property_not_service_locked(bigint) from anon;
revoke all on function public.assert_property_not_service_locked(bigint) from authenticated;

-- ---------------------------------------------------------------------------
-- get / list include scopes
-- ---------------------------------------------------------------------------

drop function if exists public.get_property_service_lock(bigint);

create or replace function public.get_property_service_lock(p_property_id bigint)
returns table (
  active boolean,
  reason_code text,
  locked_at timestamptz,
  admin_note text,
  scopes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_service_locks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'get_property_service_lock: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация') then
    raise exception 'get_property_service_lock: not allowed'
      using errcode = '42501';
  end if;

  if not public.service_lock_module_enabled() then
    active := false;
    reason_code := null;
    locked_at := null;
    admin_note := null;
    scopes := array[]::text[];
    return next;
    return;
  end if;

  select l.* into v_row
  from public.property_service_locks as l
  where l.property_id = p_property_id
    and l.active is true
  order by l.locked_at desc
  limit 1;

  if not found then
    active := false;
    reason_code := null;
    locked_at := null;
    admin_note := null;
    scopes := array[]::text[];
    return next;
    return;
  end if;

  active := true;
  reason_code := v_row.reason_code;
  locked_at := v_row.locked_at;
  admin_note := case
    when public.has_staff_role('администрация') then v_row.admin_note
    else null
  end;
  scopes := v_row.scopes;
  return next;
end;
$fn$;

revoke all on function public.get_property_service_lock(bigint) from public;
revoke all on function public.get_property_service_lock(bigint) from anon;
grant execute on function public.get_property_service_lock(bigint) to authenticated;

drop function if exists public.list_property_service_locks();

create or replace function public.list_property_service_locks()
returns table (
  lock_id uuid,
  property_id bigint,
  apartment_number text,
  owner_name text,
  active boolean,
  reason_code text,
  admin_note text,
  locked_at timestamptz,
  locked_by_email text,
  scopes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_property_service_locks: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'list_property_service_locks: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    l.id,
    l.property_id,
    coalesce(p.apartment_number::text, ''),
    p.owner_name,
    l.active,
    l.reason_code,
    l.admin_note,
    l.locked_at,
    null::text,
    l.scopes
  from public.property_service_locks as l
  join public.properties as p on p.id = l.property_id
  where l.active is true
  order by l.locked_at desc;
end;
$fn$;

revoke all on function public.list_property_service_locks() from public;
revoke all on function public.list_property_service_locks() from anon;
grant execute on function public.list_property_service_locks() to authenticated;

-- ---------------------------------------------------------------------------
-- Lock RPC with scopes
-- ---------------------------------------------------------------------------

drop function if exists public.admin_lock_property_services(bigint, text);

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

  -- If 'all' present, collapse to just all
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

-- ---------------------------------------------------------------------------
-- Scoped triggers
-- ---------------------------------------------------------------------------

create or replace function public.trg_enforce_service_lock_scoped()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_scope text := coalesce(nullif(tg_argv[0], ''), 'all');
  v_pid bigint;
begin
  if tg_op = 'DELETE' then
    v_pid := case
      when tg_table_name = 'properties' then old.id
      else (to_jsonb(old) ->> 'property_id')::bigint
    end;
    if v_pid is not null then
      perform public.assert_property_not_service_locked(v_pid, v_scope);
    end if;
    return old;
  end if;

  v_pid := case
    when tg_table_name = 'properties' then new.id
    else (to_jsonb(new) ->> 'property_id')::bigint
  end;
  if v_pid is not null then
    perform public.assert_property_not_service_locked(v_pid, v_scope);
  end if;
  return new;
end;
$fn$;

do $trg$
begin
  if to_regclass('public.requests') is not null then
    drop trigger if exists requests_service_lock_bi on public.requests;
    create trigger requests_service_lock_bi
      before insert on public.requests
      for each row
      execute function public.trg_enforce_service_lock_scoped('requests');
  end if;

  if to_regclass('public.chat_messages') is not null then
    drop trigger if exists chat_messages_service_lock_bi on public.chat_messages;
    create trigger chat_messages_service_lock_bi
      before insert on public.chat_messages
      for each row
      execute function public.trg_enforce_service_lock_scoped('chat');
  end if;

  if to_regclass('public.apartment_guests') is not null then
    drop trigger if exists apartment_guests_service_lock_biud on public.apartment_guests;
    create trigger apartment_guests_service_lock_biud
      before insert or update or delete on public.apartment_guests
      for each row
      execute function public.trg_enforce_service_lock_scoped('occupancy');
  end if;

  if to_regclass('public.water_readings') is not null then
    drop trigger if exists water_readings_service_lock_bi on public.water_readings;
    create trigger water_readings_service_lock_bi
      before insert on public.water_readings
      for each row
      execute function public.trg_enforce_service_lock_scoped('water');
  end if;

  if to_regclass('public.electricity_charges') is not null then
    drop trigger if exists electricity_charges_service_lock_bi on public.electricity_charges;
    create trigger electricity_charges_service_lock_bi
      before insert on public.electricity_charges
      for each row
      execute function public.trg_enforce_service_lock_scoped('electricity');
  end if;

  if to_regclass('public.meter_readings') is not null then
    drop trigger if exists meter_readings_service_lock_bi on public.meter_readings;
    create trigger meter_readings_service_lock_bi
      before insert on public.meter_readings
      for each row
      execute function public.trg_enforce_service_lock_scoped('electricity');
  end if;

  if to_regclass('public.poll_votes') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'poll_votes' and column_name = 'property_id'
     ) then
    drop trigger if exists poll_votes_service_lock_bi on public.poll_votes;
    create trigger poll_votes_service_lock_bi
      before insert on public.poll_votes
      for each row
      execute function public.trg_enforce_service_lock_scoped('polls');
  end if;
end;
$trg$;

create or replace function public.trg_enforce_service_lock_properties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if public.current_staff_id() is not null then
    return new;
  end if;
  if new is distinct from old then
    perform public.assert_property_not_service_locked(new.id, 'occupancy');
  end if;
  return new;
end;
$fn$;

-- Internet RPCs: assert with internet scope
create or replace function public.request_internet_connect(
  p_property_id bigint,
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
  v_amount numeric;
  v_version_id uuid;
  v_wo uuid;
  v_billing_day smallint;
begin
  if v_uid is null or v_email is null then
    raise exception 'request_internet_connect: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'request_internet_connect: not allowed'
      using errcode = '42501';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'internet');

  select c.amount_eur, c.tariff_version_id
    into v_amount, v_version_id
  from public.compute_internet_monthly_amount(v_today) as c;

  v_billing_day := public.internet_billing_day_from_date(v_today);

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
           period_start = v_today,
           period_end = null,
           pending_days = null,
           disable_reason = null,
           disable_work_order_id = null,
           billing_day = v_billing_day,
           billing_anchor_date = v_today,
           next_charge_on = public.internet_add_one_month(v_today),
           updated_at = now()
     where s.id = v_sub.id
    returning * into v_sub;
  else
    insert into public.internet_subscriptions (
      property_id, status, period_start, period_end, pending_days,
      billing_day, billing_anchor_date, next_charge_on
    ) values (
      p_property_id, 'pending_enable', v_today, null, null,
      v_billing_day, v_today, public.internet_add_one_month(v_today)
    )
    returning * into v_sub;
  end if;

  perform public.internet_insert_charge(
    p_property_id, null, v_amount, v_version_id,
    'Ежемесячная подписка · ' || to_char(v_today, 'YYYY-MM'),
    v_email, p_idempotency_key
  );

  v_wo := public.internet_create_system_work_order(
    v_sub.id, p_property_id, 'enable', v_uid
  );

  update public.internet_subscriptions as s
     set enable_work_order_id = v_wo,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_connect(bigint, uuid) from public;
revoke all on function public.request_internet_connect(bigint, uuid) from anon;
grant execute on function public.request_internet_connect(bigint, uuid) to authenticated;

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
  perform public.assert_property_not_service_locked(p_property_id, 'internet');

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
      null,
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
         billing_day = null,
         billing_anchor_date = null,
         next_charge_on = null,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.cancel_internet_connect_request(bigint) from public;
revoke all on function public.cancel_internet_connect_request(bigint) from anon;
grant execute on function public.cancel_internet_connect_request(bigint) to authenticated;

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
  perform public.assert_property_not_service_locked(p_property_id, 'internet');

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
