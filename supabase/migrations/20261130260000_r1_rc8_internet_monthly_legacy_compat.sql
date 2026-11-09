-- =============================================================================
-- R1-RC8 — Internet monthly ↔ package_30/day compatibility
-- =============================================================================
-- Publishing package_30/day must not silently stop legacy monthly subscriptions.
-- Monthly cron resolves the latest applicable version that still has a month rate
-- (does not auto-convert monthly → 30-day package).
-- =============================================================================

begin;

-- Latest internet tariff version (valid_from <= p_on) that still exposes rates.month.
create or replace function public.resolve_internet_legacy_monthly_rate(p_on_date date)
returns table (
  tariff_version_id uuid,
  valid_from date,
  month_rate_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tariff_id uuid;
  v_on date := coalesce(p_on_date, public.tariff_sofia_today());
begin
  select c.id into v_tariff_id
  from public.tariff_catalog as c
  where c.tariff_key = 'internet' and c.active is true
  limit 1;
  if v_tariff_id is null then
    return;
  end if;

  return query
  select
    tv.id,
    tv.valid_from,
    round(nullif(public.tariff_rates_json(tv.id, 'natural') ->> 'month', '')::numeric, 2)
  from public.tariff_versions as tv
  where tv.tariff_id = v_tariff_id
    and tv.valid_from <= v_on
    and nullif(public.tariff_rates_json(tv.id, 'natural') ->> 'month', '') is not null
  order by tv.valid_from desc, tv.created_at desc
  limit 1;
end;
$fn$;

revoke all on function public.resolve_internet_legacy_monthly_rate(date) from public, anon;
grant execute on function public.resolve_internet_legacy_monthly_rate(date) to authenticated;
grant execute on function public.resolve_internet_legacy_monthly_rate(date) to service_role;

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
  v_skip_reason text;
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
      -- Prefer legacy monthly rate even if the newest published version is package_30/day.
      select lm.tariff_version_id, lm.month_rate_eur
        into v_version_id, v_month
      from public.resolve_internet_legacy_monthly_rate(r.next_charge_on) as lm;

      if v_month is null or v_month <= 0 then
        -- Ambiguous: monthly subscription active but no legacy month rate remains.
        -- Do not advance next_charge_on; do not invent package_30 conversion.
        raise exception 'internet monthly: no legacy month rate for subscription % (publish month rate or migrate subscription explicitly)', r.id
          using errcode = 'P0001';
      end if;

      v_amount := round(v_month, 2);
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
      when unique_violation then
        -- Idempotent: charge key already present for this month — advance schedule only.
        update public.internet_subscriptions as s
           set next_charge_on = public.internet_add_one_month(r.next_charge_on),
               updated_at = now()
         where s.id = r.id;
      when others then
        -- Keep next_charge_on so ops can see stuck monthly rows; no silent drop.
        v_skip_reason := SQLERRM;
        raise notice 'process_internet_monthly_charges skip %: %', r.property_id, v_skip_reason;
        continue;
    end;
  end loop;
  return v_count;
end;
$fn$;

revoke all on function public.process_internet_monthly_charges() from public, anon, authenticated;
grant execute on function public.process_internet_monthly_charges() to service_role;

-- Block ambiguous publish that would leave monthly subs without a month rate
-- unless a prior version still carries month (compat OK) OR no monthly subs exist.
create or replace function public.internet_assert_publish_compatible_with_monthly(p_rates jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_has_month boolean := nullif(btrim(coalesce(p_rates ->> 'month', '')), '') is not null;
  v_has_package boolean := nullif(btrim(coalesce(p_rates ->> 'package_30', '')), '') is not null;
  v_monthly_n integer := 0;
  v_legacy_ok boolean := false;
begin
  if v_has_month then
    return;
  end if;
  if not v_has_package then
    return;
  end if;

  select count(*)::integer into v_monthly_n
  from public.internet_subscriptions as s
  where s.status = 'active'
    and coalesce(s.billing_mode, 'monthly') = 'monthly';

  if v_monthly_n = 0 then
    return;
  end if;

  select exists (
    select 1 from public.resolve_internet_legacy_monthly_rate(public.tariff_sofia_today())
  ) into v_legacy_ok;

  if v_legacy_ok then
    -- Existing month-bearing versions keep monthly cron working.
    return;
  end if;

  raise exception 'internet: cannot publish package_30/day only while % active monthly subscription(s) have no legacy month rate — keep a month rate or migrate subscriptions explicitly (do not auto-convert monthly to 30-day package)', v_monthly_n
    using errcode = 'P0001';
end;
$fn$;

revoke all on function public.internet_assert_publish_compatible_with_monthly(jsonb) from public, anon;
grant execute on function public.internet_assert_publish_compatible_with_monthly(jsonb) to authenticated;
grant execute on function public.internet_assert_publish_compatible_with_monthly(jsonb) to service_role;

-- Hook into first_run / admin publish path if it builds rates from package_30.
-- Validate inside first_run_publish_activation_tariffs internet branch via wrapper used by UI.

create or replace function public.admin_assert_internet_rates_publishable(p_rates jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_assert_internet_rates_publishable: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role(
    convert_from(decode('d0b0d0b4d0bcd0b8d0bdd0b8d181d182d180d0b0d186d0b8d18f', 'hex'), 'utf8')
  ) then
    raise exception 'admin_assert_internet_rates_publishable: not allowed' using errcode = '42501';
  end if;
  perform public.internet_assert_publish_compatible_with_monthly(p_rates);
end;
$fn$;

revoke all on function public.admin_assert_internet_rates_publishable(jsonb) from public, anon;
grant execute on function public.admin_assert_internet_rates_publishable(jsonb) to authenticated;

commit;
