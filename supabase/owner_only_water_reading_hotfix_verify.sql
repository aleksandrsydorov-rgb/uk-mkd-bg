-- =============================================================================
-- AMADEUS 11 — owner-only submit_water_reading verification (READ-ONLY)
-- =============================================================================
-- Does not CREATE/ALTER/DROP/GRANT/DELETE.
-- =============================================================================

with fn as (
  select
    to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') as fn_oid
),
defs as (
  select
    f.fn_oid,
    p.prosecdef,
    coalesce(p.proconfig, array[]::text[]) as proconfig,
    pg_get_functiondef(f.fn_oid) as def
  from fn as f
  join pg_proc as p on p.oid = f.fn_oid
),
checks as (
  select 'exists'::text as check_type, 'submit_water_reading'::text as item,
    case when fn_oid is not null then 'OK' else 'FAIL' end as result
  from fn

  union all
  select 'security_definer', 'submit_water_reading',
    case when prosecdef then 'OK' else 'FAIL' end
  from defs

  union all
  select 'empty_search_path', 'submit_water_reading',
    case
      when exists (
        select 1
        from unnest(proconfig) as cfg(val)
        where cfg.val like 'search_path=%'
          and replace(replace(cfg.val, 'search_path=', ''), '"', '') = ''
      )
      or def ilike '%set search_path to ''''%'
      or def ilike '%set search_path = ''''%'
      then 'OK'
      else 'FAIL'
    end
  from defs

  union all
  select 'execute_authenticated', 'submit_water_reading',
    case when has_function_privilege('authenticated', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from fn

  union all
  select 'no_execute_anon', 'submit_water_reading',
    case when has_function_privilege('anon', fn_oid, 'execute') then 'FAIL' else 'OK' end
  from fn

  union all
  select 'no_execute_public', 'submit_water_reading',
    case when has_function_privilege('public', fn_oid, 'execute') then 'FAIL' else 'OK' end
  from fn

  union all
  select 'owns_property', 'submit_water_reading',
    case when def like '%owns_property%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'no_water_staff_role', 'submit_water_reading',
    case when def like '%water_staff_role%' then 'FAIL' else 'OK' end
  from defs

  union all
  select 'no_staff_role_literals', 'submit_water_reading',
    case
      when def like '%администрация%'
        or def like '%бухгалтер%'
        or def like '%инженер%'
        or def like '%уборщик%'
      then 'FAIL'
      else 'OK'
    end
  from defs

  union all
  select 'submitted_via_owner', 'submit_water_reading',
    case when def like '%v_via := ''owner''%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'no_staff_via', 'submit_water_reading',
    case when def like '%v_via := ''staff''%' then 'FAIL' else 'OK' end
  from defs
),
final_rows as (
  select check_type, item, result
  from checks
)
select check_type, item, result
from final_rows
order by check_type;

-- Summary (independent read-only pass)
select
  case
    when (
      select count(*) filter (where result = 'FAIL')
      from (
        select
          case when to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') is null then 'FAIL' else 'OK' end as result
      ) as s
    ) > 0 then 'FAIL'
    else
      case
        when pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
             like '%owns_property%'
         and pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
             not like '%water_staff_role%'
         and pg_get_functiondef('public.submit_water_reading(bigint, numeric, date, uuid)'::regprocedure)
             like '%v_via := ''owner''%'
        then 'OK'
        else 'FAIL'
      end
  end as owner_only_water_reading_summary;
