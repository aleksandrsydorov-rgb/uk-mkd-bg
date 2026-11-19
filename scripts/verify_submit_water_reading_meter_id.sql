-- Roll-back verification for submit_water_reading(p_meter_id).
-- Does not persist readings/charges. No emails.

BEGIN;

DO $verify$
DECLARE
  v_staff_email text := 'admin@e2e.local';
  v_uid uuid;
  v_multi_prop bigint;
  v_single_prop bigint;
  v_other_prop bigint;
  v_m1 uuid;
  v_m2 uuid;
  v_foreign uuid;
  v_single_meter uuid;
  v_key uuid;
  v_key2 uuid;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_row record;
  v_row2 record;
  v_prev1 numeric;
  v_prev2 numeric;
  v_cnt int;
  v_err text;
BEGIN
  SELECT u.id INTO v_uid
  FROM auth.users AS u
  WHERE lower(u.email) = lower(v_staff_email)
  LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'verify FAIL: missing staff user %', v_staff_email;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', v_staff_email, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'email', v_staff_email)::text,
    true
  );

  -- Multi-meter apartment (existing data)
  SELECT m.property_id INTO v_multi_prop
  FROM public.water_meters AS m
  WHERE m.retired_at IS NULL
  GROUP BY m.property_id
  HAVING count(*) >= 2
  ORDER BY count(*) DESC, m.property_id
  LIMIT 1;
  IF v_multi_prop IS NULL THEN
    RAISE EXCEPTION 'verify FAIL: no multi-meter property';
  END IF;

  SELECT m.id INTO v_m1
  FROM public.water_meters AS m
  WHERE m.property_id = v_multi_prop AND m.retired_at IS NULL
  ORDER BY m.meter_number, m.id
  LIMIT 1;

  SELECT m.id INTO v_m2
  FROM public.water_meters AS m
  WHERE m.property_id = v_multi_prop AND m.retired_at IS NULL AND m.id <> v_m1
  ORDER BY m.meter_number, m.id
  LIMIT 1;

  -- Single-meter apartment
  SELECT m.property_id, m.id INTO v_single_prop, v_single_meter
  FROM public.water_meters AS m
  WHERE m.retired_at IS NULL
  GROUP BY m.property_id, m.id
  HAVING (
    SELECT count(*) FROM public.water_meters AS x
    WHERE x.property_id = m.property_id AND x.retired_at IS NULL
  ) = 1
  ORDER BY m.property_id
  LIMIT 1;
  IF v_single_prop IS NULL THEN
    RAISE EXCEPTION 'verify FAIL: no single-meter property';
  END IF;

  -- Foreign meter from another apartment
  SELECT m.property_id, m.id INTO v_other_prop, v_foreign
  FROM public.water_meters AS m
  WHERE m.retired_at IS NULL AND m.property_id <> v_multi_prop
  ORDER BY m.property_id
  LIMIT 1;

  SELECT coalesce(
    (
      SELECT r.current_value
      FROM public.water_readings AS r
      WHERE r.meter_id = v_m1 AND r.status = 'active'
      ORDER BY r.reading_date DESC, r.current_value DESC, r.created_at DESC, r.id DESC
      LIMIT 1
    ),
    (SELECT mm.initial_reading FROM public.water_meters AS mm WHERE mm.id = v_m1)
  ) INTO v_prev1;

  SELECT coalesce(
    (
      SELECT r.current_value
      FROM public.water_readings AS r
      WHERE r.meter_id = v_m2 AND r.status = 'active'
      ORDER BY r.reading_date DESC, r.current_value DESC, r.created_at DESC, r.id DESC
      LIMIT 1
    ),
    (SELECT mm.initial_reading FROM public.water_meters AS mm WHERE mm.id = v_m2)
  ) INTO v_prev2;

  -- 1) Ambiguous call without meter_id must fail
  v_err := NULL;
  BEGIN
    PERFORM public.submit_water_reading(v_multi_prop, v_prev1 + 0.1, v_today, gen_random_uuid());
    RAISE EXCEPTION 'expected ambiguous reject';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err ILIKE '%expected ambiguous%' THEN RAISE; END IF;
      IF v_err NOT ILIKE '%Multiple active water meters%' THEN
        RAISE EXCEPTION 'verify#ambiguous FAIL: %', v_err;
      END IF;
  END;
  RAISE NOTICE 'OK ambiguous without meter_id';

  -- 2) Foreign meter must fail
  v_err := NULL;
  BEGIN
    PERFORM public.submit_water_reading(
      v_multi_prop, v_prev1 + 0.1, v_today, gen_random_uuid(), v_foreign
    );
    RAISE EXCEPTION 'expected foreign reject';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err ILIKE '%expected foreign%' THEN RAISE; END IF;
      IF v_err NOT ILIKE '%Water meter not found for property%' THEN
        RAISE EXCEPTION 'verify#foreign FAIL: %', v_err;
      END IF;
  END;
  RAISE NOTICE 'OK foreign meter rejected';

  -- 3) Independent readings for two meters
  v_key := gen_random_uuid();
  SELECT * INTO v_row
  FROM public.submit_water_reading(
    v_multi_prop, round(v_prev1 + 1.0, 1), v_today, v_key, v_m1
  );
  IF v_row.meter_id IS DISTINCT FROM v_m1 THEN
    RAISE EXCEPTION 'verify#m1 FAIL: meter_id %', v_row.meter_id;
  END IF;
  IF v_row.previous_value IS DISTINCT FROM round(v_prev1, 1) THEN
    RAISE EXCEPTION 'verify#m1 FAIL: previous % vs %', v_row.previous_value, v_prev1;
  END IF;

  v_key2 := gen_random_uuid();
  SELECT * INTO v_row2
  FROM public.submit_water_reading(
    v_multi_prop, round(v_prev2 + 2.0, 1), v_today, v_key2, v_m2
  );
  IF v_row2.meter_id IS DISTINCT FROM v_m2 THEN
    RAISE EXCEPTION 'verify#m2 FAIL: meter_id %', v_row2.meter_id;
  END IF;
  IF v_row2.previous_value IS DISTINCT FROM round(v_prev2, 1) THEN
    RAISE EXCEPTION 'verify#m2 FAIL: previous % vs %', v_row2.previous_value, v_prev2;
  END IF;
  IF v_row.reading_id = v_row2.reading_id THEN
    RAISE EXCEPTION 'verify#independent FAIL: same reading id';
  END IF;
  RAISE NOTICE 'OK independent meters m1=% m2=%', v_row.meter_id, v_row2.meter_id;

  -- 4) Idempotent retry (no duplicate)
  SELECT count(*) INTO v_cnt FROM public.water_readings WHERE meter_id = v_m1 AND status = 'active';
  SELECT * INTO v_row2
  FROM public.submit_water_reading(
    v_multi_prop, round(v_prev1 + 1.0, 1), v_today, v_key, v_m1
  );
  IF v_row2.reading_id IS DISTINCT FROM v_row.reading_id THEN
    RAISE EXCEPTION 'verify#idempotent FAIL: new reading id';
  END IF;
  IF (SELECT count(*) FROM public.water_readings WHERE meter_id = v_m1 AND status = 'active') <> v_cnt THEN
    RAISE EXCEPTION 'verify#idempotent FAIL: duplicate reading row';
  END IF;
  RAISE NOTICE 'OK idempotent retry';

  -- 5) Charge/history bind to same meter
  IF EXISTS (
    SELECT 1 FROM public.water_ledger AS l
    WHERE l.reading_id = v_row.reading_id AND l.kind = 'charge'
  ) AND v_row.meter_id IS DISTINCT FROM v_m1 THEN
    RAISE EXCEPTION 'verify#charge FAIL: meter mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.water_readings AS r
    WHERE r.id = v_row.reading_id AND r.meter_id = v_m1 AND r.property_id = v_multi_prop
  ) THEN
    RAISE EXCEPTION 'verify#history FAIL: reading not on meter';
  END IF;
  RAISE NOTICE 'OK charge/history meter bind';

  -- 6) Single-meter old 4-arg call works
  SELECT coalesce(
    (
      SELECT r.current_value
      FROM public.water_readings AS r
      WHERE r.meter_id = v_single_meter AND r.status = 'active'
      ORDER BY r.reading_date DESC, r.current_value DESC, r.created_at DESC, r.id DESC
      LIMIT 1
    ),
    (SELECT mm.initial_reading FROM public.water_meters AS mm WHERE mm.id = v_single_meter)
  ) INTO v_prev1;

  v_key := gen_random_uuid();
  SELECT * INTO v_row
  FROM public.submit_water_reading(
    v_single_prop, round(v_prev1 + 0.5, 1), v_today, v_key
  );
  IF v_row.meter_id IS DISTINCT FROM v_single_meter THEN
    RAISE EXCEPTION 'verify#single FAIL: meter %', v_row.meter_id;
  END IF;
  RAISE NOTICE 'OK single-meter 4-arg call';

  RAISE NOTICE 'ALL CHECKS PASSED (will rollback)';
END;
$verify$;

ROLLBACK;

SELECT count(*) AS properties_after FROM public.properties;
