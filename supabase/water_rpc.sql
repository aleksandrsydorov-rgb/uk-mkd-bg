-- =============================================================================
-- AMADEUS 11 — water RPC (SECURITY DEFINER)
-- =============================================================================
-- Writes go through these functions only. Tables stay SELECT-only for
-- authenticated. Does not change support_fee, meter_readings, properties
-- debt/overpayment, existing helpers, or RLS.
--
-- Empty staff.role is NOT treated as администрация.
-- Role is read from public.staff, never from the client.
-- =============================================================================

-- Internal helper. Not a business RPC. No EXECUTE for authenticated.
create or replace function public.water_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(lower(btrim(s.role)), '')
  from public.staff as s
  where lower(btrim(s.email)) = lower(btrim(auth.email()))
    and s.active is true
  limit 1;
$$;

revoke all on function public.water_staff_role() from public;
revoke all on function public.water_staff_role() from anon;
revoke all on function public.water_staff_role() from authenticated;

-- -----------------------------------------------------------------------------
-- assign_water_meter
-- Roles: администрация, инженер
-- -----------------------------------------------------------------------------

create or replace function public.assign_water_meter(
  p_property_id bigint,
  p_meter_number text,
  p_initial_reading numeric,
  p_installed_at date default current_date
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

  v_installed := coalesce(p_installed_at, current_date);

  if v_installed > current_date then
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
  p_installed_at date default current_date
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

  v_installed := coalesce(p_installed_at, current_date);

  if v_installed > current_date then
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

-- -----------------------------------------------------------------------------
-- set_water_tariff
-- Roles: администрация, бухгалтер
-- Immutable history: INSERT only, never UPDATE.
-- -----------------------------------------------------------------------------

create or replace function public.set_water_tariff(
  p_price_eur_per_m3 numeric,
  p_valid_from date,
  p_note text default null
)
returns setof public.water_tariffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  v_role := public.water_staff_role();
  if v_role is distinct from 'администрация'
     and v_role is distinct from 'бухгалтер' then
    raise exception 'Not authorized.';
  end if;

  if p_price_eur_per_m3 is null or p_price_eur_per_m3 < 0 then
    raise exception 'Tariff price cannot be negative.';
  end if;

  if p_valid_from is null then
    raise exception 'Tariff valid_from is required.';
  end if;

  if exists (
    select 1
    from public.water_tariffs as t
    where t.valid_from = p_valid_from
  ) then
    raise exception 'A water tariff already exists for this valid_from date.';
  end if;

  return query
  insert into public.water_tariffs (
    price_eur_per_m3,
    valid_from,
    note,
    created_by_email
  )
  values (
    p_price_eur_per_m3,
    p_valid_from,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.set_water_tariff(numeric, date, text) from public;
revoke all on function public.set_water_tariff(numeric, date, text) from anon;
grant execute on function public.set_water_tariff(numeric, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- submit_water_reading
-- Owner of the property, or staff role администрация / бухгалтер / инженер.
-- Cleaner is denied. Client does not send meter/previous/tariff/amount.
-- -----------------------------------------------------------------------------

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

  if p_reading_date > current_date then
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

-- -----------------------------------------------------------------------------
-- record_water_payment
-- Roles: администрация, бухгалтер
-- -----------------------------------------------------------------------------

create or replace function public.record_water_payment(
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
  v_role text;
  v_amount numeric;
  v_note text;
  v_row public.water_ledger%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  v_role := public.water_staff_role();
  if v_role is distinct from 'администрация'
     and v_role is distinct from 'бухгалтер' then
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
  from public.water_ledger as l
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
    insert into public.water_ledger (
      property_id,
      reading_id,
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
      from public.water_ledger as l
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

revoke all on function public.record_water_payment(bigint, numeric, text, uuid) from public;
revoke all on function public.record_water_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_water_payment(bigint, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- get_water_balance
-- Owner of the property, or staff role администрация / бухгалтер.
-- Engineer and cleaner are denied. Balance is derived from ledger.
-- -----------------------------------------------------------------------------

create or replace function public.get_water_balance(
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
  v_role text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  v_role := public.water_staff_role();

  if not public.owns_property(p_property_id)
     and v_role is distinct from 'администрация'
     and v_role is distinct from 'бухгалтер' then
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
    )::numeric(12, 2)
  from public.water_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_water_balance(bigint) from public;
revoke all on function public.get_water_balance(bigint) from anon;
grant execute on function public.get_water_balance(bigint) to authenticated;

-- =============================================================================
-- SECURITY TEST MATRIX (run after this file is applied; not executed here)
-- =============================================================================
-- OWNER A:
--   submit_water_reading own property → ALLOW
--   submit_water_reading property B → DENY
--   known idempotency key of property B → DENY (authorization first)
--   same key / same property / same payload → existing result
--   same key / same property / different current_value → IDEMPOTENCY CONFLICT
--   same key / same property / different reading_date → IDEMPOTENCY CONFLICT
--   set_water_tariff → DENY
--   assign_water_meter → DENY
--   replace_water_meter → DENY
--   record_water_payment → DENY
--   get_water_balance own → ALLOW
--   get_water_balance B → DENY
--
-- ADMIN (администрация):
--   assign_water_meter → ALLOW
--   replace_water_meter → ALLOW
--   set_water_tariff → ALLOW
--   submit_water_reading → ALLOW
--   record_water_payment → ALLOW
--   get_water_balance any property → ALLOW
--
-- ACCOUNTANT (бухгалтер):
--   assign_water_meter → DENY
--   replace_water_meter → DENY
--   set_water_tariff → ALLOW
--   submit_water_reading → ALLOW (staff)
--   record_water_payment → ALLOW
--   get_water_balance → ALLOW
--
-- PAYMENT:
--   same key + same amount/note → existing result
--   same key + different amount → IDEMPOTENCY CONFLICT
--   same key + different note → IDEMPOTENCY CONFLICT
--
-- ENGINEER (инженер):
--   assign_water_meter / replace_water_meter → ALLOW
--   set_water_tariff → DENY
--   record_water_payment → DENY
--   submit_water_reading → ALLOW
--   get_water_balance → DENY
--
-- CLEANER (уборщик):
--   assign / replace → DENY
--   set_water_tariff → DENY
--   record_water_payment → DENY
--   submit_water_reading → DENY  (not treated as generic is_staff)
--   get_water_balance → DENY
--
-- Writes are RPC-only. No reverse/adjustment RPC in this file.
-- =============================================================================
