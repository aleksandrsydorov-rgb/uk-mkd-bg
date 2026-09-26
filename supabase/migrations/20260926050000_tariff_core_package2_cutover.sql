-- Tariff Core Package 2: Water/Electricity operational cutover + future utility cancellation.
-- Does NOT rewrite historical charges/readings.
-- Does NOT cut over Support Fee / Capital Repair.
-- Financial calendar: Europe/Sofia.

begin;

-- ---------------------------------------------------------------------------
-- Additive Core references on transactional charge/reading rows
-- ---------------------------------------------------------------------------

alter table public.water_readings
  alter column tariff_id drop not null;

alter table public.water_readings
  add column if not exists tariff_version_id uuid
    references public.tariff_versions (id);

comment on column public.water_readings.tariff_version_id is
  'Package 2+: Core tariff version used for new readings. Legacy tariff_id may remain on historical rows.';

alter table public.electricity_charges
  alter column tariff_id drop not null;

alter table public.electricity_charges
  add column if not exists tariff_version_id uuid
    references public.tariff_versions (id);

comment on column public.electricity_charges.tariff_version_id is
  'Package 2+: Core tariff version used for new charges. Legacy tariff_id may remain on historical rows.';

create index if not exists water_readings_tariff_version_id_idx
  on public.water_readings (tariff_version_id)
  where tariff_version_id is not null;

create index if not exists electricity_charges_tariff_version_id_idx
  on public.electricity_charges (tariff_version_id)
  where tariff_version_id is not null;

-- ---------------------------------------------------------------------------
-- Core utility resolver (server-side; no legacy fallback)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_utility_tariff(
  p_tariff_key text,
  p_on_date date
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_tariff_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rates jsonb;
  v_base numeric;
  v_day numeric;
  v_night numeric;
begin
  v_key := btrim(coalesce(p_tariff_key, ''));
  if v_key not in ('water', 'electricity') then
    raise exception 'resolve_utility_tariff: tariff_key must be water or electricity'
      using errcode = '22023';
  end if;
  if p_on_date is null then
    raise exception 'resolve_utility_tariff: application date required' using errcode = '22023';
  end if;

  select c.id
    into v_tariff_id
  from public.tariff_catalog as c
  where c.tariff_key = v_key
    and c.active is true
  limit 1;

  if v_tariff_id is null then
    if v_key = 'water' then
      raise exception 'No water tariff configured for reading date.';
    end if;
    raise exception 'No electricity tariff is defined for this reading date.';
  end if;

  begin
    v_version_id := public.resolve_tariff_version_by_date(v_tariff_id, p_on_date);
  exception
    when sqlstate 'P0002' then
      -- Only the expected "no matching published version" from resolve_tariff_version_by_date.
      if v_key = 'water' then
        raise exception 'No water tariff configured for reading date.';
      end if;
      raise exception 'No electricity tariff is defined for this reading date.';
  end;

  select tv.valid_from, public.tariff_rates_json(tv.id)
    into v_valid_from, v_rates
  from public.tariff_versions as tv
  where tv.id = v_version_id;

  if v_key = 'water' then
    v_base := (v_rates ->> 'base')::numeric;
    if v_base is null or v_base < 0 then
      raise exception 'No water tariff configured for reading date.';
    end if;
  else
    v_day := (v_rates ->> 'day')::numeric;
    v_night := (v_rates ->> 'night')::numeric;
    if v_day is null or v_night is null or v_day < 0 or v_night < 0 then
      raise exception 'No electricity tariff is defined for this reading date.';
    end if;
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rates := v_rates;
  return next;
end;
$fn$;

revoke all on function public.resolve_utility_tariff(text, date) from public;
revoke all on function public.resolve_utility_tariff(text, date) from anon;
revoke all on function public.resolve_utility_tariff(text, date) from authenticated;

-- Public read of current applicable utility rates (owner + staff UI).
create or replace function public.get_applicable_utility_tariff(
  p_tariff_key text,
  p_on_date date default null
)
returns table (
  tariff_version_id uuid,
  tariff_key text,
  valid_from date,
  rates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_on date;
  v_version_id uuid;
  v_valid_from date;
  v_rates jsonb;
begin
  if auth.uid() is null then
    raise exception 'get_applicable_utility_tariff: not authenticated' using errcode = '28000';
  end if;

  v_key := btrim(coalesce(p_tariff_key, ''));
  if v_key not in ('water', 'electricity') then
    raise exception 'get_applicable_utility_tariff: tariff_key must be water or electricity'
      using errcode = '22023';
  end if;

  v_on := coalesce(p_on_date, public.tariff_sofia_today());

  select r.tariff_version_id, r.valid_from, r.rates
    into v_version_id, v_valid_from, v_rates
  from public.resolve_utility_tariff(v_key, v_on) as r;

  return query
  select v_version_id, v_key, v_valid_from, v_rates;
end;
$fn$;

revoke all on function public.get_applicable_utility_tariff(text, date) from public;
revoke execute on function public.get_applicable_utility_tariff(text, date) from anon;
grant execute on function public.get_applicable_utility_tariff(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Shut down legacy tariff publishers + direct legacy writes
-- ---------------------------------------------------------------------------

create or replace function public.set_water_tariff(
  p_price_eur_per_m3 numeric,
  p_valid_from date,
  p_note text default null
)
returns setof public.water_tariffs
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  raise exception 'Legacy tariff publication disabled; use Tariff Core.'
    using errcode = '42501';
end;
$fn$;

revoke all on function public.set_water_tariff(numeric, date, text) from public;
revoke execute on function public.set_water_tariff(numeric, date, text) from anon;
grant execute on function public.set_water_tariff(numeric, date, text) to authenticated;

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
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  raise exception 'Legacy tariff publication disabled; use Tariff Core.'
    using errcode = '42501';
end;
$fn$;

revoke all on function public.set_electricity_tariff(numeric, numeric, date, text) from public;
revoke execute on function public.set_electricity_tariff(numeric, numeric, date, text) from anon;
grant execute on function public.set_electricity_tariff(numeric, numeric, date, text) to authenticated;

create or replace function public.legacy_utility_tariff_write_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception 'Legacy tariff publication disabled; use Tariff Core.'
    using errcode = '42501';
end;
$fn$;

drop trigger if exists water_tariffs_legacy_write_block on public.water_tariffs;
create trigger water_tariffs_legacy_write_block
  before insert or update or delete on public.water_tariffs
  for each row execute function public.legacy_utility_tariff_write_block();

drop trigger if exists electricity_tariffs_legacy_write_block on public.electricity_tariffs;
create trigger electricity_tariffs_legacy_write_block
  before insert or update or delete on public.electricity_tariffs
  for each row execute function public.legacy_utility_tariff_write_block();

-- Reinforce: authenticated cannot mutate critical transactional tables.
revoke insert, update, delete on table public.water_tariffs from public, anon, authenticated;
revoke insert, update, delete on table public.electricity_tariffs from public, anon, authenticated;
revoke insert, update, delete on table public.water_readings from public, anon, authenticated;
revoke insert, update, delete on table public.meter_readings from public, anon, authenticated;
revoke insert, update, delete on table public.electricity_charges from public, anon, authenticated;
revoke insert, update, delete on table public.water_ledger from public, anon, authenticated;
revoke insert, update, delete on table public.electricity_ledger from public, anon, authenticated;
grant select on table public.water_tariffs to authenticated;
grant select on table public.electricity_tariffs to authenticated;
grant select on table public.water_readings to authenticated;
grant select on table public.meter_readings to authenticated;
grant select on table public.electricity_charges to authenticated;
grant select on table public.water_ledger to authenticated;
grant select on table public.electricity_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_future_tariff_version — enable Water/Electricity future cancellation
-- ---------------------------------------------------------------------------

create or replace function public.cancel_future_tariff_version(
  p_version_id uuid,
  p_reason text,
  p_cancellation_idempotency_key uuid
)
returns table (
  version_id uuid,
  status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tv public.tariff_versions;
  v_cat public.tariff_catalog;
  v_today date := public.tariff_sofia_today();
  v_reason text;
  v_existing public.tariff_versions;
begin
  if auth.uid() is null then
    raise exception 'cancel_future_tariff_version: not authenticated' using errcode = '28000';
  end if;
  if p_version_id is null or p_cancellation_idempotency_key is null then
    raise exception 'cancel_future_tariff_version: version and idempotency key required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'cancel_future_tariff_version: reason required' using errcode = '22023';
  end if;

  select tv.* into v_existing
  from public.tariff_versions as tv
  where tv.cancellation_idempotency_key = p_cancellation_idempotency_key;
  if found then
    if v_existing.id is distinct from p_version_id
       or btrim(coalesce(v_existing.cancellation_reason, '')) is distinct from v_reason then
      raise exception 'cancel_future_tariff_version: idempotency key conflict' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.cancelled_at;
    return;
  end if;

  select tv.* into v_tv from public.tariff_versions as tv where tv.id = p_version_id for update;
  if not found then
    raise exception 'cancel_future_tariff_version: not found' using errcode = 'P0002';
  end if;

  select c.* into v_cat from public.tariff_catalog as c where c.id = v_tv.tariff_id;

  if not public.tariff_can_publish(v_cat.module_key) then
    raise exception 'cancel_future_tariff_version: not allowed' using errcode = '42501';
  end if;

  if v_tv.status = 'cancelled' then
    return query select v_tv.id, v_tv.status, v_tv.cancelled_at;
    return;
  end if;

  if v_tv.status <> 'published' then
    raise exception 'cancel_future_tariff_version: only published versions' using errcode = '22023';
  end if;

  if v_tv.valid_from <= v_today then
    raise exception 'cancel_future_tariff_version: effective or past versions cannot be cancelled'
      using errcode = '22023';
  end if;

  if public.tariff_version_bound_to_support_usage(v_tv.id) then
    raise exception 'cancel_future_tariff_version: version bound to Support usage'
      using errcode = '42501';
  end if;

  update public.tariff_versions as tv
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancellation_reason = v_reason,
         cancellation_idempotency_key = p_cancellation_idempotency_key
   where tv.id = v_tv.id;

  return query
  select tv.id, tv.status, tv.cancelled_at
  from public.tariff_versions as tv
  where tv.id = v_tv.id;
end;
$fn$;

revoke all on function public.cancel_future_tariff_version(uuid, text, uuid) from public;
revoke execute on function public.cancel_future_tariff_version(uuid, text, uuid) from anon;
grant execute on function public.cancel_future_tariff_version(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_water_reading — Core tariff source (behavior otherwise unchanged)
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

  select r.*
    into v_last
  from public.water_readings as r
  where r.meter_id = v_meter.id
    and r.status = 'active'
  order by r.reading_date desc, r.created_at desc
  limit 1;

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
$fn$;

revoke all on function public.submit_water_reading(bigint, numeric, date, uuid) from public;
revoke all on function public.submit_water_reading(bigint, numeric, date, uuid) from anon;
grant execute on function public.submit_water_reading(bigint, numeric, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_electricity_reading — Core tariff source (same version day+night)
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

  select r.* into v_resolved
  from public.resolve_utility_tariff('electricity', p_reading_date) as r;

  v_version_id := v_resolved.tariff_version_id;
  v_day_rate := (v_resolved.rates ->> 'day')::numeric;
  v_night_rate := (v_resolved.rates ->> 'night')::numeric;

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
      v_day_rate,
      v_night_rate,
      round(v_cons_day * v_day_rate, 2),
      round(v_cons_night * v_night_rate, 2),
      round(v_cons_day * v_day_rate, 2)
        + round(v_cons_night * v_night_rate, 2),
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
