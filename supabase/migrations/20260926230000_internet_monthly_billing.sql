-- Internet: monthly subscription billing.
-- Owner requests connect → charge 1× month rate; recurring charge on same day-of-month
-- until disconnect. Prepaid from–to / extend deprecated.

begin;

-- ---------------------------------------------------------------------------
-- Tariff catalog: month only (unlock briefly if versions already exist)
-- ---------------------------------------------------------------------------

alter table public.tariff_catalog disable trigger tariff_catalog_lock;

update public.tariff_catalog
   set billing_period = 'month',
       component_keys = array['month']::text[],
       calculation_type = 'fixed'
 where tariff_key = 'internet';

alter table public.tariff_catalog enable trigger tariff_catalog_lock;

-- ---------------------------------------------------------------------------
-- Subscription billing fields
-- ---------------------------------------------------------------------------

alter table public.internet_subscriptions
  add column if not exists billing_day smallint null
    constraint internet_subscriptions_billing_day_check
      check (billing_day is null or (billing_day >= 1 and billing_day <= 28)),
  add column if not exists billing_anchor_date date null,
  add column if not exists next_charge_on date null;

comment on column public.internet_subscriptions.billing_day is
  'Day of month (1–28) for recurring charge; set on first connect request.';
comment on column public.internet_subscriptions.next_charge_on is
  'Next Sofia date when monthly charge should run.';

-- ---------------------------------------------------------------------------
-- Resolve / compute: month rate only
-- ---------------------------------------------------------------------------

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

  v_month := (v_rates ->> 'month')::numeric;
  if v_month is null or v_month < 0 then
    raise exception 'No internet tariff configured for this date.'
      using errcode = 'P0002';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rates := jsonb_build_object('month', v_month);
  return next;
end;
$fn$;

revoke all on function public.resolve_internet_tariff(date) from public;
revoke all on function public.resolve_internet_tariff(date) from anon;
revoke all on function public.resolve_internet_tariff(date) from authenticated;

create or replace function public.compute_internet_monthly_amount(p_on_date date default null)
returns table (
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
  v_month numeric;
begin
  if auth.uid() is null then
    raise exception 'compute_internet_monthly_amount: not authenticated'
      using errcode = '28000';
  end if;

  v_on := coalesce(p_on_date, public.tariff_sofia_today());

  select r.tariff_version_id, r.rates
    into v_version_id, v_rates
  from public.resolve_internet_tariff(v_on) as r;

  v_month := round((v_rates ->> 'month')::numeric, 2);

  month_rate_eur := v_month;
  amount_eur := v_month;
  tariff_version_id := v_version_id;
  return next;
end;
$fn$;

revoke all on function public.compute_internet_monthly_amount(date) from public;
revoke all on function public.compute_internet_monthly_amount(date) from anon;
grant execute on function public.compute_internet_monthly_amount(date) to authenticated;

-- Keep days helper for any legacy UI, but base it on month/30 for remnant day rate.
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
  v_month numeric;
  v_day numeric;
  v_safe integer;
  v_months integer;
  v_rem integer;
begin
  if auth.uid() is null then
    raise exception 'compute_internet_amount: not authenticated'
      using errcode = '28000';
  end if;
  if p_days is null or p_days < 1 then
    raise exception 'compute_internet_amount: invalid days'
      using errcode = '22023';
  end if;

  v_on := coalesce(p_on_date, public.tariff_sofia_today());
  select r.tariff_version_id, r.rates
    into v_version_id, v_rates
  from public.resolve_internet_tariff(v_on) as r;

  v_month := round((v_rates ->> 'month')::numeric, 2);
  v_day := round(v_month / 30.0, 4);
  v_safe := p_days;
  v_months := floor(v_safe / 30.0)::integer;
  v_rem := v_safe % 30;

  days := v_safe;
  month_cycles := v_months;
  remainder_days := v_rem;
  day_rate_eur := v_day;
  month_rate_eur := v_month;
  amount_eur := round(v_months * v_month + v_rem * v_day, 2);
  tariff_version_id := v_version_id;
  return next;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.internet_billing_day_from_date(p_date date)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select least(28, greatest(1, extract(day from p_date)::integer))::smallint;
$$;

create or replace function public.internet_add_one_month(p_date date)
returns date
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_day integer := least(28, extract(day from p_date)::integer);
  v_next date;
begin
  v_next := (date_trunc('month', p_date) + interval '1 month')::date;
  return make_date(
    extract(year from v_next)::integer,
    extract(month from v_next)::integer,
    least(v_day, extract(day from (date_trunc('month', v_next) + interval '1 month - 1 day')::date)::integer)
  );
end;
$fn$;

create or replace function public.internet_next_charge_on(p_from date, p_billing_day smallint)
returns date
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_day smallint := least(28, greatest(1, coalesce(p_billing_day, 1)))::smallint;
  v_candidate date;
begin
  v_candidate := make_date(
    extract(year from p_from)::integer,
    extract(month from p_from)::integer,
    least(
      v_day,
      extract(day from (date_trunc('month', p_from) + interval '1 month - 1 day')::date)::integer
    )
  );
  if v_candidate <= p_from then
    return public.internet_add_one_month(v_candidate);
  end if;
  return v_candidate;
end;
$fn$;

-- Deterministic uuid for monthly charge idempotency (property + year-month).
create or replace function public.internet_monthly_charge_key(p_property_id bigint, p_on date)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5(
    'internet-monthly:' || p_property_id::text || ':' || to_char(p_on, 'YYYY-MM')
  )::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Connect: monthly plan (no from–to)
-- ---------------------------------------------------------------------------

drop function if exists public.request_internet_connect(bigint, date, date, uuid);
drop function if exists public.request_internet_extend(bigint, date, date, uuid);

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

-- Stub extend: removed product path
create or replace function public.request_internet_extend(
  p_property_id bigint,
  p_idempotency_key uuid default null
)
returns public.internet_subscriptions
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception 'request_internet_extend: feature_removed'
    using errcode = 'P0001';
end;
$fn$;

revoke all on function public.request_internet_extend(bigint, uuid) from public;
revoke all on function public.request_internet_extend(bigint, uuid) from anon;
-- not granted to authenticated

-- ---------------------------------------------------------------------------
-- Cancel: clear billing fields
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Work order complete: set active without prepaid end; clear billing on disable
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
  v_staff_id bigint;
  v_row public.work_orders%rowtype;
  v_note text;
  v_sub public.internet_subscriptions%rowtype;
  v_today date := public.tariff_sofia_today();
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
               period_end = null,
               pending_days = null,
               disable_reason = null,
               billing_day = coalesce(s.billing_day, public.internet_billing_day_from_date(v_today)),
               billing_anchor_date = coalesce(s.billing_anchor_date, v_today),
               next_charge_on = coalesce(
                 s.next_charge_on,
                 public.internet_add_one_month(coalesce(s.billing_anchor_date, v_today))
               ),
               updated_at = now()
         where s.id = v_sub.id;
      elsif v_row.internet_action = 'disable'
            and v_sub.status = 'pending_disable' then
        update public.internet_subscriptions as s
           set status = 'inactive',
               pending_days = null,
               period_end = v_today,
               billing_day = null,
               next_charge_on = null,
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

-- ---------------------------------------------------------------------------
-- Monthly charge cron
-- ---------------------------------------------------------------------------

create or replace function public.process_internet_monthly_charges()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_today date := public.tariff_sofia_today();
  v_count integer := 0;
  r record;
  v_amount numeric;
  v_version_id uuid;
  v_key uuid;
begin
  for r in
    select s.id, s.property_id, s.billing_day, s.next_charge_on, s.billing_anchor_date
    from public.internet_subscriptions as s
    where s.status = 'active'
      and s.billing_day is not null
      and s.next_charge_on is not null
      and s.next_charge_on <= v_today
    for update skip locked
  loop
    begin
      select r.tariff_version_id, round((r.rates ->> 'month')::numeric, 2)
        into v_version_id, v_amount
      from public.resolve_internet_tariff(v_today) as r;

      if v_amount is null or v_amount <= 0 then
        continue;
      end if;

      v_key := public.internet_monthly_charge_key(r.property_id, r.next_charge_on);

      perform public.internet_insert_charge(
        r.property_id,
        null,
        v_amount,
        v_version_id,
        'Ежемесячная подписка · ' || to_char(r.next_charge_on, 'YYYY-MM'),
        'system@internet',
        v_key
      );

      update public.internet_subscriptions as s
         set next_charge_on = public.internet_add_one_month(r.next_charge_on),
             updated_at = now()
       where s.id = r.id;

      v_count := v_count + 1;
    exception
      when others then
        -- Skip property on tariff/charge errors; continue others.
        continue;
    end;
  end loop;

  return v_count;
end;
$fn$;

revoke all on function public.process_internet_monthly_charges() from public;
revoke all on function public.process_internet_monthly_charges() from anon;
revoke all on function public.process_internet_monthly_charges() from authenticated;

-- Expiry: only legacy prepaid rows with period_end set
create or replace function public.process_internet_expiry_disconnects()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_today date := public.tariff_sofia_today();
  v_system uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_count integer := 0;
  r record;
  v_wo uuid;
begin
  for r in
    select s.*
    from public.internet_subscriptions as s
    where s.status = 'active'
      and s.period_end is not null
      and s.period_end < v_today
    for update skip locked
  loop
    update public.internet_subscriptions as s
       set status = 'pending_disable',
           disable_reason = 'expiry',
           updated_at = now()
     where s.id = r.id;

    v_wo := public.internet_create_system_work_order(
      r.id, r.property_id, 'disable', v_system
    );

    update public.internet_subscriptions as s
       set disable_work_order_id = v_wo,
           updated_at = now()
     where s.id = r.id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('created', v_count, 'sofia_today', v_today);
end;
$fn$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('internet_monthly_charges_sofia_07');
    exception
      when others then null;
    end;
    perform cron.schedule(
      'internet_monthly_charges_sofia_07',
      '0 7 * * *',
      $cmd$select public.process_internet_monthly_charges()$cmd$
    );
  end if;
end;
$cron$;

-- Backfill active prepaid → recurring if still within period
update public.internet_subscriptions as s
   set billing_day = public.internet_billing_day_from_date(coalesce(s.period_start, public.tariff_sofia_today())),
       billing_anchor_date = coalesce(s.period_start, public.tariff_sofia_today()),
       next_charge_on = public.internet_next_charge_on(
         public.tariff_sofia_today(),
         public.internet_billing_day_from_date(coalesce(s.period_start, public.tariff_sofia_today()))
       ),
       period_end = null
 where s.status = 'active'
   and s.billing_day is null
   and (s.period_end is null or s.period_end >= public.tariff_sofia_today());

commit;
