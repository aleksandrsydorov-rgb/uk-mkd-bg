-- =============================================================================
-- AMADEUS 11 — electricity physical meter hotfix
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Role literals must remain 'администрация' / 'инженер'.
-- Does not change water_meters, finance, has_staff_role(), or electricity_mode.
-- =============================================================================

BEGIN;

create table if not exists public.electricity_meters (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  meter_number text not null,
  initial_day_reading numeric(12, 3) not null,
  initial_night_reading numeric(12, 3) not null,
  installed_at date not null,
  retired_at date null,
  replacement_reason text null,
  assigned_by_email text not null,
  created_at timestamptz not null default now(),
  constraint electricity_meters_meter_number_not_blank
    check (length(trim(meter_number)) > 0),
  constraint electricity_meters_initial_day_nonneg
    check (initial_day_reading >= 0),
  constraint electricity_meters_initial_night_nonneg
    check (initial_night_reading >= 0),
  constraint electricity_meters_assigned_by_not_blank
    check (length(trim(assigned_by_email)) > 0),
  constraint electricity_meters_meter_number_key
    unique (meter_number)
);

comment on table public.electricity_meters is
  'Physical electricity meters (one device, day+night registers). Retired meters stay for history; at most one active per property.';

create unique index if not exists electricity_meters_one_active_per_property_idx
  on public.electricity_meters (property_id)
  where retired_at is null;

alter table public.meter_readings
  add column if not exists electricity_meter_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meter_readings_electricity_meter_id_fkey'
  ) then
    alter table public.meter_readings
      add constraint meter_readings_electricity_meter_id_fkey
      foreign key (electricity_meter_id)
      references public.electricity_meters (id)
      on delete restrict;
  end if;
end $$;

create index if not exists meter_readings_electricity_meter_id_idx
  on public.meter_readings (electricity_meter_id);

alter table public.electricity_meters enable row level security;

revoke all on table public.electricity_meters from public;
revoke all on table public.electricity_meters from anon;
revoke all on table public.electricity_meters from authenticated;
grant select on table public.electricity_meters to authenticated;

drop policy if exists electricity_meters_select on public.electricity_meters;
create policy electricity_meters_select
on public.electricity_meters
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.has_staff_role('инженер')
);

-- -----------------------------------------------------------------------------
-- assign_electricity_meter
-- Roles: администрация, инженер
-- -----------------------------------------------------------------------------

create or replace function public.assign_electricity_meter(
  p_property_id bigint,
  p_meter_number text,
  p_initial_day_reading numeric,
  p_initial_night_reading numeric,
  p_installed_at date
)
returns setof public.electricity_meters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_number text;
  v_day numeric(12, 3);
  v_night numeric(12, 3);
  v_installed date;
  v_today date;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('инженер') then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  v_number := btrim(coalesce(p_meter_number, ''));
  if v_number = '' then
    raise exception 'Meter number is required.';
  end if;

  if p_initial_day_reading is null or p_initial_day_reading < 0
     or p_initial_night_reading is null or p_initial_night_reading < 0 then
    raise exception 'Initial reading cannot be negative.';
  end if;
  v_day := round(p_initial_day_reading, 3);
  v_night := round(p_initial_night_reading, 3);

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_installed := coalesce(p_installed_at, v_today);

  if v_installed > v_today then
    raise exception 'Meter installation date cannot be in the future.';
  end if;

  if exists (
    select 1
    from public.electricity_meters as m
    where m.property_id = p_property_id
      and m.retired_at is null
  ) then
    raise exception 'An active electricity meter is already assigned.';
  end if;

  if exists (
    select 1
    from public.electricity_meters as m
    where m.meter_number = v_number
  ) then
    raise exception 'Meter number is already in use.';
  end if;

  return query
  insert into public.electricity_meters (
    property_id,
    meter_number,
    initial_day_reading,
    initial_night_reading,
    installed_at,
    assigned_by_email
  )
  values (
    p_property_id,
    v_number,
    v_day,
    v_night,
    v_installed,
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.assign_electricity_meter(bigint, text, numeric, numeric, date) from public;
revoke all on function public.assign_electricity_meter(bigint, text, numeric, numeric, date) from anon;
grant execute on function public.assign_electricity_meter(bigint, text, numeric, numeric, date) to authenticated;

-- -----------------------------------------------------------------------------
-- replace_electricity_meter
-- Roles: администрация, инженер
-- Old row is retired, never deleted. Readings are not reassigned.
-- -----------------------------------------------------------------------------

create or replace function public.replace_electricity_meter(
  p_property_id bigint,
  p_new_meter_number text,
  p_initial_day_reading numeric,
  p_initial_night_reading numeric,
  p_installed_at date,
  p_replacement_reason text
)
returns setof public.electricity_meters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_number text;
  v_reason text;
  v_day numeric(12, 3);
  v_night numeric(12, 3);
  v_installed date;
  v_today date;
  v_old public.electricity_meters%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('инженер') then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  v_reason := btrim(coalesce(p_replacement_reason, ''));
  if v_reason = '' then
    raise exception 'Replacement reason is required.';
  end if;

  v_number := btrim(coalesce(p_new_meter_number, ''));
  if v_number = '' then
    raise exception 'Meter number is required.';
  end if;

  if p_initial_day_reading is null or p_initial_day_reading < 0
     or p_initial_night_reading is null or p_initial_night_reading < 0 then
    raise exception 'Initial reading cannot be negative.';
  end if;
  v_day := round(p_initial_day_reading, 3);
  v_night := round(p_initial_night_reading, 3);

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_installed := coalesce(p_installed_at, v_today);

  if v_installed > v_today then
    raise exception 'Meter installation date cannot be in the future.';
  end if;

  select *
    into v_old
  from public.electricity_meters as m
  where m.property_id = p_property_id
    and m.retired_at is null
  for update;

  if not found then
    raise exception 'No active electricity meter assigned.';
  end if;

  if v_installed < v_old.installed_at then
    raise exception 'New meter installation date cannot be earlier than the old meter installation date.';
  end if;

  if exists (
    select 1
    from public.electricity_meters as m
    where m.meter_number = v_number
  ) then
    raise exception 'Meter number is already in use.';
  end if;

  update public.electricity_meters as m
  set
    retired_at = v_installed,
    replacement_reason = v_reason
  where m.id = v_old.id;

  return query
  insert into public.electricity_meters (
    property_id,
    meter_number,
    initial_day_reading,
    initial_night_reading,
    installed_at,
    assigned_by_email
  )
  values (
    p_property_id,
    v_number,
    v_day,
    v_night,
    v_installed,
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.replace_electricity_meter(bigint, text, numeric, numeric, date, text) from public;
revoke all on function public.replace_electricity_meter(bigint, text, numeric, numeric, date, text) from anon;
grant execute on function public.replace_electricity_meter(bigint, text, numeric, numeric, date, text) to authenticated;

create or replace function public.submit_electricity_reading(
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
  submitted_source text
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
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер');

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

    return query
    select
      v_existing_day.id,
      v_existing_night.id,
      p_property_id,
      p_reading_date,
      v_prev_day,
      v_existing_day.value,
      v_existing_day.value - v_prev_day,
      v_prev_night,
      v_existing_night.value,
      v_existing_night.value - v_prev_night,
      coalesce(v_existing_day.submitted_source, v_via);
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

  return query
  select
    v_day_id,
    v_night_id,
    p_property_id,
    p_reading_date,
    v_prev_day,
    v_day,
    v_day - v_prev_day,
    v_prev_night,
    v_night,
    v_night - v_prev_night,
    v_via;
end;
$$;

revoke all on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) from public;
revoke all on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) from anon;
grant execute on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) to authenticated;

COMMIT;
