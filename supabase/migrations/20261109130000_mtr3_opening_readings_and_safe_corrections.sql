-- =============================================================================
-- MTR-3 — Opening readings (charge-free) + safe uncharged corrections
-- =============================================================================
-- Canonical: inventarisation distinct from submit_* (which create charges).
-- Charged / paid corrections: FAIL CLOSED (no invented refund/void semantics).
-- Prerequisites: water_readings, meter_readings, water_meters, electricity_meters,
--   has_staff_role, water_ledger, electricity_charges, electricity_ledger.
-- Preserves IS-10d / MTR-2. No seeds. No published tariffs.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.water_readings') is null
     or to_regclass('public.meter_readings') is null
     or to_regclass('public.water_meters') is null
     or to_regclass('public.electricity_meters') is null then
    raise exception 'mtr3: meter/reading tables missing';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'mtr3: has_staff_role(text) missing';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- Schema: water_readings opening / correction metadata
-- ---------------------------------------------------------------------------

alter table public.water_readings
  alter column tariff_id drop not null;

alter table public.water_readings
  add column if not exists reading_kind text not null default 'operational';

alter table public.water_readings
  add column if not exists source_reference text;

alter table public.water_readings
  add column if not exists corrects_reading_id uuid;

do $ck$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'water_readings_reading_kind_check'
      and conrelid = 'public.water_readings'::regclass
  ) then
    alter table public.water_readings
      add constraint water_readings_reading_kind_check
      check (reading_kind in ('opening', 'operational', 'correction'));
  end if;
end;
$ck$;

create unique index if not exists water_readings_one_active_opening_per_meter_idx
  on public.water_readings (meter_id)
  where reading_kind = 'opening' and status = 'active';

create unique index if not exists water_readings_one_active_correction_of_idx
  on public.water_readings (corrects_reading_id)
  where corrects_reading_id is not null and status = 'active';

-- ---------------------------------------------------------------------------
-- Schema: meter_readings (electricity) status / opening metadata
-- ---------------------------------------------------------------------------

alter table public.meter_readings
  add column if not exists status text not null default 'active';

alter table public.meter_readings
  add column if not exists reading_kind text not null default 'operational';

alter table public.meter_readings
  add column if not exists source_reference text;

alter table public.meter_readings
  add column if not exists corrects_reading_id bigint;

alter table public.meter_readings
  add column if not exists reversed_at timestamptz;

alter table public.meter_readings
  add column if not exists reversed_by_email text;

alter table public.meter_readings
  add column if not exists reversal_reason text;

do $eck$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meter_readings_status_check'
      and conrelid = 'public.meter_readings'::regclass
  ) then
    alter table public.meter_readings
      add constraint meter_readings_status_check
      check (status in ('active', 'reversed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'meter_readings_reading_kind_check'
      and conrelid = 'public.meter_readings'::regclass
  ) then
    alter table public.meter_readings
      add constraint meter_readings_reading_kind_check
      check (reading_kind in ('opening', 'operational', 'correction'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'meter_readings_reversal_metadata_check'
      and conrelid = 'public.meter_readings'::regclass
  ) then
    alter table public.meter_readings
      add constraint meter_readings_reversal_metadata_check
      check (
        (
          status = 'active'
          and reversed_at is null
          and reversed_by_email is null
          and reversal_reason is null
        )
        or (
          status = 'reversed'
          and reversed_at is not null
          and reversed_by_email is not null
          and reversal_reason is not null
          and length(trim(reversal_reason)) > 0
        )
      );
  end if;
end;
$eck$;

-- Allow system inventarisation source (opening rows).
alter table public.meter_readings drop constraint if exists meter_readings_submitted_source_chk;
alter table public.meter_readings
  add constraint meter_readings_submitted_source_chk
  check (
    submitted_source is null
    or submitted_source in ('owner', 'staff', 'system')
  );

create unique index if not exists meter_readings_one_active_opening_per_meter_type_idx
  on public.meter_readings (electricity_meter_id, meter_type)
  where reading_kind = 'opening'
    and status = 'active'
    and electricity_meter_id is not null;

-- ---------------------------------------------------------------------------
-- Compatibility: service-lock trigger CASE must not type-check new.id as uuid
-- on water_readings (uuid PK). Use jsonb extraction for both branches.
-- ---------------------------------------------------------------------------

create or replace function public.trg_enforce_service_lock_scoped()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_scope text := coalesce(nullif(tg_argv[0], ''), 'all');
  v_pid bigint;
begin
  if tg_op = 'DELETE' then
    v_pid := case
      when tg_table_name = 'properties' then (to_jsonb(old) ->> 'id')::bigint
      else (to_jsonb(old) ->> 'property_id')::bigint
    end;
    if v_pid is not null then
      perform public.assert_property_not_service_locked(v_pid, v_scope);
    end if;
    return old;
  end if;

  v_pid := case
    when tg_table_name = 'properties' then (to_jsonb(new) ->> 'id')::bigint
    else (to_jsonb(new) ->> 'property_id')::bigint
  end;
  if v_pid is not null then
    perform public.assert_property_not_service_locked(v_pid, v_scope);
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Staff gate helper (admin / engineer only)
-- ---------------------------------------------------------------------------

create or replace function public.mtr3_assert_meter_staff()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('инженер') then
    raise exception 'Not authorized.';
  end if;
  return v_email;
end;
$fn$;

revoke all on function public.mtr3_assert_meter_staff() from public, anon;
grant execute on function public.mtr3_assert_meter_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- register_water_opening_reading — charge-free inventarisation row
-- ---------------------------------------------------------------------------

create or replace function public.register_water_opening_reading(
  p_property_id bigint,
  p_current_value numeric,
  p_reading_date date,
  p_source_reference text,
  p_idempotency_key uuid
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

  select * into v_meter
  from public.water_meters as m
  where m.property_id = p_property_id and m.retired_at is null
  for update;
  if not found then
    raise exception 'No active water meter assigned.';
  end if;

  if v_date < v_meter.installed_at then
    raise exception 'Reading date cannot be earlier than meter installation date.';
  end if;

  -- Compatibility: sync meter baseline when no charged operational history.
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
      select r.* into v_existing
      from public.water_readings as r
      where r.idempotency_key = p_idempotency_key
         or (
           r.meter_id = v_meter.id
           and r.reading_kind = 'opening'
           and r.status = 'active'
         )
      order by case when r.idempotency_key = p_idempotency_key then 0 else 1 end
      limit 1;

      if v_existing.id is null then
        raise;
      end if;

      if v_existing.idempotency_key = p_idempotency_key then
        if v_existing.current_value is distinct from v_value
           or v_existing.reading_date is distinct from v_date then
          raise exception 'Idempotency key conflict.';
        end if;
        return query select r.* from public.water_readings as r where r.id = v_existing.id;
        return;
      end if;

      raise exception 'An active opening water reading already exists for this meter.';
  end;
end;
$fn$;

revoke all on function public.register_water_opening_reading(bigint, numeric, date, text, uuid)
  from public, anon;
grant execute on function public.register_water_opening_reading(bigint, numeric, date, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- register_electricity_opening_reading — charge-free day/night pair
-- ---------------------------------------------------------------------------

create or replace function public.register_electricity_opening_reading(
  p_property_id bigint,
  p_day_reading numeric,
  p_night_reading numeric,
  p_reading_date date,
  p_source_reference text,
  p_idempotency_key uuid
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
       or v_night_row.reading_kind is distinct from 'opening' then
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

  select * into v_meter
  from public.electricity_meters as m
  where m.property_id = p_property_id and m.retired_at is null
  for update;
  if not found then
    raise exception 'No active electricity meter assigned.';
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

  -- Fail closed: never create electricity_charges / ledger on opening.
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

revoke all on function public.register_electricity_opening_reading(bigint, numeric, numeric, date, text, uuid)
  from public, anon;
grant execute on function public.register_electricity_opening_reading(bigint, numeric, numeric, date, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- correct_water_reading — uncharged only; charged/paid BLOCKED
-- ---------------------------------------------------------------------------

create or replace function public.correct_water_reading(
  p_reading_id uuid,
  p_corrected_value numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns setof public.water_readings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_old public.water_readings%rowtype;
  v_corr public.water_readings%rowtype;
  v_value numeric(12, 3);
  v_reason text;
  v_has_charge boolean;
  v_has_payment boolean;
  v_latest_id uuid;
begin
  v_email := public.mtr3_assert_meter_staff();

  if p_reading_id is null then
    raise exception 'Reading not found.';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_corrected_value is null or p_corrected_value < 0 then
    raise exception 'Corrected reading cannot be negative.';
  end if;
  v_value := round(p_corrected_value, 3);
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Correction reason is required.';
  end if;

  select r.* into v_corr
  from public.water_readings as r
  where r.idempotency_key = p_idempotency_key;
  if found then
    if v_corr.corrects_reading_id is distinct from p_reading_id
       or v_corr.current_value is distinct from v_value
       or v_corr.reading_kind is distinct from 'correction' then
      raise exception 'Idempotency key conflict.';
    end if;
    return query select r.* from public.water_readings as r where r.id = v_corr.id;
    return;
  end if;

  select r.* into v_old
  from public.water_readings as r
  where r.id = p_reading_id
  for update;
  if not found then
    raise exception 'Reading not found.';
  end if;

  if v_old.status is distinct from 'active' then
    raise exception 'Reading is not active.';
  end if;

  perform 1 from public.properties as p where p.id = v_old.property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  select exists (
    select 1 from public.water_ledger as l
    where l.reading_id = v_old.id and l.kind = 'charge'
  ) into v_has_charge;

  select exists (
    select 1 from public.water_ledger as l
    where l.property_id = v_old.property_id and l.kind = 'payment'
  ) into v_has_payment;

  if v_has_charge and v_has_payment then
    raise exception 'Reading correction blocked: payment exists (financial correction design required).';
  end if;
  if v_has_charge then
    raise exception 'Reading correction blocked: charge exists (financial correction design required).';
  end if;

  -- Chronology: only latest active reading on meter may be corrected.
  select r.id into v_latest_id
  from public.water_readings as r
  where r.meter_id = v_old.meter_id and r.status = 'active'
  order by r.reading_date desc, r.current_value desc, r.created_at desc, r.id desc
  limit 1;
  if v_latest_id is distinct from v_old.id then
    raise exception 'Only the latest active reading may be corrected.';
  end if;

  if v_value < v_old.previous_value then
    raise exception 'Corrected reading cannot be lower than previous reading.';
  end if;

  update public.water_readings as r
  set
    status = 'reversed',
    reversed_at = now(),
    reversed_by_email = v_email,
    reversal_reason = v_reason
  where r.id = v_old.id;

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
    source_reference,
    corrects_reading_id
  )
  values (
    v_old.property_id,
    v_old.meter_id,
    v_old.reading_date,
    v_old.previous_value,
    v_value,
    v_old.tariff_id,
    v_old.tariff_version_id,
    coalesce(v_old.tariff_eur_per_m3, 0),
    v_email,
    'staff',
    p_idempotency_key,
    'active',
    'correction',
    v_reason,
    v_old.id
  )
  returning *;
end;
$fn$;

revoke all on function public.correct_water_reading(uuid, numeric, text, uuid)
  from public, anon;
grant execute on function public.correct_water_reading(uuid, numeric, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- correct_electricity_reading — uncharged day/night pair only
-- ---------------------------------------------------------------------------

create or replace function public.correct_electricity_reading(
  p_day_reading_id bigint,
  p_night_reading_id bigint,
  p_corrected_day numeric,
  p_corrected_night numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns table (
  day_reading_id bigint,
  night_reading_id bigint,
  property_id bigint,
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
  v_day public.meter_readings%rowtype;
  v_night public.meter_readings%rowtype;
  v_new_day numeric(12, 3);
  v_new_night numeric(12, 3);
  v_reason text;
  v_has_charge boolean;
  v_has_payment boolean;
  v_latest_day bigint;
  v_latest_night bigint;
  v_out_day bigint;
  v_out_night bigint;
  v_ex_day public.meter_readings%rowtype;
  v_ex_night public.meter_readings%rowtype;
begin
  v_email := public.mtr3_assert_meter_staff();

  if p_day_reading_id is null or p_night_reading_id is null then
    raise exception 'Reading not found.';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_corrected_day is null or p_corrected_day < 0
     or p_corrected_night is null or p_corrected_night < 0 then
    raise exception 'Corrected reading cannot be negative.';
  end if;
  v_new_day := round(p_corrected_day, 3);
  v_new_night := round(p_corrected_night, 3);
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Correction reason is required.';
  end if;

  select d.* into v_ex_day
  from public.meter_readings as d
  where d.idempotency_key = p_idempotency_key and d.meter_type = 'electricity_day';
  select n.* into v_ex_night
  from public.meter_readings as n
  where n.idempotency_key = p_idempotency_key and n.meter_type = 'electricity_night';
  if v_ex_day.id is not null or v_ex_night.id is not null then
    if v_ex_day.id is null or v_ex_night.id is null
       or v_ex_day.corrects_reading_id is distinct from p_day_reading_id
       or v_ex_night.corrects_reading_id is distinct from p_night_reading_id
       or v_ex_day.value is distinct from v_new_day
       or v_ex_night.value is distinct from v_new_night then
      raise exception 'Idempotency key conflict.';
    end if;
    day_reading_id := v_ex_day.id;
    night_reading_id := v_ex_night.id;
    property_id := v_ex_day.property_id;
    reading_date := v_ex_day.reading_date;
    day_value := v_new_day;
    night_value := v_new_night;
    return next;
    return;
  end if;

  select r.* into v_day from public.meter_readings as r where r.id = p_day_reading_id for update;
  select r.* into v_night from public.meter_readings as r where r.id = p_night_reading_id for update;
  if v_day.id is null or v_night.id is null then
    raise exception 'Reading not found.';
  end if;
  if v_day.meter_type is distinct from 'electricity_day'
     or v_night.meter_type is distinct from 'electricity_night' then
    raise exception 'Reading pair meter_type mismatch.';
  end if;
  if v_day.property_id is distinct from v_night.property_id
     or v_day.electricity_meter_id is distinct from v_night.electricity_meter_id
     or v_day.reading_date is distinct from v_night.reading_date then
    raise exception 'Reading pair isolation mismatch.';
  end if;
  if v_day.status is distinct from 'active' or v_night.status is distinct from 'active' then
    raise exception 'Reading is not active.';
  end if;

  perform 1 from public.properties as p where p.id = v_day.property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  select exists (
    select 1 from public.electricity_charges as c
    where c.day_reading_id = v_day.id or c.night_reading_id = v_night.id
  ) into v_has_charge;

  select exists (
    select 1 from public.electricity_ledger as l
    where l.property_id = v_day.property_id and l.kind = 'payment'
  ) into v_has_payment;

  if v_has_charge and v_has_payment then
    raise exception 'Reading correction blocked: payment exists (financial correction design required).';
  end if;
  if v_has_charge then
    raise exception 'Reading correction blocked: charge exists (financial correction design required).';
  end if;

  select r.id into v_latest_day
  from public.meter_readings as r
  where r.electricity_meter_id = v_day.electricity_meter_id
    and r.meter_type = 'electricity_day'
    and coalesce(r.status, 'active') = 'active'
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
  limit 1;

  select r.id into v_latest_night
  from public.meter_readings as r
  where r.electricity_meter_id = v_night.electricity_meter_id
    and r.meter_type = 'electricity_night'
    and coalesce(r.status, 'active') = 'active'
  order by r.reading_date desc, r.value desc, r.created_at desc, r.id desc
  limit 1;

  if v_latest_day is distinct from v_day.id or v_latest_night is distinct from v_night.id then
    raise exception 'Only the latest active reading may be corrected.';
  end if;

  update public.meter_readings as r
  set
    status = 'reversed',
    reversed_at = now(),
    reversed_by_email = v_email,
    reversal_reason = v_reason
  where r.id in (v_day.id, v_night.id);

  insert into public.meter_readings (
    property_id, meter_type, value, reading_date, submitted_by, submitted_source,
    idempotency_key, electricity_meter_id, status, reading_kind, source_reference,
    corrects_reading_id
  ) values (
    v_day.property_id, 'electricity_day', v_new_day, v_day.reading_date, v_email, 'staff',
    p_idempotency_key, v_day.electricity_meter_id, 'active', 'correction', v_reason,
    v_day.id
  ) returning id into v_out_day;

  insert into public.meter_readings (
    property_id, meter_type, value, reading_date, submitted_by, submitted_source,
    idempotency_key, electricity_meter_id, status, reading_kind, source_reference,
    corrects_reading_id
  ) values (
    v_night.property_id, 'electricity_night', v_new_night, v_night.reading_date, v_email, 'staff',
    p_idempotency_key, v_night.electricity_meter_id, 'active', 'correction', v_reason,
    v_night.id
  ) returning id into v_out_night;

  day_reading_id := v_out_day;
  night_reading_id := v_out_night;
  property_id := v_day.property_id;
  reading_date := v_day.reading_date;
  day_value := v_new_day;
  night_value := v_new_night;
  return next;
end;
$fn$;

revoke all on function public.correct_electricity_reading(bigint, bigint, numeric, numeric, text, uuid)
  from public, anon;
grant execute on function public.correct_electricity_reading(bigint, bigint, numeric, numeric, text, uuid)
  to authenticated;

commit;
