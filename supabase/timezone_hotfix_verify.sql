-- =============================================================================
-- AMADEUS 11 — timezone hotfix verification (READ-ONLY)
-- =============================================================================
-- Does not CREATE/ALTER/DROP/GRANT. Safe after timezone_hotfix.sql.
-- Checks that the four date-validation RPC use Europe/Sofia and do not
-- compare future dates against current_date (UTC).
-- =============================================================================

with targets as (
  select *
  from (values
    ('assign_water_meter', 'public.assign_water_meter(bigint, text, numeric, date)'::regprocedure),
    ('replace_water_meter', 'public.replace_water_meter(bigint, text, numeric, text, date)'::regprocedure),
    ('submit_water_reading', 'public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure),
    ('create_capital_repair_assessment', 'public.create_capital_repair_assessment(text, text, date, date)'::regprocedure)
  ) as t(fn_name, fn_oid)
),
defs as (
  select
    t.fn_name,
    pg_get_functiondef(t.fn_oid) as def
  from targets as t
),
checks as (
  select
    'exists'::text as check_type,
    t.fn_name as item,
    case when t.fn_oid is not null then 'OK' else 'FAIL' end as result
  from targets as t

  union all
  select
    'europe_sofia',
    d.fn_name,
    case
      when d.def like '%Europe/Sofia%' then 'OK'
      else 'FAIL'
    end
  from defs as d

  union all
  select
    'no_current_date_future',
    d.fn_name,
    case
      when d.def ~* '>[ \t\n]*current_date'
        or d.def ~* 'current_date[ \t\n]*>' then 'FAIL'
      else 'OK'
    end
  from defs as d

  union all
  select
    'no_current_date_in_def',
    d.fn_name,
    case
      when d.def ~* 'current_date' then 'FAIL'
      else 'OK'
    end
  from defs as d

  union all
  select
    'execute_authenticated',
    t.fn_name,
    case when has_function_privilege('authenticated', t.fn_oid, 'execute')
      then 'OK' else 'FAIL' end
  from targets as t

  union all
  select
    'no_execute_anon',
    t.fn_name,
    case when has_function_privilege('anon', t.fn_oid, 'execute')
      then 'FAIL' else 'OK' end
  from targets as t
),
final_rows as (
  select check_type, item, result
  from checks
)
select
  check_type,
  item,
  result
from final_rows
order by check_type, item;

select
  case
    when exists (select 1 from (
      select 1
      from (values
        ('assign_water_meter', 'public.assign_water_meter(bigint, text, numeric, date)'::regprocedure),
        ('replace_water_meter', 'public.replace_water_meter(bigint, text, numeric, text, date)'::regprocedure),
        ('submit_water_reading', 'public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure),
        ('create_capital_repair_assessment', 'public.create_capital_repair_assessment(text, text, date, date)'::regprocedure)
      ) as t(fn_name, fn_oid)
      where pg_get_functiondef(t.fn_oid) not like '%Europe/Sofia%'
         or pg_get_functiondef(t.fn_oid) ~* 'current_date'
    ) as bad)
    then 'FAIL'
    else 'OK'
  end as timezone_hotfix_summary;
