-- =============================================================================
-- AMADEUS 11 — timezone hotfix (Europe/Sofia local date)
-- =============================================================================
-- CREATE OR REPLACE only for date-validation RPC.
-- Does not change RLS, schemas, other RPC, or EXECUTE security model
-- (REVOKE public/anon, GRANT authenticated — reapplied below).
-- =============================================================================

BEGIN;

create or replace function public.assign_water_meter(
  p_property_id bigint,
  p_meter_number text,
  p_initial_reading numeric,
  p_installed_at date default ((now() at time zone 'Europe/Sofia')::date)
)
returns setof public.water_meters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role text;
  v_number text;
  v_initial numeric;
  v_installed date;
  v_today date;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  v_role := public.water_staff_role();
  if v_role is distinct from 'администрация'
     and v_role is distinct from 'инженер' then
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

  if p_initial_reading is null or p_initial_reading < 0 then
    raise exception 'Initial reading cannot be negative.';
  end if;
  v_initial := p_initial_reading;

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_installed := coalesce(p_installed_at, v_today);

  if v_installed > v_today then
    raise exception 'Meter installation date cannot be in the future.';
  end if;

  if exists (
    select 1
    from public.water_meters as m
    where m.property_id = p_property_id
      and m.retired_at is null
  ) then
    raise exception 'An active water meter is already assigned.';
  end if;

  if exists (
    select 1
    from public.water_meters as m
    where m.meter_number = v_number
  ) then
    raise exception 'Meter number is already in use.';
  end if;

  return query
  insert into public.water_meters (
    property_id,
    meter_number,
    initial_reading,
    installed_at,
    assigned_by_email
  )
  values (
    p_property_id,
    v_number,
    v_initial,
    v_installed,
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.assign_water_meter(bigint, text, numeric, date) from public;
revoke all on function public.assign_water_meter(bigint, text, numeric, date) from anon;
grant execute on function public.assign_water_meter(bigint, text, numeric, date) to authenticated;

-- -----------------------------------------------------------------------------
-- replace_water_meter
-- Roles: администрация, инженер
-- Old row is retired, never deleted.
-- -----------------------------------------------------------------------------

create or replace function public.replace_water_meter(
  p_property_id bigint,
  p_new_meter_number text,
  p_new_initial_reading numeric,
  p_reason text,
  p_installed_at date default ((now() at time zone 'Europe/Sofia')::date)
)
returns setof public.water_meters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role text;
  v_number text;
  v_reason text;
  v_installed date;
  v_today date;
  v_old public.water_meters%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  v_role := public.water_staff_role();
  if v_role is distinct from 'администрация'
     and v_role is distinct from 'инженер' then
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

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Replacement reason is required.';
  end if;

  v_number := btrim(coalesce(p_new_meter_number, ''));
  if v_number = '' then
    raise exception 'Meter number is required.';
  end if;

  if p_new_initial_reading is null or p_new_initial_reading < 0 then
    raise exception 'Initial reading cannot be negative.';
  end if;

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_installed := coalesce(p_installed_at, v_today);

  if v_installed > v_today then
    raise exception 'Meter installation date cannot be in the future.';
  end if;

  select *
    into v_old
  from public.water_meters as m
  where m.property_id = p_property_id
    and m.retired_at is null
  for update;

  if not found then
    raise exception 'No active water meter assigned.';
  end if;

  if v_installed < v_old.installed_at then
    raise exception 'New meter installation date cannot be earlier than the old meter installation date.';
  end if;

  if exists (
    select 1
    from public.water_meters as m
    where m.meter_number = v_number
  ) then
    raise exception 'Meter number is already in use.';
  end if;

  update public.water_meters as m
  set
    retired_at = now(),
    replacement_reason = v_reason
  where m.id = v_old.id;

  return query
  insert into public.water_meters (
    property_id,
    meter_number,
    initial_reading,
    installed_at,
    assigned_by_email
  )
  values (
    p_property_id,
    v_number,
    p_new_initial_reading,
    v_installed,
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.replace_water_meter(bigint, text, numeric, text, date) from public;
revoke all on function public.replace_water_meter(bigint, text, numeric, text, date) from anon;
grant execute on function public.replace_water_meter(bigint, text, numeric, text, date) to authenticated;

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
as $$
declare
  v_email text;
  v_role text;
  v_via text;
  v_meter public.water_meters%rowtype;
  v_last public.water_readings%rowtype;
  v_prev numeric;
  v_current numeric(12, 3);
  v_tariff public.water_tariffs%rowtype;
  v_reading public.water_readings%rowtype;
  v_charge_created boolean;
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

  v_current := round(p_current_value, 3);

  if v_current < 0 then
    raise exception 'Current reading cannot be negative.';
  end if;

  if p_reading_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'Reading date cannot be in the future.';
  end if;

  v_role := public.water_staff_role();

  if public.owns_property(p_property_id) then
    v_via := 'owner';
  elsif v_role in ('администрация', 'бухгалтер', 'инженер') then
    v_via := 'staff';
  else
    raise exception 'Not authorized.';
  end if;

  -- Safe retry only after authorization, and only for the same request payload.
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

  -- Re-check after lock in case a concurrent retry already inserted.
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

  select r.*
    into v_last
  from public.water_readings as r
  where r.meter_id = v_meter.id
    and r.status = 'active'
  order by r.reading_date desc, r.created_at desc
  limit 1;

  if found then
    v_prev := v_last.current_value;
    if p_reading_date < v_last.reading_date then
      raise exception 'Reading date cannot be earlier than previous reading.';
    end if;
  else
    v_prev := v_meter.initial_reading;
  end if;

  if v_current < v_prev then
    raise exception 'Current reading cannot be lower than previous reading.';
  end if;

  select t.*
    into v_tariff
  from public.water_tariffs as t
  where t.valid_from <= p_reading_date
  order by t.valid_from desc
  limit 1;

  if not found then
    raise exception 'No water tariff configured for reading date.';
  end if;

  begin
    insert into public.water_readings (
      property_id,
      meter_id,
      reading_date,
      previous_value,
      current_value,
      tariff_id,
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
      v_tariff.id,
      v_tariff.price_eur_per_m3,
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
      gen_random_uuid()
    );
    v_charge_created := true;
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
$$;

revoke all on function public.submit_water_reading(bigint, numeric, date, uuid) from public;
revoke all on function public.submit_water_reading(bigint, numeric, date, uuid) from anon;
grant execute on function public.submit_water_reading(bigint, numeric, date, uuid) to authenticated;

create or replace function public.create_capital_repair_assessment(
  p_title text,
  p_description text default null,
  p_decision_date date default ((now() at time zone 'Europe/Sofia')::date),
  p_due_date date default null
)
returns setof public.capital_repair_assessments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_title text;
  v_description text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'Title is required.';
  end if;

  if p_decision_date is null then
    raise exception 'Decision date is required.';
  end if;

  if p_decision_date > (now() at time zone 'Europe/Sofia')::date then
    raise exception 'Decision date cannot be in the future.';
  end if;

  if p_due_date is not null and p_due_date < p_decision_date then
    raise exception 'Due date cannot be earlier than decision date.';
  end if;

  v_description := nullif(btrim(coalesce(p_description, '')), '');

  return query
  insert into public.capital_repair_assessments (
    title,
    description,
    decision_date,
    due_date,
    status,
    created_by_email
  )
  values (
    v_title,
    v_description,
    p_decision_date,
    p_due_date,
    'active',
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.create_capital_repair_assessment(text, text, date, date) from public;
revoke all on function public.create_capital_repair_assessment(text, text, date, date) from anon;
grant execute on function public.create_capital_repair_assessment(text, text, date, date) to authenticated;

COMMIT;
