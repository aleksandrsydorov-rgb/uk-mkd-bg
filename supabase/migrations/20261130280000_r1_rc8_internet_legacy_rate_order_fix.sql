-- Fix resolve_internet_legacy_monthly_rate: tariff_versions has no created_at.
begin;

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
    and coalesce(tv.status, 'published') = 'published'
    and nullif(public.tariff_rates_json(tv.id, 'natural') ->> 'month', '') is not null
  order by tv.valid_from desc, tv.published_at desc nulls last, tv.id desc
  limit 1;
end;
$fn$;

revoke all on function public.resolve_internet_legacy_monthly_rate(date) from public, anon;
grant execute on function public.resolve_internet_legacy_monthly_rate(date) to authenticated;
grant execute on function public.resolve_internet_legacy_monthly_rate(date) to service_role;

commit;
