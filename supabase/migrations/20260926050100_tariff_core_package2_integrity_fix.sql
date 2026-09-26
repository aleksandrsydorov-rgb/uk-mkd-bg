-- Tariff Core Package 2 integrity follow-up.
-- Applied AFTER 20260926050000_tariff_core_package2_cutover.sql.
-- Does NOT edit that applied migration.
--
-- Fixes:
--   B1 water previous baseline ordering (deterministic greatest same-day value)
--   B2 electricity previous baseline ordering (per register / physical meter)
--   B3 electricity idempotent path must not reprice with live Core rates
--   P1 water FOR UPDATE on chosen previous reading
--   P2 electricity FOR UPDATE after deterministic order
--   P3 water charge ledger uses reading idempotency_key (not random uuid)

begin;

-- ---------------------------------------------------------------------------
-- submit_water_reading
-- ---------------------------------------------------------------------------

create or replace function public.submit_water_reading(
  p_property_id bigint,
  p_current_value numeric,
  p_reading_date date,
  p_idempotency_key uuid
)
returns table (
  reading_id uuid,
  property_id bigint,
  meter_id uuid,
  meter_number text,
  reading_date date,
  previous_value numeric,
  current_value numeric,
  consumption_m3 numeric,
  tariff_eur_per_m3 numeric,
  charge_amount_eur numeric,
  charge_created boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_via text;
  v_meter public.water_meters%rowtype;
  v_last public.water_readings%rowtype;
  v_prev numeric;
  v_current numeric(12, 3);
  v_resolved record;
  v_rate numeric;
  v_version_id uuid;
  v_reading public.water_readings%rowtype;
  v_charge_created boolean;
  v_mode text;
  v_is_owner boolean;
  v_is_water_staff boolean;
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

  if p_current_value is null then
    raise exception 'Current reading is required.';
  end if;

  v_current := round(p_current_value, 1);

  if v_current < 0 then
    raise exception 'Current reading cannot be negative.';
  end if;

  if p_reading_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'Reading date cannot be in the future.';
  end if;

  select coalesce(nullif(btrim(bs.water_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  v_is_owner := public.owns_property(p_property_id);
  v_is_water_staff :=
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер');

  if v_mode = 'disabled' then
    raise exception 'Water readings are disabled.';
  elsif v_mode = 'staff_only' then
    if not v_is_water_staff then
      raise exception 'Not authorized.';
    end if;
    v_via := 'staff';
  elsif v_mode = 'owner_and_staff' then
    if v_is_water_staff then
      v_via := 'staff';
    elsif v_is_owner then
      v_via := 'owner';
    else
      raise exception 'Not authorized.';
    end if;
  else
    raise exception 'Not authorized.';
  end if;

  select r.*
    into v_reading
  from public.water_readings as r
  where r.idempotency_key = p_idempotency_key;

  if found then
    if v_reading.property_id is distinct from p_property_id
       or v_reading.current_value is distinct from v_current
       or v_reading.reading_date is distinct from p_reading_date then
      raise exception 'Idempotency key conflict.';
    end if;

    select exists (
      select 1
      from public.water_ledger as l
      where l.reading_id = v_reading.id
        and l.kind = 'charge'
    )
      into v_charge_created;

    return query
    select
      v_reading.id,
      v_reading.property_id,
      v_reading.meter_id,
      m.meter_number,
      v_reading.reading_date,
      v_reading.previous_value,
      v_reading.current_value,
      v_reading.consumption_m3,
      v_reading.tariff_eur_per_m3,
      v_reading.charge_amount_eur,
      coalesce(v_charge_created, false)
    from public.water_meters as m
    where m.id = v_reading.meter_id;

    return;
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  select r.*
    into v_reading
  from public.water_readings as r
  where r.idempotency_key = p_idempotency_key;

  if found then
    if v_reading.property_id is distinct from p_property_id
       or v_reading.current_value is distinct from v_current
       or v_reading.reading_date is distinct from p_reading_date then
      raise exception 'Idempotency key conflict.';
    end if;

    select exists (
      select 1
      from public.water_ledger as l
      where l.reading_id = v_reading.id
        and l.kind = 'charge'
    )
      into v_charge_created;

    return query
    select
      v_reading.id,
      v_reading.property_id,
      v_reading.meter_id,
      m.meter_number,
      v_reading.reading_date,
      v_reading.previous_value,
      v_reading.current_value,
      v_reading.consumption_m3,
      v_reading.tariff_eur_per_m3,
      v_reading.charge_amount_eur,
      coalesce(v_charge_created, false)
    from public.water_meters as m
    where m.id = v_reading.meter_id;

    return;
  end if;

  select *
    into v_meter
  from public.water_meters as m
  where m.property_id = p_property_id
    and m.retired_at is null
  for update;

  if not found then
    raise exception 'No active water meter assigned.';
  end if;

  if p_reading_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  -- Deterministic previous baseline for same physical meter.
  -- Same reading_date: greatest current_value wins.
  select r.*
    into v_last
  from public.water_readings as r
  where r.meter_id = v_meter.id
    and r.status = 'active'
  order by r.reading_date desc, r.current_value desc, r.created_at desc, r.id desc
  limit 1
  for update;

  if found then
    v_prev := round(v_last.current_value, 1);
    if p_reading_date < v_last.reading_date then
      raise exception 'Reading date cannot be earlier than previous reading.';
    end if;
  else
    v_prev := round(v_meter.initial_reading, 1);
  end if;

  if v_current < v_prev then
    raise exception 'Current reading cannot be lower than previous reading.';
  end if;

  select r.* into v_resolved
  from public.resolve_utility_tariff('water', p_reading_date) as r;

  v_version_id := v_resolved.tariff_version_id;
  v_rate := (v_resolved.rates ->> 'base')::numeric;

  begin
    insert into public.water_readings (
      property_id,
      meter_id,
      reading_date,
      previous_value,
      current_value,
      tariff_id,
      tariff_version_id,
      tariff_eur_per_m3,
      submitted_by_email,
      submitted_via,
      idempotency_key,
      status
    )
    values (
      p_property_id,
      v_meter.id,
      p_reading_date,
      v_prev,
      v_current,
      null,
      v_version_id,
      v_rate,
      v_email,
      v_via,
      p_idempotency_key,
      'active'
    )
    returning * into v_reading;
  exception
    when unique_violation then
      select r.*
        into v_reading
      from public.water_readings as r
      where r.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_reading.property_id is distinct from p_property_id
         or v_reading.current_value is distinct from v_current
         or v_reading.reading_date is distinct from p_reading_date then
        raise exception 'Idempotency key conflict.';
      end if;

      select exists (
        select 1
        from public.water_ledger as l
        where l.reading_id = v_reading.id
          and l.kind = 'charge'
      )
        into v_charge_created;

      return query
      select
        v_reading.id,
        v_reading.property_id,
        v_reading.meter_id,
        m.meter_number,
        v_reading.reading_date,
        v_reading.previous_value,
        v_reading.current_value,
        v_reading.consumption_m3,
        v_reading.tariff_eur_per_m3,
        v_reading.charge_amount_eur,
        coalesce(v_charge_created, false)
      from public.water_meters as m
      where m.id = v_reading.meter_id;

      return;
  end;

  v_charge_created := false;

  if v_reading.charge_amount_eur > 0 then
    begin
      insert into public.water_ledger (
        property_id,
        reading_id,
        kind,
        amount_eur,
        recorded_by_email,
        idempotency_key
      )
      values (
        v_reading.property_id,
        v_reading.id,
        'charge',
        v_reading.charge_amount_eur,
        v_email,
        p_idempotency_key
      );
      v_charge_created := true;
    exception
      when unique_violation then
        -- Concurrent/retry path: charge ledger already recorded for this key.
        select exists (
          select 1
          from public.water_ledger as l
          where l.reading_id = v_reading.id
            and l.kind = 'charge'
        )
          into v_charge_created;
    end;
  end if;

  return query
  select
    v_reading.id,
    v_reading.property_id,
    v_reading.meter_id,
    v_meter.meter_number,
    v_reading.reading_date,
    v_reading.previous_value,
    v_reading.current_value,
    v_reading.consumption_m3,
    v_reading.tariff_eur_per_m3,
    v_reading.charge_amount_eur,
    v_charge_created;
end;
$fn$;

revoke all on function public.submit_water_reading(bigint, numeric, date, uuid) from public;
revoke all on function public.submit_water_reading(bigint, numeric, date, uuid) from anon;
grant execute on function public.submit_water_reading(bigint, numeric, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_electricity_reading
-- ---------------------------------------------------------------------------

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
as $fn$
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
  v_resolved record;
  v_version_id uuid;
  v_day_rate numeric;
  v_night_rate numeric;
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

  -- Idempotency BEFORE live tariff resolve (never reprice old ops).
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

    select c.*
      into v_charge
    from public.electricity_charges as c
    where c.idempotency_key = p_idempotency_key;

    if v_charge.id is null then
      raise exception 'Idempotency key conflict: readings exist without charge snapshot.'
        using errcode = '23514';
    end if;

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

  -- Deterministic previous baselines per physical meter + register.
  select r.*
    into v_last_day
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_day'
    and r.electricity_meter_id = v_meter.id
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
  limit 1
  for update;

  select r.*
    into v_last_night
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_night'
    and r.electricity_meter_id = v_meter.id
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
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

  -- Resolve Core tariff only for NEW operations.
  select r.* into v_resolved
  from public.resolve_utility_tariff('electricity', p_reading_date) as r;

  v_version_id := v_resolved.tariff_version_id;
  v_day_rate := (v_resolved.rates ->> 'day')::numeric;
  v_night_rate := (v_resolved.rates ->> 'night')::numeric;

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
  v_day_amt := round(v_cons_day * v_day_rate, 2);
  v_night_amt := round(v_cons_night * v_night_rate, 2);
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
    tariff_version_id,
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
    null,
    v_version_id,
    v_day_rate,
    v_night_rate,
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
$fn$;

revoke all on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) from public;
revoke all on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) from anon;
grant execute on function public.submit_electricity_reading(bigint, numeric, numeric, date, uuid) to authenticated;

commit;
