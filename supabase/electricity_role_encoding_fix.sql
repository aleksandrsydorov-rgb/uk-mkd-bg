-- =============================================================================
-- AMADEUS 11 — electricity role literal encoding fix
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Production currently stored mojibake role literals inside:
--   submit_electricity_reading
--   debug_electricity_auth
-- instead of Unicode:
--   'администрация'
--   'инженер'
--
-- Does NOT change has_staff_role().
-- Does NOT change active / mode / RLS / owner / idempotency logic.
-- Apply in SQL editor as UTF-8. Do not paste through a Latin-1 console.
-- =============================================================================

BEGIN;

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
      and r.id is distinct from v_existing_day.id
    order by r.reading_date desc, r.created_at desc
    limit 1;

    select r.*
      into v_last_night
    from public.meter_readings as r
    where r.property_id = p_property_id
      and r.meter_type = 'electricity_night'
      and r.id is distinct from v_existing_night.id
    order by r.reading_date desc, r.created_at desc
    limit 1;

    v_prev_day := coalesce(v_last_day.value, 0);
    v_prev_night := coalesce(v_last_night.value, 0);

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
  order by r.reading_date desc, r.created_at desc
  limit 1
  for update;

  select r.*
    into v_last_night
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_night'
  order by r.reading_date desc, r.created_at desc
  limit 1
  for update;

  v_prev_day := coalesce(v_last_day.value, 0);
  v_prev_night := coalesce(v_last_night.value, 0);

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

create or replace function public.debug_electricity_auth()
returns table (
  auth_email text,
  auth_uid uuid,
  staff_role text,
  staff_active boolean,
  is_admin boolean,
  is_engineer boolean,
  electricity_mode text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_mode text;
begin
  if v_uid is null then
    return;
  end if;

  select s.role, s.active
    into v_role, v_active
  from public.staff as s
  where v_email is not null
    and lower(btrim(s.email)) = lower(v_email)
  order by (s.active is true) desc, s.id
  limit 1;

  select coalesce(nullif(btrim(bs.electricity_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  return query
  select
    v_email,
    v_uid,
    v_role,
    v_active,
    public.has_staff_role('администрация'),
    public.has_staff_role('инженер'),
    v_mode;
end;
$$;

revoke all on function public.debug_electricity_auth() from public;
revoke all on function public.debug_electricity_auth() from anon;
grant execute on function public.debug_electricity_auth() to authenticated;

COMMIT;
