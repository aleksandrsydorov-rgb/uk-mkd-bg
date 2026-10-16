-- =============================================================================
-- MTR-3F — Financially safe corrections of charged / paid meter readings
-- =============================================================================
-- Accounting invariants (do not violate):
--   I1. Original reading rows and original charge ledger rows are never deleted
--       or amount-mutated.
--   I2. Payment rows are never rewritten, deleted, or reallocated.
--   I3. Balance = Σ(charge + adjustment_debit) − Σ(payment + adjustment_credit).
--   I4. At most one charge per water reading / electricity charge snapshot.
--   I5. Correction of a charged reading posts at most one adjustment pair
--       (debit XOR credit) for the delta vs the original posted charge,
--       using the original tariff snapshot (never a live reprice).
--   I6. Paid state is handled solely via I3 adjustments (over/under balance);
--       no refund / payment_reversal invention.
--   I7. Idempotent: same correction key returns the same correction reading
--       and does not double-post adjustments.
-- Canonical primitives: water_ledger / electricity_ledger kinds
--   adjustment_debit | adjustment_credit (already in schema).
-- Admin-only when a charge exists. Uncharged path unchanged (staff admin|engineer).
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.correct_water_reading(uuid,numeric,text,uuid)') is null
     or to_regprocedure(
          'public.correct_electricity_reading(bigint,bigint,numeric,numeric,text,uuid)'
        ) is null then
    raise exception 'mtr3f: MTR-3 correct_* RPCs missing — apply MTR-3 first';
  end if;
  if to_regclass('public.water_ledger') is null
     or to_regclass('public.electricity_ledger') is null then
    raise exception 'mtr3f: utility ledgers missing';
  end if;
end;
$pre$;

-- One financial adjustment marker per original water reading (note key).
create unique index if not exists water_ledger_mtr3f_adj_once_per_reading_idx
  on public.water_ledger (property_id, note)
  where kind in ('adjustment_debit', 'adjustment_credit')
    and note like 'mtr3f:water_reading:%';

create unique index if not exists electricity_ledger_mtr3f_adj_once_per_charge_idx
  on public.electricity_ledger (property_id, note)
  where kind in ('adjustment_debit', 'adjustment_credit')
    and note like 'mtr3f:electricity_charge:%';

-- ---------------------------------------------------------------------------
-- correct_water_reading — uncharged OR charged/paid via ledger adjustment
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
  v_charge_amt numeric(12, 2);
  v_new_charge numeric(12, 2);
  v_delta numeric(12, 2);
  v_latest_id uuid;
  v_adj_note text;
  v_adj_key uuid;
  v_new_id uuid;
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

  if v_has_charge then
    -- Financial path: administrators only (I2/I5).
    if not public.has_staff_role('администрация') then
      raise exception 'Not authorized.';
    end if;
  end if;

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

  v_adj_note := 'mtr3f:water_reading:' || v_old.id::text;
  if exists (
    select 1 from public.water_ledger as l
    where l.property_id = v_old.property_id
      and l.note = v_adj_note
      and l.kind in ('adjustment_debit', 'adjustment_credit')
  ) then
    raise exception 'Financial adjustment already posted for this reading.';
  end if;

  update public.water_readings as r
  set
    status = 'reversed',
    reversed_at = now(),
    reversed_by_email = v_email,
    reversal_reason = v_reason
  where r.id = v_old.id;

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
  returning id into v_new_id;

  if v_has_charge then
    select l.amount_eur into v_charge_amt
    from public.water_ledger as l
    where l.reading_id = v_old.id and l.kind = 'charge'
    limit 1;

    v_new_charge := round(
      (v_value - v_old.previous_value) * coalesce(v_old.tariff_eur_per_m3, 0),
      2
    );
    v_delta := round(v_new_charge - coalesce(v_charge_amt, 0), 2);

    -- Never insert a second charge (I4). Delta-only adjustments (I5).
    if v_delta > 0 then
      v_adj_key := gen_random_uuid();
      insert into public.water_ledger (
        property_id, reading_id, kind, amount_eur, note, recorded_by_email, idempotency_key
      ) values (
        v_old.property_id, v_new_id, 'adjustment_debit', v_delta,
        v_adj_note, v_email, v_adj_key
      );
    elsif v_delta < 0 then
      v_adj_key := gen_random_uuid();
      insert into public.water_ledger (
        property_id, reading_id, kind, amount_eur, note, recorded_by_email, idempotency_key
      ) values (
        v_old.property_id, v_new_id, 'adjustment_credit', abs(v_delta),
        v_adj_note, v_email, v_adj_key
      );
    end if;
    -- Payments untouched (I2). Over/under absorbed by balance (I3/I6).
  end if;

  return query select r.* from public.water_readings as r where r.id = v_new_id;
end;
$fn$;

revoke all on function public.correct_water_reading(uuid, numeric, text, uuid)
  from public, anon;
grant execute on function public.correct_water_reading(uuid, numeric, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- correct_electricity_reading — uncharged OR charged/paid via ledger adjustment
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
  v_charge public.electricity_charges%rowtype;
  v_has_charge boolean;
  v_has_payment boolean;
  v_latest_day bigint;
  v_latest_night bigint;
  v_out_day bigint;
  v_out_night bigint;
  v_ex_day public.meter_readings%rowtype;
  v_ex_night public.meter_readings%rowtype;
  v_new_total numeric(12, 2);
  v_delta numeric(12, 2);
  v_adj_note text;
  v_adj_key uuid;
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

  select c.* into v_charge
  from public.electricity_charges as c
  where c.day_reading_id = v_day.id and c.night_reading_id = v_night.id
  for update;
  v_has_charge := found;

  if v_has_charge then
    if not public.has_staff_role('администрация') then
      raise exception 'Not authorized.';
    end if;
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

  if v_has_charge then
    if v_new_day < v_charge.previous_day or v_new_night < v_charge.previous_night then
      raise exception 'Corrected reading cannot be lower than previous reading.';
    end if;
    v_adj_note := 'mtr3f:electricity_charge:' || v_charge.id::text;
    if exists (
      select 1 from public.electricity_ledger as l
      where l.property_id = v_day.property_id
        and l.note = v_adj_note
        and l.kind in ('adjustment_debit', 'adjustment_credit')
    ) then
      raise exception 'Financial adjustment already posted for this charge.';
    end if;
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

  if v_has_charge then
    -- Recalculate with original charge tariff snapshots (I5). Do not mutate charge row (I1).
    v_new_total := round(
      (v_new_day - v_charge.previous_day) * v_charge.day_tariff_eur_per_kwh,
      2
    ) + round(
      (v_new_night - v_charge.previous_night) * v_charge.night_tariff_eur_per_kwh,
      2
    );
    v_delta := round(v_new_total - coalesce(v_charge.total_amount_eur, 0), 2);

    select exists (
      select 1 from public.electricity_ledger as l
      where l.property_id = v_day.property_id and l.kind = 'payment'
    ) into v_has_payment;
    -- v_has_payment informational only (I6): payments preserved; balance absorbs delta.

    if v_delta > 0 then
      v_adj_key := gen_random_uuid();
      insert into public.electricity_ledger (
        property_id, charge_id, kind, amount_eur, note, recorded_by_email, idempotency_key
      ) values (
        v_day.property_id, null, 'adjustment_debit', v_delta,
        v_adj_note, v_email, v_adj_key
      );
    elsif v_delta < 0 then
      v_adj_key := gen_random_uuid();
      insert into public.electricity_ledger (
        property_id, charge_id, kind, amount_eur, note, recorded_by_email, idempotency_key
      ) values (
        v_day.property_id, null, 'adjustment_credit', abs(v_delta),
        v_adj_note, v_email, v_adj_key
      );
    end if;
  end if;

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
