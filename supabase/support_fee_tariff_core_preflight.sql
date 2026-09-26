-- =============================================================================
-- AMADEUS 11 — Support Fee Tariff Core PREFLIGHT (READ-ONLY)
-- Safe to re-run after 060000 is applied (catalog introspection only).
-- Before apply: BOOTSTRAP_REQUIRED is OK when catalog valid + zero published Support.
-- After apply: those rows must be OK (published 2026 baseline present).
-- Does NOT call RPCs introduced by 060000.
-- FAIL rows sort first. Require NO FAIL (BOOTSTRAP_REQUIRED allowed only pre-apply).
-- Notes use dollar-quoting for paste-safe SQL Editor runs.
-- =============================================================================

with sofia as (
  select
    (now() at time zone 'Europe/Sofia')::date as today,
    extract(year from (now() at time zone 'Europe/Sofia'))::integer as year,
    make_date(
      extract(year from (now() at time zone 'Europe/Sofia'))::integer,
      1, 1
    ) as year_start
),
sf_cat as (
  select c.*
  from public.tariff_catalog as c
  where c.tariff_key = 'support_fee'
),
published as (
  select tv.*
  from public.tariff_versions as tv
  join sf_cat as c on c.id = tv.tariff_id
  where tv.status = 'published'
),
applicable as (
  select p.*
  from published as p
  cross join sofia as s
  where p.valid_from <= s.year_start
  order by p.valid_from desc, p.id desc
  limit 1
),
legacy_rate as (
  select bs.support_rate_eur_per_sqm_year as rate
  from public.building_settings as bs
  where bs.id = 1
),
checks as (
  select 'catalog'::text as check_type, 'support_fee_exists_active'::text as item,
    case when exists (select 1 from sf_cat where active is true) then 'OK' else 'FAIL' end as result,
    '{}'::jsonb as detail

  union all
  select 'catalog', 'support_fee_metadata',
    case when exists (
      select 1 from sf_cat
      where unit_code = 'm2'
        and currency = 'EUR'
        and calculation_type = 'per_unit'
        and billing_period = 'year'
        and application_basis = 'billing_year'
    ) then 'OK' else 'FAIL' end,
    coalesce(
      (select jsonb_build_object(
        'unit_code', unit_code, 'currency', currency,
        'calculation_type', calculation_type, 'billing_period', billing_period,
        'application_basis', application_basis
      ) from sf_cat),
      '{"missing":true}'::jsonb
    )

  union all
  select 'tariff', 'at_least_one_published',
    case
      when exists (select 1 from published) then 'OK'
      when exists (select 1 from sf_cat where active is true) then 'BOOTSTRAP_REQUIRED'
      else 'FAIL'
    end,
    jsonb_build_object(
      'published_count', (select count(*)::int from published),
      'planned_baseline', $b$2026-01-01 / base=8.0000 via 060000 cutover migration$b$
    )

  union all
  select 'tariff', 'applicable_to_current_sofia_year',
    case
      when exists (select 1 from applicable) then 'OK'
      when not exists (select 1 from published)
           and exists (select 1 from sf_cat where active is true)
        then 'BOOTSTRAP_REQUIRED'
      else 'FAIL'
    end,
    jsonb_build_object(
      'sofia_year', (select year from sofia),
      'year_start', (select year_start from sofia),
      'applicable_version_id', (select id from applicable),
      'applicable_valid_from', (select valid_from from applicable),
      'planned_baseline', $b$2026-01-01 / 8.0000$b$
    )

  union all
  select 'tariff', 'applicable_exactly_one_base',
    case
      when exists (select 1 from applicable)
           and (
             select count(*)::int from public.tariff_rate_items as ri
             where ri.version_id = (select id from applicable)
               and ri.component_key = 'base'
           ) = 1
           and (
             select count(*)::int from public.tariff_rate_items as ri
             where ri.version_id = (select id from applicable)
           ) = 1
        then 'OK'
      when not exists (select 1 from published)
           and exists (select 1 from sf_cat where active is true)
        then 'BOOTSTRAP_REQUIRED'
      else 'FAIL'
    end,
    '{}'::jsonb

  union all
  select 'tariff', 'applicable_base_rate_positive',
    case
      when exists (
        select 1 from public.tariff_rate_items as ri
        where ri.version_id = (select id from applicable)
          and ri.component_key = 'base'
          and ri.rate > 0
      ) then 'OK'
      when not exists (select 1 from published)
           and exists (select 1 from sf_cat where active is true)
        then 'BOOTSTRAP_REQUIRED'
      else 'FAIL'
    end,
    jsonb_build_object(
      'core_rate', (
        select ri.rate from public.tariff_rate_items as ri
        where ri.version_id = (select id from applicable) and ri.component_key = 'base'
      ),
      'legacy_building_settings_rate', (select rate from legacy_rate),
      'planned_cutover_baseline_rate', 8.0000,
      'note', $n$legacy rate is informational only; 060000 encodes confirmed 8.0000 explicitly$n$
    )

  union all
  select 'tariff', 'published_valid_from_jan1',
    case when exists (
      select 1 from published
      where extract(month from valid_from)::int <> 1
         or extract(day from valid_from)::int <> 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb

  union all
  select 'tariff', 'no_duplicate_published_valid_from',
    case when exists (
      select 1 from published
      group by tariff_id, valid_from
      having count(*) > 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb

  union all
  select 'data', 'assessments_no_duplicate_property_year',
    case
      when not exists (
        select 1
        from pg_catalog.pg_class as c
        join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'support_fee_assessments'
          and c.relkind in ('r','p')
      ) then 'FAIL'
      when exists (
        select 1 from public.support_fee_assessments
        group by property_id, billing_year
        having count(*) > 1
      ) then 'FAIL'
      else 'OK'
    end, '{}'::jsonb

  union all
  select 'info', 'legacy_building_settings_rate',
    'INFO',
    jsonb_build_object(
      'legacy_rate', (select rate from legacy_rate),
      'core_applicable_rate', (
        select ri.rate from public.tariff_rate_items as ri
        where ri.version_id = (select id from applicable) and ri.component_key = 'base'
      ),
      'note', $n$Do not auto-map legacy rate into tariff core$n$
    )

  union all
  select 'rpc', x.name,
    case when exists (
      select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = x.name
        and pg_catalog.oidvectortypes(p.proargtypes) = x.argtypes
    ) then 'OK' else 'FAIL' end,
    '{}'::jsonb
  from (values
    ('finalize_support_fee_assessment', 'bigint, integer'),
    ('finalize_support_fee_year', 'integer'),
    ('preview_support_fee_year', 'bigint, integer'),
    ('charge_support_fee', 'bigint, text'),
    ('upsert_support_fee_annual_policy', 'integer, boolean, numeric, numeric, timestamp with time zone'),
    ('publish_support_fee_annual_policy', 'integer'),
    ('support_fee_base_amount', 'bigint'),
    ('set_support_rate_eur_per_sqm_year', 'numeric'),
    ('resolve_tariff_version_by_date', 'uuid, date'),
    ('resolve_support_tariff_version_by_year', 'uuid, integer'),
    ('publish_tariff_version', 'uuid, jsonb, text, text, uuid, integer, date, text, date, uuid'),
    ('cancel_future_tariff_version', 'uuid, text, uuid')
  ) as x(name, argtypes)

  union all
  select 'table', x.rel,
    case when exists (
      select 1
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = x.rel
        and c.relkind in ('r','p','v','m','f')
    ) then 'OK' else 'FAIL' end,
    '{}'::jsonb
  from (values
    ('tariff_catalog'),
    ('tariff_versions'),
    ('tariff_rate_items'),
    ('support_fee_assessments'),
    ('support_fee_annual_policies'),
    ('support_fee_ledger'),
    ('support_fee_allocations'),
    ('building_settings')
  ) as x(rel)

  union all
  select 'prereq', 'package1_tariff_version_bound_stub_or_fn',
    case when exists (
      select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'tariff_version_bound_to_support_usage'
        and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid'
    ) then 'OK' else 'FAIL' end,
    '{}'::jsonb

  union all
  select 'prereq', 'package2_utility_resolver',
    case when exists (
      select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'resolve_utility_tariff'
        and pg_catalog.oidvectortypes(p.proargtypes) = 'text, date'
    ) then 'OK' else 'FAIL' end,
    '{}'::jsonb
)
select check_type, item, result, detail
from checks
order by
  case result when 'FAIL' then 0 when 'BOOTSTRAP_REQUIRED' then 1 when 'INFO' then 2 else 3 end,
  check_type,
  item;
