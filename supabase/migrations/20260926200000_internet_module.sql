-- Internet module v1: tariff, subscriptions, ledger, system work orders, expiry jobs.

begin;

-- ---------------------------------------------------------------------------
-- Module Core: promote internet to live utilities module
-- ---------------------------------------------------------------------------

update public.module_catalog
   set implemented = true,
       category = 'utilities',
       default_name = 'Интернет',
       sort_order = 30
 where module_key = 'internet';

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'internet', false, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'internet'
);

-- ---------------------------------------------------------------------------
-- Tariff Core: day + month (30-day cycle)
-- ---------------------------------------------------------------------------

insert into public.tariff_catalog (
  tariff_key, module_key, default_name, unit_code, currency,
  calculation_type, billing_period, application_basis, governance_type, component_keys, active
) values (
  'internet', 'internet', 'Интернет', 'item', 'EUR',
  'fixed', null, 'calendar_date', 'external_supplier', array['day','month']::text[], true
)
on conflict (tariff_key) do update
  set default_name = excluded.default_name,
      module_key = excluded.module_key,
      unit_code = excluded.unit_code,
      currency = excluded.currency,
      calculation_type = excluded.calculation_type,
      billing_period = excluded.billing_period,
      application_basis = excluded.application_basis,
      governance_type = excluded.governance_type,
      component_keys = excluded.component_keys,
      active = excluded.active;

create or replace function public.tariff_can_publish(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case btrim(coalesce(p_module_key, ''))
    when 'support_fee' then public.has_staff_role('администрация')
    when 'capital_repair' then public.has_staff_role('администрация')
    when 'water' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    when 'electricity' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    when 'internet' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    else false
  end;
$$;

revoke all on function public.tariff_can_publish(text) from public;
revoke all on function public.tariff_can_publish(text) from anon;
grant execute on function public.tariff_can_publish(text) to authenticated;

create or replace function public.resolve_internet_tariff(p_on_date date)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tariff_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rates jsonb;
  v_day numeric;
  v_month numeric;
begin
  if p_on_date is null then
    raise exception 'resolve_internet_tariff: application date required'
      using errcode = '22023';
  end if;

  select c.id into v_tariff_id
  from public.tariff_catalog as c
  where c.tariff_key = 'internet'
    and c.active is true
  limit 1;

  if v_tariff_id is null then
    raise exception 'No internet tariff configured.'
      using errcode = 'P0002';
  end if;

  begin
    v_version_id := public.resolve_tariff_version_by_date(v_tariff_id, p_on_date);
  exception
    when sqlstate 'P0002' then
      raise exception 'No internet tariff configured for this date.'
        using errcode = 'P0002';
  end;

  select tv.valid_from, public.tariff_rates_json(tv.id)
    into v_valid_from, v_rates
  from public.tariff_versions as tv
  where tv.id = v_version_id;

  v_day := (v_rates ->> 'day')::numeric;
  v_month := (v_rates ->> 'month')::numeric;
  if v_day is null or v_month is null or v_day < 0 or v_month < 0 then
    raise exception 'No internet tariff configured for this date.'
      using errcode = 'P0002';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rates := v_rates;
  return next;
end;
$fn$;

revoke all on function public.resolve_internet_tariff(date) from public;
revoke all on function public.resolve_internet_tariff(date) from anon;
revoke all on function public.resolve_internet_tariff(date) from authenticated;

create or replace function public.get_applicable_internet_tariff(p_on_date date default null)
returns table (
  tariff_version_id uuid,
  tariff_key text,
  valid_from date,
  rates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_on date;
  v_version_id uuid;
  v_valid_from date;
  v_rates jsonb;
begin
  if auth.uid() is null then
    raise exception 'get_applicable_internet_tariff: not authenticated'
      using errcode = '28000';
  end if;

  v_on := coalesce(p_on_date, public.tariff_sofia_today());

  select r.tariff_version_id, r.valid_from, r.rates
    into v_version_id, v_valid_from, v_rates
  from public.resolve_internet_tariff(v_on) as r;

  return query
  select v_version_id, 'internet'::text, v_valid_from, v_rates;
end;
$fn$;

revoke all on function public.get_applicable_internet_tariff(date) from public;
revoke all on function public.get_applicable_internet_tariff(date) from anon;
grant execute on function public.get_applicable_internet_tariff(date) to authenticated;

create or replace function public.compute_internet_amount(p_days integer, p_on_date date default null)
returns table (
  days integer,
  month_cycles integer,
  remainder_days integer,
  day_rate_eur numeric,
  month_rate_eur numeric,
  amount_eur numeric,
  tariff_version_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_on date;
  v_version_id uuid;
  v_rates jsonb;
  v_day numeric;
  v_month numeric;
  v_months integer;
  v_rem integer;
  v_amount numeric;
begin
  if auth.uid() is null then
    raise exception 'compute_internet_amount: not authenticated'
      using errcode = '28000';
  end if;
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'compute_internet_amount: invalid days'
      using errcode = '22023';
  end if;

  v_on := coalesce(p_on_date, public.tariff_sofia_today());
  select r.tariff_version_id, r.rates
    into v_version_id, v_rates
  from public.resolve_internet_tariff(v_on) as r;

  v_day := (v_rates ->> 'day')::numeric;
  v_month := (v_rates ->> 'month')::numeric;
  v_months := (p_days / 30);
  v_rem := p_days % 30;
  v_amount := round(v_months * v_month + v_rem * v_day, 2);

  return query
  select p_days, v_months, v_rem, v_day, v_month, v_amount, v_version_id;
end;
$fn$;

revoke all on function public.compute_internet_amount(integer, date) from public;
revoke all on function public.compute_internet_amount(integer, date) from anon;
grant execute on function public.compute_internet_amount(integer, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.internet_subscriptions (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  status text not null default 'inactive'
    constraint internet_subscriptions_status_check
      check (status in ('pending_enable', 'active', 'pending_disable', 'inactive')),
  period_start date null,
  period_end date null,
  pending_days integer null
    constraint internet_subscriptions_pending_days_check
      check (pending_days is null or (pending_days >= 1 and pending_days <= 3650)),
  disable_reason text null
    constraint internet_subscriptions_disable_reason_check
      check (disable_reason is null or disable_reason in ('owner_early', 'expiry', 'debt')),
  enable_work_order_id uuid null,
  disable_work_order_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internet_subscriptions_property_key unique (property_id)
);

comment on table public.internet_subscriptions is
  'One internet subscription contour per apartment. Period dates set on engineer enable.';

create table if not exists public.internet_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  kind text not null
    constraint internet_ledger_kind_check
      check (kind in ('charge', 'payment', 'adjustment_debit', 'adjustment_credit')),
  amount_eur numeric(12, 2) not null
    constraint internet_ledger_amount_positive check (amount_eur > 0),
  period_days integer null,
  tariff_version_id uuid null
    references public.tariff_versions (id) on delete restrict,
  note text null,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint internet_ledger_idempotency_key unique (idempotency_key)
);

create index if not exists internet_ledger_property_created_idx
  on public.internet_ledger (property_id, created_at desc);

alter table public.internet_subscriptions enable row level security;
alter table public.internet_ledger enable row level security;

revoke all on table public.internet_subscriptions from public;
revoke all on table public.internet_subscriptions from anon;
revoke all on table public.internet_subscriptions from authenticated;
revoke all on table public.internet_ledger from public;
revoke all on table public.internet_ledger from anon;
revoke all on table public.internet_ledger from authenticated;

grant select on table public.internet_subscriptions to authenticated;
grant select on table public.internet_ledger to authenticated;

drop policy if exists internet_subscriptions_select on public.internet_subscriptions;
create policy internet_subscriptions_select on public.internet_subscriptions
  for select to authenticated
  using (
    public.owns_property(property_id)
    or public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

drop policy if exists internet_ledger_select on public.internet_ledger;
create policy internet_ledger_select on public.internet_ledger
  for select to authenticated
  using (
    public.owns_property(property_id)
    or public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

-- Work orders: system source + internet link (technical only in title/instructions)
alter table public.work_orders
  drop constraint if exists work_orders_source_type_check;

alter table public.work_orders
  add constraint work_orders_source_type_check
  check (source_type in ('request', 'admin', 'system'));

alter table public.work_orders
  drop constraint if exists work_orders_source_request_ck;

alter table public.work_orders
  add constraint work_orders_source_request_ck
  check (
    (source_type = 'request' and request_id is not null)
    or (source_type in ('admin', 'system') and request_id is null)
  );

alter table public.work_orders
  add column if not exists internet_action text null;

alter table public.work_orders
  add column if not exists internet_subscription_id uuid null
    references public.internet_subscriptions (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'work_orders_internet_action_check'
  ) then
    alter table public.work_orders
      add constraint work_orders_internet_action_check
      check (internet_action is null or internet_action in ('enable', 'disable'));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function public.internet_apt_label(p_property_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce('№' || p.apartment_number::text, 'апартамент')
  from public.properties as p
  where p.id = p_property_id;
$$;

revoke all on function public.internet_apt_label(bigint) from public;
revoke all on function public.internet_apt_label(bigint) from anon;
revoke all on function public.internet_apt_label(bigint) from authenticated;

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
declare
  v_id uuid;
  v_apt text;
  v_title text;
  v_instr text;
begin
  if p_action not in ('enable', 'disable') then
    raise exception 'internet_create_system_work_order: invalid action'
      using errcode = '22023';
  end if;

  v_apt := public.internet_apt_label(p_property_id);
  if p_action = 'enable' then
    v_title := 'Включить интернет · ' || v_apt;
    v_instr := 'Подключить интернет в апартаменте ' || v_apt || '.';
  else
    v_title := 'Отключить интернет · ' || v_apt;
    v_instr := 'Отключить интернет в апартаменте ' || v_apt || '.';
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

revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from public;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from anon;
revoke all on function public.internet_create_system_work_order(uuid, bigint, text, uuid) from authenticated;

create or replace function public.internet_insert_charge(
  p_property_id bigint,
  p_days integer,
  p_amount numeric,
  p_tariff_version_id uuid,
  p_note text,
  p_email text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.internet_ledger%rowtype;
  v_amount numeric;
  v_note text;
begin
  v_amount := round(p_amount, 2);
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  if p_idempotency_key is not null then
    select l.* into v_row
    from public.internet_ledger as l
    where l.idempotency_key = p_idempotency_key;
    if found then
      if v_row.property_id is distinct from p_property_id
         or v_row.kind is distinct from 'charge'
         or v_row.amount_eur is distinct from v_amount then
        raise exception 'Idempotency key conflict.';
      end if;
      return v_row.id;
    end if;
  end if;

  insert into public.internet_ledger (
    property_id, kind, amount_eur, period_days, tariff_version_id,
    note, recorded_by_email, idempotency_key
  ) values (
    p_property_id, 'charge', v_amount, p_days, p_tariff_version_id,
    v_note, p_email, coalesce(p_idempotency_key, gen_random_uuid())
  )
  returning id into v_row.id;

  return v_row.id;
end;
$fn$;

revoke all on function public.internet_insert_charge(bigint, integer, numeric, uuid, text, text, uuid) from public;
revoke all on function public.internet_insert_charge(bigint, integer, numeric, uuid, text, text, uuid) from anon;
revoke all on function public.internet_insert_charge(bigint, integer, numeric, uuid, text, text, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Owner / admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.request_internet_connect(
  p_property_id bigint,
  p_days integer,
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
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'request_internet_connect: invalid days'
      using errcode = '22023';
  end if;

  select c.days, c.amount_eur, c.tariff_version_id
    into v_days, v_amount, v_version_id
  from public.compute_internet_amount(p_days, public.tariff_sofia_today()) as c;

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
           period_start = null,
           period_end = null,
           pending_days = v_days,
           disable_reason = null,
           disable_work_order_id = null,
           updated_at = now()
     where s.id = v_sub.id
    returning * into v_sub;
  else
    insert into public.internet_subscriptions (
      property_id, status, pending_days
    ) values (
      p_property_id, 'pending_enable', v_days
    )
    returning * into v_sub;
  end if;

  perform public.internet_insert_charge(
    p_property_id, v_days, v_amount, v_version_id,
    'Подключение интернета на ' || v_days::text || ' дн.',
    v_email, p_idempotency_key
  );

  v_wo := public.internet_create_system_work_order(v_sub.id, p_property_id, 'enable', v_uid);

  update public.internet_subscriptions as s
     set enable_work_order_id = v_wo,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_connect(bigint, integer, uuid) from public;
revoke all on function public.request_internet_connect(bigint, integer, uuid) from anon;
grant execute on function public.request_internet_connect(bigint, integer, uuid) to authenticated;

create or replace function public.request_internet_extend(
  p_property_id bigint,
  p_days integer,
  p_idempotency_key uuid default null
)
returns public.internet_subscriptions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_sub public.internet_subscriptions%rowtype;
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
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'request_internet_extend: invalid days'
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

  select c.days, c.amount_eur, c.tariff_version_id
    into v_days, v_amount, v_version_id
  from public.compute_internet_amount(p_days, public.tariff_sofia_today()) as c;

  perform public.internet_insert_charge(
    p_property_id, v_days, v_amount, v_version_id,
    'Продление интернета на ' || v_days::text || ' дн.',
    v_email, p_idempotency_key
  );

  update public.internet_subscriptions as s
     set period_end = s.period_end + v_days,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_extend(bigint, integer, uuid) from public;
revoke all on function public.request_internet_extend(bigint, integer, uuid) from anon;
grant execute on function public.request_internet_extend(bigint, integer, uuid) to authenticated;

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
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.request_internet_disconnect(bigint) from public;
revoke all on function public.request_internet_disconnect(bigint) from anon;
grant execute on function public.request_internet_disconnect(bigint) to authenticated;

create or replace function public.admin_internet_disconnect_debt(p_property_id bigint)
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
    raise exception 'admin_internet_disconnect_debt: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'admin_internet_disconnect_debt: not allowed'
      using errcode = '42501';
  end if;

  select s.* into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if not found or v_sub.status <> 'active' then
    raise exception 'admin_internet_disconnect_debt: not active'
      using errcode = 'P0001';
  end if;

  -- Technical task only — no debt amount / reason in WO text.
  v_wo := public.internet_create_system_work_order(v_sub.id, p_property_id, 'disable', v_uid);

  update public.internet_subscriptions as s
     set status = 'pending_disable',
         disable_reason = 'debt',
         disable_work_order_id = v_wo,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$fn$;

revoke all on function public.admin_internet_disconnect_debt(bigint) from public;
revoke all on function public.admin_internet_disconnect_debt(bigint) from anon;
grant execute on function public.admin_internet_disconnect_debt(bigint) to authenticated;

create or replace function public.record_internet_payment(
  p_property_id bigint,
  p_amount_eur numeric,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  amount_eur numeric,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_amount numeric;
  v_note text;
  v_row public.internet_ledger%rowtype;
begin
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  v_amount := round(coalesce(p_amount_eur, 0), 2);
  if v_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.* into v_row
  from public.internet_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.kind is distinct from 'payment'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;
    return query
    select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id;
  if not found then
    raise exception 'Property not found.';
  end if;

  insert into public.internet_ledger (
    property_id, kind, amount_eur, note, recorded_by_email, idempotency_key
  ) values (
    p_property_id, 'payment', v_amount, v_note, v_email, p_idempotency_key
  )
  returning * into v_row;

  return query
  select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$fn$;

revoke all on function public.record_internet_payment(bigint, numeric, text, uuid) from public;
revoke all on function public.record_internet_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_internet_payment(bigint, numeric, text, uuid) to authenticated;

create or replace function public.get_internet_balance(p_property_id bigint)
returns table (
  charged_eur numeric,
  paid_eur numeric,
  adjustments_debit_eur numeric,
  adjustments_credit_eur numeric,
  balance_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_internet_balance: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'get_internet_balance: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    round(coalesce(sum(case when l.kind = 'charge' then l.amount_eur else 0 end), 0), 2),
    round(coalesce(sum(case when l.kind = 'payment' then l.amount_eur else 0 end), 0), 2),
    round(coalesce(sum(case when l.kind = 'adjustment_debit' then l.amount_eur else 0 end), 0), 2),
    round(coalesce(sum(case when l.kind = 'adjustment_credit' then l.amount_eur else 0 end), 0), 2),
    round(coalesce(sum(
      case
        when l.kind = 'charge' then l.amount_eur
        when l.kind = 'payment' then -l.amount_eur
        when l.kind = 'adjustment_debit' then l.amount_eur
        when l.kind = 'adjustment_credit' then -l.amount_eur
        else 0
      end
    ), 0), 2)
  from public.internet_ledger as l
  where l.property_id = p_property_id;
end;
$fn$;

revoke all on function public.get_internet_balance(bigint) from public;
revoke all on function public.get_internet_balance(bigint) from anon;
grant execute on function public.get_internet_balance(bigint) to authenticated;

create or replace function public.get_internet_fund_totals()
returns table (
  active_count integer,
  inactive_count integer,
  pending_enable_count integer,
  pending_disable_count integer,
  charged_eur numeric,
  paid_eur numeric,
  balance_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_internet_fund_totals: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'get_internet_fund_totals: not allowed'
      using errcode = '42501';
  end if;

  return query
  with sub as (
    select
      count(*) filter (where s.status = 'active')::int as active_count,
      count(*) filter (where s.status = 'inactive')::int as inactive_count,
      count(*) filter (where s.status = 'pending_enable')::int as pending_enable_count,
      count(*) filter (where s.status = 'pending_disable')::int as pending_disable_count
    from public.internet_subscriptions as s
  ),
  led as (
    select
      round(coalesce(sum(case when l.kind = 'charge' then l.amount_eur else 0 end), 0), 2) as charged,
      round(coalesce(sum(case when l.kind = 'payment' then l.amount_eur else 0 end), 0), 2) as paid,
      round(coalesce(sum(
        case
          when l.kind = 'charge' then l.amount_eur
          when l.kind = 'payment' then -l.amount_eur
          when l.kind = 'adjustment_debit' then l.amount_eur
          when l.kind = 'adjustment_credit' then -l.amount_eur
          else 0
        end
      ), 0), 2) as bal
    from public.internet_ledger as l
  )
  select
    sub.active_count,
    sub.inactive_count,
    sub.pending_enable_count,
    sub.pending_disable_count,
    led.charged,
    led.paid,
    led.bal
  from sub, led;
end;
$fn$;

revoke all on function public.get_internet_fund_totals() from public;
revoke all on function public.get_internet_fund_totals() from anon;
grant execute on function public.get_internet_fund_totals() to authenticated;

-- ---------------------------------------------------------------------------
-- Expiry: next Sofia day after period_end → pending_disable + WO
-- ---------------------------------------------------------------------------

create or replace function public.process_internet_expiry_disconnects()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_today date := public.tariff_sofia_today();
  v_system uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_row public.internet_subscriptions%rowtype;
  v_wo uuid;
  v_created integer := 0;
begin
  for v_row in
    select s.*
    from public.internet_subscriptions as s
    where s.status = 'active'
      and s.period_end is not null
      and s.period_end < v_today
    for update
  loop
    v_wo := public.internet_create_system_work_order(
      v_row.id, v_row.property_id, 'disable', v_system
    );
    update public.internet_subscriptions as s
       set status = 'pending_disable',
           disable_reason = 'expiry',
           disable_work_order_id = v_wo,
           updated_at = now()
     where s.id = v_row.id;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'sofia_today', v_today);
end;
$fn$;

revoke all on function public.process_internet_expiry_disconnects() from public;
revoke all on function public.process_internet_expiry_disconnects() from anon;
-- Not granted to authenticated; schedule via pg_cron / service role.

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'internet_expiry_disconnects_sofia_07';
    perform cron.schedule(
      'internet_expiry_disconnects_sofia_07',
      '0 7 * * *',
      $cmd$select public.process_internet_expiry_disconnects()$cmd$
    );
    -- Note: DB timezone may not be Europe/Sofia; operators should align cron TZ.
  end if;
exception
  when others then
    raise notice 'internet expiry cron not scheduled: %', sqlerrm;
end;
$cron$;

-- ---------------------------------------------------------------------------
-- Engineer claim pool for system WOs + complete hook
-- ---------------------------------------------------------------------------

create or replace function public.list_claimable_system_work_orders()
returns table (
  id uuid,
  title text,
  instructions text,
  status text,
  priority text,
  apartment_number text,
  internet_action text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'list_claimable_system_work_orders: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('инженер') then
    raise exception 'list_claimable_system_work_orders: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    wo.id,
    wo.title,
    wo.instructions,
    wo.status,
    wo.priority,
    case when p.id is null then null else p.apartment_number::text end,
    wo.internet_action,
    wo.created_at
  from public.work_orders as wo
  left join public.properties as p on p.id = wo.target_property_id
  where wo.source_type = 'system'
    and wo.status = 'open'
    and wo.assigned_staff_id is null
  order by wo.created_at asc;
end;
$fn$;

revoke all on function public.list_claimable_system_work_orders() from public;
revoke all on function public.list_claimable_system_work_orders() from anon;
grant execute on function public.list_claimable_system_work_orders() to authenticated;

create or replace function public.claim_system_work_order(p_work_order_id uuid)
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
    raise exception 'claim_system_work_order: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('инженер') then
    raise exception 'claim_system_work_order: not allowed'
      using errcode = '42501';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null or not public.is_work_order_assignee_role(v_staff_id) then
    raise exception 'claim_system_work_order: not allowed'
      using errcode = '42501';
  end if;

  select wo.* into v_row
  from public.work_orders as wo
  where wo.id = p_work_order_id
  for update;

  if not found
     or v_row.source_type <> 'system'
     or v_row.status <> 'open'
     or v_row.assigned_staff_id is not null then
    raise exception 'claim_system_work_order: not claimable'
      using errcode = 'P0002';
  end if;

  update public.work_orders as wo
     set assigned_staff_id = v_staff_id,
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = v_row.id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.claim_system_work_order(uuid) from public;
revoke all on function public.claim_system_work_order(uuid) from anon;
grant execute on function public.claim_system_work_order(uuid) to authenticated;

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

  -- Internet technical completion (no finance).
  if v_row.internet_subscription_id is not null and v_row.internet_action is not null then
    select s.* into v_sub
    from public.internet_subscriptions as s
    where s.id = v_row.internet_subscription_id
    for update;

    if found then
      if v_row.internet_action = 'enable'
         and v_sub.status = 'pending_enable'
         and v_sub.pending_days is not null then
        update public.internet_subscriptions as s
           set status = 'active',
               period_start = v_today,
               period_end = v_today + (v_sub.pending_days - 1),
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

commit;
