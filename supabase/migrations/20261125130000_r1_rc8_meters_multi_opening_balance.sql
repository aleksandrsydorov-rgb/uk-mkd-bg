-- =============================================================================
-- R1-RC8 — Multi active meters per apartment + opening balance (apt+utility)
-- + atomic opening import RPCs (preview checks == commit checks)
-- =============================================================================

begin;

-- Allow multiple active meters of the same utility on one property.
drop index if exists public.water_meters_one_active_per_property_idx;
drop index if exists public.electricity_meters_one_active_per_property_idx;

-- Opening balance once per (property, utility) — DB idempotency.
create unique index if not exists water_ledger_opening_balance_once_idx
  on public.water_ledger (property_id)
  where note = 'opening_balance:water';

create unique index if not exists electricity_ledger_opening_balance_once_idx
  on public.electricity_ledger (property_id)
  where note = 'opening_balance:electricity';

-- ---------------------------------------------------------------------------
-- Opening reading: target a specific meter when multiple actives exist
-- (drop+recreate so 5-arg calls resolve via DEFAULT null).
-- ---------------------------------------------------------------------------

drop function if exists public.register_water_opening_reading(bigint, numeric, date, text, uuid);

create or replace function public.register_water_opening_reading(
  p_property_id bigint,
  p_current_value numeric,
  p_reading_date date,
  p_source_reference text,
  p_idempotency_key uuid,
  p_meter_id uuid default null
)
returns setof public.water_readings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_meter public.water_meters%rowtype;
  v_value numeric(12, 3);
  v_date date;
  v_src text;
  v_existing public.water_readings%rowtype;
  v_today date;
  v_active_count int;
begin
  v_email := public.mtr3_assert_meter_staff();

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;
  if p_current_value is null or p_current_value < 0 then
    raise exception 'Opening reading cannot be negative.';
  end if;

  v_value := round(p_current_value, 3);
  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  if v_src is null then
    raise exception 'Source reference is required.';
  end if;

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_date := coalesce(p_reading_date, v_today);
  if v_date > v_today then
    raise exception 'Reading date cannot be in the future.';
  end if;

  select r.* into v_existing
  from public.water_readings as r
  where r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.property_id is distinct from p_property_id
       or v_existing.current_value is distinct from v_value
       or v_existing.reading_date is distinct from v_date
       or v_existing.reading_kind is distinct from 'opening' then
      raise exception 'Idempotency key conflict.';
    end if;
    return query select r.* from public.water_readings as r where r.id = v_existing.id;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  if p_meter_id is not null then
    select * into v_meter
    from public.water_meters as m
    where m.id = p_meter_id
      and m.property_id = p_property_id
      and m.retired_at is null
    for update;
    if not found then
      raise exception 'No active water meter assigned.';
    end if;
  else
    select count(*)::int into v_active_count
    from public.water_meters as m
    where m.property_id = p_property_id and m.retired_at is null;
    if v_active_count > 1 then
      raise exception 'Meter id required when multiple active water meters exist.';
    end if;
    select * into v_meter
    from public.water_meters as m
    where m.property_id = p_property_id and m.retired_at is null
    order by m.installed_at asc, m.created_at asc
    limit 1
    for update;
    if not found then
      raise exception 'No active water meter assigned.';
    end if;
  end if;

  if v_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  if v_meter.initial_reading is distinct from v_value then
    if exists (
      select 1
      from public.water_readings as r
      join public.water_ledger as l
        on l.reading_id = r.id and l.kind = 'charge'
      where r.meter_id = v_meter.id
    ) then
      raise exception 'Opening reading conflicts with charged meter history.';
    end if;
    update public.water_meters as m
    set initial_reading = v_value
    where m.id = v_meter.id;
  end if;

  begin
    return query
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
      status,
      reading_kind,
      source_reference
    )
    values (
      p_property_id,
      v_meter.id,
      v_date,
      v_value,
      v_value,
      null,
      null,
      0,
      v_email,
      'staff',
      p_idempotency_key,
      'active',
      'opening',
      v_src
    )
    returning *;
  exception
    when unique_violation then
      if exists (
        select 1 from public.water_readings r
        where r.meter_id = v_meter.id
          and r.reading_kind = 'opening' and r.status = 'active'
          and r.idempotency_key is distinct from p_idempotency_key
      ) then
        raise exception 'An active opening water reading already exists for this meter.';
      end if;
      raise exception 'Idempotency key conflict.';
  end;
end;
$fn$;

revoke all on function public.register_water_opening_reading(bigint, numeric, date, text, uuid, uuid) from public, anon;
grant execute on function public.register_water_opening_reading(bigint, numeric, date, text, uuid, uuid) to authenticated;

drop function if exists public.register_electricity_opening_reading(bigint, numeric, numeric, date, text, uuid);

create or replace function public.register_electricity_opening_reading(
  p_property_id bigint,
  p_day_reading numeric,
  p_night_reading numeric,
  p_reading_date date,
  p_source_reference text,
  p_idempotency_key uuid,
  p_meter_id uuid default null
)
returns table (
  day_reading_id bigint,
  night_reading_id bigint,
  property_id bigint,
  meter_id uuid,
  reading_date date,
  day_value numeric,
  night_value numeric
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_meter public.electricity_meters%rowtype;
  v_day numeric(12, 3);
  v_night numeric(12, 3);
  v_date date;
  v_src text;
  v_today date;
  v_day_row public.meter_readings%rowtype;
  v_night_row public.meter_readings%rowtype;
  v_day_id bigint;
  v_night_id bigint;
  v_active_count int;
begin
  v_email := public.mtr3_assert_meter_staff();

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;
  if p_day_reading is null or p_day_reading < 0
     or p_night_reading is null or p_night_reading < 0 then
    raise exception 'Opening reading cannot be negative.';
  end if;

  v_day := round(p_day_reading, 3);
  v_night := round(p_night_reading, 3);
  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  if v_src is null then
    raise exception 'Source reference is required.';
  end if;

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_date := coalesce(p_reading_date, v_today);
  if v_date > v_today then
    raise exception 'Reading date cannot be in the future.';
  end if;

  select d.* into v_day_row
  from public.meter_readings as d
  where d.idempotency_key = p_idempotency_key and d.meter_type = 'electricity_day';
  select n.* into v_night_row
  from public.meter_readings as n
  where n.idempotency_key = p_idempotency_key and n.meter_type = 'electricity_night';

  if v_day_row.id is not null or v_night_row.id is not null then
    if v_day_row.id is null or v_night_row.id is null
       or v_day_row.property_id is distinct from p_property_id
       or v_night_row.property_id is distinct from p_property_id
       or v_day_row.value is distinct from v_day
       or v_night_row.value is distinct from v_night
       or v_day_row.reading_date is distinct from v_date
       or v_day_row.reading_kind is distinct from 'opening' then
      raise exception 'Idempotency key conflict.';
    end if;
    day_reading_id := v_day_row.id;
    night_reading_id := v_night_row.id;
    property_id := p_property_id;
    meter_id := v_day_row.electricity_meter_id;
    reading_date := v_date;
    day_value := v_day;
    night_value := v_night;
    return next;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  if p_meter_id is not null then
    select * into v_meter
    from public.electricity_meters as m
    where m.id = p_meter_id
      and m.property_id = p_property_id
      and m.retired_at is null
    for update;
    if not found then
      raise exception 'No active electricity meter assigned.';
    end if;
  else
    select count(*)::int into v_active_count
    from public.electricity_meters as m
    where m.property_id = p_property_id and m.retired_at is null;
    if v_active_count > 1 then
      raise exception 'Meter id required when multiple active electricity meters exist.';
    end if;
    select * into v_meter
    from public.electricity_meters as m
    where m.property_id = p_property_id and m.retired_at is null
    order by m.installed_at asc, m.created_at asc
    limit 1
    for update;
    if not found then
      raise exception 'No active electricity meter assigned.';
    end if;
  end if;

  if v_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  if v_meter.initial_day_reading is distinct from v_day
     or v_meter.initial_night_reading is distinct from v_night then
    if exists (
      select 1
      from public.meter_readings as r
      join public.electricity_charges as c
        on c.day_reading_id = r.id or c.night_reading_id = r.id
      where r.electricity_meter_id = v_meter.id
    ) then
      raise exception 'Opening reading conflicts with charged meter history.';
    end if;
    update public.electricity_meters as m
    set
      initial_day_reading = v_day,
      initial_night_reading = v_night
    where m.id = v_meter.id;
  end if;

  begin
    insert into public.meter_readings (
      property_id, meter_type, value, reading_date, submitted_by, submitted_source,
      idempotency_key, electricity_meter_id, status, reading_kind, source_reference
    ) values (
      p_property_id, 'electricity_day', v_day, v_date, v_email, 'staff',
      p_idempotency_key, v_meter.id, 'active', 'opening', v_src
    ) returning id into v_day_id;

    insert into public.meter_readings (
      property_id, meter_type, value, reading_date, submitted_by, submitted_source,
      idempotency_key, electricity_meter_id, status, reading_kind, source_reference
    ) values (
      p_property_id, 'electricity_night', v_night, v_date, v_email, 'staff',
      p_idempotency_key, v_meter.id, 'active', 'opening', v_src
    ) returning id into v_night_id;
  exception
    when unique_violation then
      if exists (
        select 1 from public.meter_readings r
        where r.electricity_meter_id = v_meter.id
          and r.reading_kind = 'opening' and r.status = 'active'
          and r.idempotency_key is distinct from p_idempotency_key
      ) then
        raise exception 'An active opening electricity reading already exists for this meter.';
      end if;
      raise exception 'Idempotency key conflict.';
  end;

  day_reading_id := v_day_id;
  night_reading_id := v_night_id;
  property_id := p_property_id;
  meter_id := v_meter.id;
  reading_date := v_date;
  day_value := v_day;
  night_value := v_night;
  return next;
end;
$fn$;

revoke all on function public.register_electricity_opening_reading(bigint, numeric, numeric, date, text, uuid, uuid) from public, anon;
grant execute on function public.register_electricity_opening_reading(bigint, numeric, numeric, date, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- assign_water_meter — allow multiple active meters (serial still unique)
-- ---------------------------------------------------------------------------

create or replace function public.assign_water_meter(
  p_property_id bigint,
  p_meter_number text,
  p_initial_reading numeric,
  p_installed_at date default ((now() at time zone 'Europe/Sofia'))::date
)
returns setof public.water_meters
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_number text;
  v_initial numeric;
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
$fn$;

revoke all on function public.assign_water_meter(bigint, text, numeric, date) from public;
revoke execute on function public.assign_water_meter(bigint, text, numeric, date) from anon;
grant execute on function public.assign_water_meter(bigint, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- assign_electricity_meter — allow multiple active meters
-- ---------------------------------------------------------------------------

create or replace function public.assign_electricity_meter(
  p_property_id bigint,
  p_meter_number text,
  p_initial_day_reading numeric,
  p_initial_night_reading numeric,
  p_installed_at date default ((now() at time zone 'Europe/Sofia'))::date
)
returns setof public.electricity_meters
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_number text;
  v_day numeric;
  v_night numeric;
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

  if p_initial_day_reading is null or p_initial_day_reading < 0 then
    raise exception 'Initial day reading cannot be negative.';
  end if;
  if p_initial_night_reading is null or p_initial_night_reading < 0 then
    raise exception 'Initial night reading cannot be negative.';
  end if;
  v_day := p_initial_day_reading;
  v_night := p_initial_night_reading;

  v_today := (now() at time zone 'Europe/Sofia')::date;
  v_installed := coalesce(p_installed_at, v_today);
  if v_installed > v_today then
    raise exception 'Meter installation date cannot be in the future.';
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

revoke all on function public.assign_electricity_meter(bigint, text, numeric, numeric, date) from public;
revoke execute on function public.assign_electricity_meter(bigint, text, numeric, numeric, date) from anon;
grant execute on function public.assign_electricity_meter(bigint, text, numeric, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening financial balance — per apartment + utility (not per meter)
-- ---------------------------------------------------------------------------

create or replace function public.register_water_opening_balance(
  p_property_id bigint,
  p_kind text,
  p_amount_eur numeric,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind text;
  v_amount numeric(12, 2);
  v_existing uuid;
  v_ledger_kind text;
  v_id uuid;
begin
  perform public.mtr3_assert_meter_staff();

  if p_property_id is null or not exists (
    select 1 from public.properties p where p.id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  v_kind := lower(btrim(coalesce(p_kind, 'zero')));
  if v_kind not in ('zero', 'debt', 'overpayment') then
    raise exception 'opening_balance_kind invalid' using errcode = '22023';
  end if;

  if v_kind = 'zero' then
    return jsonb_build_object('ok', true, 'applied', false, 'kind', 'zero');
  end if;

  v_amount := round(coalesce(p_amount_eur, 0)::numeric, 2);
  if v_amount is null or v_amount <= 0 then
    raise exception 'opening_balance_eur must be positive for debt/overpayment'
      using errcode = '22023';
  end if;

  select l.id into v_existing
  from public.water_ledger as l
  where l.property_id = p_property_id
    and l.note = 'opening_balance:water'
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'idempotent', true,
      'ledger_id', v_existing,
      'kind', v_kind
    );
  end if;

  v_ledger_kind := case when v_kind = 'debt' then 'adjustment_debit' else 'adjustment_credit' end;

  insert into public.water_ledger (
    property_id, kind, amount_eur, note, idempotency_key, recorded_by_email
  ) values (
    p_property_id,
    v_ledger_kind,
    v_amount,
    'opening_balance:water',
    coalesce(p_idempotency_key, gen_random_uuid()),
    nullif(btrim(auth.email()), '')
  )
  on conflict (property_id) where (note = 'opening_balance:water') do nothing
  returning id into v_id;

  if v_id is null then
    select l.id into v_id
    from public.water_ledger as l
    where l.property_id = p_property_id
      and l.note = 'opening_balance:water'
    limit 1;
    return jsonb_build_object(
      'ok', true, 'applied', false, 'idempotent', true, 'ledger_id', v_id, 'kind', v_kind
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'applied', true, 'idempotent', false, 'ledger_id', v_id, 'kind', v_kind, 'amount_eur', v_amount
  );
end;
$fn$;

revoke all on function public.register_water_opening_balance(bigint, text, numeric, uuid) from public, anon;
grant execute on function public.register_water_opening_balance(bigint, text, numeric, uuid) to authenticated;

create or replace function public.register_electricity_opening_balance(
  p_property_id bigint,
  p_kind text,
  p_amount_eur numeric,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind text;
  v_amount numeric(12, 2);
  v_existing uuid;
  v_ledger_kind text;
  v_id uuid;
begin
  perform public.mtr3_assert_meter_staff();

  if p_property_id is null or not exists (
    select 1 from public.properties p where p.id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  v_kind := lower(btrim(coalesce(p_kind, 'zero')));
  if v_kind not in ('zero', 'debt', 'overpayment') then
    raise exception 'opening_balance_kind invalid' using errcode = '22023';
  end if;

  if v_kind = 'zero' then
    return jsonb_build_object('ok', true, 'applied', false, 'kind', 'zero');
  end if;

  v_amount := round(coalesce(p_amount_eur, 0)::numeric, 2);
  if v_amount is null or v_amount <= 0 then
    raise exception 'opening_balance_eur must be positive for debt/overpayment'
      using errcode = '22023';
  end if;

  select l.id into v_existing
  from public.electricity_ledger as l
  where l.property_id = p_property_id
    and l.note = 'opening_balance:electricity'
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'ok', true, 'applied', false, 'idempotent', true, 'ledger_id', v_existing, 'kind', v_kind
    );
  end if;

  v_ledger_kind := case when v_kind = 'debt' then 'adjustment_debit' else 'adjustment_credit' end;

  insert into public.electricity_ledger (
    property_id, kind, amount_eur, note, idempotency_key, recorded_by_email
  ) values (
    p_property_id,
    v_ledger_kind,
    v_amount,
    'opening_balance:electricity',
    coalesce(p_idempotency_key, gen_random_uuid()),
    nullif(btrim(auth.email()), '')
  )
  on conflict (property_id) where (note = 'opening_balance:electricity') do nothing
  returning id into v_id;

  if v_id is null then
    select l.id into v_id
    from public.electricity_ledger as l
    where l.property_id = p_property_id
      and l.note = 'opening_balance:electricity'
    limit 1;
    return jsonb_build_object(
      'ok', true, 'applied', false, 'idempotent', true, 'ledger_id', v_id, 'kind', v_kind
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'applied', true, 'idempotent', false, 'ledger_id', v_id, 'kind', v_kind, 'amount_eur', v_amount
  );
end;
$fn$;

revoke all on function public.register_electricity_opening_balance(bigint, text, numeric, uuid) from public, anon;
grant execute on function public.register_electricity_opening_balance(bigint, text, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic water meters opening import (preview == commit validation)
-- Each row: apartment_number, meter_number, initial_reading, installed_at,
-- optional opening_balance_kind / opening_balance_eur (applied once per apt).
-- ---------------------------------------------------------------------------

create or replace function public.admin_import_water_meters_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_reading numeric;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_existing_meter_id uuid;
  v_result jsonb;
begin
  perform public.admin_assert_module_setup();
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_water_meters_opening: rows array required'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_bal_kind := lower(btrim(coalesce(v_row ->> 'opening_balance_kind', 'zero')));
    if v_bal_kind = '' then v_bal_kind := 'zero'; end if;

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required'
      ));
      continue;
    end if;
    if v_serial is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'required', 'reason', 'meter_number_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if exists (
      select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
        'apartment_number', v_apt, 'meter_number', v_serial
      ));
      continue;
    end if;
    v_seen_serials := array_append(v_seen_serials, v_serial);

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;
    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'unknown_apartment', 'reason', 'unknown_apartment',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_reading := nullif(btrim(coalesce(v_row ->> 'initial_reading', '')), '')::numeric;
    exception when others then
      v_reading := null;
    end;
    if v_reading is null or v_reading < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_installed := null;
    end;
    if v_installed is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_future',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if v_bal_kind <> 'zero' and (v_bal_amt is null or v_bal_amt <= 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    select m.id into v_existing_meter_id
    from public.water_meters as m
    where m.meter_number = v_serial
    limit 1;

    if v_existing_meter_id is not null then
      -- Idempotent skip when same serial already exists (no duplicate create).
      v_skipped := v_skipped + 1;
      if not coalesce(p_dry_run, true)
         and v_bal_kind <> 'zero'
         and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_water_meter(v_prop_id, v_serial, v_reading, v_installed) as m
    limit 1;

    perform public.register_water_opening_reading(
      v_prop_id, v_reading, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    if v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_water_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'water',
    'errors', v_errors,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$fn$;

revoke all on function public.admin_import_water_meters_opening(jsonb, boolean) from public, anon;
grant execute on function public.admin_import_water_meters_opening(jsonb, boolean) to authenticated;

create or replace function public.admin_import_electricity_meters_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_day numeric;
  v_night numeric;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_existing_meter_id uuid;
  v_result jsonb;
begin
  perform public.admin_assert_module_setup();
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_electricity_meters_opening: rows array required'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_bal_kind := lower(btrim(coalesce(v_row ->> 'opening_balance_kind', 'zero')));
    if v_bal_kind = '' then v_bal_kind := 'zero'; end if;

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required'
      ));
      continue;
    end if;
    if v_serial is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'required', 'reason', 'meter_number_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if exists (
      select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    v_seen_serials := array_append(v_seen_serials, v_serial);

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;
    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'unknown_apartment', 'reason', 'unknown_apartment',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_day := nullif(btrim(coalesce(v_row ->> 'initial_day_reading', '')), '')::numeric;
      v_night := nullif(btrim(coalesce(v_row ->> 'initial_night_reading', '')), '')::numeric;
    exception when others then
      v_day := null; v_night := null;
    end;
    if v_day is null or v_day < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_day_reading',
        'code', 'invalid', 'reason', 'initial_day_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if v_night is null or v_night < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_night_reading',
        'code', 'invalid', 'reason', 'initial_night_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_installed := null;
    end;
    if v_installed is null or v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if v_bal_kind <> 'zero' and (v_bal_amt is null or v_bal_amt <= 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    select m.id into v_existing_meter_id
    from public.electricity_meters as m
    where m.meter_number = v_serial
    limit 1;

    if v_existing_meter_id is not null then
      v_skipped := v_skipped + 1;
      if not coalesce(p_dry_run, true)
         and v_bal_kind <> 'zero'
         and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_electricity_meter(
      v_prop_id, v_serial, v_day, v_night, v_installed
    ) as m
    limit 1;

    perform public.register_electricity_opening_reading(
      v_prop_id, v_day, v_night, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    if v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_electricity_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'electricity',
    'errors', v_errors,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$fn$;

revoke all on function public.admin_import_electricity_meters_opening(jsonb, boolean) from public, anon;
grant execute on function public.admin_import_electricity_meters_opening(jsonb, boolean) to authenticated;

commit;
