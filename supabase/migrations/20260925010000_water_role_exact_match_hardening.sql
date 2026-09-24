-- Residual SH-3 LOW: water_staff_role() lower/btrim-normalized staff roles.
-- Replace that helper and the four water RPCs that used it with exact
-- has_staff_role() checks. Authorized role sets stay as they are today.
-- Does not change meter, tariff, or payment business logic.

begin;

-- ---------------------------------------------------------------------------
-- Helper: exact canonical role only. No lower/btrim on role.
-- Email identity match stays the same as has_staff_role().
-- Client EXECUTE stays denied.
-- ---------------------------------------------------------------------------

create or replace function public.water_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select s.role
  from public.staff as s
  where lower(btrim(s.email)) = lower(btrim(auth.email()))
    and s.active is true
    and s.role in ('администрация', 'бухгалтер', 'инженер', 'уборщик')
  limit 1;
$fn$;

revoke all on function public.water_staff_role() from public;
revoke execute on function public.water_staff_role() from anon;
revoke execute on function public.water_staff_role() from authenticated;

-- ---------------------------------------------------------------------------
-- assign_water_meter: administration | инженер
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
$fn$;

revoke all on function public.assign_water_meter(bigint, text, numeric, date) from public;
revoke execute on function public.assign_water_meter(bigint, text, numeric, date) from anon;
grant execute on function public.assign_water_meter(bigint, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- replace_water_meter: administration | инженер
-- ---------------------------------------------------------------------------

create or replace function public.replace_water_meter(
  p_property_id bigint,
  p_new_meter_number text,
  p_new_initial_reading numeric,
  p_reason text,
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
  v_reason text;
  v_installed date;
  v_today date;
  v_old public.water_meters%rowtype;
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
$fn$;

revoke all on function public.replace_water_meter(bigint, text, numeric, text, date) from public;
revoke execute on function public.replace_water_meter(bigint, text, numeric, text, date) from anon;
grant execute on function public.replace_water_meter(bigint, text, numeric, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- set_water_tariff: administration | бухгалтер
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
declare
  v_email text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
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
$fn$;

revoke all on function public.set_water_tariff(numeric, date, text) from public;
revoke execute on function public.set_water_tariff(numeric, date, text) from anon;
grant execute on function public.set_water_tariff(numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_water_payment: administration | бухгалтер
-- ---------------------------------------------------------------------------

create or replace function public.record_water_payment(
  p_property_id bigint,
  p_amount_eur numeric,
  p_note text,
  p_idempotency_key uuid
)
returns table(
  ledger_id uuid,
  property_id bigint,
  amount_eur numeric,
  note text,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_row public.water_ledger%rowtype;
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
$fn$;

revoke all on function public.record_water_payment(bigint, numeric, text, uuid) from public;
revoke execute on function public.record_water_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_water_payment(bigint, numeric, text, uuid) to authenticated;

commit;
