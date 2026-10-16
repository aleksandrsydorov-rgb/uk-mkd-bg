-- =============================================================================
-- IS-9b — Fresh-install complete dependencies DDL (companion)
-- =============================================================================
-- Safe for EXISTING installations: CREATE IF NOT EXISTS / CREATE OR REPLACE.
-- Does NOT include empty-project preflight (would refuse populated production).
-- Does NOT modify business rows. Does NOT publish tariffs or create admins.
-- =============================================================================
-- =============================================================================
-- IS-9b вЂ” Property Book authorization helpers (canonical BOOK-ONLY)
-- =============================================================================
-- Sources: PB-1 access truth, lifecycle archive (archived_at), XFER admin_status,
--          Phase E1 active_owners hardening, PB-1 is_owner.
-- properties.owner_email is NEVER consulted for authorization.
-- Depends on: property_registry_people, properties, has_staff_role / is_staff.
-- =============================================================================

create or replace function public.property_book_set_mutating(p_on boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform set_config('property_book.mutating', case when p_on then '1' else '0' end, true);
end;
$fn$;

revoke all on function public.property_book_set_mutating(boolean) from public, anon;

create or replace function public.admin_assert_book_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_book: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ') then
    raise exception 'admin_book: not allowed'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.admin_assert_book_admin() from public;
revoke all on function public.admin_assert_book_admin() from anon;

create or replace function public.property_book_owner_row_access_ready(
  p_owner public.property_registry_people
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
begin
  if p_owner.relation_type is distinct from 'owner' then
    return false;
  end if;
  if p_owner.deregistered_at is not null then
    return false;
  end if;
  if nullif(btrim(coalesce(p_owner.email, '')), '') is null
     or position('@' in p_owner.email) = 0 then
    return false;
  end if;
  if p_owner.ownership_share_percent is null or p_owner.ownership_share_percent <= 0 then
    return false;
  end if;
  if p_owner.ideal_parts_percent is null or p_owner.ideal_parts_percent < 0 then
    return false;
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = p_owner.property_id;
  if not found then
    return false;
  end if;
  if v_prop.archived_at is not null then
    return false;
  end if;
  if v_prop.ownership_type is null
     or v_prop.ownership_type not in ('sole', 'shared') then
    return false;
  end if;

  if p_owner.entity_kind = 'legal_entity' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null then
      return false;
    end if;
    if nullif(btrim(coalesce(p_owner.eik_bulstat, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'natural_person' then
    if nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
       or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'sole_trader' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null
       and (
         nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
         or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null
       ) then
      return false;
    end if;
  else
    return false;
  end if;

  return true;
end;
$fn$;

revoke all on function public.property_book_owner_row_access_ready(public.property_registry_people)
  from public, anon;

create or replace function public.property_book_active_owner_by_email(
  p_property_id bigint,
  p_email text
)
returns public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_row public.property_registry_people%rowtype;
begin
  if v_email is null then
    return null;
  end if;
  select r.* into v_row
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and r.admin_status is distinct from 'deceased_recorded'
    and lower(btrim(coalesce(r.email, ''))) = v_email
  order by r.id
  limit 1;
  return v_row;
end;
$fn$;

revoke all on function public.property_book_active_owner_by_email(bigint, text) from public, anon;

create or replace function public.owns_property(property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
begin
  if v_email is null or auth.uid() is null then
    return false;
  end if;

  v_owner := public.property_book_active_owner_by_email(property_id, v_email);
  if v_owner.id is null then
    return false;
  end if;
  return public.property_book_owner_row_access_ready(v_owner);
end;
$fn$;

revoke all on function public.owns_property(bigint) from public, anon;
grant execute on function public.owns_property(bigint) to authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.property_registry_people as r
    where r.relation_type = 'owner'
      and r.deregistered_at is null
      and r.admin_status is distinct from 'deceased_recorded'
      and lower(btrim(coalesce(r.email, ''))) = lower(btrim(coalesce(auth.email(), '')))
      and public.property_book_owner_row_access_ready(r)
  );
$fn$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.property_book_active_owners(p_property_id bigint)
returns setof public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is not distinct from 'service_role' then
    null;
  elsif public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ') then
    null;
  elsif auth.uid() is not null and public.owns_property(p_property_id) then
    null;
  else
    raise exception 'property_book_active_owners: forbidden'
      using errcode = '42501';
  end if;

  return query
  select r.*
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id;
end;
$fn$;

revoke all on function public.property_book_active_owners(bigint) from public;
revoke all on function public.property_book_active_owners(bigint) from anon;
grant execute on function public.property_book_active_owners(bigint) to authenticated;
grant execute on function public.property_book_active_owners(bigint) to service_role;

create or replace function public.property_book_validate(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
  v_errors text[] := array[]::text[];
  v_owners public.property_registry_people[] := array[]::public.property_registry_people[];
  v_row public.property_registry_people%rowtype;
  v_share_sum numeric := 0;
  v_ideal_sum numeric := 0;
  v_natural_n integer := 0;
  v_legal_n integer := 0;
  v_prop_ideal numeric;
begin
  select p.* into v_prop
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('property_not_found'));
  end if;

  if nullif(btrim(coalesce(v_prop.purpose, '')), '') is null then
    v_errors := array_append(v_errors, 'purpose_required');
  end if;
  if v_prop.area_sqm is null or v_prop.area_sqm <= 0 then
    v_errors := array_append(v_errors, 'area_required');
  end if;
  v_prop_ideal := v_prop.ideal_parts_percent;
  if v_prop_ideal is null then
    v_errors := array_append(v_errors, 'object_ideal_parts_required');
  end if;
  if v_prop.ownership_type is null
     or v_prop.ownership_type not in ('sole', 'shared') then
    v_errors := array_append(v_errors, 'ownership_type_required');
  end if;

  for v_row in
    select * from public.property_registry_people as r
    where r.property_id = p_property_id
      and r.relation_type = 'owner'
      and r.deregistered_at is null
    order by r.id
  loop
    v_owners := array_append(v_owners, v_row);
  end loop;

  if coalesce(array_length(v_owners, 1), 0) = 0 then
    v_errors := array_append(v_errors, 'owners_required');
  else
    foreach v_row in array v_owners
    loop
      if v_row.ownership_share_percent is null or v_row.ownership_share_percent <= 0 then
        v_errors := array_append(v_errors, 'owner_share_required');
      else
        v_share_sum := v_share_sum + v_row.ownership_share_percent;
      end if;
      if v_row.ideal_parts_percent is null or v_row.ideal_parts_percent < 0 then
        v_errors := array_append(v_errors, 'owner_ideal_parts_required');
      else
        v_ideal_sum := v_ideal_sum + v_row.ideal_parts_percent;
      end if;
      if nullif(btrim(coalesce(v_row.email, '')), '') is null then
        v_errors := array_append(v_errors, 'owner_email_required');
      end if;
      if v_row.entity_kind = 'legal_entity' then
        v_legal_n := v_legal_n + 1;
        if nullif(btrim(coalesce(v_row.entity_name, '')), '') is null then
          v_errors := array_append(v_errors, 'legal_name_required');
        end if;
        if nullif(btrim(coalesce(v_row.eik_bulstat, '')), '') is null then
          v_errors := array_append(v_errors, 'eik_required');
        end if;
      elsif v_row.entity_kind in ('natural_person', 'sole_trader') then
        v_natural_n := v_natural_n + 1;
        if v_row.entity_kind = 'natural_person'
           and (
             nullif(btrim(coalesce(v_row.first_name, '')), '') is null
             or nullif(btrim(coalesce(v_row.last_name, '')), '') is null
           ) then
          v_errors := array_append(v_errors, 'natural_name_required');
        end if;
        if v_row.entity_kind = 'sole_trader'
           and nullif(btrim(coalesce(v_row.entity_name, '')), '') is null
           and (
             nullif(btrim(coalesce(v_row.first_name, '')), '') is null
             or nullif(btrim(coalesce(v_row.last_name, '')), '') is null
           ) then
          v_errors := array_append(v_errors, 'sole_trader_name_required');
        end if;
      else
        v_errors := array_append(v_errors, 'invalid_entity_kind');
      end if;
    end loop;

    if v_legal_n > 0 and v_natural_n > 0 then
      v_errors := array_append(v_errors, 'mixed_natural_legal_forbidden');
    end if;
    if v_legal_n > 1 then
      v_errors := array_append(v_errors, 'multiple_legal_forbidden');
    end if;

    if v_prop.ownership_type = 'sole' then
      if coalesce(array_length(v_owners, 1), 0) <> 1 then
        v_errors := array_append(v_errors, 'sole_requires_one_owner');
      elsif abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'sole_share_must_be_100');
      end if;
      if v_prop_ideal is not null
         and coalesce(array_length(v_owners, 1), 0) = 1
         and v_owners[1].ideal_parts_percent is not null
         and abs(v_owners[1].ideal_parts_percent - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'sole_ideal_parts_mismatch');
      end if;
    elsif v_prop.ownership_type = 'shared' then
      if v_legal_n > 0 then
        v_errors := array_append(v_errors, 'shared_legal_forbidden');
      end if;
      if coalesce(array_length(v_owners, 1), 0) < 2 then
        v_errors := array_append(v_errors, 'shared_requires_two_owners');
      end if;
      if abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'shares_must_sum_100');
      end if;
      if v_prop_ideal is not null and abs(v_ideal_sum - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'owner_ideal_parts_sum_mismatch');
      end if;
    end if;

    if v_legal_n = 1 and v_prop.ownership_type = 'sole' then
      if abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'legal_must_own_100');
      end if;
    end if;
  end if;

  select coalesce(array_agg(distinct e), array[]::text[])
    into v_errors
  from unnest(v_errors) as e;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors),
    'owner_count', coalesce(array_length(v_owners, 1), 0),
    'share_sum', v_share_sum,
    'ideal_sum', v_ideal_sum
  );
end;
$fn$;

revoke all on function public.property_book_validate(bigint) from public;
revoke all on function public.property_book_validate(bigint) from anon;
grant execute on function public.property_book_validate(bigint) to authenticated;

create or replace function public.property_book_is_complete(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((public.property_book_validate(p_property_id) ->> 'ok')::boolean, false);
$fn$;

revoke all on function public.property_book_is_complete(bigint) from public;
revoke all on function public.property_book_is_complete(bigint) from anon;
grant execute on function public.property_book_is_complete(bigint) to authenticated;

-- Re-apply Book/capital SELECT policies now that owns_property exists.
do $$
begin
  if to_regprocedure('public.owns_property(bigint)') is null
     or to_regprocedure('public.has_staff_role(text)') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'property_registry_people'
      and policyname = 'property_registry_people_select'
  ) then
    create policy property_registry_people_select
    on public.property_registry_people
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'water_meters'
      and policyname = 'water_meters_select'
  ) then
    create policy water_meters_select
    on public.water_meters
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
      or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      or public.has_staff_role('РёРЅР¶РµРЅРµСЂ')
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'electricity_meters'
      and policyname = 'electricity_meters_select'
  ) then
    create policy electricity_meters_select
    on public.electricity_meters
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
      or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      or public.has_staff_role('РёРЅР¶РµРЅРµСЂ')
    );
  end if;
end $$;


-- =============================================================================
-- IS-9b вЂ” Utilities readings + ledgers (canonical DDL, no price seeds)
-- =============================================================================
-- Sources: water_capital_schema, electricity_finance_hotfix, electricity_submit_hotfix,
--          database.types meter_readings shape.
-- Does NOT seed AMADEUS 11 water/electricity tariff prices.
-- Writes remain RPC-only (SELECT grants + RLS).
-- =============================================================================

-- Water tariffs shell (empty вЂ” admin publishes via Tariff Core / legacy path later)
create table if not exists public.water_tariffs (
  id uuid primary key default gen_random_uuid(),
  price_eur_per_m3 numeric(12, 4) not null,
  valid_from date not null,
  note text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint water_tariffs_price_nonneg
    check (price_eur_per_m3 >= 0),
  constraint water_tariffs_valid_from_key
    unique (valid_from),
  constraint water_tariffs_id_price_key
    unique (id, price_eur_per_m3)
);

comment on table public.water_tariffs is
  'Water price history. Fresh-install: empty вЂ” no seeded prices.';

create table if not exists public.water_readings (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  meter_id uuid not null,
  reading_date date not null,
  previous_value numeric(12, 3) not null,
  current_value numeric(12, 3) not null,
  tariff_id uuid not null,
  tariff_eur_per_m3 numeric(12, 4) not null,
  consumption_m3 numeric(12, 3)
    generated always as (current_value - previous_value) stored,
  charge_amount_eur numeric(12, 2)
    generated always as (
      round((current_value - previous_value) * tariff_eur_per_m3, 2)
    ) stored,
  submitted_by_email text null,
  submitted_via text not null,
  idempotency_key uuid not null,
  status text not null default 'active',
  reversed_at timestamptz null,
  reversed_by_email text null,
  reversal_reason text null,
  created_at timestamptz not null default now(),
  constraint water_readings_previous_value_nonneg check (previous_value >= 0),
  constraint water_readings_current_value_nonneg check (current_value >= 0),
  constraint water_readings_current_gte_previous check (current_value >= previous_value),
  constraint water_readings_tariff_eur_nonneg check (tariff_eur_per_m3 >= 0),
  constraint water_readings_submitted_via_check
    check (submitted_via in ('owner', 'staff', 'system')),
  constraint water_readings_submitter_check
    check (
      submitted_via = 'system'
      or (
        submitted_by_email is not null
        and length(trim(submitted_by_email)) > 0
      )
    ),
  constraint water_readings_status_check check (status in ('active', 'reversed')),
  constraint water_readings_reversal_metadata_check
    check (
      (
        status = 'active'
        and reversed_at is null
        and reversed_by_email is null
        and reversal_reason is null
      )
      or (
        status = 'reversed'
        and reversed_at is not null
        and reversed_by_email is not null
        and reversal_reason is not null
        and length(trim(reversal_reason)) > 0
      )
    ),
  constraint water_readings_idempotency_key_key unique (idempotency_key),
  constraint water_readings_id_property_id_key unique (id, property_id),
  constraint water_readings_property_meter_fk
    foreign key (property_id, meter_id)
    references public.water_meters (property_id, id)
    on delete restrict,
  constraint water_readings_tariff_snapshot_fk
    foreign key (tariff_id, tariff_eur_per_m3)
    references public.water_tariffs (id, price_eur_per_m3)
    on delete restrict
);

create index if not exists water_readings_property_date_created_idx
  on public.water_readings (property_id, reading_date desc, created_at desc);
create index if not exists water_readings_meter_date_created_idx
  on public.water_readings (meter_id, reading_date desc, created_at desc);
create index if not exists water_readings_status_idx
  on public.water_readings (status);

create table if not exists public.water_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  reading_id uuid null,
  kind text not null,
  amount_eur numeric(12, 2) not null,
  note text null,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint water_ledger_kind_check
    check (kind in ('charge', 'payment', 'adjustment_debit', 'adjustment_credit')),
  constraint water_ledger_amount_positive check (amount_eur > 0),
  constraint water_ledger_charge_requires_reading
    check (kind <> 'charge' or reading_id is not null),
  constraint water_ledger_idempotency_key_key unique (idempotency_key),
  constraint water_ledger_reading_property_fk
    foreign key (reading_id, property_id)
    references public.water_readings (id, property_id)
    on delete restrict
);

create unique index if not exists water_ledger_one_charge_per_reading_idx
  on public.water_ledger (reading_id)
  where kind = 'charge' and reading_id is not null;
create index if not exists water_ledger_property_created_idx
  on public.water_ledger (property_id, created_at desc);
create index if not exists water_ledger_kind_idx on public.water_ledger (kind);

-- Electricity meter readings (legacy platform table; no CREATE in migrations/)
create table if not exists public.meter_readings (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint null
    references public.properties (id) on delete restrict,
  meter_type text null,
  value numeric null,
  reading_date date null,
  submitted_by text null,
  meter_serial_number text null,
  submitted_source text null,
  idempotency_key uuid null,
  electricity_meter_id uuid null,
  constraint meter_readings_submitted_source_chk
    check (submitted_source is null or submitted_source in ('owner', 'staff'))
);

create unique index if not exists meter_readings_electricity_idempotency_idx
  on public.meter_readings (idempotency_key, meter_type)
  where idempotency_key is not null;
create index if not exists meter_readings_property_type_date_idx
  on public.meter_readings (property_id, meter_type, reading_date desc, created_at desc);

create table if not exists public.electricity_tariffs (
  id uuid primary key default gen_random_uuid(),
  day_price_eur_per_kwh numeric(12, 4) not null,
  night_price_eur_per_kwh numeric(12, 4) not null,
  valid_from date not null,
  note text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint electricity_tariffs_day_price_nonneg check (day_price_eur_per_kwh >= 0),
  constraint electricity_tariffs_night_price_nonneg check (night_price_eur_per_kwh >= 0),
  constraint electricity_tariffs_valid_from_key unique (valid_from),
  constraint electricity_tariffs_id_prices_key
    unique (id, day_price_eur_per_kwh, night_price_eur_per_kwh)
);

comment on table public.electricity_tariffs is
  'Electricity day/night price history. Fresh-install: empty вЂ” no AMADEUS 11 price seed.';

create table if not exists public.electricity_charges (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  day_reading_id bigint not null
    references public.meter_readings (id) on delete restrict,
  night_reading_id bigint not null
    references public.meter_readings (id) on delete restrict,
  reading_date date not null,
  previous_day numeric(12, 3) not null,
  current_day numeric(12, 3) not null,
  previous_night numeric(12, 3) not null,
  current_night numeric(12, 3) not null,
  tariff_id uuid not null,
  day_tariff_eur_per_kwh numeric(12, 4) not null,
  night_tariff_eur_per_kwh numeric(12, 4) not null,
  consumption_day numeric(12, 3)
    generated always as (current_day - previous_day) stored,
  consumption_night numeric(12, 3)
    generated always as (current_night - previous_night) stored,
  day_amount_eur numeric(12, 2)
    generated always as (
      round((current_day - previous_day) * day_tariff_eur_per_kwh, 2)
    ) stored,
  night_amount_eur numeric(12, 2)
    generated always as (
      round((current_night - previous_night) * night_tariff_eur_per_kwh, 2)
    ) stored,
  total_amount_eur numeric(12, 2)
    generated always as (
      round((current_day - previous_day) * day_tariff_eur_per_kwh, 2)
      + round((current_night - previous_night) * night_tariff_eur_per_kwh, 2)
    ) stored,
  recorded_by_email text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint electricity_charges_prev_day_nonneg check (previous_day >= 0),
  constraint electricity_charges_curr_day_nonneg check (current_day >= 0),
  constraint electricity_charges_day_gte check (current_day >= previous_day),
  constraint electricity_charges_prev_night_nonneg check (previous_night >= 0),
  constraint electricity_charges_curr_night_nonneg check (current_night >= 0),
  constraint electricity_charges_night_gte check (current_night >= previous_night),
  constraint electricity_charges_day_tariff_nonneg check (day_tariff_eur_per_kwh >= 0),
  constraint electricity_charges_night_tariff_nonneg check (night_tariff_eur_per_kwh >= 0),
  constraint electricity_charges_recorded_by_not_blank
    check (length(trim(recorded_by_email)) > 0),
  constraint electricity_charges_idempotency_key unique (idempotency_key),
  constraint electricity_charges_property_id_id_key unique (property_id, id),
  constraint electricity_charges_tariff_snapshot_fkey
    foreign key (tariff_id, day_tariff_eur_per_kwh, night_tariff_eur_per_kwh)
    references public.electricity_tariffs (id, day_price_eur_per_kwh, night_price_eur_per_kwh)
);

create table if not exists public.electricity_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  charge_id uuid null,
  kind text not null,
  amount_eur numeric(12, 2) not null,
  note text null,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint electricity_ledger_kind_check
    check (kind in ('charge', 'payment', 'adjustment_debit', 'adjustment_credit')),
  constraint electricity_ledger_amount_positive check (amount_eur > 0),
  constraint electricity_ledger_charge_kind_check
    check (
      (kind = 'charge' and charge_id is not null)
      or (kind <> 'charge' and charge_id is null)
    ),
  constraint electricity_ledger_idempotency_key unique (idempotency_key),
  constraint electricity_ledger_charge_fk
    foreign key (property_id, charge_id)
    references public.electricity_charges (property_id, id)
);

create unique index if not exists electricity_ledger_one_charge_per_charge_idx
  on public.electricity_ledger (charge_id)
  where kind = 'charge';
create index if not exists electricity_ledger_property_created_idx
  on public.electricity_ledger (property_id, created_at desc);
create index if not exists electricity_charges_property_date_idx
  on public.electricity_charges (property_id, reading_date desc, created_at desc);

-- RLS / grants (SELECT only)
alter table public.water_tariffs enable row level security;
alter table public.water_readings enable row level security;
alter table public.water_ledger enable row level security;
alter table public.meter_readings enable row level security;
alter table public.electricity_tariffs enable row level security;
alter table public.electricity_charges enable row level security;
alter table public.electricity_ledger enable row level security;

revoke all on table public.water_tariffs from public, anon, authenticated;
revoke all on table public.water_readings from public, anon, authenticated;
revoke all on table public.water_ledger from public, anon, authenticated;
revoke all on table public.meter_readings from public, anon, authenticated;
revoke all on table public.electricity_tariffs from public, anon, authenticated;
revoke all on table public.electricity_charges from public, anon, authenticated;
revoke all on table public.electricity_ledger from public, anon, authenticated;

grant select on table public.water_tariffs to authenticated;
grant select on table public.water_readings to authenticated;
grant select on table public.water_ledger to authenticated;
grant select on table public.meter_readings to authenticated;
grant select on table public.electricity_tariffs to authenticated;
grant select on table public.electricity_charges to authenticated;
grant select on table public.electricity_ledger to authenticated;

do $$
begin
  if to_regprocedure('public.has_staff_role(text)') is null then
    return;
  end if;

  if to_regprocedure('public.is_owner()') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'water_tariffs'
         and policyname = 'water_tariffs_select'
     ) then
    create policy water_tariffs_select on public.water_tariffs
    for select to authenticated
    using (
      public.is_owner()
      or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
      or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      or public.has_staff_role('РёРЅР¶РµРЅРµСЂ')
    );
  end if;

  if to_regprocedure('public.owns_property(bigint)') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'water_readings'
        and policyname = 'water_readings_select'
    ) then
      create policy water_readings_select on public.water_readings
      for select to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
        or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
        or public.has_staff_role('РёРЅР¶РµРЅРµСЂ')
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'water_ledger'
        and policyname = 'water_ledger_select'
    ) then
      create policy water_ledger_select on public.water_ledger
      for select to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
        or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'meter_readings'
        and policyname = 'meter_readings_owner_staff_select'
    ) then
      create policy meter_readings_owner_staff_select on public.meter_readings
      for select to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
        or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
        or public.has_staff_role('РёРЅР¶РµРЅРµСЂ')
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'electricity_charges'
        and policyname = 'electricity_charges_select'
    ) then
      create policy electricity_charges_select on public.electricity_charges
      for select to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
        or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'electricity_ledger'
        and policyname = 'electricity_ledger_select'
    ) then
      create policy electricity_ledger_select on public.electricity_ledger
      for select to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
        or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      );
    end if;
  end if;

  if to_regprocedure('public.is_owner()') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'electricity_tariffs'
         and policyname = 'electricity_tariffs_select'
     ) then
    create policy electricity_tariffs_select on public.electricity_tariffs
    for select to authenticated
    using (
      public.is_owner()
      or public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
      or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
      or public.has_staff_role('РёРЅР¶РµРЅРµСЂ')
    );
  end if;
end $$;


-- =============================================================================
-- IS-9b вЂ” Capital Repair operational RPCs (canonical)
-- =============================================================================
-- Sources:
--   record_capital_repair_payment вЂ” legacy capital_repair_rpc.sql (not in migrations/)
--   get_capital_repair_balance / fund_totals вЂ” IS-8 opening-compatible semantics
--   resolve_capital_tariff_for_year + charge_capital_repair вЂ” tariff cutover migration
-- Depends on: capital_repair_* tables, owns_property, has_staff_role, tariff resolvers.
-- Does NOT invent Support Fee opening mechanisms.
-- =============================================================================

create or replace function public.record_capital_repair_payment(
  p_property_id bigint,
  p_amount_eur numeric,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  amount_eur numeric,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_row public.capital_repair_ledger%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
     and not public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ') then
    raise exception 'Not authorized.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if p_amount_eur is null then
    raise exception 'Amount must be greater than zero.';
  end if;

  v_amount := round(p_amount_eur, 2);
  if v_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.*
    into v_row
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is not null
       or v_row.kind is distinct from 'payment'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;

    return query
    select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  begin
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    )
    values (
      p_property_id,
      null,
      'payment',
      v_amount,
      v_note,
      v_email,
      p_idempotency_key
    )
    returning * into v_row;
  exception
    when unique_violation then
      select l.*
        into v_row
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_row.property_id is distinct from p_property_id
         or v_row.assessment_id is not null
         or v_row.kind is distinct from 'payment'
         or v_row.amount_eur is distinct from v_amount
         or v_row.note is distinct from v_note then
        raise exception 'Idempotency key conflict.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$$;

revoke all on function public.record_capital_repair_payment(bigint, numeric, text, uuid) from public;
revoke all on function public.record_capital_repair_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_capital_repair_payment(bigint, numeric, text, uuid) to authenticated;

create or replace function public.get_capital_repair_balance(
  p_property_id bigint
)
returns table (
  charged_eur numeric,
  paid_eur numeric,
  adjustments_debit_eur numeric,
  adjustments_credit_eur numeric,
  balance_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if not public.owns_property(p_property_id)
     and not public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
     and not public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ') then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from public.properties as p where p.id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  return query
  select
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('charge', 'opening_obligation')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('payment', 'opening_historical_settlement')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind = 'adjustment_debit'
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('adjustment_credit', 'opening_credit')
    ), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (
        where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
      ), 0)
      - coalesce(sum(l.amount_eur) filter (
        where l.kind in (
          'payment',
          'opening_historical_settlement',
          'adjustment_credit',
          'opening_credit'
        )
      ), 0)
    )::numeric(12, 2)
  from public.capital_repair_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_capital_repair_balance(bigint) from public;
revoke all on function public.get_capital_repair_balance(bigint) from anon;
grant execute on function public.get_capital_repair_balance(bigint) to authenticated;

create or replace function public.get_capital_repair_fund_totals()
returns table (
  charged_eur numeric,
  paid_eur numeric,
  balance_eur numeric,
  apartments_with_debt integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_capital_repair_fund_totals: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
     and not public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ') then
    raise exception 'get_capital_repair_fund_totals: not allowed'
      using errcode = '42501';
  end if;

  return query
  with per_apt as (
    select
      l.property_id,
      (
        coalesce(sum(l.amount_eur) filter (
          where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
        ), 0)
        - coalesce(sum(l.amount_eur) filter (
          where l.kind in (
            'payment',
            'opening_historical_settlement',
            'adjustment_credit',
            'opening_credit'
          )
        ), 0)
      )::numeric(12, 2) as bal
    from public.capital_repair_ledger as l
    group by l.property_id
  )
  select
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('charge', 'opening_obligation')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('payment', 'opening_historical_settlement')
    ), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (
        where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
      ), 0)
      - coalesce(sum(l.amount_eur) filter (
        where l.kind in (
          'payment',
          'opening_historical_settlement',
          'adjustment_credit',
          'opening_credit'
        )
      ), 0)
    )::numeric(12, 2),
    (select count(*)::integer from per_apt as a where a.bal > 0)
  from public.capital_repair_ledger as l;
end;
$fn$;

revoke all on function public.get_capital_repair_fund_totals() from public;
revoke all on function public.get_capital_repair_fund_totals() from anon;
grant execute on function public.get_capital_repair_fund_totals() to authenticated;

-- Charge path requires Tariff Core resolvers (packaged in 85_*).
-- Defined here only when resolver already exists; 85 re-creates charge after resolvers.
do $$
begin
  if to_regprocedure('public.resolve_capital_tariff_for_year(integer)') is null then
    raise notice
      'IS-9b: charge_capital_repair deferred until resolve_capital_tariff_for_year exists (85_tariff_versions_schema.sql)';
  end if;
end $$;


-- =============================================================================
-- IS-9b вЂ” Tariff Core versions / rate schema + capital charge resolver
-- =============================================================================
-- Creates tariff_versions + tariff_rate_items WITHOUT inserting published prices.
-- decision_id is uuid without FK until general_meeting_decisions exists
-- (FK attached conditionally). Admin publish remains a later UI/RPC step.
-- =============================================================================

create table if not exists public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null
    references public.tariff_catalog (id)
    on delete restrict,
  valid_from date not null,
  status text not null
    constraint tariff_versions_status_check
      check (status in ('published', 'cancelled')),
  basis_type text not null
    constraint tariff_versions_basis_type_check
      check (basis_type in (
        'general_meeting',
        'external_decision',
        'supplier_notice',
        'invoice',
        'other',
        'legacy_import'
      )),
  basis_reference text null,
  basis_date date null,
  basis_note text not null
    constraint tariff_versions_basis_note_nonempty
      check (length(btrim(basis_note)) > 0),
  decision_id uuid null,
  published_at timestamptz not null default now(),
  published_by uuid null,
  legacy_author text null,
  idempotency_key uuid not null,
  payload_fingerprint text not null,
  cancelled_at timestamptz null,
  cancelled_by uuid null,
  cancellation_reason text null,
  cancellation_idempotency_key uuid null,
  constraint tariff_versions_idempotency_key_key unique (idempotency_key),
  constraint tariff_versions_cancellation_idempotency_key_key unique (cancellation_idempotency_key),
  constraint tariff_versions_published_no_cancel_fields check (
    status <> 'published'
    or (
      cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null
      and cancellation_idempotency_key is null
    )
  ),
  constraint tariff_versions_cancelled_fields check (
    status <> 'cancelled'
    or (
      cancelled_at is not null
      and cancelled_by is not null
      and cancellation_reason is not null
      and length(btrim(cancellation_reason)) > 0
      and cancellation_idempotency_key is not null
    )
  )
);

comment on table public.tariff_versions is
  'Published/cancelled tariff versions. Fresh-install: schema only вЂ” no published price rows.';

create unique index if not exists tariff_versions_one_published_per_valid_from_uidx
  on public.tariff_versions (tariff_id, valid_from)
  where status = 'published';

create index if not exists tariff_versions_history_idx
  on public.tariff_versions (tariff_id, valid_from desc, id desc);

create index if not exists tariff_versions_decision_id_idx
  on public.tariff_versions (decision_id);

-- Attach GM FK when decisions table already exists (else chronological migrations may add it).
do $$
begin
  if to_regclass('public.general_meeting_decisions') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'tariff_versions_decision_id_fkey'
     ) then
    alter table public.tariff_versions
      add constraint tariff_versions_decision_id_fkey
      foreign key (decision_id)
      references public.general_meeting_decisions (id)
      on delete restrict;
  end if;
end $$;

create table if not exists public.tariff_rate_items (
  version_id uuid not null
    references public.tariff_versions (id)
    on delete restrict,
  component_key text not null,
  rate numeric(12, 4) not null
    constraint tariff_rate_items_rate_nonneg check (rate >= 0),
  primary key (version_id, component_key)
);

comment on table public.tariff_rate_items is
  'Atomic rate components per tariff version. Empty on fresh install.';

alter table public.tariff_versions enable row level security;
alter table public.tariff_rate_items enable row level security;

revoke all on table public.tariff_versions from public, anon, authenticated;
revoke all on table public.tariff_rate_items from public, anon, authenticated;
grant select on table public.tariff_versions to authenticated;
grant select on table public.tariff_rate_items to authenticated;

do $$
begin
  if to_regprocedure('public.tariff_can_view()') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'tariff_versions'
        and policyname = 'tariff_versions_select'
    ) then
      create policy tariff_versions_select on public.tariff_versions
      for select to authenticated
      using (public.tariff_can_view());
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'tariff_rate_items'
        and policyname = 'tariff_rate_items_select'
    ) then
      create policy tariff_rate_items_select on public.tariff_rate_items
      for select to authenticated
      using (public.tariff_can_view());
    end if;
  end if;
end $$;

-- Internal resolvers (not granted to clients) вЂ” required by capital charge path
create or replace function public.resolve_tariff_version_by_date(
  p_tariff_id uuid,
  p_on_date date
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_tariff_id is null or p_on_date is null then
    raise exception 'resolve_tariff_version_by_date: arguments required' using errcode = '22023';
  end if;

  select tv.id into v_id
  from public.tariff_versions as tv
  where tv.tariff_id = p_tariff_id
    and tv.status = 'published'
    and tv.valid_from <= p_on_date
  order by tv.valid_from desc, tv.id desc
  limit 1;

  if v_id is null then
    raise exception 'resolve_tariff_version_by_date: no matching version'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.resolve_tariff_version_by_date(uuid, date) from public;
revoke all on function public.resolve_tariff_version_by_date(uuid, date) from anon;
revoke all on function public.resolve_tariff_version_by_date(uuid, date) from authenticated;

create or replace function public.resolve_support_tariff_version_by_year(
  p_tariff_id uuid,
  p_billing_year integer
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_from date;
begin
  if p_tariff_id is null or p_billing_year is null then
    raise exception 'resolve_support_tariff_version_by_year: arguments required'
      using errcode = '22023';
  end if;
  if p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_support_tariff_version_by_year: invalid year' using errcode = '22023';
  end if;
  v_from := make_date(p_billing_year, 1, 1);
  return public.resolve_tariff_version_by_date(p_tariff_id, v_from);
end;
$fn$;

revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from public;
revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from anon;
revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from authenticated;

create or replace function public.resolve_capital_tariff_for_year(
  p_billing_year integer
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cat_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_amount numeric;
begin
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_capital_tariff_for_year: invalid billing year'
      using errcode = '22023';
  end if;

  select c.id
    into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'capital_repair'
    and c.active is true;

  if v_cat_id is null then
    raise exception 'resolve_capital_tariff_for_year: capital_repair catalog missing'
      using errcode = 'P0002';
  end if;

  begin
    v_version_id := public.resolve_support_tariff_version_by_year(v_cat_id, p_billing_year);
  exception
    when sqlstate 'P0002' then
      raise exception 'No capital repair tariff configured for billing year %', p_billing_year
        using errcode = 'P0002';
  end;

  select tv.valid_from
    into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id
    and tv.status = 'published';

  if v_valid_from is null then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  select ri.rate
    into v_amount
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base';

  if v_amount is null or v_amount <= 0 then
    raise exception 'resolve_capital_tariff_for_year: invalid amount'
      using errcode = '22023';
  end if;

  if (
    select count(*)::int
    from public.tariff_rate_items as ri
    where ri.version_id = v_version_id
  ) <> 1 then
    raise exception 'resolve_capital_tariff_for_year: expected exactly one rate component'
      using errcode = '22023';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  amount_eur := round(v_amount, 2);
  return next;
end;
$fn$;

revoke all on function public.resolve_capital_tariff_for_year(integer) from public;
revoke all on function public.resolve_capital_tariff_for_year(integer) from anon;
revoke all on function public.resolve_capital_tariff_for_year(integer) from authenticated;

create or replace function public.get_applicable_capital_tariff(
  p_billing_year integer default null
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric,
  billing_year integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_applicable_capital_tariff: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
    or public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ')
  ) then
    raise exception 'get_applicable_capital_tariff: not allowed'
      using errcode = '42501';
  end if;

  v_year := coalesce(
    p_billing_year,
    extract(year from (now() at time zone 'Europe/Sofia'))::integer
  );

  return query
  select
    r.tariff_version_id,
    r.valid_from,
    r.amount_eur,
    v_year
  from public.resolve_capital_tariff_for_year(v_year) as r;
end;
$fn$;

revoke all on function public.get_applicable_capital_tariff(integer) from public;
revoke all on function public.get_applicable_capital_tariff(integer) from anon;
grant execute on function public.get_applicable_capital_tariff(integer) to authenticated;

create or replace function public.charge_capital_repair(
  p_property_id bigint,
  p_assessment_id uuid,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  assessment_id uuid,
  amount_eur numeric,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_status text;
  v_row public.capital_repair_ledger%rowtype;
  v_module_enabled boolean;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ')
     and not public.has_staff_role('Р±СѓС…РіР°Р»С‚РµСЂ') then
    raise exception 'Not authorized.';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'capital_repair';
  if v_module_enabled is not true then
    raise exception 'Capital repair module is disabled.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;
  if p_assessment_id is null then
    raise exception 'Assessment not found.';
  end if;

  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year) as r;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.* into v_row
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is distinct from p_assessment_id
       or v_row.kind is distinct from 'charge'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;
    return query
    select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  select a.status into v_status
  from public.capital_repair_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'Assessment not found.';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Assessment is not active.';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = p_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'Capital repair charge already exists for this property and assessment.';
  end if;

  begin
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, p_assessment_id, 'charge', v_amount, v_note, v_email, p_idempotency_key
    )
    returning * into v_row;
  exception
    when unique_violation then
      select l.* into v_row
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;
      if found then
        if v_row.property_id is distinct from p_property_id
           or v_row.assessment_id is distinct from p_assessment_id
           or v_row.kind is distinct from 'charge'
           or v_row.amount_eur is distinct from v_amount
           or v_row.note is distinct from v_note then
          raise exception 'Idempotency key conflict.';
        end if;
      else
        raise exception 'Capital repair charge already exists for this property and assessment.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$fn$;

revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from public;
revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from anon;
grant execute on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) to authenticated;


-- =============================================================================
-- IS-9b вЂ” Safe first-administrator bootstrap (no credentials embedded)
-- =============================================================================
-- Installation owner must:
--   1) Create/invite the Auth user out-of-band (Supabase Auth вЂ” not this package).
--   2) Set approval_token_hash = encode(digest(<plaintext_token>, 'sha256'), 'hex')
--      via a controlled SQL session (service role / install owner).
--   3) Authenticated candidate calls install_bootstrap_claim_first_admin(token, name).
--
-- No passwords. No public unrestricted registration. No automatic privileged users.
-- Fails if an Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ staff row already exists.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.install_bootstrap_state (
  id smallint primary key default 1 check (id = 1),
  approval_token_hash text null,
  approval_note text null,
  approved_at timestamptz null,
  first_admin_staff_id bigint null,
  first_admin_email text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.install_bootstrap_state is
  'Controlled first-admin bootstrap. Token hash set by installation owner; never store plaintext.';

insert into public.install_bootstrap_state (id)
values (1)
on conflict (id) do nothing;

alter table public.install_bootstrap_state enable row level security;

revoke all on table public.install_bootstrap_state from public, anon, authenticated;
-- No SELECT grant to authenticated вЂ” state is install-ops only (service_role / SQL editor).

create or replace function public.install_bootstrap_set_approval(
  p_approval_token text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_approval_token, '')), '');
begin
  -- Callable only by service_role (installation owner session), never by anon/authenticated clients.
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_set_approval: service_role required'
      using errcode = '42501';
  end if;

  if v_token is null or char_length(v_token) < 32 then
    raise exception 'install_bootstrap_set_approval: token must be at least 32 characters'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.staff as s
    where s.role = 'Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ' and s.active is true
  ) then
    raise exception 'install_bootstrap_set_approval: administrator already exists'
      using errcode = 'P0001';
  end if;

  update public.install_bootstrap_state as b
  set approval_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
      approval_note = nullif(btrim(coalesce(p_note, '')), ''),
      approved_at = now(),
      updated_at = now()
  where b.id = 1;
end;
$fn$;

revoke all on function public.install_bootstrap_set_approval(text, text) from public, anon, authenticated;

create or replace function public.install_bootstrap_claim_first_admin(
  p_approval_token text,
  p_display_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_token text := nullif(btrim(coalesce(p_approval_token, '')), '');
  v_hash text;
  v_staff_id bigint;
  v_completed timestamptz;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'install_bootstrap_claim_first_admin: authenticated session with email required'
      using errcode = '28000';
  end if;

  if v_name is null then
    raise exception 'install_bootstrap_claim_first_admin: display name required'
      using errcode = '22023';
  end if;

  if v_token is null then
    raise exception 'install_bootstrap_claim_first_admin: approval token required'
      using errcode = '22023';
  end if;

  select b.approval_token_hash, b.completed_at
    into v_hash, v_completed
  from public.install_bootstrap_state as b
  where b.id = 1
  for update;

  if v_completed is not null then
    raise exception 'install_bootstrap_claim_first_admin: bootstrap already completed'
      using errcode = 'P0001';
  end if;

  if v_hash is null then
    raise exception 'install_bootstrap_claim_first_admin: installation owner has not approved bootstrap'
      using errcode = '42501';
  end if;

  if encode(digest(v_token, 'sha256'), 'hex') is distinct from v_hash then
    raise exception 'install_bootstrap_claim_first_admin: invalid approval token'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.staff as s
    where s.role = 'Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ' and coalesce(s.active, true) is true
  ) then
    raise exception 'install_bootstrap_claim_first_admin: administrator already exists'
      using errcode = 'P0001';
  end if;

  insert into public.staff (name, email, role, active)
  values (v_name, v_email, 'Р°РґРјРёРЅРёСЃС‚СЂР°С†РёСЏ', true)
  returning id into v_staff_id;

  update public.install_bootstrap_state as b
  set first_admin_staff_id = v_staff_id,
      first_admin_email = v_email,
      completed_at = now(),
      approval_token_hash = null,
      updated_at = now()
  where b.id = 1;

  return v_staff_id;
end;
$fn$;

revoke all on function public.install_bootstrap_claim_first_admin(text, text) from public, anon;
grant execute on function public.install_bootstrap_claim_first_admin(text, text) to authenticated;
