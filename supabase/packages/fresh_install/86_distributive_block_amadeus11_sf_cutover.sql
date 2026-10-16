-- =============================================================================
-- IS-10d — Distributive-only block of AMADEUS 11 Support Fee cutover publish
-- =============================================================================
-- Migration 20260926060000_support_fee_tariff_core_cutover.sql bootstraps a
-- published 8.00 EUR/m²/year Support Fee version when published_count = 0.
-- That rate is the existing AMADEUS 11 building configuration — NOT a default
-- for newly installed complexes.
--
-- This package file (applied ONLY on fresh distributive installs):
-- 1. Sets install_distributive_flags so a later compatibility migration can
--    neutralize any cutover residue without touching production installs.
-- 2. Pre-claims the cutover version id + idempotency_key as a CANCELLED
--    sentinel so the cutover INSERT … ON CONFLICT (idempotency_key) DO NOTHING
--    cannot publish AMADEUS 11 prices.
--
-- Does NOT edit production migration files. Does NOT publish any tariff.
-- Does NOT seed apartments, owners, obligations, or payments.
-- =============================================================================

create table if not exists public.install_distributive_flags (
  flag_key text primary key,
  flag_value text not null,
  note text null,
  created_at timestamptz not null default now()
);

comment on table public.install_distributive_flags is
  'Fresh-install distributive markers. Absent on brownfield/production upgrades.';

alter table public.install_distributive_flags enable row level security;
revoke all on table public.install_distributive_flags from public, anon, authenticated;

insert into public.install_distributive_flags (flag_key, flag_value, note)
values (
  'skip_amadeus11_support_fee_cutover_publish',
  'true',
  'IS-10d: block AMADEUS 11 8.00 EUR/m²/year Support Fee cutover on greenfield'
)
on conflict (flag_key) do update
  set flag_value = excluded.flag_value,
      note = excluded.note;

-- Deterministic ids from 20260926060000_support_fee_tariff_core_cutover bootstrap.
-- Must match exactly so ON CONFLICT (idempotency_key) absorbs the cutover insert.
do $sentinel$
declare
  v_cat_id uuid;
  v_version_id uuid := (
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 1, 8) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 9, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 13, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 17, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:version'), 21, 12)
  )::uuid;
  v_idem uuid := (
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 1, 8) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 9, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 13, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 17, 4) || '-' ||
    substr(md5('support_fee_tariff_core_cutover:2026_baseline:idem'), 21, 12)
  )::uuid;
  v_cancel_idem uuid := (
    substr(md5('is10d_distributive_block:amadeus11_sf_cutover:cancel'), 1, 8) || '-' ||
    substr(md5('is10d_distributive_block:amadeus11_sf_cutover:cancel'), 9, 4) || '-' ||
    substr(md5('is10d_distributive_block:amadeus11_sf_cutover:cancel'), 13, 4) || '-' ||
    substr(md5('is10d_distributive_block:amadeus11_sf_cutover:cancel'), 17, 4) || '-' ||
    substr(md5('is10d_distributive_block:amadeus11_sf_cutover:cancel'), 21, 12)
  )::uuid;
  -- Well-known non-auth system actor for distributive install bookkeeping only.
  v_system_actor uuid := '00000000-0000-4000-8000-00000000010d'::uuid;
begin
  if to_regclass('public.tariff_versions') is null
     or to_regclass('public.tariff_catalog') is null then
    raise exception
      'is10d distributive block: tariff_versions/catalog missing — apply 70/85 first'
      using errcode = 'P0002';
  end if;

  select c.id into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'support_fee'
    and c.active is true;

  if v_cat_id is null then
    raise exception
      'is10d distributive block: support_fee catalog row missing'
      using errcode = 'P0002';
  end if;

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
    payload_fingerprint,
    cancelled_at,
    cancelled_by,
    cancellation_reason,
    cancellation_idempotency_key
  )
  values (
    v_version_id,
    v_cat_id,
    date '2026-01-01',
    'cancelled',
    'legacy_import',
    'is10d_distributive_block',
    date '2026-01-01',
    'IS-10d distributive sentinel — claims AMADEUS 11 cutover idempotency key so greenfield installs do not inherit 8.00 EUR/m²/year',
    null,
    now(),
    null,
    'package:86_distributive_block_amadeus11_sf_cutover',
    v_idem,
    md5('is10d|distributive_sentinel|support_fee|no_published_price'),
    now(),
    v_system_actor,
    'Distributive fresh-install: AMADEUS 11 Support Fee cutover publish blocked',
    v_cancel_idem
  )
  on conflict (idempotency_key) do nothing;
end;
$sentinel$;
