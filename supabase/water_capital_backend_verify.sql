-- =============================================================================
-- AMADEUS 11 — water + capital backend verification (READ-ONLY)
-- =============================================================================
-- Does not CREATE/ALTER/DROP/GRANT. Safe to run after
-- water_capital_backend_deploy.sql. Not a deployment script.
-- =============================================================================

with checks as (
  select 'helper'::text as check_type, 'has_staff_role(text)'::text as item,
    case when to_regprocedure('public.has_staff_role(text)') is not null then 'OK' else 'FAIL' end as result
  union all
  select 'helper', 'water_staff_role()',
    case when to_regprocedure('public.water_staff_role()') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'assign_water_meter',
    case when to_regprocedure('public.assign_water_meter(bigint, text, numeric, date)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'replace_water_meter',
    case when to_regprocedure('public.replace_water_meter(bigint, text, numeric, text, date)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'set_water_tariff',
    case when to_regprocedure('public.set_water_tariff(numeric, date, text)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'submit_water_reading',
    case when to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'record_water_payment',
    case when to_regprocedure('public.record_water_payment(bigint, numeric, text, uuid)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'get_water_balance',
    case when to_regprocedure('public.get_water_balance(bigint)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'create_capital_repair_assessment',
    case when to_regprocedure('public.create_capital_repair_assessment(text, text, date, date)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'charge_capital_repair',
    case when to_regprocedure('public.charge_capital_repair(bigint, uuid, numeric, text, uuid)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'record_capital_repair_payment',
    case when to_regprocedure('public.record_capital_repair_payment(bigint, numeric, text, uuid)') is not null then 'OK' else 'FAIL' end
  union all
  select 'function', 'get_capital_repair_balance',
    case when to_regprocedure('public.get_capital_repair_balance(bigint)') is not null then 'OK' else 'FAIL' end
  union all
  select 'rls', t.relname || ' enabled',
    case when c.relrowsecurity then 'OK' else 'FAIL' end
  from (values
    ('water_meters'),
    ('water_tariffs'),
    ('water_readings'),
    ('water_ledger'),
    ('capital_repair_assessments'),
    ('capital_repair_ledger')
  ) as t(relname)
  left join pg_class c
    on c.relname = t.relname
   and c.relnamespace = 'public'::regnamespace
  union all
  select 'policy', p.expected,
    case when exists (
      select 1
      from pg_policies x
      where x.schemaname = 'public'
        and x.tablename = p.tbl
        and x.policyname = p.expected
        and x.cmd = 'SELECT'
        and x.roles @> array['authenticated']::name[]
    ) then 'OK' else 'FAIL' end
  from (values
    ('water_meters', 'water_meters_select'),
    ('water_tariffs', 'water_tariffs_select'),
    ('water_readings', 'water_readings_select'),
    ('water_ledger', 'water_ledger_select'),
    ('capital_repair_assessments', 'capital_repair_assessments_select'),
    ('capital_repair_ledger', 'capital_repair_ledger_select')
  ) as p(tbl, expected)
  union all
  select 'policy_no_is_staff', x.policyname,
    case
      when x.qual ilike '%is_staff(%' then 'FAIL'
      else 'OK'
    end
  from pg_policies x
  where x.schemaname = 'public'
    and x.policyname in (
      'water_meters_select',
      'water_tariffs_select',
      'water_readings_select',
      'water_ledger_select',
      'capital_repair_assessments_select',
      'capital_repair_ledger_select'
    )
  union all
  select 'policy_roles', 'water_meters ops not cleaner',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.policyname = 'water_meters_select'
        and x.qual like '%администрация%'
        and x.qual like '%бухгалтер%'
        and x.qual like '%инженер%'
        and x.qual not like '%уборщик%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'policy_roles', 'water_tariffs ops not cleaner',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.policyname = 'water_tariffs_select'
        and x.qual like '%администрация%'
        and x.qual like '%бухгалтер%'
        and x.qual like '%инженер%'
        and x.qual not like '%уборщик%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'policy_roles', 'water_readings ops not cleaner',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.policyname = 'water_readings_select'
        and x.qual like '%администрация%'
        and x.qual like '%бухгалтер%'
        and x.qual like '%инженер%'
        and x.qual not like '%уборщик%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'policy_roles', 'water_ledger finance not engineer/cleaner',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.policyname = 'water_ledger_select'
        and x.qual like '%администрация%'
        and x.qual like '%бухгалтер%'
        and x.qual not like '%инженер%'
        and x.qual not like '%уборщик%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'policy_roles', 'capital assessments finance + owner EXISTS',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.policyname = 'capital_repair_assessments_select'
        and x.qual like '%администрация%'
        and x.qual like '%бухгалтер%'
        and x.qual like '%owns_property%'
        and x.qual like '%capital_repair_ledger%'
        and x.qual not like '%инженер%'
        and x.qual not like '%уборщик%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'policy_roles', 'capital ledger finance not engineer/cleaner',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.policyname = 'capital_repair_ledger_select'
        and x.qual like '%администрация%'
        and x.qual like '%бухгалтер%'
        and x.qual not like '%инженер%'
        and x.qual not like '%уборщик%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'privilege', 'authenticated SELECT ' || t.relname,
    case when has_table_privilege('authenticated', 'public.' || t.relname, 'SELECT') then 'OK' else 'FAIL' end
  from (values
    ('water_meters'),
    ('water_tariffs'),
    ('water_readings'),
    ('water_ledger'),
    ('capital_repair_assessments'),
    ('capital_repair_ledger')
  ) as t(relname)
  union all
  select 'privilege', 'authenticated NO write ' || t.relname,
    case when not has_table_privilege('authenticated', 'public.' || t.relname, 'INSERT')
          and not has_table_privilege('authenticated', 'public.' || t.relname, 'UPDATE')
          and not has_table_privilege('authenticated', 'public.' || t.relname, 'DELETE')
         then 'OK' else 'FAIL' end
  from (values
    ('water_meters'),
    ('water_tariffs'),
    ('water_readings'),
    ('water_ledger'),
    ('capital_repair_assessments'),
    ('capital_repair_ledger')
  ) as t(relname)
  union all
  select 'privilege', 'anon NO CRUD ' || t.relname,
    case when not has_table_privilege('anon', 'public.' || t.relname, 'SELECT')
          and not has_table_privilege('anon', 'public.' || t.relname, 'INSERT')
          and not has_table_privilege('anon', 'public.' || t.relname, 'UPDATE')
          and not has_table_privilege('anon', 'public.' || t.relname, 'DELETE')
         then 'OK' else 'FAIL' end
  from (values
    ('water_meters'),
    ('water_tariffs'),
    ('water_readings'),
    ('water_ledger'),
    ('capital_repair_assessments'),
    ('capital_repair_ledger')
  ) as t(relname)
  union all
  select 'execute', 'authenticated EXECUTE ' || f.sig,
    case when has_function_privilege('authenticated', f.sig, 'EXECUTE') then 'OK' else 'FAIL' end
  from (values
    ('public.has_staff_role(text)'),
    ('public.assign_water_meter(bigint, text, numeric, date)'),
    ('public.replace_water_meter(bigint, text, numeric, text, date)'),
    ('public.set_water_tariff(numeric, date, text)'),
    ('public.submit_water_reading(bigint, numeric, date, uuid)'),
    ('public.record_water_payment(bigint, numeric, text, uuid)'),
    ('public.get_water_balance(bigint)'),
    ('public.create_capital_repair_assessment(text, text, date, date)'),
    ('public.charge_capital_repair(bigint, uuid, numeric, text, uuid)'),
    ('public.record_capital_repair_payment(bigint, numeric, text, uuid)'),
    ('public.get_capital_repair_balance(bigint)')
  ) as f(sig)
  union all
  select 'execute', 'authenticated NO EXECUTE water_staff_role()',
    case when not has_function_privilege('authenticated', 'public.water_staff_role()', 'EXECUTE')
         then 'OK' else 'FAIL' end
  union all
  select 'execute', 'anon NO EXECUTE ' || f.sig,
    case when not has_function_privilege('anon', f.sig, 'EXECUTE') then 'OK' else 'FAIL' end
  from (values
    ('public.has_staff_role(text)'),
    ('public.water_staff_role()'),
    ('public.assign_water_meter(bigint, text, numeric, date)'),
    ('public.replace_water_meter(bigint, text, numeric, text, date)'),
    ('public.set_water_tariff(numeric, date, text)'),
    ('public.submit_water_reading(bigint, numeric, date, uuid)'),
    ('public.record_water_payment(bigint, numeric, text, uuid)'),
    ('public.get_water_balance(bigint)'),
    ('public.create_capital_repair_assessment(text, text, date, date)'),
    ('public.charge_capital_repair(bigint, uuid, numeric, text, uuid)'),
    ('public.record_capital_repair_payment(bigint, numeric, text, uuid)'),
    ('public.get_capital_repair_balance(bigint)')
  ) as f(sig)
  union all
  select 'execute', 'PUBLIC NO EXECUTE ' || f.sig,
    case when not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) a
      where p.oid = to_regprocedure(f.sig)
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then 'OK' else 'FAIL' end
  from (values
    ('public.has_staff_role(text)'),
    ('public.water_staff_role()'),
    ('public.assign_water_meter(bigint, text, numeric, date)'),
    ('public.replace_water_meter(bigint, text, numeric, text, date)'),
    ('public.set_water_tariff(numeric, date, text)'),
    ('public.submit_water_reading(bigint, numeric, date, uuid)'),
    ('public.record_water_payment(bigint, numeric, text, uuid)'),
    ('public.get_water_balance(bigint)'),
    ('public.create_capital_repair_assessment(text, text, date, date)'),
    ('public.charge_capital_repair(bigint, uuid, numeric, text, uuid)'),
    ('public.record_capital_repair_payment(bigint, numeric, text, uuid)'),
    ('public.get_capital_repair_balance(bigint)')
  ) as f(sig)
  union all
  select 'staff', 'STAFF INSERT POLICY',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'INSERT'
        and x.roles @> array['authenticated']::name[]
        and coalesce(x.with_check, '') like '%has_staff_role%'
        and coalesce(x.with_check, '') like '%администрация%'
        and coalesce(x.with_check, '') not ilike '%is_staff(%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'staff', 'STAFF UPDATE POLICY',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'UPDATE'
        and x.roles @> array['authenticated']::name[]
        and coalesce(x.qual, '') like '%has_staff_role%'
        and coalesce(x.qual, '') like '%администрация%'
        and coalesce(x.qual, '') not ilike '%is_staff(%'
        and coalesce(x.with_check, '') not ilike '%is_staff(%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'staff', 'STAFF DELETE POLICY',
    case when exists (
      select 1 from pg_policies x
      where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'DELETE'
        and x.roles @> array['authenticated']::name[]
        and coalesce(x.qual, '') like '%has_staff_role%'
        and coalesce(x.qual, '') like '%администрация%'
        and coalesce(x.qual, '') not ilike '%is_staff(%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'staff', 'STAFF ROLE ESCALATION',
    case when
      exists (
        select 1 from pg_policies x
        where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'INSERT'
          and coalesce(x.with_check, '') like '%has_staff_role%'
          and coalesce(x.with_check, '') like '%администрация%'
      )
      and exists (
        select 1 from pg_policies x
        where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'UPDATE'
          and coalesce(x.qual, '') like '%has_staff_role%'
          and coalesce(x.qual, '') like '%администрация%'
      )
      and exists (
        select 1 from pg_policies x
        where x.schemaname = 'public' and x.tablename = 'staff' and x.cmd = 'DELETE'
          and coalesce(x.qual, '') like '%has_staff_role%'
          and coalesce(x.qual, '') like '%администрация%'
      )
      and not exists (
        select 1 from pg_policies x
        where x.schemaname = 'public' and x.tablename = 'staff'
          and x.cmd in ('INSERT', 'UPDATE', 'DELETE')
          and (
            coalesce(x.qual, '') ilike '%is_staff(%'
            or coalesce(x.with_check, '') ilike '%is_staff(%'
          )
      )
    then 'OK' else 'FAIL' end
  union all
  select 'data', 'test water tariff 2026-09-22 / 0.5000 once',
    case when (
      select count(*) from public.water_tariffs
      where valid_from = date '2026-09-22' and price_eur_per_m3 = 0.5000
    ) = 1 then 'OK' else 'FAIL' end
),
final_rows as (
  select
    check_type,
    item,
    result
  from checks

  union all

  select
    'ALL CHECKS'::text,
    'backend verification'::text,
    case
      when count(*) filter (where result = 'FAIL') = 0
      then 'OK'
      else 'FAIL'
    end
  from checks
)
select
  check_type,
  item,
  result
from final_rows
order by
  case
    when check_type = 'ALL CHECKS' then 999
    else 1
  end,
  check_type,
  item;
