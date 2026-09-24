import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';
const ACCOUNTANT = '\u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440';
const ENGINEER = '\u0438\u043d\u0436\u0435\u043d\u0435\u0440';

const hotfix = `-- =============================================================================
-- AMADEUS 11 — electricity finance (tariffs, charges, ledger, RPC)
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Source of truth for day/night prices is public.electricity_tariffs (immutable rows).
-- Does not backfill charges for legacy meter_readings.
-- Does not alter water / support fee / capital repair.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. TARIFFS
-- -----------------------------------------------------------------------------
create table if not exists public.electricity_tariffs (
  id uuid primary key default gen_random_uuid(),
  day_price_eur_per_kwh numeric(12, 4) not null,
  night_price_eur_per_kwh numeric(12, 4) not null,
  valid_from date not null,
  note text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint electricity_tariffs_day_price_nonneg
    check (day_price_eur_per_kwh >= 0),
  constraint electricity_tariffs_night_price_nonneg
    check (night_price_eur_per_kwh >= 0),
  constraint electricity_tariffs_valid_from_key
    unique (valid_from),
  constraint electricity_tariffs_id_prices_key
    unique (id, day_price_eur_per_kwh, night_price_eur_per_kwh)
);

comment on table public.electricity_tariffs is
  'Immutable electricity day/night price history. Snapshot copied onto electricity_charges.';

insert into public.electricity_tariffs (
  day_price_eur_per_kwh,
  night_price_eur_per_kwh,
  valid_from,
  note,
  created_by_email
)
values (
  0.1400,
  0.0900,
  date '2026-01-01',
  'AMADEUS 11 initial day/night tariffs',
  'system@amadeus11'
)
on conflict (valid_from) do nothing;

-- -----------------------------------------------------------------------------
-- 2. CHARGE DETAIL (billing record for one day+night meter_readings pair)
-- Linked by idempotency_key. Does not alter meter_readings schema.
-- -----------------------------------------------------------------------------
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

comment on table public.electricity_charges is
  'Server-side electricity billing snapshot for one meter_readings pair. No backfill of legacy readings.';

-- -----------------------------------------------------------------------------
-- 3. LEDGER
-- -----------------------------------------------------------------------------
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
  constraint electricity_ledger_amount_positive
    check (amount_eur > 0),
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

comment on table public.electricity_ledger is
  'Electricity subledger. Balance is derived. Do not mix with water_ledger or support_fee_ledger.';

create unique index if not exists electricity_ledger_one_charge_per_charge_idx
  on public.electricity_ledger (charge_id)
  where kind = 'charge';

create index if not exists electricity_ledger_property_created_idx
  on public.electricity_ledger (property_id, created_at desc);

create index if not exists electricity_charges_property_date_idx
  on public.electricity_charges (property_id, reading_date desc, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. RLS / GRANTS — SELECT only. Writes via RPC.
-- -----------------------------------------------------------------------------
alter table public.electricity_tariffs enable row level security;
alter table public.electricity_charges enable row level security;
alter table public.electricity_ledger enable row level security;

revoke all on table public.electricity_tariffs from public;
revoke all on table public.electricity_tariffs from anon;
revoke all on table public.electricity_tariffs from authenticated;
grant select on table public.electricity_tariffs to authenticated;

revoke all on table public.electricity_charges from public;
revoke all on table public.electricity_charges from anon;
revoke all on table public.electricity_charges from authenticated;
grant select on table public.electricity_charges to authenticated;

revoke all on table public.electricity_ledger from public;
revoke all on table public.electricity_ledger from anon;
revoke all on table public.electricity_ledger from authenticated;
grant select on table public.electricity_ledger to authenticated;

drop policy if exists electricity_tariffs_select on public.electricity_tariffs;
create policy electricity_tariffs_select
on public.electricity_tariffs
for select
to authenticated
using (
  public.is_owner()
  or public.has_staff_role('${ADMIN}')
  or public.has_staff_role('${ACCOUNTANT}')
  or public.has_staff_role('${ENGINEER}')
);

drop policy if exists electricity_charges_select on public.electricity_charges;
create policy electricity_charges_select
on public.electricity_charges
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('${ADMIN}')
  or public.has_staff_role('${ACCOUNTANT}')
);

drop policy if exists electricity_ledger_select on public.electricity_ledger;
create policy electricity_ledger_select
on public.electricity_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('${ADMIN}')
  or public.has_staff_role('${ACCOUNTANT}')
);

-- -----------------------------------------------------------------------------
-- 5. set_electricity_tariff — ${ADMIN} / ${ACCOUNTANT} — INSERT only
-- -----------------------------------------------------------------------------
create or replace function public.set_electricity_tariff(
  p_day_price_eur_per_kwh numeric,
  p_night_price_eur_per_kwh numeric,
  p_valid_from date,
  p_note text default null
)
returns setof public.electricity_tariffs
language plpgsql
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

  if not public.has_staff_role('${ADMIN}')
     and not public.has_staff_role('${ACCOUNTANT}') then
    raise exception 'Not authorized.';
  end if;

  if p_day_price_eur_per_kwh is null or p_day_price_eur_per_kwh < 0
     or p_night_price_eur_per_kwh is null or p_night_price_eur_per_kwh < 0 then
    raise exception 'Tariff price cannot be negative.';
  end if;

  if p_valid_from is null then
    raise exception 'Tariff valid_from is required.';
  end if;

  if exists (
    select 1
    from public.electricity_tariffs as t
    where t.valid_from = p_valid_from
  ) then
    raise exception 'An electricity tariff already exists for this valid_from date.';
  end if;

  return query
  insert into public.electricity_tariffs (
    day_price_eur_per_kwh,
    night_price_eur_per_kwh,
    valid_from,
    note,
    created_by_email
  )
  values (
    round(p_day_price_eur_per_kwh, 4),
    round(p_night_price_eur_per_kwh, 4),
    p_valid_from,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.set_electricity_tariff(numeric, numeric, date, text) from public;
revoke all on function public.set_electricity_tariff(numeric, numeric, date, text) from anon;
grant execute on function public.set_electricity_tariff(numeric, numeric, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. submit_electricity_reading — atomic readings + optional charge/ledger
-- Client does not send previous/consumption/tariff/amount.
-- DROP required: return type extended with finance columns.
-- -----------------------------------------------------------------------------
drop function if exists public.submit_electricity_reading(bigint, numeric, numeric, date, uuid);

create function public.submit_electricity_reading(
  p_property_id bigint,
  p_day_reading numeric,
  p_night_reading numeric,
  p_reading_date date,
  p_idempotency_key uuid
)
returns table (
  day_reading_id bigint,
  night_reading_id bigint,
  property_id bigint,
  reading_date date,
  previous_day numeric,
  current_day numeric,
  consumption_day numeric,
  previous_night numeric,
  current_night numeric,
  consumption_night numeric,
  submitted_source text,
  day_tariff_eur_per_kwh numeric,
  night_tariff_eur_per_kwh numeric,
  day_amount_eur numeric,
  night_amount_eur numeric,
  total_amount_eur numeric,
  charge_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_mode text;
  v_is_owner boolean;
  v_is_el_staff boolean;
  v_via text;
  v_day numeric(12, 3);
  v_night numeric(12, 3);
  v_prev_day numeric;
  v_prev_night numeric;
  v_last_day public.meter_readings%rowtype;
  v_last_night public.meter_readings%rowtype;
  v_existing_day public.meter_readings%rowtype;
  v_existing_night public.meter_readings%rowtype;
  v_day_id bigint;
  v_night_id bigint;
  v_now timestamptz := now();
  v_meter public.electricity_meters%rowtype;
  v_tariff public.electricity_tariffs%rowtype;
  v_charge public.electricity_charges%rowtype;
  v_cons_day numeric;
  v_cons_night numeric;
  v_day_amt numeric(12, 2);
  v_night_amt numeric(12, 2);
  v_total numeric(12, 2);
  v_charge_created boolean := false;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if p_reading_date is null then
    raise exception 'Reading date is required.';
  end if;

  if p_day_reading is null or p_night_reading is null then
    raise exception 'Current reading is required.';
  end if;

  v_day := round(p_day_reading, 3);
  v_night := round(p_night_reading, 3);

  if v_day < 0 or v_night < 0 then
    raise exception 'Current reading cannot be negative.';
  end if;

  if p_reading_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'Reading date cannot be in the future.';
  end if;

  select coalesce(nullif(btrim(bs.electricity_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  v_is_owner := public.owns_property(p_property_id);
  v_is_el_staff :=
    public.has_staff_role('${ADMIN}')
    or public.has_staff_role('${ENGINEER}');

  if v_mode = 'disabled' then
    raise exception 'Electricity readings are disabled.';
  elsif v_mode = 'staff_only' then
    if not v_is_el_staff then
      raise exception 'Not authorized.';
    end if;
    v_via := 'staff';
  elsif v_mode = 'owner_and_staff' then
    if v_is_el_staff then
      v_via := 'staff';
    elsif v_is_owner then
      v_via := 'owner';
    else
      raise exception 'Not authorized.';
    end if;
  else
    raise exception 'Not authorized.';
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  select m.*
    into v_meter
  from public.electricity_meters as m
  where m.property_id = p_property_id
    and m.retired_at is null
  for update;

  if not found then
    raise exception 'Electricity meter is not assigned.';
  end if;

  if p_reading_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  select t.*
    into v_tariff
  from public.electricity_tariffs as t
  where t.valid_from <= p_reading_date
  order by t.valid_from desc
  limit 1;

  if not found then
    raise exception 'No electricity tariff is defined for this reading date.';
  end if;

  select d.*
    into v_existing_day
  from public.meter_readings as d
  where d.idempotency_key = p_idempotency_key
    and d.meter_type = 'electricity_day';

  select n.*
    into v_existing_night
  from public.meter_readings as n
  where n.idempotency_key = p_idempotency_key
    and n.meter_type = 'electricity_night';

  if v_existing_day.id is not null or v_existing_night.id is not null then
    if v_existing_day.id is null or v_existing_night.id is null
       or v_existing_day.property_id is distinct from p_property_id
       or v_existing_night.property_id is distinct from p_property_id
       or v_existing_day.value is distinct from v_day
       or v_existing_night.value is distinct from v_night
       or v_existing_day.reading_date is distinct from p_reading_date
       or v_existing_night.reading_date is distinct from p_reading_date then
      raise exception 'Idempotency key conflict.';
    end if;

    select r.*
      into v_last_day
    from public.meter_readings as r
    where r.property_id = p_property_id
      and r.meter_type = 'electricity_day'
      and r.electricity_meter_id = v_meter.id
      and r.id is distinct from v_existing_day.id
    order by r.reading_date desc, r.created_at desc
    limit 1;

    select r.*
      into v_last_night
    from public.meter_readings as r
    where r.property_id = p_property_id
      and r.meter_type = 'electricity_night'
      and r.electricity_meter_id = v_meter.id
      and r.id is distinct from v_existing_night.id
    order by r.reading_date desc, r.created_at desc
    limit 1;

    v_prev_day := coalesce(v_last_day.value, v_meter.initial_day_reading);
    v_prev_night := coalesce(v_last_night.value, v_meter.initial_night_reading);

    select c.*
      into v_charge
    from public.electricity_charges as c
    where c.idempotency_key = p_idempotency_key;

    if v_charge.id is not null then
      v_charge_created := exists (
        select 1
        from public.electricity_ledger as l
        where l.charge_id = v_charge.id
          and l.kind = 'charge'
      );
      return query
      select
        v_existing_day.id,
        v_existing_night.id,
        p_property_id,
        p_reading_date,
        v_charge.previous_day,
        v_charge.current_day,
        v_charge.consumption_day,
        v_charge.previous_night,
        v_charge.current_night,
        v_charge.consumption_night,
        coalesce(v_existing_day.submitted_source, v_via),
        v_charge.day_tariff_eur_per_kwh,
        v_charge.night_tariff_eur_per_kwh,
        v_charge.day_amount_eur,
        v_charge.night_amount_eur,
        v_charge.total_amount_eur,
        v_charge_created;
      return;
    end if;

    v_cons_day := v_existing_day.value - v_prev_day;
    v_cons_night := v_existing_night.value - v_prev_night;

    return query
    select
      v_existing_day.id,
      v_existing_night.id,
      p_property_id,
      p_reading_date,
      v_prev_day,
      v_existing_day.value,
      v_cons_day,
      v_prev_night,
      v_existing_night.value,
      v_cons_night,
      coalesce(v_existing_day.submitted_source, v_via),
      v_tariff.day_price_eur_per_kwh,
      v_tariff.night_price_eur_per_kwh,
      round(v_cons_day * v_tariff.day_price_eur_per_kwh, 2),
      round(v_cons_night * v_tariff.night_price_eur_per_kwh, 2),
      round(v_cons_day * v_tariff.day_price_eur_per_kwh, 2)
        + round(v_cons_night * v_tariff.night_price_eur_per_kwh, 2),
      false;
    return;
  end if;

  select r.*
    into v_last_day
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_day'
    and r.electricity_meter_id = v_meter.id
  order by r.reading_date desc, r.created_at desc
  limit 1
  for update;

  select r.*
    into v_last_night
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_night'
    and r.electricity_meter_id = v_meter.id
  order by r.reading_date desc, r.created_at desc
  limit 1
  for update;

  if v_last_day.id is null then
    v_prev_day := v_meter.initial_day_reading;
  else
    v_prev_day := v_last_day.value;
  end if;

  if v_last_night.id is null then
    v_prev_night := v_meter.initial_night_reading;
  else
    v_prev_night := v_last_night.value;
  end if;

  if v_last_day.reading_date is not null and p_reading_date < v_last_day.reading_date then
    raise exception 'Reading date cannot be earlier than previous reading.';
  end if;

  if v_last_night.reading_date is not null and p_reading_date < v_last_night.reading_date then
    raise exception 'Reading date cannot be earlier than previous reading.';
  end if;

  if v_day < v_prev_day then
    raise exception 'Current reading cannot be lower than previous.';
  end if;

  if v_night < v_prev_night then
    raise exception 'Current reading cannot be lower than previous.';
  end if;

  insert into public.meter_readings (
    property_id,
    meter_type,
    value,
    reading_date,
    submitted_by,
    submitted_source,
    idempotency_key,
    electricity_meter_id,
    created_at
  )
  values (
    p_property_id,
    'electricity_day',
    v_day,
    p_reading_date,
    v_email,
    v_via,
    p_idempotency_key,
    v_meter.id,
    v_now
  )
  returning id into v_day_id;

  insert into public.meter_readings (
    property_id,
    meter_type,
    value,
    reading_date,
    submitted_by,
    submitted_source,
    idempotency_key,
    electricity_meter_id,
    created_at
  )
  values (
    p_property_id,
    'electricity_night',
    v_night,
    p_reading_date,
    v_email,
    v_via,
    p_idempotency_key,
    v_meter.id,
    v_now
  )
  returning id into v_night_id;

  v_cons_day := v_day - v_prev_day;
  v_cons_night := v_night - v_prev_night;
  v_day_amt := round(v_cons_day * v_tariff.day_price_eur_per_kwh, 2);
  v_night_amt := round(v_cons_night * v_tariff.night_price_eur_per_kwh, 2);
  v_total := v_day_amt + v_night_amt;

  insert into public.electricity_charges (
    property_id,
    day_reading_id,
    night_reading_id,
    reading_date,
    previous_day,
    current_day,
    previous_night,
    current_night,
    tariff_id,
    day_tariff_eur_per_kwh,
    night_tariff_eur_per_kwh,
    recorded_by_email,
    idempotency_key
  )
  values (
    p_property_id,
    v_day_id,
    v_night_id,
    p_reading_date,
    v_prev_day,
    v_day,
    v_prev_night,
    v_night,
    v_tariff.id,
    v_tariff.day_price_eur_per_kwh,
    v_tariff.night_price_eur_per_kwh,
    v_email,
    p_idempotency_key
  )
  returning * into v_charge;

  if v_charge.total_amount_eur > 0 then
    insert into public.electricity_ledger (
      property_id,
      charge_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    )
    values (
      p_property_id,
      v_charge.id,
      'charge',
      v_charge.total_amount_eur,
      null,
      v_email,
      p_idempotency_key
    );
    v_charge_created := true;
  end if;

  return query
  select
    v_day_id,
    v_night_id,
    p_property_id,
    p_reading_date,
    v_charge.previous_day,
    v_charge.current_day,
    v_charge.consumption_day,
    v_charge.previous_night,
    v_charge.current_night,
    v_charge.consumption_night,
    v_via,
    v_charge.day_tariff_eur_per_kwh,
    v_charge.night_tariff_eur_per_kwh,
    v_charge.day_amount_eur,
    v_charge.night_amount_eur,
    v_charge.total_amount_eur,
    v_charge_created;
end;
$$;

revoke all on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) from public;
revoke all on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) from anon;
grant execute on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. record_electricity_payment — ${ADMIN} / ${ACCOUNTANT}
-- Engineer / cleaner / owner: DENY
-- -----------------------------------------------------------------------------
create or replace function public.record_electricity_payment(
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
  v_row public.electricity_ledger%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('${ADMIN}')
     and not public.has_staff_role('${ACCOUNTANT}') then
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
  from public.electricity_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
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
    insert into public.electricity_ledger (
      property_id,
      charge_id,
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
      from public.electricity_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_row.property_id is distinct from p_property_id
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

revoke all on function public.record_electricity_payment(bigint, numeric, text, uuid) from public;
revoke all on function public.record_electricity_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_electricity_payment(bigint, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. get_electricity_balance — owner own property; ${ADMIN} / ${ACCOUNTANT}
-- -----------------------------------------------------------------------------
create or replace function public.get_electricity_balance(
  p_property_id bigint
)
returns table (
  charged_eur numeric,
  paid_eur numeric,
  adjustments_debit_eur numeric,
  adjustments_credit_eur numeric,
  balance_eur numeric,
  debt_eur numeric,
  overpayment_eur numeric
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
     and not public.has_staff_role('${ADMIN}')
     and not public.has_staff_role('${ACCOUNTANT}') then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1
    from public.properties as p
    where p.id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  return query
  select
    coalesce(sum(l.amount_eur) filter (where l.kind = 'charge'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'payment'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'adjustment_debit'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'adjustment_credit'), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
      - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
    )::numeric(12, 2),
    greatest(
      (
        coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
        - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
      ),
      0
    )::numeric(12, 2),
    greatest(
      -(
        coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
        - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
      ),
      0
    )::numeric(12, 2)
  from public.electricity_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_electricity_balance(bigint) from public;
revoke all on function public.get_electricity_balance(bigint) from anon;
grant execute on function public.get_electricity_balance(bigint) to authenticated;

commit;
`;

const verify = `-- =============================================================================
-- AMADEUS 11 — electricity finance verification (READ ONLY)
-- Encoding: UTF-8 (no BOM). Does not CREATE/ALTER/DROP/GRANT/INSERT/UPDATE.
-- =============================================================================

with defs as (
  select
    to_regclass('public.electricity_tariffs') as tariffs_rel,
    to_regclass('public.electricity_charges') as charges_rel,
    to_regclass('public.electricity_ledger') as ledger_rel,
    to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') as submit_oid,
    to_regprocedure('public.set_electricity_tariff(numeric, numeric, date, text)') as tariff_oid,
    to_regprocedure('public.record_electricity_payment(bigint, numeric, text, uuid)') as pay_oid,
    to_regprocedure('public.get_electricity_balance(bigint)') as bal_oid
),
src as (
  select
    d.*,
    case when d.submit_oid is not null then pg_get_functiondef(d.submit_oid) else '' end as submit_def,
    case when d.tariff_oid is not null then pg_get_functiondef(d.tariff_oid) else '' end as tariff_def,
    case when d.pay_oid is not null then pg_get_functiondef(d.pay_oid) else '' end as pay_def,
    case when d.bal_oid is not null then pg_get_functiondef(d.bal_oid) else '' end as bal_def
  from defs as d
),
checks as (
  select 'exists'::text as check_type, 'electricity_tariffs'::text as item,
    case when tariffs_rel is not null then 'OK' else 'FAIL' end as result
  from src
  union all
  select 'exists', 'electricity_charges',
    case when charges_rel is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'electricity_ledger',
    case when ledger_rel is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'submit_electricity_reading',
    case when submit_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'set_electricity_tariff',
    case when tariff_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'record_electricity_payment',
    case when pay_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'get_electricity_balance',
    case when bal_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'column', 'electricity_tariffs.day_price_eur_per_kwh',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'electricity_tariffs'
        and column_name = 'day_price_eur_per_kwh'
    ) then 'OK' else 'FAIL' end
  union all
  select 'column', 'electricity_tariffs.night_price_eur_per_kwh',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'electricity_tariffs'
        and column_name = 'night_price_eur_per_kwh'
    ) then 'OK' else 'FAIL' end
  union all
  select 'unique', 'electricity_tariffs.valid_from',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_tariffs'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%valid_from%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'unique', 'electricity_charges.idempotency_key',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_charges'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%idempotency_key%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'unique', 'electricity_ledger.idempotency_key',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_ledger'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%idempotency_key%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'rls_enabled', 'electricity_tariffs',
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_tariffs' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end
  union all
  select 'rls_enabled', 'electricity_charges',
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_charges' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end
  union all
  select 'rls_enabled', 'electricity_ledger',
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_ledger' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end
  union all
  select 'no_write_policy', 'electricity_finance_tables',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename in ('electricity_tariffs', 'electricity_charges', 'electricity_ledger')
        and cmd <> 'SELECT'
    ) then 'FAIL' else 'OK' end
  union all
  select 'select_grant', 'electricity_tariffs',
    case when has_table_privilege('authenticated', 'public.electricity_tariffs', 'select') then 'OK' else 'FAIL' end
  union all
  select 'no_authenticated_write', 'electricity_tariffs',
    case when has_table_privilege('authenticated', 'public.electricity_tariffs', 'insert')
      or has_table_privilege('authenticated', 'public.electricity_tariffs', 'update')
      or has_table_privilege('authenticated', 'public.electricity_tariffs', 'delete')
    then 'FAIL' else 'OK' end
  union all
  select 'no_authenticated_write', 'electricity_charges',
    case when has_table_privilege('authenticated', 'public.electricity_charges', 'insert')
      or has_table_privilege('authenticated', 'public.electricity_charges', 'update')
      or has_table_privilege('authenticated', 'public.electricity_charges', 'delete')
    then 'FAIL' else 'OK' end
  union all
  select 'no_authenticated_write', 'electricity_ledger',
    case when has_table_privilege('authenticated', 'public.electricity_ledger', 'insert')
      or has_table_privilege('authenticated', 'public.electricity_ledger', 'update')
      or has_table_privilege('authenticated', 'public.electricity_ledger', 'delete')
    then 'FAIL' else 'OK' end
  union all
  select 'no_anon_table', 'electricity_tariffs',
    case when has_table_privilege('anon', 'public.electricity_tariffs', 'select')
      or has_table_privilege('anon', 'public.electricity_tariffs', 'insert')
    then 'FAIL' else 'OK' end
  union all
  select 'no_anon_table', 'electricity_charges',
    case when has_table_privilege('anon', 'public.electricity_charges', 'select')
      or has_table_privilege('anon', 'public.electricity_charges', 'insert')
    then 'FAIL' else 'OK' end
  union all
  select 'no_anon_table', 'electricity_ledger',
    case when has_table_privilege('anon', 'public.electricity_ledger', 'select')
      or has_table_privilege('anon', 'public.electricity_ledger', 'insert')
    then 'FAIL' else 'OK' end
  union all
  select 'execute_authenticated', 'submit_electricity_reading',
    case when submit_oid is not null
      and has_function_privilege('authenticated', submit_oid, 'execute')
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'no_anon_execute', 'submit_electricity_reading',
    case when submit_oid is null then 'FAIL'
      when has_function_privilege('anon', submit_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_anon_execute', 'record_electricity_payment',
    case when pay_oid is null then 'FAIL'
      when has_function_privilege('anon', pay_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_anon_execute', 'get_electricity_balance',
    case when bal_oid is null then 'FAIL'
      when has_function_privilege('anon', bal_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_anon_execute', 'set_electricity_tariff',
    case when tariff_oid is null then 'FAIL'
      when has_function_privilege('anon', tariff_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_public_execute', 'electricity_finance_rpcs',
    case when exists (
      select 1 from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name in (
          'submit_electricity_reading',
          'set_electricity_tariff',
          'record_electricity_payment',
          'get_electricity_balance'
        )
        and grantee = 'PUBLIC'
        and privilege_type = 'EXECUTE'
    ) then 'FAIL' else 'OK' end
  union all
  select 'submit_tariff_snapshot', 'submit_electricity_reading',
    case when submit_def ilike '%electricity_tariffs%'
      and submit_def ilike '%valid_from <= p_reading_date%'
      and submit_def ilike '%electricity_charges%'
      and submit_def ilike '%electricity_ledger%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'submit_server_calc', 'submit_electricity_reading',
    case when submit_def ilike '%round(v_cons_day * v_tariff.day_price_eur_per_kwh, 2)%'
      and submit_def ilike '%round(v_cons_night * v_tariff.night_price_eur_per_kwh, 2)%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'zero_consumption_no_ledger', 'submit_electricity_reading',
    case when submit_def ilike '%total_amount_eur > 0%'
      and submit_def ilike '%insert into public.electricity_ledger%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'no_backfill', 'submit_electricity_reading',
    case when submit_def ilike '%insert into public.electricity_charges%'
      and submit_def not ilike '%from public.meter_readings%backfill%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'payment_roles', 'record_electricity_payment',
    case when pay_def like '%has_staff_role(''${ADMIN}'')%'
      and pay_def like '%has_staff_role(''${ACCOUNTANT}'')%'
      and pay_def not like '%has_staff_role(''${ENGINEER}'')%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'tariff_roles', 'set_electricity_tariff',
    case when tariff_def like '%has_staff_role(''${ADMIN}'')%'
      and tariff_def like '%has_staff_role(''${ACCOUNTANT}'')%'
      and tariff_def not like '%has_staff_role(''${ENGINEER}'')%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'balance_roles', 'get_electricity_balance',
    case when bal_def like '%owns_property%'
      and bal_def like '%has_staff_role(''${ADMIN}'')%'
      and bal_def like '%has_staff_role(''${ACCOUNTANT}'')%'
      and bal_def not like '%has_staff_role(''${ENGINEER}'')%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'utf8_role_admin', 'record_electricity_payment',
    case when position('${ADMIN}' in pay_def) > 0
      and octet_length('${ADMIN}') = char_length('${ADMIN}') * 2
      and position(chr(65533) in pay_def) = 0
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'utf8_role_accountant', 'get_electricity_balance',
    case when position('${ACCOUNTANT}' in bal_def) > 0
      and octet_length('${ACCOUNTANT}') = char_length('${ACCOUNTANT}') * 2
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'utf8_role_engineer_submit', 'submit_electricity_reading',
    case when position('${ENGINEER}' in submit_def) > 0
      and octet_length('${ENGINEER}') = char_length('${ENGINEER}') * 2
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'no_mojibake', 'finance_rpcs',
    case when position(chr(65533) in submit_def || pay_def || tariff_def || bal_def) > 0
    then 'FAIL' else 'OK' end
  from src
)
select check_type, item, result
from checks
order by
  case when result = 'FAIL' then 0 else 1 end,
  check_type,
  item;
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
writeFileSync(join(dir, 'electricity_finance_hotfix.sql'), hotfix, { encoding: 'utf8' });
writeFileSync(join(dir, 'electricity_finance_verify.sql'), verify, { encoding: 'utf8' });

function assertUtf8(label, s) {
  for (const word of [ADMIN, ACCOUNTANT, ENGINEER]) {
    if (!s.includes(word)) throw new Error(`${label} missing ${word}`);
  }
  if (s.includes('\uFFFD')) throw new Error(`${label} replacement char`);
}
assertUtf8('hotfix', hotfix);
assertUtf8('verify', verify);
console.log('wrote electricity_finance_hotfix.sql and electricity_finance_verify.sql');
console.log('admin bytes', Buffer.from(ADMIN, 'utf8').toString('hex'));
