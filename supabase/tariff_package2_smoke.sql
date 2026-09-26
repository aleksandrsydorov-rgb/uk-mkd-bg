-- =============================================================================
-- AMADEUS 11 - Tariff Core Package 2 FINAL smoke (BEGIN / ROLLBACK)
-- =============================================================================
-- Prerequisites:
--   - 20260926050000 + 20260926050100 applied
--   - published Core water + electricity versions for today
--   - admin@example.com active in public.staff and linked to auth.users
--
-- Actor selection is by email (no Cyrillic role literal dependency).
-- Property fixture uses numeric apartment_number + explicit floor.
-- ALL test data rolls back.
-- =============================================================================

begin;

do $smoke$
declare
  v_staff_email text;
  v_uid uuid;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_future date := v_today + 30;
  v_water_cat uuid;
  v_el_cat uuid;
  v_water_res record;
  v_el_res record;
  v_pub_id uuid;
  v_pub_id2 uuid;
  v_idem uuid := gen_random_uuid();
  v_cancel_idem uuid := gen_random_uuid();
  v_cancel_idem2 uuid := gen_random_uuid();
  v_prop bigint;
  v_prop2 bigint;
  v_apt bigint;
  v_water_meter uuid;
  v_el_meter uuid;
  v_old_water uuid;
  v_old_el uuid;
  v_submit record;
  v_submit2 record;
  v_key uuid;
  v_key_bad uuid;
  v_atomic_key uuid;
  v_snap_key uuid;
  v_version_a uuid;
  v_rate_a numeric;
  v_ledger_count int;
  v_resolved_future uuid;
  v_reject_ok boolean;
  v_future_pub uuid;
begin
  -- Auth actor: known linked administration test account
  select s.email, u.id
    into v_staff_email, v_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true
    and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id
  limit 1;

  if v_uid is null then
    raise exception 'smoke: admin@example.com is not active or not linked to auth.users';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_staff_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'email', v_staff_email)::text,
    true
  );

  select c.id into v_water_cat from public.tariff_catalog as c where c.tariff_key = 'water';
  select c.id into v_el_cat from public.tariff_catalog as c where c.tariff_key = 'electricity';
  if v_water_cat is null or v_el_cat is null then
    raise exception 'smoke: Core catalog missing water/electricity';
  end if;

  -- 1 Water resolver
  select * into v_water_res from public.resolve_utility_tariff('water', v_today);
  if v_water_res.tariff_version_id is null or (v_water_res.rates ->> 'base') is null then
    raise exception 'smoke#1 FAIL: water resolver';
  end if;

  -- 2/3 Electricity resolver; day+night same version
  select * into v_el_res from public.resolve_utility_tariff('electricity', v_today);
  if v_el_res.tariff_version_id is null
     or (v_el_res.rates ->> 'day') is null
     or (v_el_res.rates ->> 'night') is null then
    raise exception 'smoke#2/3 FAIL: electricity resolver';
  end if;

  -- 7 Core publish idempotency
  select version_id into v_pub_id
  from public.publish_tariff_version(
    v_water_cat, jsonb_build_object('base', 9.99), 'supplier_notice',
    'Package2 final smoke publish', v_idem, null, v_future, 'SMOKE-FINAL-1', null, null
  );
  select version_id into v_pub_id2
  from public.publish_tariff_version(
    v_water_cat, jsonb_build_object('base', 9.99), 'supplier_notice',
    'Package2 final smoke publish', v_idem, null, v_future, 'SMOKE-FINAL-1', null, null
  );
  if v_pub_id2 is distinct from v_pub_id then
    raise exception 'smoke#7 FAIL: publish idempotency';
  end if;

  -- 8 future cancellation idempotency
  perform public.cancel_future_tariff_version(v_pub_id, 'smoke cancel', v_cancel_idem);
  perform public.cancel_future_tariff_version(v_pub_id, 'smoke cancel', v_cancel_idem);

  -- 9 cancellation conflict (same cancel key, different reason)
  begin
    perform public.cancel_future_tariff_version(v_pub_id, 'different reason', v_cancel_idem);
    raise exception 'smoke#9 FAIL: cancel conflict should raise';
  exception
    when others then
      if SQLERRM ilike 'smoke#9 FAIL%' then raise; end if;
      if SQLERRM not ilike '%idempotency key conflict%' then
        raise exception 'smoke#9 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 10 effective/past cancellation rejected
  begin
    perform public.cancel_future_tariff_version(
      v_water_res.tariff_version_id, 'should fail', v_cancel_idem2
    );
    raise exception 'smoke#10 FAIL: past/effective cancel should raise';
  exception
    when others then
      if SQLERRM ilike 'smoke#10 FAIL%' then raise; end if;
      if SQLERRM not ilike '%effective or past%'
         and SQLERRM not ilike '%cannot be cancelled%' then
        raise exception 'smoke#10 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 4 cancelled future version never selected
  v_resolved_future := null;
  begin
    select r.tariff_version_id into v_resolved_future
    from public.resolve_utility_tariff('water', v_future) as r;
  exception
    when others then
      if SQLERRM ilike '%No water tariff configured%' then
        v_resolved_future := null;
      else
        raise;
      end if;
  end;
  if v_resolved_future is not distinct from v_pub_id then
    raise exception 'smoke#4 FAIL: cancelled version resolved';
  end if;

  -- 5/6 legacy publishers blocked
  begin
    perform public.set_water_tariff(1, v_today, 'x');
    raise exception 'smoke#5 FAIL: set_water_tariff should raise';
  exception
    when others then
      if SQLERRM ilike 'smoke#5 FAIL%' then raise; end if;
      if SQLERRM not ilike '%Legacy tariff publication disabled%' then
        raise exception 'smoke#5 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  begin
    perform public.set_electricity_tariff(1, 1, v_today, 'x');
    raise exception 'smoke#6 FAIL: set_electricity_tariff should raise';
  exception
    when others then
      if SQLERRM ilike 'smoke#6 FAIL%' then raise; end if;
      if SQLERRM not ilike '%Legacy tariff publication disabled%' then
        raise exception 'smoke#6 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- Fixture property (numeric apartment_number + explicit floor)
  select coalesce(max(apartment_number), 0) + 900000 into v_apt from public.properties;
  insert into public.properties (apartment_number, floor, owner_name, area_sqm)
  values (v_apt, 1, 'Smoke Package2 Final', 50)
  returning id into v_prop;

  insert into public.properties (apartment_number, floor, owner_name, area_sqm)
  values (v_apt + 1, 1, 'Smoke Package2 Final B', 50)
  returning id into v_prop2;

  insert into public.water_meters (
    property_id, meter_number, initial_reading, installed_at, assigned_by_email
  ) values (
    v_prop, 'SMOKE-W-' || v_prop::text, 10.0, v_today, v_staff_email
  ) returning id into v_water_meter;

  insert into public.electricity_meters (
    property_id, meter_number, initial_day_reading, initial_night_reading,
    installed_at, assigned_by_email
  ) values (
    v_prop, 'SMOKE-E-' || v_prop::text, 100, 50, v_today, v_staff_email
  ) returning id into v_el_meter;

  update public.building_settings
     set water_mode = 'owner_and_staff',
         electricity_mode = 'owner_and_staff'
   where id = 1;

  -- 11 equal water
  v_key := gen_random_uuid();
  select * into v_submit from public.submit_water_reading(v_prop, 10.0, v_today, v_key);
  if v_submit.consumption_m3 is distinct from 0 then
    raise exception 'smoke#11 FAIL: equal water';
  end if;

  -- 14 exact retry
  select * into v_submit2 from public.submit_water_reading(v_prop, 10.0, v_today, v_key);
  if v_submit2.reading_id is distinct from v_submit.reading_id then
    raise exception 'smoke#14 FAIL: water retry identity';
  end if;

  -- 15 same key + different value
  begin
    perform public.submit_water_reading(v_prop, 10.5, v_today, v_key);
    raise exception 'smoke#15 FAIL: changed value should conflict';
  exception
    when others then
      if SQLERRM ilike 'smoke#15 FAIL%' then raise; end if;
      if SQLERRM not ilike '%Idempotency key conflict%' then
        raise exception 'smoke#15 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 12 greater + 17/18 Core snapshot
  v_key := gen_random_uuid();
  select * into v_submit from public.submit_water_reading(v_prop, 11.0, v_today, v_key);
  if v_submit.consumption_m3 is distinct from 1.0 then
    raise exception 'smoke#12 FAIL: greater water';
  end if;
  if not exists (
    select 1 from public.water_readings as r
    where r.id = v_submit.reading_id
      and r.tariff_version_id is not null
      and r.tariff_id is null
      and r.tariff_eur_per_m3 is not null
  ) then
    raise exception 'smoke#17/18 FAIL: water Core snapshot';
  end if;

  -- 19 ledger not duplicated on retry
  select count(*) into v_ledger_count
  from public.water_ledger where reading_id = v_submit.reading_id and kind = 'charge';
  select * into v_submit2 from public.submit_water_reading(v_prop, 11.0, v_today, v_key);
  if (select count(*) from public.water_ledger where reading_id = v_submit.reading_id and kind = 'charge')
     <> v_ledger_count then
    raise exception 'smoke#19 FAIL: water ledger duplicate';
  end if;

  -- 13 lower same-meter SAME-DATE must reject (proves B1 fix: baseline is 11)
  begin
    perform public.submit_water_reading(v_prop, 10.5, v_today, gen_random_uuid());
    raise exception 'smoke#13 FAIL: lower same-date should reject';
  exception
    when others then
      if SQLERRM ilike 'smoke#13 FAIL%' then raise; end if;
      if SQLERRM not ilike '%cannot be lower%' then
        raise exception 'smoke#13 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 16 same key + different property
  insert into public.water_meters (
    property_id, meter_number, initial_reading, installed_at, assigned_by_email
  ) values (
    v_prop2, 'SMOKE-W2-' || v_prop2::text, 0, v_today, v_staff_email
  );
  begin
    perform public.submit_water_reading(v_prop2, 11.0, v_today, v_key);
    raise exception 'smoke#16 FAIL: different property should conflict';
  exception
    when others then
      if SQLERRM ilike 'smoke#16 FAIL%' then raise; end if;
      if SQLERRM not ilike '%Idempotency key conflict%' then
        raise exception 'smoke#16 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 20/21/22 replacement independent baseline; old retained; no leakage
  v_old_water := v_water_meter;
  perform public.replace_water_meter(v_prop, 'SMOKE-WR-' || v_prop::text, 0, 'smoke replace', v_today);
  select id into v_water_meter from public.water_meters
  where property_id = v_prop and retired_at is null;
  if not exists (
    select 1 from public.water_meters where id = v_old_water and retired_at is not null
  ) then
    raise exception 'smoke#21 FAIL: old water meter not retained';
  end if;
  v_key := gen_random_uuid();
  select * into v_submit from public.submit_water_reading(v_prop, 0, v_today, v_key);
  if v_submit.previous_value is distinct from 0 then
    raise exception 'smoke#20/22 FAIL: replacement baseline leaked old meter';
  end if;

  -- 23 reading before install rejected (use far past date on new meter)
  begin
    perform public.submit_water_reading(v_prop, 1, '2000-01-01'::date, gen_random_uuid());
    raise exception 'smoke#23 FAIL: before install should reject';
  exception
    when others then
      if SQLERRM ilike 'smoke#23 FAIL%' then raise; end if;
      if SQLERRM not ilike '%earlier than meter installation%'
         and SQLERRM not ilike '%earlier than previous%' then
        raise exception 'smoke#23 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- ELECTRICITY -----------------------------------------------

  -- 24 equal
  v_key := gen_random_uuid();
  select * into v_submit from public.submit_electricity_reading(v_prop, 100, 50, v_today, v_key);
  if v_submit.consumption_day is distinct from 0 or v_submit.consumption_night is distinct from 0 then
    raise exception 'smoke#24 FAIL: equal el';
  end if;

  -- 30 exact retry + 34 ledger not duplicated
  select count(*) into v_ledger_count from public.electricity_ledger where property_id = v_prop;
  select * into v_submit2 from public.submit_electricity_reading(v_prop, 100, 50, v_today, v_key);
  if v_submit2.day_reading_id is distinct from v_submit.day_reading_id then
    raise exception 'smoke#30 FAIL: el retry identity';
  end if;
  if (select count(*) from public.electricity_ledger where property_id = v_prop) <> v_ledger_count then
    raise exception 'smoke#34 FAIL: el ledger duplicate';
  end if;

  -- 31 same key + changed payload
  begin
    perform public.submit_electricity_reading(v_prop, 101, 50, v_today, v_key);
    raise exception 'smoke#31 FAIL: changed payload should conflict';
  exception
    when others then
      if SQLERRM ilike 'smoke#31 FAIL%' then raise; end if;
      if SQLERRM not ilike '%Idempotency key conflict%' then
        raise exception 'smoke#31 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 25 greater + 32/33 Core same-version snapshot
  v_snap_key := gen_random_uuid();
  select * into v_submit from public.submit_electricity_reading(v_prop, 110, 55, v_today, v_snap_key);
  if v_submit.consumption_day is distinct from 10 or v_submit.consumption_night is distinct from 5 then
    raise exception 'smoke#25 FAIL: greater el';
  end if;
  select c.tariff_version_id, c.day_tariff_eur_per_kwh
    into v_version_a, v_rate_a
  from public.electricity_charges as c
  where c.idempotency_key = v_snap_key;
  if v_version_a is null then
    raise exception 'smoke#32 FAIL: missing tariff_version_id';
  end if;
  if not exists (
    select 1 from public.electricity_charges as c
    where c.idempotency_key = v_snap_key
      and c.tariff_id is null
      and c.day_tariff_eur_per_kwh = v_submit.day_tariff_eur_per_kwh
      and c.night_tariff_eur_per_kwh = v_submit.night_tariff_eur_per_kwh
  ) then
    raise exception 'smoke#33 FAIL: day/night snapshot mismatch';
  end if;

  -- 26 lower day
  begin
    perform public.submit_electricity_reading(v_prop, 105, 60, v_today, gen_random_uuid());
    raise exception 'smoke#26 FAIL: lower day';
  exception
    when others then
      if SQLERRM ilike 'smoke#26 FAIL%' then raise; end if;
      if SQLERRM not ilike '%cannot be lower%' then
        raise exception 'smoke#26 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 27 lower night
  begin
    perform public.submit_electricity_reading(v_prop, 120, 54, v_today, gen_random_uuid());
    raise exception 'smoke#27 FAIL: lower night';
  exception
    when others then
      if SQLERRM ilike 'smoke#27 FAIL%' then raise; end if;
      if SQLERRM not ilike '%cannot be lower%' then
        raise exception 'smoke#27 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 28 same-day deterministic lower reject (baseline day=110)
  begin
    perform public.submit_electricity_reading(v_prop, 109.5, 56, v_today, gen_random_uuid());
    raise exception 'smoke#28 FAIL: same-day lower day';
  exception
    when others then
      if SQLERRM ilike 'smoke#28 FAIL%' then raise; end if;
      if SQLERRM not ilike '%cannot be lower%' then
        raise exception 'smoke#28 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 29 atomicity: fresh invalid key leaves zero partials
  v_atomic_key := gen_random_uuid();
  v_reject_ok := false;
  begin
    perform public.submit_electricity_reading(v_prop, 109, 60, v_today, v_atomic_key);
  exception
    when others then
      if SQLERRM ilike '%cannot be lower%' then
        v_reject_ok := true;
      else
        raise exception 'smoke#29 FAIL: unexpected: %', SQLERRM;
      end if;
  end;
  if not v_reject_ok then
    raise exception 'smoke#29 FAIL: invalid pair accepted';
  end if;
  if exists (select 1 from public.meter_readings where idempotency_key = v_atomic_key) then
    raise exception 'smoke#29 FAIL: partial meter_readings';
  end if;
  if exists (select 1 from public.electricity_charges where idempotency_key = v_atomic_key) then
    raise exception 'smoke#29 FAIL: partial electricity_charges';
  end if;
  if exists (select 1 from public.electricity_ledger where idempotency_key = v_atomic_key) then
    raise exception 'smoke#29 FAIL: partial electricity_ledger';
  end if;

  -- 39 retry does not use newly published live tariff
  -- Publish a future bait version; retry must keep original snapshot A
  -- (idempotent path returns stored charge — never re-resolves Core).
  select version_id into v_future_pub
  from public.publish_tariff_version(
    v_el_cat,
    jsonb_build_object('day', 99.99, 'night', 88.88),
    'supplier_notice',
    'Package2 final smoke live-tariff bait',
    gen_random_uuid(),
    null,
    v_today + 45,
    'SMOKE-FINAL-EL-BAIT',
    null,
    null
  );
  if v_future_pub is null then
    raise exception 'smoke#39 FAIL: bait publish returned null';
  end if;
  select * into v_submit2
  from public.submit_electricity_reading(v_prop, 110, 55, v_today, v_snap_key);
  if v_submit2.day_tariff_eur_per_kwh is distinct from v_rate_a then
    raise exception 'smoke#39 FAIL: retry used live/new tariff rate';
  end if;
  if exists (
    select 1 from public.electricity_charges as c
    where c.idempotency_key = v_snap_key
      and c.tariff_version_id is distinct from v_version_a
  ) then
    raise exception 'smoke#39 FAIL: retry changed tariff_version_id';
  end if;

  -- 40 readings exist without charge => fail closed (no live reprice)
  -- Simulate orphan pair under same transaction using a throwaway key on prop2 meter.
  insert into public.electricity_meters (
    property_id, meter_number, initial_day_reading, initial_night_reading,
    installed_at, assigned_by_email
  ) values (
    v_prop2, 'SMOKE-E2-' || v_prop2::text, 0, 0, v_today, v_staff_email
  );
  v_key_bad := gen_random_uuid();
  insert into public.meter_readings (
    property_id, meter_type, value, reading_date, submitted_by, submitted_source,
    idempotency_key, electricity_meter_id, created_at
  )
  select v_prop2, 'electricity_day', 1, v_today, v_staff_email, 'staff',
         v_key_bad, m.id, now()
  from public.electricity_meters as m
  where m.property_id = v_prop2 and m.retired_at is null;
  insert into public.meter_readings (
    property_id, meter_type, value, reading_date, submitted_by, submitted_source,
    idempotency_key, electricity_meter_id, created_at
  )
  select v_prop2, 'electricity_night', 1, v_today, v_staff_email, 'staff',
         v_key_bad, m.id, now()
  from public.electricity_meters as m
  where m.property_id = v_prop2 and m.retired_at is null;

  begin
    perform public.submit_electricity_reading(v_prop2, 1, 1, v_today, v_key_bad);
    raise exception 'smoke#40 FAIL: orphan pair should fail closed';
  exception
    when others then
      if SQLERRM ilike 'smoke#40 FAIL%' then raise; end if;
      if SQLERRM not ilike '%readings exist without charge snapshot%'
         and SQLERRM not ilike '%Idempotency key conflict%' then
        raise exception 'smoke#40 FAIL: unexpected: %', SQLERRM;
      end if;
  end;
  if exists (
    select 1 from public.electricity_charges where idempotency_key = v_key_bad
  ) then
    raise exception 'smoke#40 FAIL: orphan path created charge with live tariff';
  end if;

  -- 35/36/37 replacement
  v_old_el := v_el_meter;
  perform public.replace_electricity_meter(
    v_prop, 'SMOKE-ER-' || v_prop::text, 0, 0, v_today, 'smoke replace'
  );
  select id into v_el_meter from public.electricity_meters
  where property_id = v_prop and retired_at is null;
  if not exists (
    select 1 from public.electricity_meters where id = v_old_el and retired_at is not null
  ) then
    raise exception 'smoke#36 FAIL: old el meter not retained';
  end if;
  v_key := gen_random_uuid();
  select * into v_submit from public.submit_electricity_reading(v_prop, 0, 0, v_today, v_key);
  if v_submit.previous_day is distinct from 0 or v_submit.previous_night is distinct from 0 then
    raise exception 'smoke#35/37 FAIL: el replacement baseline leaked';
  end if;

  -- 38 reading date validation (before install)
  begin
    perform public.submit_electricity_reading(v_prop, 1, 1, '2000-01-01'::date, gen_random_uuid());
    raise exception 'smoke#38 FAIL: before install should reject';
  exception
    when others then
      if SQLERRM ilike 'smoke#38 FAIL%' then raise; end if;
      if SQLERRM not ilike '%earlier than meter installation%'
         and SQLERRM not ilike '%earlier than previous%' then
        raise exception 'smoke#38 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  raise notice 'tariff_package2_final_smoke: ALL CHECKS PASSED';
end;
$smoke$;

rollback;
