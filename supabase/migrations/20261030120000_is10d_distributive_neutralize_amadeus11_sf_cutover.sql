-- =============================================================================
-- IS-10d — Neutralize AMADEUS 11 Support Fee cutover on distributive installs
-- =============================================================================
-- Production / brownfield: install_distributive_flags is absent → NO-OP.
-- Existing published tariffs, balances, and obligations are never rewritten.
--
-- Fresh distributive path (package applied first): flag is set. After the
-- unchanged 20260926060000 cutover migration, neutralize only the known
-- AMADEUS 11 baseline version id if this database is still empty of business
-- data. Removes cutover-attached rate rows from that sentinel version and
-- ensures status remains cancelled (never published).
--
-- Does NOT edit 20260926060000_support_fee_tariff_core_cutover.sql.
-- Does NOT blind-delete arbitrary published tariffs.
-- =============================================================================

begin;

do $neutralize$
declare
  v_flag text;
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
  v_system_actor uuid := '00000000-0000-4000-8000-00000000010d'::uuid;
  v_cancel_idem uuid := (
    substr(md5('is10d_distributive_neutralize:amadeus11_sf_cutover:cancel'), 1, 8) || '-' ||
    substr(md5('is10d_distributive_neutralize:amadeus11_sf_cutover:cancel'), 9, 4) || '-' ||
    substr(md5('is10d_distributive_neutralize:amadeus11_sf_cutover:cancel'), 13, 4) || '-' ||
    substr(md5('is10d_distributive_neutralize:amadeus11_sf_cutover:cancel'), 17, 4) || '-' ||
    substr(md5('is10d_distributive_neutralize:amadeus11_sf_cutover:cancel'), 21, 12)
  )::uuid;
  v_props bigint;
  v_sfl bigint;
  v_sfa bigint;
  v_row public.tariff_versions%rowtype;
begin
  if to_regclass('public.install_distributive_flags') is null then
    -- Brownfield / production upgrade path — preserve existing tariffs.
    return;
  end if;

  select f.flag_value into v_flag
  from public.install_distributive_flags as f
  where f.flag_key = 'skip_amadeus11_support_fee_cutover_publish';

  if coalesce(v_flag, '') is distinct from 'true' then
    return;
  end if;

  -- Refuse to neutralize if real business / financial history exists.
  select count(*) into v_props from public.properties;
  select count(*) into v_sfl from public.support_fee_ledger;
  select count(*) into v_sfa from public.support_fee_assessments;

  if v_props > 0 or v_sfl > 0 or v_sfa > 0 then
    raise exception
      'is10d neutralize: distributive flag set but business/finance rows present — refusing'
      using errcode = 'P0001';
  end if;

  select * into v_row
  from public.tariff_versions as tv
  where tv.id = v_version_id
     or tv.idempotency_key = v_idem;

  if not found then
    -- Cutover did not create the baseline (unexpected on package path) — OK.
    return;
  end if;

  -- Strip AMADEUS 11 rate residue that cutover may have attached to the sentinel.
  if to_regclass('public.tariff_rate_items') is not null then
    if exists (
      select 1
      from pg_trigger as t
      join pg_class as c on c.oid = t.tgrelid
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'tariff_rate_items'
        and t.tgname = 'tariff_rate_items_immutability'
    ) then
      alter table public.tariff_rate_items disable trigger tariff_rate_items_immutability;
    end if;

    delete from public.tariff_rate_items
    where version_id = v_row.id;

    if exists (
      select 1
      from pg_trigger as t
      join pg_class as c on c.oid = t.tgrelid
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'tariff_rate_items'
        and t.tgname = 'tariff_rate_items_immutability'
    ) then
      alter table public.tariff_rate_items enable trigger tariff_rate_items_immutability;
    end if;
  end if;

  -- Ensure never published.
  if v_row.status is distinct from 'cancelled' then
    update public.tariff_versions as tv
       set status = 'cancelled',
           cancelled_at = coalesce(tv.cancelled_at, now()),
           cancelled_by = coalesce(tv.cancelled_by, v_system_actor),
           cancellation_reason = coalesce(
             nullif(btrim(tv.cancellation_reason), ''),
             'IS-10d distributive neutralize: AMADEUS 11 Support Fee cutover publish blocked'
           ),
           cancellation_idempotency_key = coalesce(
             tv.cancellation_idempotency_key,
             v_cancel_idem
           ),
           basis_reference = 'is10d_distributive_neutralize',
           basis_note = 'IS-10d: AMADEUS 11 8.00 EUR/m²/year cutover must not ship as greenfield default',
           legacy_author = coalesce(tv.legacy_author, 'migration:20261030120000_is10d')
     where tv.id = v_row.id;
  end if;

  -- Drop cutover legacy pointer to this neutralized version (empty-install only).
  if to_regclass('public.tariff_legacy_links') is not null then
    delete from public.tariff_legacy_links as l
    where l.version_id = v_row.id
      and l.tariff_key = 'support_fee'
      and l.legacy_source = 'building_settings'
      and l.legacy_key = 'support_rate_eur_per_sqm_year';
  end if;
end;
$neutralize$;

commit;
