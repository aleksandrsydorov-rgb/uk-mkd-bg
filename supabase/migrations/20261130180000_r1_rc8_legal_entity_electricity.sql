-- =============================================================================
-- R1-RC8 — Legal-entity electricity readings wait for a UK calculation
-- =============================================================================
-- Electricity of a legal-entity apartment is stored as a reading and is not
-- charged from the general natural-person tariff. An administration or engineer
-- staff member confirms per-reading rates. Those rates do not publish a tariff
-- version and do not change the complex tariff.
--
-- Mixed natural + legal ownership cannot be created. Rows that are already mixed
-- stay as they are and cannot be calculated. Sole traders stay natural.
-- Water, support fee, capital repair, and internet are unchanged.
-- Does not rewrite old readings, payments, charges, or the open first-run install.
-- =============================================================================

begin;

alter table public.electricity_charges
  add column if not exists calculation_basis text not null default 'tariff';

alter table public.electricity_charges
  drop constraint if exists electricity_charges_calculation_basis_check;

alter table public.electricity_charges
  add constraint electricity_charges_calculation_basis_check
  check (calculation_basis in ('tariff', 'legal_reading'));

comment on column public.electricity_charges.calculation_basis is
  'tariff: amount came from the general tariff snapshot. legal_reading: amount came from rates confirmed for this reading. Later tariff or owner changes do not rewrite the row.';

do $dup$
begin
  if exists (
    select 1
    from public.electricity_charges
    group by day_reading_id
    having count(*) > 1
  ) or exists (
    select 1
    from public.electricity_charges
    group by night_reading_id
    having count(*) > 1
  ) then
    raise exception 'electricity_charges: duplicate reading links exist';
  end if;
end
$dup$;

create unique index if not exists electricity_charges_day_reading_id_uidx
  on public.electricity_charges (day_reading_id);

create unique index if not exists electricity_charges_night_reading_id_uidx
  on public.electricity_charges (night_reading_id);

create or replace function public.electricity_charges_reject_mutation()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'DELETE'
     and current_setting('app.electricity_charge_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'electricity_charges: confirmed snapshot is immutable'
    using errcode = '55000';
end;
$fn$;

drop trigger if exists electricity_charges_immutable_trg on public.electricity_charges;
create trigger electricity_charges_immutable_trg
  before update or delete on public.electricity_charges
  for each row
  execute function public.electricity_charges_reject_mutation();

-- ---------------------------------------------------------------------------
-- Owner composition. Does not replace property_tariff_subject_kind.
-- sole_trader counts as natural. ЕТ stays natural via that same rule.
-- ---------------------------------------------------------------------------

create or replace function public.property_ownership_composition(p_property_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_legal integer := 0;
  v_natural integer := 0;
  v_other integer := 0;
  v_owner_type text;
begin
  select
    count(*) filter (where r.entity_kind = 'legal_entity'),
    count(*) filter (where r.entity_kind in ('natural_person', 'sole_trader')),
    count(*) filter (
      where r.entity_kind is null
         or r.entity_kind not in ('legal_entity', 'natural_person', 'sole_trader')
    )
  into v_legal, v_natural, v_other
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;

  if v_other > 0 then
    return 'unknown';
  end if;
  if v_legal > 0 and v_natural > 0 then
    return 'mixed';
  end if;
  if v_legal > 0 then
    return 'legal';
  end if;
  if v_natural > 0 then
    return 'natural';
  end if;

  select nullif(btrim(coalesce(p.owner_type, '')), '')
    into v_owner_type
  from public.properties as p
  where p.id = p_property_id;

  if v_owner_type is not null
     and v_owner_type ~* 'юр|legal|company|ооо|еоод|ад' then
    return 'legal';
  end if;
  return 'natural';
end;
$fn$;

revoke all on function public.property_ownership_composition(bigint) from public, anon;
grant execute on function public.property_ownership_composition(bigint) to authenticated;

create or replace function public.electricity_register_baseline(p_reading_id bigint)
returns table (
  previous_value numeric,
  previous_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_reading public.meter_readings%rowtype;
  v_meter public.electricity_meters%rowtype;
begin
  select r.*
    into v_reading
  from public.meter_readings as r
  where r.id = p_reading_id;

  if v_reading.id is null then
    previous_value := null;
    previous_date := null;
    return next;
    return;
  end if;

  select prev.value, prev.reading_date
    into previous_value, previous_date
  from public.meter_readings as prev
  where prev.property_id = v_reading.property_id
    and prev.meter_type = v_reading.meter_type
    and prev.electricity_meter_id is not distinct from v_reading.electricity_meter_id
    and coalesce(prev.status, 'active') = 'active'
    and prev.id <> v_reading.id
    and (
      prev.reading_date < v_reading.reading_date
      or (prev.reading_date = v_reading.reading_date and prev.id < v_reading.id)
    )
  order by prev.reading_date desc, prev.id desc
  limit 1;

  if previous_value is not null then
    return next;
    return;
  end if;

  select m.*
    into v_meter
  from public.electricity_meters as m
  where m.id = v_reading.electricity_meter_id;

  if v_reading.meter_type = 'electricity_night' then
    previous_value := coalesce(v_meter.initial_night_reading, 0);
  else
    previous_value := coalesce(v_meter.initial_day_reading, 0);
  end if;
  previous_date := v_meter.installed_at;
  return next;
end;
$fn$;

revoke all on function public.electricity_register_baseline(bigint) from public, anon;

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
      -- A reading pair without a charge is pending. Replay must not invent a tariff charge,
      -- even when ownership later changes.
      select b.previous_value
        into v_prev_day
      from public.electricity_register_baseline(v_existing_day.id) as b;
      select b.previous_value
        into v_prev_night
      from public.electricity_register_baseline(v_existing_night.id) as b;
      if v_prev_day is null then
        v_prev_day := v_existing_day.value;
      end if;
      if v_prev_night is null then
        v_prev_night := v_existing_night.value;
      end if;
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
        coalesce(v_existing_day.submitted_source, v_via),
        null::numeric,
        null::numeric,
        null::numeric,
        null::numeric,
        null::numeric,
        false;
      return;
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
    and coalesce(r.status, 'active') = 'active'
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
  limit 1
  for update;

  select r.*
    into v_last_night
  from public.meter_readings as r
  where r.property_id = p_property_id
    and r.meter_type = 'electricity_night'
    and r.electricity_meter_id = v_meter.id
    and coalesce(r.status, 'active') = 'active'
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

  if public.property_ownership_composition(p_property_id) in ('legal', 'mixed', 'unknown') then
    -- Legal, mixed, and unknown apartments store the reading only.
    -- The general natural-person tariff is not applied and no debt is posted.
    insert into public.meter_readings (
      property_id, meter_type, value, reading_date, submitted_by, submitted_source,
      idempotency_key, electricity_meter_id, created_at
    ) values (
      p_property_id, 'electricity_day', v_day, p_reading_date, v_email, v_via,
      p_idempotency_key, v_meter.id, v_now
    )
    returning id into v_day_id;

    insert into public.meter_readings (
      property_id, meter_type, value, reading_date, submitted_by, submitted_source,
      idempotency_key, electricity_meter_id, created_at
    ) values (
      p_property_id, 'electricity_night', v_night, p_reading_date, v_email, v_via,
      p_idempotency_key, v_meter.id, v_now
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
      v_via,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric,
      false;
    return;
  end if;

  -- Resolve Core tariff only for NEW natural-person operations.
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

-- ---------------------------------------------------------------------------
-- Quote and confirm. The client total is not an argument.
-- ---------------------------------------------------------------------------

create or replace function public.electricity_assert_rate(p_rate numeric)
returns numeric
language plpgsql
immutable
as $fn$
begin
  if p_rate is null then
    raise exception 'electricity: rate is required' using errcode = '22023';
  end if;
  if p_rate < 0 then
    raise exception 'electricity: rate cannot be negative' using errcode = '22023';
  end if;
  if abs(p_rate - round(p_rate, 4)) > 0.0000001 then
    raise exception 'electricity: rate precision is 0.0001' using errcode = '22023';
  end if;
  return round(p_rate, 4);
end;
$fn$;

revoke all on function public.electricity_assert_rate(numeric) from public, anon;

create or replace function public.quote_electricity_legal_charge(
  p_day_reading_id bigint,
  p_night_reading_id bigint,
  p_day_rate numeric,
  p_night_rate numeric
)
returns table (
  consumption_day numeric,
  consumption_night numeric,
  day_amount_eur numeric,
  night_amount_eur numeric,
  total_amount_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_day public.meter_readings%rowtype;
  v_night public.meter_readings%rowtype;
  v_prev_day numeric;
  v_prev_night numeric;
  v_day_rate numeric;
  v_night_rate numeric;
  v_composition text;
  v_charge public.electricity_charges%rowtype;
begin
  if nullif(btrim(auth.email()), '') is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('инженер') then
    raise exception 'Not authorized.';
  end if;

  v_day_rate := public.electricity_assert_rate(p_day_rate);
  v_night_rate := public.electricity_assert_rate(p_night_rate);

  select r.* into v_day from public.meter_readings as r where r.id = p_day_reading_id;
  select r.* into v_night from public.meter_readings as r where r.id = p_night_reading_id;
  if v_day.id is null or v_night.id is null
     or v_day.meter_type is distinct from 'electricity_day'
     or v_night.meter_type is distinct from 'electricity_night'
     or v_day.property_id is distinct from v_night.property_id
     or v_day.idempotency_key is distinct from v_night.idempotency_key then
    raise exception 'electricity: readings are not a pair' using errcode = '22023';
  end if;

  select c.*
    into v_charge
  from public.electricity_charges as c
  where c.day_reading_id = v_day.id
     or c.night_reading_id = v_night.id
  limit 1;
  if v_charge.id is not null then
    consumption_day := v_charge.consumption_day;
    consumption_night := v_charge.consumption_night;
    day_amount_eur := v_charge.day_amount_eur;
    night_amount_eur := v_charge.night_amount_eur;
    total_amount_eur := v_charge.total_amount_eur;
    return next;
    return;
  end if;

  v_composition := public.property_ownership_composition(v_day.property_id);
  if v_composition = 'mixed' then
    raise exception 'electricity: mixed natural and legal entity cannot be calculated'
      using errcode = '22023';
  elsif v_composition = 'unknown' then
    raise exception 'electricity: owner type cannot be determined'
      using errcode = '22023';
  elsif v_composition is distinct from 'legal' then
    raise exception 'electricity: legal-entity calculation does not apply'
      using errcode = '22023';
  end if;

  select b.previous_value into v_prev_day
  from public.electricity_register_baseline(v_day.id) as b;
  select b.previous_value into v_prev_night
  from public.electricity_register_baseline(v_night.id) as b;

  consumption_day := v_day.value - v_prev_day;
  consumption_night := v_night.value - v_prev_night;
  day_amount_eur := round(consumption_day * v_day_rate, 2);
  night_amount_eur := round(consumption_night * v_night_rate, 2);
  total_amount_eur := day_amount_eur + night_amount_eur;
  return next;
end;
$fn$;

revoke all on function public.quote_electricity_legal_charge(bigint, bigint, numeric, numeric) from public, anon;
grant execute on function public.quote_electricity_legal_charge(bigint, bigint, numeric, numeric) to authenticated;

create or replace function public.confirm_electricity_legal_charge(
  p_day_reading_id bigint,
  p_night_reading_id bigint,
  p_day_rate numeric,
  p_night_rate numeric,
  p_idempotency_key uuid
)
returns table (
  charge_id uuid,
  property_id bigint,
  day_reading_id bigint,
  night_reading_id bigint,
  day_tariff_eur_per_kwh numeric,
  night_tariff_eur_per_kwh numeric,
  day_amount_eur numeric,
  night_amount_eur numeric,
  total_amount_eur numeric,
  charge_created boolean,
  recorded_by_email text,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_day public.meter_readings%rowtype;
  v_night public.meter_readings%rowtype;
  v_charge public.electricity_charges%rowtype;
  v_prev_day numeric;
  v_prev_night numeric;
  v_day_rate numeric;
  v_night_rate numeric;
  v_composition text;
  v_inserted boolean := false;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('инженер') then
    raise exception 'Not authorized.';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  v_day_rate := public.electricity_assert_rate(p_day_rate);
  v_night_rate := public.electricity_assert_rate(p_night_rate);

  select r.*
    into v_day
  from public.meter_readings as r
  where r.id = p_day_reading_id
  for update;
  select r.*
    into v_night
  from public.meter_readings as r
  where r.id = p_night_reading_id
  for update;

  if v_day.id is null or v_night.id is null
     or v_day.meter_type is distinct from 'electricity_day'
     or v_night.meter_type is distinct from 'electricity_night'
     or v_day.property_id is distinct from v_night.property_id
     or v_day.electricity_meter_id is distinct from v_night.electricity_meter_id
     or v_day.reading_date is distinct from v_night.reading_date
     or v_day.idempotency_key is distinct from v_night.idempotency_key then
    raise exception 'electricity: readings are not a pair' using errcode = '22023';
  end if;
  if coalesce(v_day.status, 'active') is distinct from 'active'
     or coalesce(v_night.status, 'active') is distinct from 'active' then
    raise exception 'reading is not active' using errcode = '22023';
  end if;
  if v_day.reading_kind = 'opening' or v_night.reading_kind = 'opening' then
    raise exception 'electricity: opening readings are not charged here'
      using errcode = '22023';
  end if;

  perform 1
  from public.properties as p
  where p.id = v_day.property_id
  for update;

  select c.*
    into v_charge
  from public.electricity_charges as c
  where c.day_reading_id = v_day.id
     or c.night_reading_id = v_night.id
  for update;

  if v_charge.id is not null then
    if v_charge.day_tariff_eur_per_kwh is distinct from v_day_rate
       or v_charge.night_tariff_eur_per_kwh is distinct from v_night_rate then
      raise exception 'electricity: confirmed rates cannot be changed'
        using errcode = '55000';
    end if;
    return query
    select
      v_charge.id,
      v_charge.property_id,
      v_charge.day_reading_id,
      v_charge.night_reading_id,
      v_charge.day_tariff_eur_per_kwh,
      v_charge.night_tariff_eur_per_kwh,
      v_charge.day_amount_eur,
      v_charge.night_amount_eur,
      v_charge.total_amount_eur,
      false,
      v_charge.recorded_by_email,
      v_charge.created_at;
    return;
  end if;

  v_composition := public.property_ownership_composition(v_day.property_id);
  if v_composition = 'mixed' then
    raise exception 'electricity: mixed natural and legal entity cannot be calculated'
      using errcode = '22023';
  elsif v_composition = 'unknown' then
    raise exception 'electricity: owner type cannot be determined'
      using errcode = '22023';
  elsif v_composition is distinct from 'legal' then
    raise exception 'electricity: legal-entity calculation does not apply'
      using errcode = '22023';
  end if;

  select b.previous_value into v_prev_day
  from public.electricity_register_baseline(v_day.id) as b;
  select b.previous_value into v_prev_night
  from public.electricity_register_baseline(v_night.id) as b;
  if v_day.value < v_prev_day or v_night.value < v_prev_night then
    raise exception 'Current reading cannot be lower than previous.';
  end if;

  begin
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
      idempotency_key,
      calculation_basis
    ) values (
      v_day.property_id,
      v_day.id,
      v_night.id,
      v_day.reading_date,
      v_prev_day,
      v_day.value,
      v_prev_night,
      v_night.value,
      null,
      null,
      v_day_rate,
      v_night_rate,
      v_email,
      p_idempotency_key,
      'legal_reading'
    )
    returning * into v_charge;
    v_inserted := true;
  exception
    when unique_violation then
      select c.*
        into v_charge
      from public.electricity_charges as c
      where c.day_reading_id = v_day.id
         or c.night_reading_id = v_night.id
      limit 1;
      if v_charge.id is null then
        raise;
      end if;
      if v_charge.day_tariff_eur_per_kwh is distinct from v_day_rate
         or v_charge.night_tariff_eur_per_kwh is distinct from v_night_rate then
        raise exception 'electricity: confirmed rates cannot be changed'
          using errcode = '55000';
      end if;
  end;

  if v_inserted and v_charge.total_amount_eur > 0 then
    insert into public.electricity_ledger (
      property_id,
      charge_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    ) values (
      v_charge.property_id,
      v_charge.id,
      'charge',
      v_charge.total_amount_eur,
      null,
      v_email,
      p_idempotency_key
    );
  end if;

  return query
  select
    v_charge.id,
    v_charge.property_id,
    v_charge.day_reading_id,
    v_charge.night_reading_id,
    v_charge.day_tariff_eur_per_kwh,
    v_charge.night_tariff_eur_per_kwh,
    v_charge.day_amount_eur,
    v_charge.night_amount_eur,
    v_charge.total_amount_eur,
    v_inserted and v_charge.total_amount_eur > 0,
    v_charge.recorded_by_email,
    v_charge.created_at;
end;
$fn$;

revoke all on function public.confirm_electricity_legal_charge(bigint, bigint, numeric, numeric, uuid) from public, anon;
grant execute on function public.confirm_electricity_legal_charge(bigint, bigint, numeric, numeric, uuid) to authenticated;

create or replace function public.admin_list_pending_electricity_readings()
returns table (
  day_reading_id bigint,
  night_reading_id bigint,
  property_id bigint,
  apartment_number text,
  meter_number text,
  reading_date date,
  previous_day numeric,
  previous_day_date date,
  current_day numeric,
  previous_night numeric,
  previous_night_date date,
  current_night numeric,
  consumption_day numeric,
  consumption_night numeric,
  composition text,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if nullif(btrim(auth.email()), '') is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('инженер')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    d.id,
    n.id,
    d.property_id,
    p.apartment_number,
    m.meter_number,
    d.reading_date,
    day_base.previous_value,
    day_base.previous_date,
    d.value,
    night_base.previous_value,
    night_base.previous_date,
    n.value,
    d.value - day_base.previous_value,
    n.value - night_base.previous_value,
    public.property_ownership_composition(d.property_id),
    case public.property_ownership_composition(d.property_id)
      when 'legal' then null
      when 'mixed' then 'mixed'
      when 'unknown' then 'unknown'
      else 'not_legal'
    end
  from public.meter_readings as d
  join public.meter_readings as n
    on n.idempotency_key = d.idempotency_key
   and n.meter_type = 'electricity_night'
   and n.property_id = d.property_id
  join public.properties as p
    on p.id = d.property_id
  left join public.electricity_meters as m
    on m.id = d.electricity_meter_id
  cross join lateral public.electricity_register_baseline(d.id) as day_base
  cross join lateral public.electricity_register_baseline(n.id) as night_base
  where d.meter_type = 'electricity_day'
    and coalesce(d.status, 'active') = 'active'
    and coalesce(n.status, 'active') = 'active'
    and coalesce(d.reading_kind, 'operational') is distinct from 'opening'
    and coalesce(n.reading_kind, 'operational') is distinct from 'opening'
    and not exists (
      select 1
      from public.electricity_charges as c
      where c.day_reading_id = d.id
         or c.night_reading_id = n.id
    )
  order by d.reading_date, p.apartment_number, d.id;
end;
$fn$;

revoke all on function public.admin_list_pending_electricity_readings() from public, anon;
grant execute on function public.admin_list_pending_electricity_readings() to authenticated;

-- ---------------------------------------------------------------------------
-- New mixed ownership is rejected. An already mixed set can still be edited.
-- ---------------------------------------------------------------------------

create or replace function public.property_registry_reject_new_mixed_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before_legal integer := 0;
  v_before_natural integer := 0;
  v_legal integer := 0;
  v_natural integer := 0;
begin
  if new.relation_type is distinct from 'owner' then
    return new;
  end if;
  if new.deregistered_at is not null then
    return new;
  end if;
  if current_setting('app.property_book_allow_existing_mixed', true) = 'on' then
    return new;
  end if;

  select
    count(*) filter (where r.entity_kind = 'legal_entity'),
    count(*) filter (where r.entity_kind in ('natural_person', 'sole_trader'))
  into v_before_legal, v_before_natural
  from public.property_registry_people as r
  where r.property_id = new.property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and r.id is distinct from new.id;

  v_legal := v_before_legal;
  v_natural := v_before_natural;
  if new.entity_kind = 'legal_entity' then
    v_legal := v_legal + 1;
  elsif new.entity_kind in ('natural_person', 'sole_trader') then
    v_natural := v_natural + 1;
  else
    return new;
  end if;

  if v_legal > 0 and v_natural > 0
     and not (v_before_legal > 0 and v_before_natural > 0) then
    raise exception 'ownership: mixed natural and legal entity is not supported'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

drop trigger if exists property_registry_reject_new_mixed_owner_trg on public.property_registry_people;
create trigger property_registry_reject_new_mixed_owner_trg
  before insert or update of entity_kind, relation_type, deregistered_at, property_id
  on public.property_registry_people
  for each row
  execute function public.property_registry_reject_new_mixed_owner();

create or replace function public.property_book_validate_owners_payload(
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_owners jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_errors text[] := array[]::text[];
  v_own jsonb;
  v_share_sum numeric := 0;
  v_ideal_sum numeric := 0;
  v_natural_n integer := 0;
  v_legal_n integer := 0;
  v_owner_n integer := 0;
  v_kind text;
  v_share numeric;
  v_ideal numeric;
  v_own_type text := lower(btrim(coalesce(p_ownership_type, '')));
  v_prop_ideal numeric := p_ideal_parts_percent;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('owners_required'),
      'owner_count', 0,
      'share_sum', 0,
      'ideal_sum', 0
    );
  end if;

  if nullif(btrim(coalesce(p_purpose, '')), '') is null then
    v_errors := array_append(v_errors, 'purpose_required');
  end if;
  if p_area_sqm is null or p_area_sqm <= 0 then
    v_errors := array_append(v_errors, 'area_required');
  end if;
  if v_prop_ideal is null then
    v_errors := array_append(v_errors, 'object_ideal_parts_required');
  end if;
  if v_own_type is null or v_own_type not in ('sole', 'shared') then
    v_errors := array_append(v_errors, 'ownership_type_required');
  end if;

  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_owner_n := v_owner_n + 1;
    begin
      v_share := nullif(btrim(coalesce(v_own ->> 'ownership_share_percent', '')), '')::numeric;
    exception when others then
      v_share := null;
    end;
    if v_share is null or v_share <= 0 then
      v_errors := array_append(v_errors, 'owner_share_required');
    else
      v_share_sum := v_share_sum + v_share;
    end if;

    begin
      v_ideal := nullif(btrim(coalesce(v_own ->> 'ideal_parts_percent', '')), '')::numeric;
    exception when others then
      v_ideal := null;
    end;
    if v_ideal is null or v_ideal < 0 then
      v_errors := array_append(v_errors, 'owner_ideal_parts_required');
    else
      v_ideal_sum := v_ideal_sum + v_ideal;
    end if;

    if nullif(btrim(coalesce(v_own ->> 'email', '')), '') is null then
      v_errors := array_append(v_errors, 'owner_email_required');
    end if;

    v_kind := lower(btrim(coalesce(v_own ->> 'entity_kind', '')));
    if v_kind = 'legal_entity' then
      v_legal_n := v_legal_n + 1;
      if nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is null then
        v_errors := array_append(v_errors, 'legal_name_required');
      end if;
      if nullif(btrim(coalesce(v_own ->> 'eik_bulstat', '')), '') is null then
        v_errors := array_append(v_errors, 'eik_required');
      end if;
    elsif v_kind in ('natural_person', 'sole_trader') then
      v_natural_n := v_natural_n + 1;
      if v_kind = 'natural_person'
         and (
           nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null
         ) then
        v_errors := array_append(v_errors, 'natural_name_required');
      end if;
      if v_kind = 'sole_trader'
         and nullif(btrim(coalesce(v_own ->> 'entity_name', '')), '') is null
         and (
           nullif(btrim(coalesce(v_own ->> 'first_name', '')), '') is null
           or nullif(btrim(coalesce(v_own ->> 'last_name', '')), '') is null
         ) then
        v_errors := array_append(v_errors, 'sole_trader_name_required');
      end if;
    else
      v_errors := array_append(v_errors, 'invalid_entity_kind');
    end if;
  end loop;

  if v_owner_n = 0 then
    v_errors := array_append(v_errors, 'owners_required');
  else
    -- Owners of one apartment are one type: natural persons (sole traders count
    -- as natural) or legal entities. Several owners of the same type are allowed.
    -- A new natural + legal combination is rejected. Existing mixed rows are not
    -- rewritten by this check; the ownership trigger keeps them in place.
    if v_legal_n > 0 and v_natural_n > 0 then
      v_errors := array_append(v_errors, 'mixed_natural_legal_forbidden');
    end if;

    if v_own_type = 'sole' then
      if v_owner_n <> 1 then
        v_errors := array_append(v_errors, 'sole_requires_one_owner');
      elsif abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'sole_share_must_be_100');
      end if;
      if v_prop_ideal is not null
         and v_owner_n = 1
         and abs(v_ideal_sum - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'sole_ideal_parts_mismatch');
      end if;
      if v_legal_n = 1 and abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'legal_must_own_100');
      end if;
    elsif v_own_type = 'shared' then
      if v_owner_n < 2 then
        v_errors := array_append(v_errors, 'shared_requires_two_owners');
      end if;
      if abs(v_share_sum - 100) > 0.01 then
        v_errors := array_append(v_errors, 'shares_must_sum_100');
      end if;
      if v_prop_ideal is not null and abs(v_ideal_sum - v_prop_ideal) > 0.01 then
        v_errors := array_append(v_errors, 'owner_ideal_parts_sum_mismatch');
      end if;
    end if;
  end if;

  select coalesce(array_agg(distinct e), array[]::text[])
    into v_errors
  from unnest(v_errors) as e;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors),
    'owner_count', v_owner_n,
    'share_sum', v_share_sum,
    'ideal_sum', v_ideal_sum
  );
end;
$fn$;

revoke all on function public.property_book_validate_owners_payload(text, numeric, numeric, text, jsonb)
  from public, anon;
grant execute on function public.property_book_validate_owners_payload(text, numeric, numeric, text, jsonb)
  to authenticated;

create or replace function public.admin_replace_property_book_owners(
  p_property_id bigint,
  p_owners jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_old_emails text[];
  v_payload_legal integer := 0;
  v_payload_natural integer := 0;
  v_before_composition text;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_replace_property_book_owners: not found'
      using errcode = 'P0002';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_replace_property_book_owners: owners array required'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind = 'legal_entity' then
      v_payload_legal := v_payload_legal + 1;
    elsif v_kind in ('natural_person', 'sole_trader') then
      v_payload_natural := v_payload_natural + 1;
    end if;
  end loop;

  v_before_composition := public.property_ownership_composition(p_property_id);
  if v_payload_legal > 0 and v_payload_natural > 0
     and v_before_composition is distinct from 'mixed' then
    raise exception 'ownership: mixed natural and legal entity is not supported'
      using errcode = '22023';
  end if;
  if v_before_composition = 'mixed' then
    -- Re-saving an already mixed apartment must not be forced into a cleanup.
    perform set_config('app.property_book_allow_existing_mixed', 'on', true);
  end if;

  select coalesce(array_agg(lower(btrim(r.email))), array[]::text[])
    into v_old_emails
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and nullif(btrim(coalesce(r.email, '')), '') is not null;

  update public.property_registry_people as r
     set deregistered_at = coalesce(r.deregistered_at, current_date),
         updated_at = now()
   where r.property_id = p_property_id
     and r.relation_type = 'owner'
     and r.deregistered_at is null;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
      raise exception 'admin_replace_property_book_owners: invalid entity_kind'
        using errcode = '22023';
    end if;
    insert into public.property_registry_people (
      property_id, relation_type, entity_kind,
      first_name, middle_name, last_name, entity_name, eik_bulstat, email,
      ownership_share_percent, ideal_parts_percent,
      registered_at, lives_on_property
    ) values (
      p_property_id,
      'owner',
      v_kind,
      nullif(btrim(coalesce(v_item ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'middle_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'entity_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), ''),
      lower(nullif(btrim(coalesce(v_item ->> 'email', '')), '')),
      nullif(v_item ->> 'ownership_share_percent', '')::numeric,
      nullif(v_item ->> 'ideal_parts_percent', '')::numeric,
      current_date,
      null
    );
  end loop;

  -- Expire pending invites for former owners no longer on the Book
  update public.property_access_invites as i
     set status = 'expired'
   where i.property_id = p_property_id
     and i.status = 'pending'
     and not exists (
       select 1
       from public.property_registry_people as r
       where r.property_id = p_property_id
         and r.relation_type = 'owner'
         and r.deregistered_at is null
         and lower(btrim(coalesce(r.email, ''))) = lower(btrim(i.email))
     );

  perform set_config('app.property_book_allow_existing_mixed', 'off', true);
  perform public.property_book_sync_portal_owner_fields(p_property_id);

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_replace_property_book_owners(bigint, jsonb) from public, anon;
grant execute on function public.admin_replace_property_book_owners(bigint, jsonb) to authenticated;

commit;
