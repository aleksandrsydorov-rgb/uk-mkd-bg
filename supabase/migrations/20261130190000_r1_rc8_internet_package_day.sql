-- =============================================================================
-- R1-RC8 — Internet package/day tariffs and paid-period calculation
-- =============================================================================
-- Two rates: package_30 (30 calendar days) and day (one calendar day, Sofia).
-- Inclusive dates: days = (end - start) + 1. DST does not change the day count.
-- Billing methods: package_plus_days and daily. Client totals are not trusted.
-- Old month-only tariff versions stay as they are and are not renamed to packages.
-- Paid periods use the existing internet_ledger. Monthly cron skips prepaid rows.
-- Optional first-run: prepare both rates, opening none/import, publish on activation.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

alter table public.tariff_catalog disable trigger tariff_catalog_lock;
update public.tariff_catalog
   set component_keys = array['package_30', 'day']::text[],
       billing_period = 'month',
       calculation_type = 'fixed'
 where tariff_key = 'internet';
alter table public.tariff_catalog enable trigger tariff_catalog_lock;

comment on column public.tariff_catalog.component_keys is
  'Internet uses package_30 and day for new versions. Historical month-only versions remain readable.';

alter table public.internet_subscriptions
  add column if not exists billing_mode text not null default 'monthly';

alter table public.internet_subscriptions
  drop constraint if exists internet_subscriptions_billing_mode_check;

alter table public.internet_subscriptions
  add constraint internet_subscriptions_billing_mode_check
  check (billing_mode in ('monthly', 'prepaid_period'));

comment on column public.internet_subscriptions.billing_mode is
  'monthly: recurring month charge. prepaid_period: paid calendar periods; monthly cron does not charge while a period covers the day.';

create table if not exists public.internet_paid_periods (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  subscription_id uuid not null
    references public.internet_subscriptions (id) on delete restrict,
  period_start date not null,
  period_end date not null,
  billing_method text not null,
  calendar_days integer not null,
  package_count integer not null,
  extra_days integer not null,
  package_rate_eur numeric(12, 2) not null,
  day_rate_eur numeric(12, 4) not null,
  amount_eur numeric(12, 2) not null,
  tariff_version_id uuid null
    references public.tariff_versions (id) on delete restrict,
  ledger_id uuid null
    references public.internet_ledger (id) on delete restrict,
  opening_import boolean not null default false,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint internet_paid_periods_method_check
    check (billing_method in ('package_plus_days', 'daily')),
  constraint internet_paid_periods_dates_check
    check (period_end >= period_start),
  constraint internet_paid_periods_days_check
    check (calendar_days = (period_end - period_start) + 1),
  constraint internet_paid_periods_packages_check
    check (package_count >= 0 and extra_days >= 0),
  constraint internet_paid_periods_amount_nonneg check (amount_eur >= 0),
  constraint internet_paid_periods_rates_nonneg
    check (package_rate_eur >= 0 and day_rate_eur >= 0),
  constraint internet_paid_periods_idempotency_key unique (idempotency_key)
);

create index if not exists internet_paid_periods_property_dates_idx
  on public.internet_paid_periods (property_id, period_start, period_end);

create or replace function public.internet_paid_periods_reject_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (
    select 1
    from public.internet_paid_periods as p
    where p.property_id = new.property_id
      and p.id is distinct from new.id
      and daterange(p.period_start, p.period_end, '[]')
          && daterange(new.period_start, new.period_end, '[]')
  ) then
    raise exception 'internet: paid periods overlap'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists internet_paid_periods_overlap_trg on public.internet_paid_periods;
create trigger internet_paid_periods_overlap_trg
  before insert or update of property_id, period_start, period_end
  on public.internet_paid_periods
  for each row
  execute function public.internet_paid_periods_reject_overlap();

create or replace function public.internet_calendar_days(p_start date, p_end date)
returns integer
language sql
immutable
as $$
  select case
    when p_start is null or p_end is null or p_end < p_start then null
    else (p_end - p_start) + 1
  end;
$$;

revoke all on function public.internet_calendar_days(date, date) from public, anon;
grant execute on function public.internet_calendar_days(date, date) to authenticated;

create or replace function public.compute_internet_period_quote(
  p_period_start date,
  p_period_end date,
  p_billing_method text,
  p_on_date date default null
)
returns table (
  calendar_days integer,
  package_count integer,
  extra_days integer,
  package_rate_eur numeric,
  day_rate_eur numeric,
  amount_eur numeric,
  tariff_version_id uuid,
  billing_method text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_method text := lower(btrim(coalesce(p_billing_method, '')));
  v_on date := coalesce(p_on_date, public.tariff_sofia_today());
  v_days integer;
  v_packages integer;
  v_extra integer;
  v_version uuid;
  v_rates jsonb;
  v_package numeric;
  v_day numeric;
  v_amount numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  if v_method not in ('package_plus_days', 'daily') then
    raise exception 'internet: billing method must be package_plus_days or daily'
      using errcode = '22023';
  end if;
  v_days := public.internet_calendar_days(p_period_start, p_period_end);
  if v_days is null then
    raise exception 'internet: period end must be on or after period start'
      using errcode = '22023';
  end if;

  select r.tariff_version_id, r.rates
    into v_version, v_rates
  from public.resolve_internet_tariff(v_on) as r;

  v_package := nullif(v_rates ->> 'package_30', '')::numeric;
  v_day := nullif(v_rates ->> 'day', '')::numeric;
  if v_package is null or v_day is null then
    raise exception 'internet: package_30 and day rates are required'
      using errcode = 'P0002';
  end if;
  if v_package < 0 or v_day < 0 then
    raise exception 'internet: rates cannot be negative' using errcode = '22023';
  end if;
  v_package := round(v_package, 2);
  v_day := round(v_day, 4);

  if v_method = 'daily' then
    v_packages := 0;
    v_extra := v_days;
    v_amount := round(v_days * v_day, 2);
  else
    v_packages := (v_days / 30);
    v_extra := v_days % 30;
    v_amount := round(v_packages * v_package + v_extra * v_day, 2);
  end if;

  calendar_days := v_days;
  package_count := v_packages;
  extra_days := v_extra;
  package_rate_eur := v_package;
  day_rate_eur := v_day;
  amount_eur := v_amount;
  tariff_version_id := v_version;
  billing_method := v_method;
  return next;
end;
$fn$;

revoke all on function public.compute_internet_period_quote(date, date, text, date) from public, anon;
grant execute on function public.compute_internet_period_quote(date, date, text, date) to authenticated;

create or replace function public.confirm_internet_paid_period(
  p_property_id bigint,
  p_period_start date,
  p_period_end date,
  p_billing_method text,
  p_idempotency_key uuid
)
returns table (
  period_id uuid,
  subscription_id uuid,
  ledger_id uuid,
  calendar_days integer,
  package_count integer,
  extra_days integer,
  package_rate_eur numeric,
  day_rate_eur numeric,
  amount_eur numeric,
  billing_method text,
  charge_created boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_uid uuid := auth.uid();
  v_is_staff boolean;
  v_quote record;
  v_sub public.internet_subscriptions%rowtype;
  v_period public.internet_paid_periods%rowtype;
  v_ledger uuid;
  v_wo uuid;
  v_note text;
  v_inserted boolean := false;
begin
  if v_uid is null or v_email is null then
    raise exception 'Not authorized.';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  v_is_staff := public.has_staff_role('администрация') or public.has_staff_role('инженер');
  if not v_is_staff and not public.owns_property(p_property_id) then
    raise exception 'Not authorized.';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'internet');

  select * into v_period
  from public.internet_paid_periods as p
  where p.idempotency_key = p_idempotency_key;
  if found then
    if v_period.property_id is distinct from p_property_id
       or v_period.period_start is distinct from p_period_start
       or v_period.period_end is distinct from p_period_end
       or v_period.billing_method is distinct from lower(btrim(p_billing_method)) then
      raise exception 'Idempotency key conflict.';
    end if;
    return query
    select
      v_period.id, v_period.subscription_id, v_period.ledger_id,
      v_period.calendar_days, v_period.package_count, v_period.extra_days,
      v_period.package_rate_eur, v_period.day_rate_eur, v_period.amount_eur,
      v_period.billing_method, false;
    return;
  end if;

  select q.* into v_quote
  from public.compute_internet_period_quote(
    p_period_start, p_period_end, p_billing_method, p_period_start
  ) as q;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  select s.* into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if found then
    if v_sub.status = 'pending_disable' then
      raise exception 'request_internet_connect: already connected or pending'
        using errcode = 'P0001';
    end if;
  else
    insert into public.internet_subscriptions (
      property_id, status, period_start, period_end, pending_days,
      billing_day, billing_anchor_date, next_charge_on, billing_mode
    ) values (
      p_property_id, 'pending_enable', p_period_start, p_period_end, null,
      public.internet_billing_day_from_date(p_period_start),
      p_period_start,
      (p_period_end + 1),
      'prepaid_period'
    )
    returning * into v_sub;
  end if;

  v_note := format(
    'Интернет · %s · %s–%s · %s дн.',
    case when v_quote.billing_method = 'daily' then 'посуточно' else 'пакет+дни' end,
    p_period_start::text,
    p_period_end::text,
    v_quote.calendar_days::text
  );

  if v_quote.amount_eur > 0 then
    v_ledger := public.internet_insert_charge(
      p_property_id,
      v_quote.calendar_days,
      v_quote.amount_eur,
      v_quote.tariff_version_id,
      v_note,
      v_email,
      p_idempotency_key
    );
  else
    v_ledger := null;
  end if;

  begin
    insert into public.internet_paid_periods (
      property_id, subscription_id, period_start, period_end, billing_method,
      calendar_days, package_count, extra_days, package_rate_eur, day_rate_eur,
      amount_eur, tariff_version_id, ledger_id, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_sub.id, p_period_start, p_period_end, v_quote.billing_method,
      v_quote.calendar_days, v_quote.package_count, v_quote.extra_days,
      v_quote.package_rate_eur, v_quote.day_rate_eur, v_quote.amount_eur,
      v_quote.tariff_version_id, v_ledger, v_email, p_idempotency_key
    )
    returning * into v_period;
    v_inserted := true;
  exception
    when unique_violation then
      select p.* into v_period
      from public.internet_paid_periods as p
      where p.idempotency_key = p_idempotency_key
         or (
           p.property_id = p_property_id
           and p.period_start = p_period_start
           and p.period_end = p_period_end
         )
      limit 1;
      if v_period.id is null then
        raise;
      end if;
  end;

  update public.internet_subscriptions as s
     set billing_mode = 'prepaid_period',
         period_start = least(coalesce(s.period_start, p_period_start), p_period_start),
         period_end = greatest(coalesce(s.period_end, p_period_end), p_period_end),
         next_charge_on = greatest(coalesce(s.period_end, p_period_end), p_period_end) + 1,
         status = case
           when s.status = 'inactive' then 'pending_enable'
           when s.status is null then 'pending_enable'
           else s.status
         end,
         updated_at = now()
   where s.id = v_sub.id
  returning * into v_sub;

  if v_sub.status = 'pending_enable' and v_sub.enable_work_order_id is null then
    v_wo := public.internet_create_system_work_order(v_sub.id, p_property_id, 'enable', v_uid);
    update public.internet_subscriptions as s
       set enable_work_order_id = v_wo, updated_at = now()
     where s.id = v_sub.id
    returning * into v_sub;
  end if;

  return query
  select
    v_period.id, v_sub.id, v_period.ledger_id,
    v_period.calendar_days, v_period.package_count, v_period.extra_days,
    v_period.package_rate_eur, v_period.day_rate_eur, v_period.amount_eur,
    v_period.billing_method, v_inserted and v_period.amount_eur > 0;
end;
$fn$;

revoke all on function public.confirm_internet_paid_period(bigint, date, date, text, uuid) from public, anon;
grant execute on function public.confirm_internet_paid_period(bigint, date, date, text, uuid) to authenticated;

-- Monthly cron must not charge prepaid paid periods a second time.
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
  v_month numeric;
begin
  for r in
    select s.id, s.property_id, s.billing_day, s.next_charge_on, s.billing_anchor_date
    from public.internet_subscriptions as s
    where s.status = 'active'
      and coalesce(s.billing_mode, 'monthly') = 'monthly'
      and s.billing_day is not null
      and s.next_charge_on is not null
      and s.next_charge_on <= v_today
      and not exists (
        select 1
        from public.internet_paid_periods as p
        where p.property_id = s.property_id
          and p.period_start <= v_today
          and p.period_end >= v_today
      )
    for update skip locked
  loop
    begin
      select r.tariff_version_id, nullif(r.rates ->> 'month', '')::numeric
        into v_version_id, v_month
      from public.resolve_internet_tariff(v_today) as r;
      if v_month is null then
        continue;
      end if;
      v_amount := round(v_month, 2);
      if v_amount is null or v_amount <= 0 then
        continue;
      end if;
      v_key := public.internet_monthly_charge_key(r.property_id, r.next_charge_on);
      perform public.internet_insert_charge(
        r.property_id, null, v_amount, v_version_id,
        'Ежемесячная подписка · ' || to_char(r.next_charge_on, 'YYYY-MM'),
        'system@internet', v_key
      );
      update public.internet_subscriptions as s
         set next_charge_on = public.internet_add_one_month(r.next_charge_on),
             updated_at = now()
       where s.id = r.id;
      v_count := v_count + 1;
    exception
      when others then
        continue;
    end;
  end loop;
  return v_count;
end;
$fn$;

revoke all on function public.process_internet_monthly_charges() from public, anon, authenticated;

-- New compute_internet_amount: use package_30 + day when present; otherwise legacy month path.
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
  v_package numeric;
  v_day numeric;
  v_month numeric;
  v_safe integer;
  v_packages integer;
  v_rem integer;
begin
  if auth.uid() is null then
    raise exception 'compute_internet_amount: not authenticated' using errcode = '28000';
  end if;
  if p_days is null or p_days < 1 then
    raise exception 'compute_internet_amount: invalid days' using errcode = '22023';
  end if;
  v_on := coalesce(p_on_date, public.tariff_sofia_today());
  select r.tariff_version_id, r.rates into v_version_id, v_rates
  from public.resolve_internet_tariff(v_on) as r;
  v_safe := p_days;
  v_package := nullif(v_rates ->> 'package_30', '')::numeric;
  v_day := nullif(v_rates ->> 'day', '')::numeric;
  if v_package is not null and v_day is not null then
    v_packages := (v_safe / 30);
    v_rem := v_safe % 30;
    days := v_safe;
    month_cycles := v_packages;
    remainder_days := v_rem;
    day_rate_eur := round(v_day, 4);
    month_rate_eur := round(v_package, 2);
    amount_eur := round(v_packages * round(v_package, 2) + v_rem * round(v_day, 4), 2);
    tariff_version_id := v_version_id;
    return next;
    return;
  end if;
  -- Legacy month-only versions keep the historical formula for old UI callers.
  v_month := round((v_rates ->> 'month')::numeric, 2);
  v_day := round(v_month / 30.0, 4);
  v_packages := floor(v_safe / 30.0)::integer;
  v_rem := v_safe % 30;
  days := v_safe;
  month_cycles := v_packages;
  remainder_days := v_rem;
  day_rate_eur := v_day;
  month_rate_eur := v_month;
  amount_eur := round(v_packages * v_month + v_rem * v_day, 2);
  tariff_version_id := v_version_id;
  return next;
end;
$fn$;

-- First-run stage catalog
insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values ('internet_opening', 945, false, 'internet', 'admin.firstRunStageInternetOpening')
on conflict (stage_key) do update
set sort_order = excluded.sort_order,
    required = excluded.required,
    module_key = excluded.module_key,
    label_i18n_key = excluded.label_i18n_key;

create or replace function public.first_run_assert_internet_opening_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_none text;
begin
  select * into v_inst from public.platform_installations as i where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  if not public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    return;
  end if;
  v_none := lower(btrim(coalesce(v_inst.first_run_draft ->> 'internet_opening_none', '')));
  if v_none in ('true', 't', '1', 'yes') then
    return;
  end if;
  if exists (select 1 from public.internet_opening_imports) then
    return;
  end if;
  if exists (
    select 1 from public.internet_paid_periods as p where p.opening_import is true
  ) then
    return;
  end if;
  raise exception 'first_run: internet opening missing' using errcode = 'P0001';
end;
$fn$;

revoke all on function public.first_run_assert_internet_opening_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_internet_opening_ready(uuid) to authenticated;

create or replace function public.first_run_tariff_prep_ok(p_key text, p_item jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_rate numeric;
  v_legal numeric;
  v_day numeric;
  v_night numeric;
  v_basis text;
  v_note text;
  v_ref text;
  v_decision text;
  v_date date;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    return false;
  end if;
  begin
    v_basis := lower(btrim(coalesce(p_item ->> 'basis_type', '')));
    v_note := btrim(coalesce(p_item ->> 'basis_note', ''));
    v_ref := nullif(btrim(coalesce(p_item ->> 'basis_reference', '')), '');
    v_decision := nullif(btrim(coalesce(p_item ->> 'decision_id', '')), '');
    if nullif(btrim(coalesce(p_item ->> 'basis_date', '')), '') is null then
      v_date := null;
    else
      v_date := (p_item ->> 'basis_date')::date;
    end if;
    if v_key in ('support_fee', 'capital_repair') then
      v_rate := (p_item ->> 'rate_natural')::numeric;
      v_legal := coalesce((p_item ->> 'rate_legal')::numeric, v_rate);
      return v_rate > 0
        and v_legal > 0
        and v_note <> ''
        and v_date is not null
        and (
          (v_basis = 'external_decision' and v_ref is not null)
          or (v_basis = 'general_meeting' and v_decision is not null)
        );
    elsif v_key = 'water' then
      v_rate := (p_item ->> 'rate')::numeric;
      return v_rate >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other')
        and v_ref is not null
        and v_note <> '';
    elsif v_key = 'electricity' then
      v_day := (p_item ->> 'day')::numeric;
      v_night := (p_item ->> 'night')::numeric;
      return v_day >= 0
        and v_night >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other')
        and v_ref is not null
        and v_note <> '';
    elsif v_key = 'internet' then
      v_rate := (p_item ->> 'package_30')::numeric;
      v_day := (p_item ->> 'day')::numeric;
      return v_rate >= 0
        and v_day >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other')
        and v_ref is not null
        and v_note <> '';
    end if;
  exception
    when others then
      return false;
  end;
  return false;
end;
$fn$;

revoke all on function public.first_run_tariff_prep_ok(text, jsonb) from public, anon;
grant execute on function public.first_run_tariff_prep_ok(text, jsonb) to authenticated;
create or replace function public.first_run_assert_tariffs_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_internet boolean := false;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)
  into v_selected;

  v_need_water := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) = 'water'
  );
  v_need_elec := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  );
  v_need_internet := public.first_run_draft_has_module(v_inst.first_run_draft, 'internet');

  if not public.first_run_tariff_step_satisfied(p_installation_id, 'support_fee') then
    raise exception 'first_run: tariff prep missing support_fee' using errcode = 'P0001';
  end if;
  if not public.first_run_tariff_step_satisfied(p_installation_id, 'capital_repair') then
    raise exception 'first_run: tariff prep missing capital_repair' using errcode = 'P0001';
  end if;
  if v_need_water and not public.first_run_tariff_step_satisfied(p_installation_id, 'water') then
    raise exception 'first_run: tariff prep missing water' using errcode = 'P0001';
  end if;
  if v_need_elec and not public.first_run_tariff_step_satisfied(p_installation_id, 'electricity') then
    raise exception 'first_run: tariff prep missing electricity' using errcode = 'P0001';
  end if;
  if v_need_internet and not public.first_run_tariff_step_satisfied(p_installation_id, 'internet') then
    raise exception 'first_run: tariff prep missing internet' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_tariffs_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_tariffs_ready(uuid) to authenticated;
create or replace function public.first_run_publish_activation_tariffs(
  p_installation_id uuid,
  p_activated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_at timestamptz := coalesce(p_activated_at, now());
  v_date date := (coalesce(p_activated_at, now()) at time zone 'Europe/Sofia')::date;
  v_year integer := extract(year from (coalesce(p_activated_at, now()) at time zone 'Europe/Sofia'))::integer;
  v_selected jsonb;
  v_keys text[];
  v_key text;
  v_item jsonb;
  v_cat public.tariff_catalog%rowtype;
  v_cover uuid;
  v_cover_from date;
  v_natural jsonb;
  v_legal jsonb;
  v_rate numeric;
  v_legal_rate numeric;
  v_day numeric;
  v_night numeric;
  v_basis text;
  v_note text;
  v_ref text;
  v_decision uuid;
  v_basis_date date;
  v_fingerprint text;
  v_existing public.tariff_versions%rowtype;
  v_idem uuid;
  v_version_id uuid;
  v_match boolean;
  v_component text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id
  for update;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  if v_inst.first_run_status = 'complete' then
    return;
  end if;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb) into v_selected;
  v_keys := array['support_fee', 'capital_repair'];
  if exists (
    select 1 from jsonb_array_elements_text(v_selected) as t(v) where lower(btrim(t.v)) = 'water'
  ) then
    v_keys := v_keys || array['water'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_selected) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  ) then
    v_keys := v_keys || array['electricity'];
  end if;
  if public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    v_keys := v_keys || array['internet'];
  end if;

  foreach v_key in array v_keys loop
    v_item := coalesce(v_inst.first_run_draft, '{}'::jsonb) -> 'tariff_prep' -> v_key;
    select c.* into v_cat
    from public.tariff_catalog as c
    where c.tariff_key = v_key
      and c.active is true;
    if not found then
      raise exception 'first_run: tariff catalog missing %', v_key using errcode = 'P0001';
    end if;

    v_cover := null;
    if v_key in ('support_fee', 'capital_repair') then
      v_cover := public.tariff_version_for_billing_year(v_cat.id, v_year);
    else
      select tv.id
        into v_cover
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.status = 'published'
        and tv.cancelled_at is null
        and tv.valid_from <= v_date
      order by tv.valid_from desc, tv.id desc
      limit 1;
    end if;

    if v_cover is not null then
      select tv.valid_from into v_cover_from
      from public.tariff_versions as tv
      where tv.id = v_cover;
      if v_cover_from > v_date then
        v_cover := null;
      end if;
    end if;

    if v_cover is not null and not public.first_run_tariff_prep_ok(v_key, v_item) then
      continue;
    end if;

    if not public.first_run_tariff_prep_ok(v_key, v_item) then
      raise exception 'first_run: tariff prep missing %', v_key using errcode = 'P0001';
    end if;

    v_basis := lower(btrim(v_item ->> 'basis_type'));
    v_note := btrim(v_item ->> 'basis_note');
    v_ref := nullif(btrim(coalesce(v_item ->> 'basis_reference', '')), '');
    if nullif(btrim(coalesce(v_item ->> 'decision_id', '')), '') is null then
      v_decision := null;
    else
      v_decision := (v_item ->> 'decision_id')::uuid;
    end if;
    if nullif(btrim(coalesce(v_item ->> 'basis_date', '')), '') is null then
      v_basis_date := null;
    else
      v_basis_date := (v_item ->> 'basis_date')::date;
    end if;

    if v_key in ('support_fee', 'capital_repair') then
      v_rate := (v_item ->> 'rate_natural')::numeric;
      v_legal_rate := coalesce((v_item ->> 'rate_legal')::numeric, v_rate);
      v_natural := jsonb_build_object('base', v_rate);
      v_legal := jsonb_build_object('base', v_legal_rate);
    elsif v_key = 'water' then
      v_rate := (v_item ->> 'rate')::numeric;
      v_natural := jsonb_build_object('base', v_rate);
      v_legal := v_natural;
    elsif v_key = 'internet' then
      v_rate := (v_item ->> 'package_30')::numeric;
      v_day := (v_item ->> 'day')::numeric;
      v_natural := jsonb_build_object('package_30', v_rate, 'day', v_day);
      v_legal := v_natural;
    else
      v_day := (v_item ->> 'day')::numeric;
      v_night := (v_item ->> 'night')::numeric;
      v_natural := jsonb_build_object('day', v_day, 'night', v_night);
      v_legal := v_natural;
    end if;

    if v_cover is not null then
      v_match := true;
      foreach v_component in array v_cat.component_keys loop
        if (
          select ri.rate
          from public.tariff_rate_items as ri
          where ri.version_id = v_cover
            and ri.component_key = v_component
            and ri.subject_kind = 'natural'
        ) is distinct from (v_natural ->> v_component)::numeric
        or (
          select ri.rate
          from public.tariff_rate_items as ri
          where ri.version_id = v_cover
            and ri.component_key = v_component
            and ri.subject_kind = 'legal'
        ) is distinct from (v_legal ->> v_component)::numeric then
          v_match := false;
        end if;
      end loop;
      if not v_match then
        raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
      end if;
      continue;
    end if;

    v_idem := public.first_run_activation_tariff_key(p_installation_id, v_key);
    v_fingerprint := md5(
      v_cat.id::text || '|' || v_date::text || '|' || v_basis || '|' ||
      coalesce(v_ref, '') || '|' || coalesce(v_basis_date::text, '') || '|' ||
      v_note || '|' || coalesce(v_decision::text, '') || '|' ||
      v_natural::text || '|' || v_legal::text
    );

    select tv.* into v_existing
    from public.tariff_versions as tv
    where tv.idempotency_key = v_idem;

    if found then
      if v_existing.payload_fingerprint is distinct from v_fingerprint then
        raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
      end if;
      continue;
    end if;

    if exists (
      select 1
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.valid_from = v_date
        and tv.status = 'published'
        and tv.cancelled_at is null
    ) then
      raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
    end if;

    insert into public.tariff_versions (
      tariff_id, valid_from, status, basis_type, basis_reference, basis_date, basis_note,
      decision_id, published_at, published_by, idempotency_key, payload_fingerprint
    ) values (
      v_cat.id, v_date, 'published', v_basis, v_ref, v_basis_date, v_note,
      v_decision, v_at, auth.uid(), v_idem, v_fingerprint
    )
    returning id into v_version_id;

    insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
    select v_version_id, k, (v_natural ->> k)::numeric, 'natural'
    from unnest(v_cat.component_keys) as k;

    insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
    select v_version_id, k, (v_legal ->> k)::numeric, 'legal'
    from unnest(v_cat.component_keys) as k;
  end loop;
end;
$fn$;

revoke all on function public.first_run_publish_activation_tariffs(uuid, timestamptz) from public, anon, authenticated;
create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_budget boolean := false;
  v_book_state text;
  v_water_state text;
  v_elec_state text;
  v_sf_state text;
  v_cr_state text;
  v_stage_status text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(v_inst.display_name, v_inst.complex_name, '')), '') is null then
    raise exception 'first_run: complex card incomplete (name)' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.address, '')), '') is null then
    raise exception 'first_run: complex card incomplete (address)' using errcode = 'P0001';
  end if;
  if v_inst.apartment_count is null or v_inst.apartment_count <= 0 then
    raise exception 'first_run: complex card incomplete (apartment_count)' using errcode = 'P0001';
  end if;

  foreach v_stage_status in array array[
    'welcome', 'modules_select', 'complex_card', 'property_book',
    'support_fee_opening', 'capital_repair_opening', 'tariffs', 'budget', 'uk_expenses_opening'
  ]
  loop
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = v_stage_status
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage % not complete', v_stage_status using errcode = 'P0001';
    end if;
  end loop;

  v_need_water := public.first_run_draft_has_module(v_inst.first_run_draft, 'water');
  v_need_elec := public.first_run_draft_has_module(v_inst.first_run_draft, 'electricity');
  v_need_budget := public.first_run_draft_has_module(v_inst.first_run_draft, 'budget');

  select ml.state into v_book_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'property_book';
  if v_book_state is distinct from 'ACTIVE' then
    raise exception 'first_run: property_book must be ACTIVE (got %)', coalesce(v_book_state, 'missing')
      using errcode = 'P0001';
  end if;

  if v_need_water then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_water' and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_water stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_water_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'water';
    if v_water_state is distinct from 'ACTIVE' then
      raise exception 'first_run: water must be ACTIVE (got %)', coalesce(v_water_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  if v_need_elec then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_electricity stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_elec_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'electricity';
    if v_elec_state is distinct from 'ACTIVE' then
      raise exception 'first_run: electricity must be ACTIVE (got %)', coalesce(v_elec_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  select ml.state into v_sf_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'support_fee';
  if v_sf_state is distinct from 'ACTIVE' then
    raise exception 'first_run: support_fee must be ACTIVE (got %)', coalesce(v_sf_state, 'missing')
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.support_fee_opening_imports) then
    raise exception 'first_run: support_fee opening inventarisation missing' using errcode = 'P0001';
  end if;

  perform public.first_run_assert_capital_repair_opening_ready(p_installation_id);

  select ml.state into v_cr_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'capital_repair';
  if v_cr_state is distinct from 'ACTIVE' then
    raise exception 'first_run: capital_repair must be ACTIVE (got %)', coalesce(v_cr_state, 'missing')
      using errcode = 'P0001';
  end if;

  perform public.first_run_assert_tariffs_ready(p_installation_id);

  if public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'internet_opening'
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage internet_opening not complete' using errcode = 'P0001';
    end if;
    perform public.first_run_assert_internet_opening_ready(p_installation_id);
  end if;

  if v_need_budget then
    perform public.first_run_assert_budget_ready(p_installation_id);
  end if;
  perform public.first_run_assert_uk_expenses_opening_ready(p_installation_id);
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;
create or replace function public.admin_complete_first_run_stage(p_stage text, p_next_stage text DEFAULT NULL::text, p_draft jsonb DEFAULT '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_budget boolean := false;
  v_draft jsonb;
  v_key text;
  v_stage_done text;
  v_activated_at timestamptz;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.platform_installations as i
    where i.id = v_id and i.first_run_status = 'complete'
  ) then
    return public.admin_get_first_run_state();
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');
  v_draft := coalesce(p_draft, '{}'::jsonb);

  if v_stage = 'modules_select' then
    if not (v_draft ? 'modules_selected') or jsonb_typeof(v_draft -> 'modules_selected') is distinct from 'array' then
      raise exception 'first_run: modules_selected required' using errcode = '22023';
    end if;

    foreach v_key in array array['property_book', 'support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode']
    loop
      if not exists (
        select 1
        from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
        where lower(btrim(t.v)) = v_key
      ) then
        raise exception 'first_run: required module % missing', v_key using errcode = '22023';
      end if;
    end loop;

    for v_key in
      select lower(btrim(t.v))
      from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
    loop
      if v_key in ('property_book', 'support_fee', 'capital_repair', 'water', 'electricity', 'budget', 'uk_expenses', 'guest_mode', 'tariffs') then
        continue;
      end if;
      if v_key in ('platform_support', 'user_activation', 'residence_status') then
        raise exception 'first_run: module % is not optional', v_key using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.module_catalog as c
        where c.module_key = v_key and c.implemented is true
      ) then
        raise exception 'first_run: module % is not available', v_key using errcode = '22023';
      end if;
    end loop;

    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_water' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'water') then
      raise exception 'first_run: water setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'electricity') then
      raise exception 'first_run: electricity setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'budget' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'budget') then
      raise exception 'first_run: budget setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;

    v_need_water := public.first_run_draft_has_module(v_draft, 'water');
    v_need_elec := public.first_run_draft_has_module(v_draft, 'electricity');
    v_selected := '[]'::jsonb;
    if v_need_water then
      v_selected := v_selected || jsonb_build_array('water');
    end if;
    if v_need_elec then
      v_selected := v_selected || jsonb_build_array('electricity');
    end if;
    v_draft := v_draft || jsonb_build_object('meters_selected', v_selected);

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;

    -- Connect selected catalog modules. This does not create charges or openings.
    for v_key in
      select distinct lower(btrim(t.v))
      from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
      union
      select unnest(array['support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'tariffs'])
    loop
      if exists (
        select 1 from public.module_catalog as c
        where c.module_key = v_key and c.implemented is true
      ) then
        perform public.set_building_module_enabled(v_key, true);
      end if;
    end loop;

    for v_key in
      select c.module_key
      from public.module_catalog as c
      where c.implemented is true
        and c.module_key not in ('support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'tariffs', 'platform_support', 'user_activation', 'residence_status')
        and not exists (
          select 1
          from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
          where lower(btrim(t.v)) = c.module_key
        )
    loop
      v_stage_done := case v_key
        when 'water' then 'meters_water'
        when 'electricity' then 'meters_electricity'
        when 'budget' then 'budget'
        else null
      end;
      if v_stage_done is not null and exists (
        select 1 from public.first_run_stage_progress p
        where p.installation_id = v_id and p.stage_key = v_stage_done and p.status = 'complete'
      ) then
        continue;
      end if;
      perform public.set_building_module_enabled(v_key, false);
    end loop;

    perform public.first_run_skip_stage(v_id, 'meters_select');
    if not v_need_water then
      perform public.first_run_skip_stage(v_id, 'meters_water');
    end if;
    if not v_need_elec then
      perform public.first_run_skip_stage(v_id, 'meters_electricity');
    end if;
    if not public.first_run_draft_has_module(v_draft, 'budget') then
      perform public.first_run_skip_stage(v_id, 'budget');
    end if;
    if not public.first_run_draft_has_module(v_draft, 'internet') then
      perform public.first_run_skip_stage(v_id, 'internet_opening');
    end if;

    if v_next is null then
      v_next := 'complex_card';
    end if;
  end if;

  if v_stage = 'support_fee_opening' then
    perform public.first_run_assert_support_fee_opening_ready(v_id);
    if v_next is null then
      v_next := 'capital_repair_opening';
    end if;
  end if;

  if v_stage = 'capital_repair_opening' then
    perform public.first_run_assert_capital_repair_opening_ready(v_id);
    if v_next is null then
      v_next := 'tariffs';
    end if;
  end if;

  if v_stage = 'tariffs' then
    perform public.first_run_assert_tariffs_ready(v_id);
    if v_next is null then
      if public.first_run_draft_has_module(
           (select i.first_run_draft from public.platform_installations as i where i.id = v_id),
           'internet'
         ) then
        v_next := 'internet_opening';
      else
        perform public.first_run_skip_stage(v_id, 'internet_opening');
        select public.first_run_draft_has_module(i.first_run_draft, 'budget')
        into v_need_budget
        from public.platform_installations as i
        where i.id = v_id;
        v_next := case when v_need_budget then 'budget' else 'uk_expenses_opening' end;
      end if;
    end if;
  end if;

  if v_stage = 'internet_opening' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_internet_opening_ready(v_id);
    if v_next is null then
      select public.first_run_draft_has_module(i.first_run_draft, 'budget')
      into v_need_budget
      from public.platform_installations as i
      where i.id = v_id;
      v_next := case when v_need_budget then 'budget' else 'uk_expenses_opening' end;
    end if;
  end if;

  if v_stage = 'budget' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_budget_ready(v_id);
    if v_next is null then
      v_next := 'uk_expenses_opening';
    end if;
  end if;

  if v_stage = 'uk_expenses_opening' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_uk_expenses_opening_ready(v_id);
    if v_next is null then
      v_next := 'complete';
    end if;
  end if;

  if v_stage = 'complete' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', v_draft, now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', v_draft -> 'meters_selected', '[]'::jsonb)
    into v_selected
    from public.platform_installations as i
    where i.id = v_id;

    v_need_water := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    );
    v_need_elec := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    );

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || jsonb_build_object('meters_selected', coalesce(v_selected, '[]'::jsonb))
      || v_draft
    where i.id = v_id;

    if not v_need_water then
      perform public.first_run_skip_stage(v_id, 'meters_water');
    end if;
    if not v_need_elec then
      perform public.first_run_skip_stage(v_id, 'meters_electricity');
    end if;

    if v_next is null then
      v_next := case
        when v_need_water then 'meters_water'
        when v_need_elec then 'meters_electricity'
        else 'support_fee_opening'
      end;
    end if;
  end if;

  if v_stage = 'meters_water' and v_next is null then
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status in ('skipped', 'complete')
    ) or not exists (
      select 1 from public.platform_installations as i
      where i.id = v_id and public.first_run_draft_has_module(i.first_run_draft, 'electricity')
    ) then
      v_next := 'support_fee_opening';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'support_fee_opening';
  end if;

  if v_next = 'complete' and v_stage is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    v_activated_at := now();
    perform public.first_run_publish_activation_tariffs(v_id, v_activated_at);
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, v_activated_at),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', v_activated_at, v_activated_at, auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, v_activated_at), updated_at = v_activated_at;
  elsif v_next is not null then
    update public.platform_installations as i
    set
      first_run_status = case when i.first_run_status = 'complete' then 'complete' else 'in_progress' end,
      first_run_stage = case when i.first_run_status = 'complete' then i.first_run_stage else v_next end,
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id
      and i.first_run_status is distinct from 'complete';

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, updated_at, updated_by
    ) values (v_id, v_next, 'in_progress', now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set
      status = case when p.status in ('complete', 'skipped') then p.status else 'in_progress' end,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  return public.admin_get_first_run_state();
end;
$fn$;

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;

commit;
