-- =============================================================================
-- AMADEUS 11 — Tariff Core Package 2 POST-APPLY verify (READ-ONLY)
-- =============================================================================
-- Run AFTER applying:
--   20260926050000_tariff_core_package2_cutover.sql
--
-- Safe: SELECT / catalog introspection only. No DDL/DML.
-- =============================================================================

with today as (
  select (now() at time zone 'Europe/Sofia')::date as d
),
resolved as (
  select
    'water'::text as utility,
    r.tariff_version_id,
    r.valid_from,
    r.rates
  from public.resolve_utility_tariff('water', (select d from today)) as r
  union all
  select
    'electricity',
    r.tariff_version_id,
    r.valid_from,
    r.rates
  from public.resolve_utility_tariff('electricity', (select d from today)) as r
),
checks as (
  select 'rpc'::text as check_type, name as item,
    case when to_regprocedure(sig) is not null then 'OK' else 'FAIL' end as result,
    '{}'::jsonb as detail
  from (values
    ('resolve_utility_tariff', 'public.resolve_utility_tariff(text, date)'),
    ('get_applicable_utility_tariff', 'public.get_applicable_utility_tariff(text, date)'),
    ('submit_water_reading', 'public.submit_water_reading(bigint, numeric, date, uuid)'),
    ('submit_electricity_reading', 'public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'),
    ('set_water_tariff', 'public.set_water_tariff(numeric, date, text)'),
    ('set_electricity_tariff', 'public.set_electricity_tariff(numeric, numeric, date, text)'),
    ('cancel_future_tariff_version', 'public.cancel_future_tariff_version(uuid, text, uuid)'),
    ('publish_tariff_version', 'public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid)')
  ) as t(name, sig)

  union all
  select 'column', 'water_readings.tariff_version_id',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'water_readings'
        and column_name = 'tariff_version_id'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb
  union all
  select 'column', 'electricity_charges.tariff_version_id',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'electricity_charges'
        and column_name = 'tariff_version_id'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb

  union all
  select 'legacy_publisher', 'set_water_tariff_blocked',
    case
      when pg_get_functiondef('public.set_water_tariff(numeric, date, text)'::regprocedure)
           ilike '%Legacy tariff publication disabled%'
      then 'OK' else 'FAIL'
    end,
    '{}'::jsonb
  union all
  select 'legacy_publisher', 'set_electricity_tariff_blocked',
    case
      when pg_get_functiondef('public.set_electricity_tariff(numeric, numeric, date, text)'::regprocedure)
           ilike '%Legacy tariff publication disabled%'
      then 'OK' else 'FAIL'
    end,
    '{}'::jsonb

  union all
  select 'cancel_gate', 'utility_cancellation_gate_removed',
    case
      when to_regprocedure('public.cancel_future_tariff_version(uuid, text, uuid)') is null
        then 'FAIL'
      when pg_get_functiondef('public.cancel_future_tariff_version(uuid, text, uuid)'::regprocedure)
           ilike '%utility cancellation deferred%'
        then 'FAIL'
      else 'OK'
    end,
    '{}'::jsonb

  union all
  select 'priv', rel || '_no_authenticated_write',
    case when has_table_privilege('authenticated', 'public.' || rel, 'insert')
           or has_table_privilege('authenticated', 'public.' || rel, 'update')
           or has_table_privilege('authenticated', 'public.' || rel, 'delete')
         then 'FAIL' else 'OK' end,
    '{}'::jsonb
  from (values
    ('water_tariffs'),
    ('electricity_tariffs'),
    ('water_readings'),
    ('meter_readings'),
    ('electricity_charges'),
    ('water_ledger'),
    ('electricity_ledger'),
    ('tariff_catalog'),
    ('tariff_versions'),
    ('tariff_rate_items')
  ) as t(rel)

  union all
  select 'resolver', 'water_current',
    case
      when r.tariff_version_id is null then 'FAIL'
      when (r.rates ->> 'base') is null then 'FAIL'
      when not exists (
        select 1 from public.tariff_versions as tv
        where tv.id = r.tariff_version_id
          and tv.status = 'published'
          and tv.valid_from <= (select d from today)
      ) then 'FAIL'
      else 'OK'
    end,
    jsonb_build_object(
      'tariff_version_id', r.tariff_version_id,
      'valid_from', r.valid_from,
      'rates', r.rates
    )
  from resolved as r
  where r.utility = 'water'

  union all
  select 'resolver', 'electricity_current',
    case
      when r.tariff_version_id is null then 'FAIL'
      when (r.rates ->> 'day') is null or (r.rates ->> 'night') is null then 'FAIL'
      when not exists (
        select 1 from public.tariff_versions as tv
        where tv.id = r.tariff_version_id
          and tv.status = 'published'
          and tv.valid_from <= (select d from today)
      ) then 'FAIL'
      else 'OK'
    end,
    jsonb_build_object(
      'tariff_version_id', r.tariff_version_id,
      'valid_from', r.valid_from,
      'rates', r.rates
    )
  from resolved as r
  where r.utility = 'electricity'
)
select check_type, item, result, detail
from checks
order by
  case when result = 'FAIL' then 0 else 1 end,
  check_type,
  item;
