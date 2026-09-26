-- =============================================================================
-- AMADEUS 11 — Tariff Core Package 2 PRE-APPLY preflight (READ-ONLY)
-- =============================================================================
-- Run BEFORE applying:
--   20260926050000_tariff_core_package2_cutover.sql
--
-- Checks Package 1 production prerequisites only.
-- Does NOT require Package 2 objects (resolver, tariff_version_id columns, etc.).
-- Safe: SELECT / catalog introspection only. No DDL/DML.
-- =============================================================================

with legacy_link as (
  select
    'water'::text as utility,
    (select count(*)::int from public.water_tariffs) as legacy_source_rows,
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'water'
    ) as core_versions,
    (
      select count(*)::int
      from public.tariff_legacy_links as l
      where l.legacy_source = 'water_tariffs'
    ) as legacy_links,
    (
      select count(*)::int
      from public.tariff_legacy_links as l
      join public.tariff_versions as tv on tv.id = l.version_id
      where l.legacy_source = 'water_tariffs'
        and l.version_id is not null
    ) as linked_versions,
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'water'
        and not exists (
          select 1 from public.tariff_legacy_links as l
          where l.version_id = tv.id and l.legacy_source = 'water_tariffs'
        )
    ) as unlinked_core_versions,
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'water' and tv.status = 'published'
    ) as published_versions,
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'water' and tv.status = 'cancelled'
    ) as cancelled_versions
  union all
  select
    'electricity',
    (select count(*)::int from public.electricity_tariffs),
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'electricity'
    ),
    (
      select count(*)::int
      from public.tariff_legacy_links as l
      where l.legacy_source = 'electricity_tariffs'
    ),
    (
      select count(*)::int
      from public.tariff_legacy_links as l
      join public.tariff_versions as tv on tv.id = l.version_id
      where l.legacy_source = 'electricity_tariffs'
        and l.version_id is not null
    ) as linked_versions,
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'electricity'
        and not exists (
          select 1 from public.tariff_legacy_links as l
          where l.version_id = tv.id and l.legacy_source = 'electricity_tariffs'
        )
    ),
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'electricity' and tv.status = 'published'
    ),
    (
      select count(*)::int
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = 'electricity' and tv.status = 'cancelled'
    )
),
checks as (
  select 'mirror'::text as check_type, utility || '_legacy_eq_core' as item,
    case when legacy_source_rows = core_versions
              and legacy_source_rows = legacy_links
              and legacy_source_rows = linked_versions
              and unlinked_core_versions = 0
         then 'OK' else 'FAIL' end as result,
    jsonb_build_object(
      'legacy_source_rows', legacy_source_rows,
      'core_versions', core_versions,
      'legacy_links', legacy_links,
      'linked_versions', linked_versions,
      'unlinked_core_versions', unlinked_core_versions,
      'published_versions', published_versions,
      'cancelled_versions', cancelled_versions
    ) as detail
  from legacy_link

  union all
  select 'dup_valid_from', utility || '_published',
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = ll.utility
        and tv.status = 'published'
      group by tv.valid_from
      having count(*) > 1
    ) then 'FAIL' else 'OK' end,
    '{}'::jsonb
  from legacy_link as ll

  union all
  select 'relation', rel, case when to_regclass('public.' || rel) is not null then 'OK' else 'FAIL' end, '{}'::jsonb
  from (values
    ('tariff_catalog'),
    ('tariff_versions'),
    ('tariff_rate_items'),
    ('tariff_legacy_links'),
    ('water_tariffs'),
    ('electricity_tariffs'),
    ('water_readings'),
    ('electricity_charges'),
    ('water_meters'),
    ('electricity_meters'),
    ('meter_readings')
  ) as t(rel)

  union all
  select 'rpc', name, case when to_regprocedure(sig) is not null then 'OK' else 'FAIL' end, '{}'::jsonb
  from (values
    ('resolve_tariff_version_by_date', 'public.resolve_tariff_version_by_date(uuid, date)'),
    ('publish_tariff_version', 'public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid)'),
    ('cancel_future_tariff_version', 'public.cancel_future_tariff_version(uuid, text, uuid)'),
    ('list_tariffs', 'public.list_tariffs(text, boolean, integer)'),
    ('submit_water_reading', 'public.submit_water_reading(bigint, numeric, date, uuid)'),
    ('submit_electricity_reading', 'public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'),
    ('set_water_tariff', 'public.set_water_tariff(numeric, date, text)'),
    ('set_electricity_tariff', 'public.set_electricity_tariff(numeric, numeric, date, text)')
  ) as t(name, sig)

  union all
  select 'meter_active', 'water_one_active_per_property',
    case when exists (
      select 1 from public.water_meters
      where retired_at is null
      group by property_id having count(*) > 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  union all
  select 'meter_active', 'electricity_one_active_per_property',
    case when exists (
      select 1 from public.electricity_meters
      where retired_at is null
      group by property_id having count(*) > 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb

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
)
select check_type, item, result, detail
from checks
order by
  case when result = 'FAIL' then 0 else 1 end,
  check_type,
  item;
