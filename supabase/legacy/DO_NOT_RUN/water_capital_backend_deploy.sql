-- =============================================================================
-- AMADEUS 11 WATER + CAPITAL BACKEND DEPLOYMENT
-- =============================================================================
-- Paste this file into Supabase SQL Editor as one script.
-- Order: has_staff_role → staff write integrity → water/capital RLS
--        → water RPC → capital RPC.
-- One outer BEGIN / COMMIT. Any RAISE EXCEPTION rolls back.
-- Does not alter support_fee, meter_readings, properties.debt/overpayment,
-- is_staff / is_owner / owns_property, or staff_select.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT
-- -----------------------------------------------------------------------------

do $deploy$
declare
  tbl text;
  tables text[] := array[
    'properties',
    'staff',
    'water_meters',
    'water_tariffs',
    'water_readings',
    'water_ledger',
    'capital_repair_assessments',
    'capital_repair_ledger'
  ];
  water_tables text[] := array[
    'water_meters',
    'water_tariffs',
    'water_readings',
    'water_ledger',
    'capital_repair_assessments',
    'capital_repair_ledger'
  ];
  col text;
begin
  foreach tbl in array tables loop
    if to_regclass('public.' || tbl) is null then
      raise exception 'Pre-flight failed: public.% does not exist.', tbl;
    end if;
  end loop;

  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'Pre-flight failed: public.is_owner() does not exist.';
  end if;
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'Pre-flight failed: public.is_staff() does not exist.';
  end if;

  foreach col in array array['email', 'role', 'active'] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'staff'
        and c.column_name = col
    ) then
      raise exception 'Pre-flight failed: public.staff.% is missing.', col;
    end if;
  end loop;

  if not exists (
    select 1
    from public.staff as s
    where s.active is true
      and lower(btrim(s.role)) = 'администрация'
  ) then
    raise exception 'Pre-flight failed: no active administration staff account exists.';
  end if;

  foreach tbl in array water_tables loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = tbl
        and c.relrowsecurity is true
    ) then
      raise exception 'Pre-flight failed: RLS is not enabled on public.%.', tbl;
    end if;

    if not has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') then
      raise exception 'Pre-flight failed: authenticated is missing SELECT on public.%.', tbl;
    end if;

    if has_table_privilege('authenticated', 'public.' || tbl, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || tbl, 'DELETE') then
      raise exception 'Pre-flight failed: authenticated has direct write privilege on public.%.', tbl;
    end if;
  end loop;
end;
$deploy$;

-- =============================================================================
-- 1. ROLE HELPER: supabase/water_capital_role_helper.sql
-- =============================================================================

-- =============================================================================
-- AMADEUS 11 — staff role helper for water/capital RLS
-- =============================================================================
-- SECURITY DEFINER, JWT-only: checks the caller's own staff row.
-- Empty staff.role is not администрация.
-- Active only when s.active IS TRUE.
-- GRANT EXECUTE to authenticated so RLS policies can call it.
-- This file has no BEGIN/COMMIT.
-- =============================================================================

create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.email() is not null
    and length(btrim(coalesce(p_role, ''))) > 0
    and exists (
      select 1
      from public.staff as s
      where lower(btrim(s.email)) = lower(btrim(auth.email()))
        and s.active is true
        and lower(btrim(s.role)) = lower(btrim(p_role))
    );
$$;

revoke all on function public.has_staff_role(text) from public;
revoke all on function public.has_staff_role(text) from anon;
grant execute on function public.has_staff_role(text) to authenticated;

-- =============================================================================
-- 2. STAFF WRITE INTEGRITY: supabase/staff_role_integrity_hardening.sql
-- =============================================================================

-- =============================================================================
-- AMADEUS 11 — staff write policies: close role-escalation via is_staff()
-- =============================================================================
-- Does NOT change staff_select (salary visibility is a later issue).
-- Does NOT change table GRANT on public.staff.
-- INSERT / UPDATE / DELETE: only has_staff_role('администрация').
-- Requires public.has_staff_role(text) already created.
-- This file has no BEGIN/COMMIT.
-- =============================================================================

drop policy if exists staff_staff_insert on public.staff;
drop policy if exists staff_staff_update on public.staff;
drop policy if exists staff_staff_delete on public.staff;
drop policy if exists staff_admin_insert on public.staff;
drop policy if exists staff_admin_update on public.staff;
drop policy if exists staff_admin_delete on public.staff;

create policy staff_admin_insert
on public.staff
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
);

create policy staff_admin_update
on public.staff
for update
to authenticated
using (
  public.has_staff_role('администрация')
)
with check (true);

create policy staff_admin_delete
on public.staff
for delete
to authenticated
using (
  public.has_staff_role('администрация')
);

-- =============================================================================
-- 3. WATER/CAPITAL RLS HARDENING: supabase/water_capital_rls_hardening.sql
-- =============================================================================

-- =============================================================================
-- AMADEUS 11 — harden water/capital SELECT policies (role-aware)
-- =============================================================================
-- Table GRANT unchanged (SELECT only for authenticated).
-- Writes remain RPC-only. No INSERT/UPDATE/DELETE policies.
-- Requires public.has_staff_role(text).
-- This file has no BEGIN/COMMIT.
--
-- TARGET MATRIX
-- OWNER A: own meters/readings/water ledger/capital ledger; tariffs if owner;
--   assessments only via own capital_repair_ledger row.
-- ADMIN / ACCOUNTANT: all six SELECT (assessments: all rows).
-- ENGINEER: meters, tariffs, readings SELECT. ledger + capital DENY.
-- CLEANER: all six DENY.
-- =============================================================================

drop policy if exists water_meters_select on public.water_meters;
drop policy if exists water_tariffs_select on public.water_tariffs;
drop policy if exists water_readings_select on public.water_readings;
drop policy if exists water_ledger_select on public.water_ledger;
drop policy if exists capital_repair_assessments_select on public.capital_repair_assessments;
drop policy if exists capital_repair_ledger_select on public.capital_repair_ledger;

create policy water_meters_select
on public.water_meters
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.has_staff_role('инженер')
);

create policy water_tariffs_select
on public.water_tariffs
for select
to authenticated
using (
  public.is_owner()
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.has_staff_role('инженер')
);

create policy water_readings_select
on public.water_readings
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.has_staff_role('инженер')
);

create policy water_ledger_select
on public.water_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
);

create policy capital_repair_assessments_select
on public.capital_repair_assessments
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or exists (
    select 1
    from public.capital_repair_ledger as l
    where l.assessment_id = capital_repair_assessments.id
      and public.owns_property(l.property_id)
  )
);

create policy capital_repair_ledger_select
on public.capital_repair_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
);

-- =============================================================================
-- 4. WATER RPC: supabase/water_rpc.sql
-- =============================================================================

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

-- =============================================================================
-- 5. CAPITAL RPC: supabase/capital_repair_rpc.sql
-- =============================================================================

-- =============================================================================
-- AMADEUS 11 — capital repair RPC (SECURITY DEFINER)
-- =============================================================================
-- Writes via RPC only. Does not change support_fee, properties.debt,
-- meter_readings, or existing helpers.
-- Authorization: public.has_staff_role(...) — never a client-supplied role.
-- Empty staff.role is not администрация (enforced inside has_staff_role).
-- This file has no BEGIN/COMMIT.
--
-- OWNER A: create/charge/payment DENY; get_capital_repair_balance own ALLOW.
-- ADMIN / ACCOUNTANT: assessment, charge, payment, balance ALLOW.
-- ENGINEER / CLEANER: all capital finance RPC DENY.
-- =============================================================================

create or replace function public.create_capital_repair_assessment(
  p_title text,
  p_description text default null,
  p_decision_date date default current_date,
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

  if p_decision_date > current_date then
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

-- -----------------------------------------------------------------------------

create or replace function public.charge_capital_repair(
  p_property_id bigint,
  p_assessment_id uuid,
  p_amount_eur numeric,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  assessment_id uuid,
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
  v_amount numeric;
  v_note text;
  v_status text;
  v_row public.capital_repair_ledger%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if p_assessment_id is null then
    raise exception 'Assessment not found.';
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
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is distinct from p_assessment_id
       or v_row.kind is distinct from 'charge'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;

    return query
    select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  select a.status
    into v_status
  from public.capital_repair_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found.';
  end if;

  if v_status is distinct from 'active' then
    raise exception 'Assessment is not active.';
  end if;

  if exists (
    select 1
    from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = p_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'Capital repair charge already exists for this property and assessment.';
  end if;

  begin
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    )
    values (
      p_property_id,
      p_assessment_id,
      'charge',
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
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if found then
        if v_row.property_id is distinct from p_property_id
           or v_row.assessment_id is distinct from p_assessment_id
           or v_row.kind is distinct from 'charge'
           or v_row.amount_eur is distinct from v_amount
           or v_row.note is distinct from v_note then
          raise exception 'Idempotency key conflict.';
        end if;
      else
        raise exception 'Capital repair charge already exists for this property and assessment.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$$;

revoke all on function public.charge_capital_repair(bigint, uuid, numeric, text, uuid) from public;
revoke all on function public.charge_capital_repair(bigint, uuid, numeric, text, uuid) from anon;
grant execute on function public.charge_capital_repair(bigint, uuid, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------

create or replace function public.record_capital_repair_payment(
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
  v_amount numeric;
  v_note text;
  v_row public.capital_repair_ledger%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
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
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is not null
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
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
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
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_row.property_id is distinct from p_property_id
         or v_row.assessment_id is not null
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

revoke all on function public.record_capital_repair_payment(bigint, numeric, text, uuid) from public;
revoke all on function public.record_capital_repair_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_capital_repair_payment(bigint, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------

create or replace function public.get_capital_repair_balance(
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
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
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
  from public.capital_repair_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_capital_repair_balance(bigint) from public;
revoke all on function public.get_capital_repair_balance(bigint) from anon;
grant execute on function public.get_capital_repair_balance(bigint) to authenticated;

-- =============================================================================
-- POST-DEPLOY ASSERTIONS
-- =============================================================================

do $deploy$
declare
  tbl text;
  water_tables text[] := array[
    'water_meters',
    'water_tariffs',
    'water_readings',
    'water_ledger',
    'capital_repair_assessments',
    'capital_repair_ledger'
  ];
  fn_sig text;
  business_fns text[] := array[
    'public.has_staff_role(text)',
    'public.assign_water_meter(bigint, text, numeric, date)',
    'public.replace_water_meter(bigint, text, numeric, text, date)',
    'public.set_water_tariff(numeric, date, text)',
    'public.submit_water_reading(bigint, numeric, date, uuid)',
    'public.record_water_payment(bigint, numeric, text, uuid)',
    'public.get_water_balance(bigint)',
    'public.create_capital_repair_assessment(text, text, date, date)',
    'public.charge_capital_repair(bigint, uuid, numeric, text, uuid)',
    'public.record_capital_repair_payment(bigint, numeric, text, uuid)',
    'public.get_capital_repair_balance(bigint)'
  ];
  public_deny_fns text[] := array[
    'public.has_staff_role(text)',
    'public.water_staff_role()',
    'public.assign_water_meter(bigint, text, numeric, date)',
    'public.replace_water_meter(bigint, text, numeric, text, date)',
    'public.set_water_tariff(numeric, date, text)',
    'public.submit_water_reading(bigint, numeric, date, uuid)',
    'public.record_water_payment(bigint, numeric, text, uuid)',
    'public.get_water_balance(bigint)',
    'public.create_capital_repair_assessment(text, text, date, date)',
    'public.charge_capital_repair(bigint, uuid, numeric, text, uuid)',
    'public.record_capital_repair_payment(bigint, numeric, text, uuid)',
    'public.get_capital_repair_balance(bigint)'
  ];
  all_fns text[] := public_deny_fns;
  policy_name text;
  policy_tables text[] := array[
    'water_meters',
    'water_tariffs',
    'water_readings',
    'water_ledger',
    'capital_repair_assessments',
    'capital_repair_ledger'
  ];
  policies text[] := array[
    'water_meters_select',
    'water_tariffs_select',
    'water_readings_select',
    'water_ledger_select',
    'capital_repair_assessments_select',
    'capital_repair_ledger_select'
  ];
  policy_i integer;
  qual text;
  with_check text;
  v_proc_oid oid;
  cfg text;
  search_ok boolean;
  public_exec boolean;
begin
  foreach fn_sig in array all_fns loop
    if to_regprocedure(fn_sig) is null then
      raise exception 'Post-deploy failed: function % is missing.', fn_sig;
    end if;
  end loop;

  foreach fn_sig in array all_fns loop
    v_proc_oid := to_regprocedure(fn_sig);
    if not exists (
      select 1 from pg_proc p where p.oid = v_proc_oid and p.prosecdef
    ) then
      raise exception 'Post-deploy failed: % is not SECURITY DEFINER.', fn_sig;
    end if;

    search_ok := false;
    for cfg in
      select unnest(coalesce(p.proconfig, array[]::text[]))
      from pg_proc p
      where p.oid = v_proc_oid
    loop
      if cfg like 'search_path=%'
         and btrim(substr(cfg, length('search_path=') + 1), '"') = '' then
        search_ok := true;
      end if;
    end loop;

    if not search_ok then
      raise exception 'Post-deploy failed: % does not have empty search_path.', fn_sig;
    end if;
  end loop;

  foreach fn_sig in array business_fns loop
    if not has_function_privilege('authenticated', fn_sig, 'EXECUTE') then
      raise exception 'Post-deploy failed: authenticated lacks EXECUTE on %.', fn_sig;
    end if;
    if has_function_privilege('anon', fn_sig, 'EXECUTE') then
      raise exception 'Post-deploy failed: anon has EXECUTE on %.', fn_sig;
    end if;
  end loop;

  if has_function_privilege('authenticated', 'public.water_staff_role()', 'EXECUTE') then
    raise exception 'Post-deploy failed: authenticated must not EXECUTE water_staff_role().';
  end if;
  if has_function_privilege('anon', 'public.water_staff_role()', 'EXECUTE') then
    raise exception 'Post-deploy failed: anon must not EXECUTE water_staff_role().';
  end if;
  if has_function_privilege('anon', 'public.has_staff_role(text)', 'EXECUTE') then
    raise exception 'Post-deploy failed: anon must not EXECUTE has_staff_role(text).';
  end if;

  foreach fn_sig in array public_deny_fns loop
    public_exec := exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) a
      where p.oid = to_regprocedure(fn_sig)
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    );
    if public_exec then
      raise exception 'Post-deploy failed: PUBLIC has EXECUTE on %.', fn_sig;
    end if;
  end loop;

  for policy_i in 1 .. array_length(policies, 1) loop
    tbl := policy_tables[policy_i];
    policy_name := policies[policy_i];
    select x.qual
      into qual
    from pg_policies x
    where x.schemaname = 'public'
      and x.tablename = tbl
      and x.policyname = policy_name
      and x.cmd = 'SELECT'
      and x.roles @> array['authenticated']::name[];

    if qual is null then
      raise exception 'Post-deploy failed: policy % on public.% is missing.', policy_name, tbl;
    end if;

    if qual ilike '%is_staff(%' then
      raise exception 'Post-deploy failed: policy % still uses is_staff().', policy_name;
    end if;
  end loop;

  select x.qual into qual from pg_policies x
  where x.schemaname = 'public' and x.policyname = 'water_meters_select';
  if qual is null
     or qual not like '%администрация%'
     or qual not like '%бухгалтер%'
     or qual not like '%инженер%'
     or qual like '%уборщик%' then
    raise exception 'Post-deploy failed: water_meters_select role matrix is wrong.';
  end if;

  select x.qual into qual from pg_policies x
  where x.schemaname = 'public' and x.policyname = 'water_tariffs_select';
  if qual is null
     or qual not like '%администрация%'
     or qual not like '%бухгалтер%'
     or qual not like '%инженер%'
     or qual like '%уборщик%' then
    raise exception 'Post-deploy failed: water_tariffs_select role matrix is wrong.';
  end if;

  select x.qual into qual from pg_policies x
  where x.schemaname = 'public' and x.policyname = 'water_readings_select';
  if qual is null
     or qual not like '%администрация%'
     or qual not like '%бухгалтер%'
     or qual not like '%инженер%'
     or qual like '%уборщик%' then
    raise exception 'Post-deploy failed: water_readings_select role matrix is wrong.';
  end if;

  select x.qual into qual from pg_policies x
  where x.schemaname = 'public' and x.policyname = 'water_ledger_select';
  if qual is null
     or qual not like '%администрация%'
     or qual not like '%бухгалтер%'
     or qual like '%инженер%'
     or qual like '%уборщик%' then
    raise exception 'Post-deploy failed: water_ledger_select role matrix is wrong.';
  end if;

  select x.qual into qual from pg_policies x
  where x.schemaname = 'public' and x.policyname = 'capital_repair_assessments_select';
  if qual is null
     or qual not like '%администрация%'
     or qual not like '%бухгалтер%'
     or qual not like '%owns_property%'
     or qual not like '%capital_repair_ledger%'
     or qual like '%инженер%'
     or qual like '%уборщик%' then
    raise exception 'Post-deploy failed: capital_repair_assessments_select role matrix is wrong.';
  end if;

  select x.qual into qual from pg_policies x
  where x.schemaname = 'public' and x.policyname = 'capital_repair_ledger_select';
  if qual is null
     or qual not like '%администрация%'
     or qual not like '%бухгалтер%'
     or qual like '%инженер%'
     or qual like '%уборщик%' then
    raise exception 'Post-deploy failed: capital_repair_ledger_select role matrix is wrong.';
  end if;

  select x.with_check into with_check
  from pg_policies x
  where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'INSERT'
    and x.policyname = 'staff_admin_insert';
  if with_check is null
     or with_check not like '%has_staff_role%'
     or with_check not like '%администрация%'
     or with_check ilike '%is_staff(%' then
    raise exception 'Post-deploy failed: staff INSERT policy is not administration-only.';
  end if;

  select x.qual, x.with_check into qual, with_check
  from pg_policies x
  where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'UPDATE'
    and x.policyname = 'staff_admin_update';
  if qual is null
     or qual not like '%has_staff_role%'
     or qual not like '%администрация%'
     or qual ilike '%is_staff(%'
     or coalesce(with_check, '') ilike '%is_staff(%' then
    raise exception 'Post-deploy failed: staff UPDATE policy is not administration-only.';
  end if;

  select x.qual into qual
  from pg_policies x
  where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'DELETE'
    and x.policyname = 'staff_admin_delete';
  if qual is null
     or qual not like '%has_staff_role%'
     or qual not like '%администрация%'
     or qual ilike '%is_staff(%' then
    raise exception 'Post-deploy failed: staff DELETE policy is not administration-only.';
  end if;

  if exists (
    select 1
    from pg_policies x
    where x.schemaname = 'public'
      and x.tablename = 'staff'
      and x.cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (
        coalesce(x.qual, '') ilike '%is_staff(%'
        or coalesce(x.with_check, '') ilike '%is_staff(%'
      )
  ) then
    raise exception 'Post-deploy failed: a staff WRITE policy still uses is_staff().';
  end if;

  foreach tbl in array water_tables loop
    if has_table_privilege('authenticated', 'public.' || tbl, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || tbl, 'DELETE') then
      raise exception 'Post-deploy failed: authenticated has direct write on public.%.', tbl;
    end if;

    if has_table_privilege('anon', 'public.' || tbl, 'SELECT')
       or has_table_privilege('anon', 'public.' || tbl, 'INSERT')
       or has_table_privilege('anon', 'public.' || tbl, 'UPDATE')
       or has_table_privilege('anon', 'public.' || tbl, 'DELETE') then
      raise exception 'Post-deploy failed: anon has privilege on public.%.', tbl;
    end if;
  end loop;
end;
$deploy$;

COMMIT;
