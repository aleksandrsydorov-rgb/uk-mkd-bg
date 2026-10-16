-- =============================================================================
-- IS-9b — Utilities readings + ledgers (canonical DDL, no price seeds)
-- =============================================================================
-- Sources: water_capital_schema, electricity_finance_hotfix, electricity_submit_hotfix,
--          database.types meter_readings shape.
-- Does NOT seed AMADEUS 11 water/electricity tariff prices.
-- Writes remain RPC-only (SELECT grants + RLS).
-- =============================================================================

-- Water tariffs shell (empty — admin publishes via Tariff Core / legacy path later)
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
  'Water price history. Fresh-install: empty — no seeded prices.';

create table if not exists public.water_readings (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  meter_id uuid not null,
  reading_date date not null,
  previous_value numeric(12, 3) not null,
  current_value numeric(12, 3) not null,
  -- nullable tariff_id: opening inventarisation rows (MTR-3) use tariff_eur_per_m3 = 0
  tariff_id uuid null,
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
  reading_kind text not null default 'operational',
  source_reference text null,
  corrects_reading_id uuid null,
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
  constraint water_readings_reading_kind_check
    check (reading_kind in ('opening', 'operational', 'correction')),
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
create unique index if not exists water_readings_one_active_opening_per_meter_idx
  on public.water_readings (meter_id)
  where reading_kind = 'opening' and status = 'active';

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
  status text not null default 'active',
  reading_kind text not null default 'operational',
  source_reference text null,
  corrects_reading_id bigint null,
  reversed_at timestamptz null,
  reversed_by_email text null,
  reversal_reason text null,
  constraint meter_readings_submitted_source_chk
    check (submitted_source is null or submitted_source in ('owner', 'staff', 'system')),
  constraint meter_readings_status_check
    check (status in ('active', 'reversed')),
  constraint meter_readings_reading_kind_check
    check (reading_kind in ('opening', 'operational', 'correction'))
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
  'Electricity day/night price history. Fresh-install: empty — no AMADEUS 11 price seed.';

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
      or public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
      or public.has_staff_role('инженер')
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
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
        or public.has_staff_role('инженер')
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
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
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
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
        or public.has_staff_role('инженер')
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
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
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
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
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
      or public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
      or public.has_staff_role('инженер')
    );
  end if;
end $$;
