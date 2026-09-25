-- Tariff Core v1 Package 1: idempotent backfill into Core.
-- Does NOT switch Water/Electricity/Support calculation consumers.
-- Does NOT mutate legacy tariff rows, readings, charges, or ledgers.
-- Support: catalog only + explicit legacy pointer; NO invented historical versions.

begin;

-- Ensure catalog rows exist (idempotent with schema migration seed).
insert into public.tariff_catalog (
  tariff_key, module_key, default_name, unit_code, currency,
  calculation_type, billing_period, application_basis, governance_type, component_keys, active
) values
  (
    'support_fee', 'support_fee', 'Такса поддержки', 'm2', 'EUR',
    'per_unit', 'year', 'billing_year', 'internal_decision', array['base']::text[], true
  ),
  (
    'water', 'water', 'Вода', 'm3', 'EUR',
    'per_unit', null, 'calendar_date', 'external_supplier', array['base']::text[], true
  ),
  (
    'electricity', 'electricity', 'Электроэнергия', 'kwh', 'EUR',
    'per_unit', null, 'calendar_date', 'external_supplier', array['day','night']::text[], true
  )
on conflict (tariff_key) do nothing;

-- ---------------------------------------------------------------------------
-- Preflight: refuse ambiguous legacy date duplicates (abort whole transaction)
-- ---------------------------------------------------------------------------

do $preflight$
declare
  v_water_dup date;
  v_el_dup date;
begin
  select wt.valid_from into v_water_dup
  from public.water_tariffs as wt
  group by wt.valid_from
  having count(*) > 1
  order by wt.valid_from
  limit 1;

  if v_water_dup is not null then
    raise exception
      'tariff_core_backfill: duplicate water_tariffs.valid_from=% — aborting; resolve legacy duplicates before import',
      v_water_dup
      using errcode = '23505';
  end if;

  select et.valid_from into v_el_dup
  from public.electricity_tariffs as et
  group by et.valid_from
  having count(*) > 1
  order by et.valid_from
  limit 1;

  if v_el_dup is not null then
    raise exception
      'tariff_core_backfill: duplicate electricity_tariffs.valid_from=% — aborting; resolve legacy duplicates before import',
      v_el_dup
      using errcode = '23505';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Water: import each water_tariffs row as one Core version (base component)
-- ---------------------------------------------------------------------------

insert into public.tariff_versions (
  id,
  tariff_id,
  valid_from,
  status,
  basis_type,
  basis_reference,
  basis_date,
  basis_note,
  decision_id,
  published_at,
  published_by,
  legacy_author,
  idempotency_key,
  payload_fingerprint
)
select
  -- Deterministic version id from legacy row id (repeatable backfill).
  (
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 21, 12)
  )::uuid,
  c.id,
  wt.valid_from,
  'published',
  'legacy_import',
  'water_tariffs:' || wt.id::text,
  wt.valid_from,
  coalesce(nullif(btrim(coalesce(wt.note, '')), ''), 'Imported from legacy water_tariffs'),
  null,
  coalesce(wt.created_at, now()),
  null,
  wt.created_by_email,
  (
    substr(md5('tariff_core_backfill:water:idem:' || wt.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:water:idem:' || wt.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:idem:' || wt.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:idem:' || wt.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:idem:' || wt.id::text), 21, 12)
  )::uuid,
  md5('water|' || wt.id::text || '|' || wt.valid_from::text || '|' || wt.price_eur_per_m3::text)
from public.water_tariffs as wt
inner join public.tariff_catalog as c on c.tariff_key = 'water'
where not exists (
  select 1 from public.tariff_legacy_links as l
  where l.legacy_source = 'water_tariffs' and l.legacy_row_id = wt.id
)
on conflict (idempotency_key) do nothing;

insert into public.tariff_rate_items (version_id, component_key, rate)
select
  (
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 21, 12)
  )::uuid,
  'base',
  wt.price_eur_per_m3
from public.water_tariffs as wt
where exists (
  select 1 from public.tariff_versions as tv
  where tv.id = (
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 21, 12)
  )::uuid
)
on conflict (version_id, component_key) do nothing;

insert into public.tariff_legacy_links (
  tariff_key, legacy_source, legacy_row_id, version_id, note
)
select
  'water',
  'water_tariffs',
  wt.id,
  (
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 21, 12)
  )::uuid,
  'Package 1 mirror only — live billing still uses water_tariffs'
from public.water_tariffs as wt
where exists (
  select 1 from public.tariff_versions as tv
  where tv.id = (
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:water:version:' || wt.id::text), 21, 12)
  )::uuid
)
  and not exists (
    select 1 from public.tariff_legacy_links as l
    where l.legacy_source = 'water_tariffs' and l.legacy_row_id = wt.id
  );

-- ---------------------------------------------------------------------------
-- Electricity: ONE Core version per legacy row (day + night atomic)
-- ---------------------------------------------------------------------------

insert into public.tariff_versions (
  id,
  tariff_id,
  valid_from,
  status,
  basis_type,
  basis_reference,
  basis_date,
  basis_note,
  decision_id,
  published_at,
  published_by,
  legacy_author,
  idempotency_key,
  payload_fingerprint
)
select
  (
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 21, 12)
  )::uuid,
  c.id,
  et.valid_from,
  'published',
  'legacy_import',
  'electricity_tariffs:' || et.id::text,
  et.valid_from,
  coalesce(nullif(btrim(coalesce(et.note, '')), ''), 'Imported from legacy electricity_tariffs'),
  null,
  coalesce(et.created_at, now()),
  null,
  et.created_by_email,
  (
    substr(md5('tariff_core_backfill:electricity:idem:' || et.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:electricity:idem:' || et.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:idem:' || et.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:idem:' || et.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:idem:' || et.id::text), 21, 12)
  )::uuid,
  md5(
    'electricity|' || et.id::text || '|' || et.valid_from::text || '|' ||
    et.day_price_eur_per_kwh::text || '|' || et.night_price_eur_per_kwh::text
  )
from public.electricity_tariffs as et
inner join public.tariff_catalog as c on c.tariff_key = 'electricity'
where not exists (
  select 1 from public.tariff_legacy_links as l
  where l.legacy_source = 'electricity_tariffs' and l.legacy_row_id = et.id
)
on conflict (idempotency_key) do nothing;

insert into public.tariff_rate_items (version_id, component_key, rate)
select
  (
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 21, 12)
  )::uuid,
  comps.component_key,
  comps.rate
from public.electricity_tariffs as et
cross join lateral (
  values
    ('day'::text, et.day_price_eur_per_kwh),
    ('night'::text, et.night_price_eur_per_kwh)
) as comps(component_key, rate)
where exists (
  select 1 from public.tariff_versions as tv
  where tv.id = (
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 21, 12)
  )::uuid
)
on conflict (version_id, component_key) do nothing;

insert into public.tariff_legacy_links (
  tariff_key, legacy_source, legacy_row_id, version_id, note
)
select
  'electricity',
  'electricity_tariffs',
  et.id,
  (
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 21, 12)
  )::uuid,
  'Package 1 mirror only — live billing still uses electricity_tariffs'
from public.electricity_tariffs as et
where exists (
  select 1 from public.tariff_versions as tv
  where tv.id = (
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 1, 8) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 9, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 13, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 17, 4) || '-' ||
    substr(md5('tariff_core_backfill:electricity:version:' || et.id::text), 21, 12)
  )::uuid
)
  and not exists (
    select 1 from public.tariff_legacy_links as l
    where l.legacy_source = 'electricity_tariffs' and l.legacy_row_id = et.id
  );

-- ---------------------------------------------------------------------------
-- Support: DO NOT invent historical versions from building_settings.
-- Record an explicit legacy pointer with version_id NULL until Package 3
-- establishes a justified application year / assessment binding.
-- ---------------------------------------------------------------------------

insert into public.tariff_legacy_links (
  tariff_key, legacy_source, legacy_row_id, legacy_key, version_id, note
)
select
  'support_fee',
  'building_settings',
  null,
  'support_rate_eur_per_sqm_year',
  null,
  'Live Support rate remains building_settings.support_rate_eur_per_sqm_year. '
  || 'No Core version backfilled: no reliable historical valid_from. '
  || 'Current assessments/ledger unchanged. Package 3 will bind assessments.'
where exists (select 1 from public.building_settings as bs where bs.id = 1)
  and not exists (
    select 1 from public.tariff_legacy_links as l
    where l.legacy_source = 'building_settings'
      and l.legacy_key = 'support_rate_eur_per_sqm_year'
  );

commit;
