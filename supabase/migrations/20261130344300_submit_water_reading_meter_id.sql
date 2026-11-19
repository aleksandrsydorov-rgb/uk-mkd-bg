-- AMADEUS 11 - submit_water_reading: optional p_meter_id for multi-meter apartments.
-- Keeps 4-arg compatible call (DEFAULT NULL). One active meter OK; several without p_meter_id -> clear error.
-- Does not change tariff/charge rules. Does not rebind historical readings.

DROP FUNCTION IF EXISTS public.submit_water_reading(bigint, numeric, date, uuid);
DROP FUNCTION IF EXISTS public.submit_water_reading(bigint, numeric, date, uuid, uuid);

CREATE OR REPLACE FUNCTION public.submit_water_reading(p_property_id bigint, p_current_value numeric, p_reading_date date, p_idempotency_key uuid, p_meter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(reading_id uuid, property_id bigint, meter_id uuid, meter_number text, reading_date date, previous_value numeric, current_value numeric, consumption_m3 numeric, tariff_eur_per_m3 numeric, charge_amount_eur numeric, charge_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $BODY$
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
  v_meter_count integer;
begin

  perform public.assert_building_module_workplace_ready('water');  v_email := nullif(btrim(auth.email()), '');
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
    elsif public.guest_has_action(p_property_id, 'water.submit_readings') then
      v_via := 'guest';
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
       or v_reading.reading_date is distinct from p_reading_date
       or (p_meter_id is not null and v_reading.meter_id is distinct from p_meter_id) then
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
       or v_reading.reading_date is distinct from p_reading_date
       or (p_meter_id is not null and v_reading.meter_id is distinct from p_meter_id) then
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

  if p_meter_id is not null then
    select *
      into v_meter
    from public.water_meters as m
    where m.id = p_meter_id
      and m.property_id = p_property_id
      and m.retired_at is null
    for update;

    if not found then
      raise exception 'Water meter not found for property.';
    end if;
  else
    select count(*)::integer
      into v_meter_count
    from public.water_meters as m
    where m.property_id = p_property_id
      and m.retired_at is null;

    if v_meter_count = 0 then
      raise exception 'No active water meter assigned.';
    end if;

    if v_meter_count > 1 then
      raise exception 'Multiple active water meters; meter_id is required.';
    end if;

    select *
      into v_meter
    from public.water_meters as m
    where m.property_id = p_property_id
      and m.retired_at is null
    for update;
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
       or v_reading.reading_date is distinct from p_reading_date
       or (p_meter_id is not null and v_reading.meter_id is distinct from p_meter_id) then
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
$BODY$;

REVOKE ALL ON FUNCTION public.submit_water_reading(bigint, numeric, date, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_water_reading(bigint, numeric, date, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_water_reading(bigint, numeric, date, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
