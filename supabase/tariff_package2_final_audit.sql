-- =============================================================================
-- AMADEUS 11 — Tariff Core Package 2 FINAL AUDIT (READ-ONLY)
-- =============================================================================
-- Safe: SELECT / catalog introspection only. No DDL/DML.
-- Run against production (or staging clone) after Package 2 apply.
-- FAIL rows sort first.
-- =============================================================================

with sofia_today as (
  select (now() at time zone 'Europe/Sofia')::date as d
),
schema_cols as (
  select
    c.table_name,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name in (
      'properties',
      'water_readings',
      'meter_readings',
      'electricity_charges',
      'water_meters',
      'electricity_meters',
      'water_ledger',
      'electricity_ledger',
      'water_tariffs',
      'electricity_tariffs',
      'tariff_versions',
      'tariff_rate_items',
      'tariff_catalog',
      'tariff_legacy_links',
      'building_settings'
    )
),
checks as (
  -- ------------------------------------------------------------------
  -- Schema presence / Package 2 columns
  -- ------------------------------------------------------------------
  select 'schema'::text as check_type, 'water_readings.tariff_version_id' as item,
    case when exists (
      select 1 from schema_cols
      where table_name = 'water_readings' and column_name = 'tariff_version_id'
    ) then 'OK' else 'FAIL' end as result,
    '{}'::jsonb as detail
  union all
  select 'schema', 'electricity_charges.tariff_version_id',
    case when exists (
      select 1 from schema_cols
      where table_name = 'electricity_charges' and column_name = 'tariff_version_id'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb
  union all
  select 'schema', 'water_readings.tariff_id_nullable',
    case when exists (
      select 1 from schema_cols
      where table_name = 'water_readings' and column_name = 'tariff_id' and is_nullable = 'YES'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb
  union all
  select 'schema', 'electricity_charges.tariff_id_nullable',
    case when exists (
      select 1 from schema_cols
      where table_name = 'electricity_charges' and column_name = 'tariff_id' and is_nullable = 'YES'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb

  union all
  select 'schema', 'properties.apartment_number_type',
    'INFO',
    coalesce(
      (
        select jsonb_build_object(
          'data_type', data_type,
          'udt_name', udt_name,
          'is_nullable', is_nullable,
          'column_default', column_default
        )
        from schema_cols
        where table_name = 'properties' and column_name = 'apartment_number'
      ),
      '{"missing": true}'::jsonb
    )
  union all
  select 'schema', 'properties.floor_nullability',
    case
      when not exists (
        select 1 from schema_cols where table_name = 'properties' and column_name = 'floor'
      ) then 'FAIL'
      when exists (
        select 1 from schema_cols
        where table_name = 'properties' and column_name = 'floor' and is_nullable = 'NO'
      ) then 'INFO'
      else 'INFO'
    end,
    coalesce(
      (
        select jsonb_build_object(
          'data_type', data_type,
          'udt_name', udt_name,
          'is_nullable', is_nullable,
          'column_default', column_default
        )
        from schema_cols
        where table_name = 'properties' and column_name = 'floor'
      ),
      '{"missing": true}'::jsonb
    )

  -- ------------------------------------------------------------------
  -- RPC signatures
  -- ------------------------------------------------------------------
  union all
  select 'rpc', name,
    case when to_regprocedure(sig) is not null then 'OK' else 'FAIL' end,
    '{}'::jsonb
  from (values
    ('resolve_utility_tariff', 'public.resolve_utility_tariff(text, date)'),
    ('get_applicable_utility_tariff', 'public.get_applicable_utility_tariff(text, date)'),
    ('submit_water_reading', 'public.submit_water_reading(bigint, numeric, date, uuid)'),
    ('submit_electricity_reading', 'public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'),
    ('assign_water_meter', 'public.assign_water_meter(bigint, text, numeric, date)'),
    ('replace_water_meter', 'public.replace_water_meter(bigint, text, numeric, text, date)'),
    ('assign_electricity_meter', 'public.assign_electricity_meter(bigint, text, numeric, numeric, date)'),
    ('replace_electricity_meter', 'public.replace_electricity_meter(bigint, text, numeric, numeric, date, text)'),
    ('set_water_tariff', 'public.set_water_tariff(numeric, date, text)'),
    ('set_electricity_tariff', 'public.set_electricity_tariff(numeric, numeric, date, text)'),
    ('publish_tariff_version', 'public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid)'),
    ('cancel_future_tariff_version', 'public.cancel_future_tariff_version(uuid, text, uuid)'),
    ('resolve_tariff_version_by_date', 'public.resolve_tariff_version_by_date(uuid, date)')
  ) as t(name, sig)

  -- ------------------------------------------------------------------
  -- Function body static checks (canonical definitions)
  -- ------------------------------------------------------------------
  union all
  select 'fn_body', 'submit_water_prev_order_nondeterministic',
    case
      when to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
           ~* 'order by[[:space:]]+r\.reading_date[[:space:]]+desc,[[:space:]]*r\.created_at[[:space:]]+desc'
           and pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
               !~* 'current_value[[:space:]]+desc'
        then 'FAIL'
      else 'OK'
    end,
    '{"expected":"reading_date desc, current_value desc, deterministic tie-break"}'::jsonb
  union all
  select 'fn_body', 'submit_electricity_prev_order_nondeterministic',
    case
      when to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
           ~* 'order by[[:space:]]+r\.reading_date[[:space:]]+desc,[[:space:]]*r\.created_at[[:space:]]+desc'
           and pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
               !~* 'r\.value[[:space:]]+desc|value[[:space:]]+desc'
        then 'FAIL'
      else 'OK'
    end,
    '{"expected":"reading_date desc, value desc, deterministic tie-break per register"}'::jsonb
  union all
  select 'fn_body', 'legacy_set_water_blocked',
    case
      when pg_get_functiondef('public.set_water_tariff(numeric, date, text)'::regprocedure)
           ilike '%Legacy tariff publication disabled%'
      then 'OK' else 'FAIL'
    end, '{}'::jsonb
  union all
  select 'fn_body', 'legacy_set_electricity_blocked',
    case
      when pg_get_functiondef('public.set_electricity_tariff(numeric, numeric, date, text)'::regprocedure)
           ilike '%Legacy tariff publication disabled%'
      then 'OK' else 'FAIL'
    end, '{}'::jsonb
  union all
  select 'fn_body', 'cancel_utility_gate_removed',
    case
      when pg_get_functiondef('public.cancel_future_tariff_version(uuid, text, uuid)'::regprocedure)
           ilike '%utility cancellation deferred%'
      then 'FAIL' else 'OK'
    end, '{}'::jsonb
  union all
  select 'fn_body', 'resolve_utility_no_when_others_mask',
    case
      when pg_get_functiondef('public.resolve_utility_tariff(text, date)'::regprocedure)
           ~* 'resolve_tariff_version_by_date[\s\S]{0,400}when[[:space:]]+others'
        then 'FAIL'
      when pg_get_functiondef('public.resolve_utility_tariff(text, date)'::regprocedure)
           ~* 'when[[:space:]]+sqlstate[[:space:]]+''P0002'''
        then 'OK'
      else 'INFO'
    end, '{}'::jsonb
  union all
  select 'fn_body', 'submit_water_prev_order_deterministic',
    case
      when to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
           ~* 'order by[[:space:]]+r\.reading_date[[:space:]]+desc,[[:space:]]*r\.current_value[[:space:]]+desc'
        then 'OK'
      else 'FAIL'
    end,
    '{"expected":"reading_date desc, current_value desc, created_at desc, id desc"}'::jsonb
  union all
  select 'fn_body', 'submit_electricity_prev_order_deterministic',
    case
      when to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
           ~* 'order by[[:space:]]+r\.reading_date[[:space:]]+desc,[[:space:]]*r\.value[[:space:]]+desc'
        then 'OK'
      else 'FAIL'
    end,
    '{"expected":"reading_date desc, value desc, created_at desc, id desc per register"}'::jsonb
  union all
  select 'fn_body', 'submit_electricity_orphan_fail_closed',
    case
      when to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
           ilike '%readings exist without charge snapshot%'
        then 'OK'
      else 'FAIL'
    end,
    '{"expected":"fail closed when readings exist without charge; never live-reprice"}'::jsonb
  union all
  select 'fn_body', 'submit_electricity_retry_recalc_live_tariff',
    case
      when to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
           ilike '%readings exist without charge snapshot%'
        then 'OK'
      when pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
           ~* 'v_charge\.id is not null[\s\S]{0,1200}v_day_rate'
           or (
             pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
             ilike '%round(v_cons_day * v_day_rate%'
             and pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
                 ilike '%if v_charge.id is not null%'
           )
        then 'FAIL'
      else 'FAIL'
    end,
    '{"note":"after integrity fix: orphan pair must fail closed; charge-present returns snapshot"}'::jsonb
  union all
  select 'fn_body', 'submit_water_ledger_uses_reading_idempotency_key',
    case
      when to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') is null then 'FAIL'
      when pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
           ~* 'insert into public\.water_ledger[\s\S]{0,800}p_idempotency_key'
           and pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
               !~* 'insert into public\.water_ledger[\s\S]{0,800}gen_random_uuid\(\)'
        then 'OK'
      else 'FAIL'
    end,
    '{"expected":"water_ledger.idempotency_key = reading p_idempotency_key"}'::jsonb
  union all
  select 'fn_body', 'submit_water_prev_for_update',
    case
      when pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
           ~* 'order by[[:space:]]+r\.reading_date[[:space:]]+desc,[[:space:]]*r\.current_value[[:space:]]+desc[\s\S]{0,120}for update'
        then 'OK'
      else 'INFO'
    end,
    '{"expected":"FOR UPDATE on chosen previous water reading"}'::jsonb
  union all
  select 'fn_body', 'submit_electricity_prev_for_update',
    case
      when pg_get_functiondef('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure)
           ~* 'order by[[:space:]]+r\.reading_date[[:space:]]+desc,[[:space:]]*r\.value[[:space:]]+desc[\s\S]{0,120}for update'
        then 'OK'
      else 'INFO'
    end,
    '{"expected":"FOR UPDATE on chosen previous electricity register readings"}'::jsonb

  -- ------------------------------------------------------------------
  -- Triggers / privileges
  -- ------------------------------------------------------------------
  union all
  select 'trigger', tgname || '@' || relname,
    'OK',
    jsonb_build_object('timing', tgtype)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
    and relname in ('water_tariffs', 'electricity_tariffs')
    and tgname ilike '%legacy%write%'
  union all
  select 'trigger', 'water_tariffs_legacy_write_block',
    case when exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'water_tariffs'
        and not t.tgisinternal and t.tgname ilike '%legacy%write%'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb
  union all
  select 'trigger', 'electricity_tariffs_legacy_write_block',
    case when exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_tariffs'
        and not t.tgisinternal and t.tgname ilike '%legacy%write%'
    ) then 'OK' else 'FAIL' end, '{}'::jsonb

  union all
  select 'priv', rel || '_no_authenticated_write',
    case when has_table_privilege('authenticated', 'public.' || rel, 'insert')
           or has_table_privilege('authenticated', 'public.' || rel, 'update')
           or has_table_privilege('authenticated', 'public.' || rel, 'delete')
         then 'FAIL' else 'OK' end,
    '{}'::jsonb
  from (values
    ('water_tariffs'),
    ('electricity_tariffs'),
    ('water_readings'),
    ('meter_readings'),
    ('electricity_charges'),
    ('water_ledger'),
    ('electricity_ledger'),
    ('tariff_catalog'),
    ('tariff_versions'),
    ('tariff_rate_items')
  ) as t(rel)

  -- ------------------------------------------------------------------
  -- Active meter anomalies
  -- ------------------------------------------------------------------
  union all
  select 'meter', 'water_multiple_active_per_property',
    case when exists (
      select 1 from public.water_meters
      where retired_at is null
      group by property_id having count(*) > 1
    ) then 'FAIL' else 'OK' end,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('property_id', property_id, 'cnt', cnt))
        from (
          select property_id, count(*)::int as cnt
          from public.water_meters
          where retired_at is null
          group by property_id
          having count(*) > 1
          limit 20
        ) s
      ),
      '[]'::jsonb
    )
  union all
  select 'meter', 'electricity_multiple_active_per_property',
    case when exists (
      select 1 from public.electricity_meters
      where retired_at is null
      group by property_id having count(*) > 1
    ) then 'FAIL' else 'OK' end,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('property_id', property_id, 'cnt', cnt))
        from (
          select property_id, count(*)::int as cnt
          from public.electricity_meters
          where retired_at is null
          group by property_id
          having count(*) > 1
          limit 20
        ) s
      ),
      '[]'::jsonb
    )

  -- ------------------------------------------------------------------
  -- Orphan / retired-meter linkage (electricity)
  -- ------------------------------------------------------------------
  union all
  select 'integrity', 'meter_readings_missing_electricity_meter_id',
    case when exists (
      select 1 from public.meter_readings
      where meter_type in ('electricity_day', 'electricity_night')
        and electricity_meter_id is null
    ) then 'FAIL' else 'OK' end,
    jsonb_build_object(
      'count',
      (select count(*)::int from public.meter_readings
       where meter_type in ('electricity_day', 'electricity_night')
         and electricity_meter_id is null)
    )
  union all
  select 'integrity', 'meter_readings_unknown_electricity_meter',
    case when exists (
      select 1
      from public.meter_readings as r
      where r.electricity_meter_id is not null
        and not exists (
          select 1 from public.electricity_meters as m where m.id = r.electricity_meter_id
        )
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  union all
  select 'integrity', 'water_readings_unknown_meter',
    case when exists (
      select 1
      from public.water_readings as r
      where not exists (select 1 from public.water_meters as m where m.id = r.meter_id)
    ) then 'FAIL' else 'OK' end, '{}'::jsonb

  -- ------------------------------------------------------------------
  -- Idempotency / partial pairs / duplicate charges
  -- ------------------------------------------------------------------
  union all
  select 'idempotency', 'water_duplicate_idempotency_keys',
    case when exists (
      select 1 from public.water_readings
      group by idempotency_key having count(*) > 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  union all
  select 'idempotency', 'electricity_partial_day_night_pairs',
    case when exists (
      with keys as (
        select idempotency_key
        from public.meter_readings
        where idempotency_key is not null
          and meter_type in ('electricity_day', 'electricity_night')
        group by idempotency_key
        having count(*) filter (where meter_type = 'electricity_day') <> 1
            or count(*) filter (where meter_type = 'electricity_night') <> 1
      )
      select 1 from keys
    ) then 'FAIL' else 'OK' end,
    coalesce(
      (
        select jsonb_agg(idempotency_key)
        from (
          select idempotency_key
          from public.meter_readings
          where idempotency_key is not null
            and meter_type in ('electricity_day', 'electricity_night')
          group by idempotency_key
          having count(*) filter (where meter_type = 'electricity_day') <> 1
              or count(*) filter (where meter_type = 'electricity_night') <> 1
          limit 20
        ) s
      ),
      '[]'::jsonb
    )
  union all
  select 'idempotency', 'electricity_duplicate_charge_keys',
    case when exists (
      select 1 from public.electricity_charges
      group by idempotency_key having count(*) > 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  union all
  select 'idempotency', 'electricity_readings_without_charge',
    case when exists (
      select 1
      from public.meter_readings as d
      join public.meter_readings as n
        on n.idempotency_key = d.idempotency_key
       and n.meter_type = 'electricity_night'
      where d.meter_type = 'electricity_day'
        and d.idempotency_key is not null
        and not exists (
          select 1 from public.electricity_charges as c
          where c.idempotency_key = d.idempotency_key
        )
    ) then 'FAIL' else 'OK' end,
    jsonb_build_object(
      'note', 'after integrity fix: orphan pairs must fail closed; historical orphans still flagged'
    )

  -- ------------------------------------------------------------------
  -- Same-date multi readings + monotonicity by physical meter
  -- ------------------------------------------------------------------
  union all
  select 'monotonicity', 'water_same_date_multi_readings',
    case when exists (
      select 1
      from public.water_readings
      where status = 'active'
      group by meter_id, reading_date
      having count(*) > 1
    ) then 'INFO' else 'OK' end,
    jsonb_build_object(
      'groups',
      coalesce(
        (
          select count(*)::int from (
            select 1
            from public.water_readings
            where status = 'active'
            group by meter_id, reading_date
            having count(*) > 1
          ) s
        ),
        0
      )
    )
  union all
  select 'monotonicity', 'water_regression_by_physical_meter',
    case when exists (
      with ordered as (
        select
          r.meter_id,
          r.reading_date,
          r.current_value,
          r.created_at,
          r.id,
          lag(r.current_value) over (
            partition by r.meter_id
            order by r.reading_date, r.current_value, r.created_at, r.id
          ) as prev_value
        from public.water_readings as r
        where r.status = 'active'
      )
      select 1 from ordered
      where prev_value is not null and current_value < prev_value
    ) then 'FAIL' else 'OK' end,
    coalesce(
      (
        with ordered as (
          select
            r.meter_id,
            r.reading_date,
            r.current_value,
            r.id,
            lag(r.current_value) over (
              partition by r.meter_id
              order by r.reading_date, r.current_value, r.created_at, r.id
            ) as prev_value
          from public.water_readings as r
          where r.status = 'active'
        )
        select jsonb_agg(jsonb_build_object(
          'meter_id', meter_id,
          'reading_date', reading_date,
          'current_value', current_value,
          'prev_value', prev_value,
          'id', id
        ))
        from (
          select * from ordered
          where prev_value is not null and current_value < prev_value
          limit 20
        ) x
      ),
      '[]'::jsonb
    )
  union all
  select 'monotonicity', 'electricity_day_regression_by_physical_meter',
    case when exists (
      with ordered as (
        select
          r.electricity_meter_id,
          r.reading_date,
          r.value,
          r.id,
          lag(r.value) over (
            partition by r.electricity_meter_id
            order by r.reading_date, r.value, r.created_at, r.id
          ) as prev_value
        from public.meter_readings as r
        where r.meter_type = 'electricity_day'
          and r.electricity_meter_id is not null
      )
      select 1 from ordered
      where prev_value is not null and value < prev_value
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  union all
  select 'monotonicity', 'electricity_night_regression_by_physical_meter',
    case when exists (
      with ordered as (
        select
          r.electricity_meter_id,
          r.reading_date,
          r.value,
          r.id,
          lag(r.value) over (
            partition by r.electricity_meter_id
            order by r.reading_date, r.value, r.created_at, r.id
          ) as prev_value
        from public.meter_readings as r
        where r.meter_type = 'electricity_night'
          and r.electricity_meter_id is not null
      )
      select 1 from ordered
      where prev_value is not null and value < prev_value
    ) then 'FAIL' else 'OK' end, '{}'::jsonb

  -- ------------------------------------------------------------------
  -- Tariff Core consistency / resolver
  -- ------------------------------------------------------------------
  union all
  select 'tariff', utility || '_unlinked_core_versions',
    case when unlinked = 0 then 'OK' else 'FAIL' end,
    jsonb_build_object('unlinked', unlinked)
  from (
    select 'water'::text as utility,
      (
        select count(*)::int
        from public.tariff_versions as tv
        join public.tariff_catalog as c on c.id = tv.tariff_id
        where c.tariff_key = 'water'
          and not exists (
            select 1 from public.tariff_legacy_links as l
            where l.version_id = tv.id and l.legacy_source = 'water_tariffs'
          )
      ) as unlinked
    union all
    select 'electricity',
      (
        select count(*)::int
        from public.tariff_versions as tv
        join public.tariff_catalog as c on c.id = tv.tariff_id
        where c.tariff_key = 'electricity'
          and not exists (
            select 1 from public.tariff_legacy_links as l
            where l.version_id = tv.id and l.legacy_source = 'electricity_tariffs'
          )
      )
  ) s
  union all
  select 'tariff', utility || '_dup_published_valid_from',
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = u.utility and tv.status = 'published'
      group by tv.valid_from
      having count(*) > 1
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  from (values ('water'), ('electricity')) as u(utility)

  union all
  select 'resolver', 'water_current',
    case
      when r.tariff_version_id is null then 'FAIL'
      when (r.rates ->> 'base') is null then 'FAIL'
      else 'OK'
    end,
    jsonb_build_object(
      'tariff_version_id', r.tariff_version_id,
      'valid_from', r.valid_from,
      'rates', r.rates
    )
  from public.resolve_utility_tariff('water', (select d from sofia_today)) as r
  union all
  select 'resolver', 'electricity_current',
    case
      when r.tariff_version_id is null then 'FAIL'
      when (r.rates ->> 'day') is null or (r.rates ->> 'night') is null then 'FAIL'
      else 'OK'
    end,
    jsonb_build_object(
      'tariff_version_id', r.tariff_version_id,
      'valid_from', r.valid_from,
      'rates', r.rates
    )
  from public.resolve_utility_tariff('electricity', (select d from sofia_today)) as r

  -- ------------------------------------------------------------------
  -- Post-cutover Core refs / snapshot sanity
  -- ------------------------------------------------------------------
  union all
  select 'snapshot', 'water_postcutover_missing_tariff_version',
    case when exists (
      select 1 from public.water_readings
      where tariff_id is null and tariff_version_id is null
    ) then 'FAIL' else 'OK' end,
    jsonb_build_object(
      'count',
      (select count(*)::int from public.water_readings
       where tariff_id is null and tariff_version_id is null)
    )
  union all
  select 'snapshot', 'electricity_postcutover_missing_tariff_version',
    case when exists (
      select 1 from public.electricity_charges
      where tariff_id is null and tariff_version_id is null
    ) then 'FAIL' else 'OK' end,
    jsonb_build_object(
      'count',
      (select count(*)::int from public.electricity_charges
       where tariff_id is null and tariff_version_id is null)
    )
  union all
  select 'snapshot', 'water_negative_or_null_rate_snapshot',
    case when exists (
      select 1 from public.water_readings
      where tariff_eur_per_m3 is null or tariff_eur_per_m3 < 0
    ) then 'FAIL' else 'OK' end, '{}'::jsonb
  union all
  select 'snapshot', 'electricity_negative_rate_snapshot',
    case when exists (
      select 1 from public.electricity_charges
      where day_tariff_eur_per_kwh < 0 or night_tariff_eur_per_kwh < 0
    ) then 'FAIL' else 'OK' end, '{}'::jsonb

  -- ------------------------------------------------------------------
  -- Cancelled vs effective anomalies
  -- ------------------------------------------------------------------
  union all
  select 'tariff', 'cancelled_but_valid_from_le_today',
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key in ('water', 'electricity')
        and tv.status = 'cancelled'
        and tv.valid_from <= (select d from sofia_today)
        and tv.cancelled_at is not null
        -- historical cancel of future-at-time-of-cancel is OK if valid_from was > today then;
        -- flag only if cancelled version would still be "effective window" incorrectly used
    ) then 'INFO' else 'OK' end,
    jsonb_build_object(
      'note', 'cancelled past/effective windows should never resolve; informational count',
      'count',
      (
        select count(*)::int
        from public.tariff_versions as tv
        join public.tariff_catalog as c on c.id = tv.tariff_id
        where c.tariff_key in ('water', 'electricity')
          and tv.status = 'cancelled'
          and tv.valid_from <= (select d from sofia_today)
      )
    )
)
select check_type, item, result, detail
from checks
order by
  case result when 'FAIL' then 0 when 'INFO' then 1 else 2 end,
  check_type,
  item;
