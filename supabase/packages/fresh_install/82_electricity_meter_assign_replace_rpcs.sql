-- =============================================================================
-- MTR-2 — Electricity meter assign / replace packaging (Distribution R1.0)
-- =============================================================================
-- Canonical source: live cloud klowacuvufknbrkayjhz (matches
-- supabase/legacy/DO_NOT_RUN/electricity_meter_hotfix.sql assign/replace bodies).
-- Additive create-or-replace only. Does NOT recreate tables, rewrite submit_*,
-- or touch finance ledgers. No seed data. No published tariffs.
-- Prerequisites: public.electricity_meters, public.properties, public.has_staff_role.
-- =============================================================================

begin;

-- Fail closed if prerequisites missing (greenfield package must create table first).
do $pre$
begin
  if to_regclass('public.electricity_meters') is null then
    raise exception 'mtr2: public.electricity_meters missing — apply meter DDL first';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'mtr2: public.has_staff_role(text) missing — apply auth helpers first';
  end if;
  if to_regclass('public.properties') is null then
    raise exception 'mtr2: public.properties missing';
  end if;
end;
$pre$;

-- -----------------------------------------------------------------------------
-- assign_electricity_meter
-- Roles: администрация, инженер
-- Inventarisation only — does not insert meter_readings or ledger charges.
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
as $fn$
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
$fn$;

revoke all on function public.assign_electricity_meter(bigint, text, numeric, numeric, date)
  from public;
revoke all on function public.assign_electricity_meter(bigint, text, numeric, numeric, date)
  from anon;
grant execute on function public.assign_electricity_meter(bigint, text, numeric, numeric, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- replace_electricity_meter
-- Roles: администрация, инженер
-- Old row is retired (never deleted). Readings stay on old meter_id.
-- Does not create charges or payments.
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
as $fn$
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
$fn$;

revoke all on function public.replace_electricity_meter(bigint, text, numeric, numeric, date, text)
  from public;
revoke all on function public.replace_electricity_meter(bigint, text, numeric, numeric, date, text)
  from anon;
grant execute on function public.replace_electricity_meter(bigint, text, numeric, numeric, date, text)
  to authenticated;

commit;
