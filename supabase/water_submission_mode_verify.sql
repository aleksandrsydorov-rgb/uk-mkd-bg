-- =============================================================================
-- AMADEUS 11 — water submission mode verification (READ ONLY)
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Does not CREATE/ALTER/DROP/GRANT/DELETE/INSERT/UPDATE.
-- =============================================================================

with defs as (
  select
    to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') as fn_oid,
    to_regprocedure('public.has_staff_role(text)') as helper_oid
),
src as (
  select
    d.*,
    case when d.fn_oid is not null then pg_get_functiondef(d.fn_oid) else '' end as def,
    case when d.helper_oid is not null then pg_get_functiondef(d.helper_oid) else '' end as helper_def
  from defs as d
),
checks as (
  select 'column'::text as check_type, 'water_mode'::text as item,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'building_settings' and column_name = 'water_mode'
    ) then 'OK' else 'FAIL' end as result

  union all
  select 'mode_check_constraint', 'building_settings.water_mode',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.building_settings'::regclass
        and pg_get_constraintdef(oid) ilike '%owner_and_staff%'
        and pg_get_constraintdef(oid) ilike '%staff_only%'
        and pg_get_constraintdef(oid) ilike '%disabled%'
        and pg_get_constraintdef(oid) ilike '%water_mode%'
    ) then 'OK' else 'FAIL' end

  union all
  select 'amadeus_mode', 'owner_and_staff',
    case when exists (
      select 1 from public.building_settings
      where id = 1 and coalesce(nullif(btrim(water_mode), ''), 'owner_and_staff') = 'owner_and_staff'
    ) then 'OK' else 'FAIL' end

  union all
  select 'function', 'submit_water_reading',
    case when fn_oid is not null then 'OK' else 'FAIL' end
  from src

  union all
  select 'security_definer', 'submit_water_reading',
    case when fn_oid is not null and (select prosecdef from pg_proc where oid = fn_oid) then 'OK' else 'FAIL' end
  from src

  union all
  select 'execute_authenticated', 'submit_water_reading',
    case when fn_oid is not null and has_function_privilege('authenticated', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_anon', 'submit_water_reading',
    case when fn_oid is not null and not has_function_privilege('anon', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_public', 'submit_water_reading',
    case when fn_oid is not null and not has_function_privilege('public', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'round_one_decimal', 'submit_water_reading',
    case
      when def like '%round(p_current_value, 1)%'
       and position('round(p_current_value, 3)' in def) = 0
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'mode_disabled', 'submit_water_reading',
    case when def like '%Water readings are disabled.%' then 'OK' else 'FAIL' end
  from src

  union all
  select 'mode_staff_only', 'submit_water_reading',
    case
      when def ilike '%staff_only%'
       and def ilike '%if not v_is_water_staff then%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'mode_owner_and_staff', 'submit_water_reading',
    case
      when def ilike '%owner_and_staff%'
       and def like '%owns_property%'
       and def ilike '%v_is_owner%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'staff_before_owner', 'submit_water_reading',
    case
      when position('if v_is_water_staff then' in lower(def)) > 0
       and position('elsif v_is_owner then' in lower(def)) > 0
       and position('if v_is_water_staff then' in lower(def))
         < position('elsif v_is_owner then' in lower(def))
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'roles_submit', 'submit_water_reading',
    case
      when def like '%has_staff_role(''администрация'')%'
       and def like '%has_staff_role(''инженер'')%'
       and def not like '%бухгалтер%'
       and def not like '%уборщик%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'helper_active_is_true', 'has_staff_role',
    case
      when helper_oid is not null
       and helper_def ilike '%s.active is true%'
       and helper_def not ilike '%s.active is not false%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'server_source', 'submit_water_reading',
    case
      when def like '%v_via := ''staff''%'
       and def like '%v_via := ''owner''%'
       and def not like '%p_submitted_via%'
       and def not like '%p_role%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'server_tariff_charge', 'submit_water_reading',
    case
      when def like '%water_tariffs%'
       and def like '%water_ledger%'
       and def like '%charge_amount_eur%'
       and def like '%previous_value%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'role_literals_unicode', 'submit_water_reading',
    case
      when def like '%has_staff_role(''администрация'')%'
       and def like '%has_staff_role(''инженер'')%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'no_role_mojibake', 'submit_water_reading',
    case
      when def like '%Р°%'
        or def like '%Ра%'
        or def like '%Ð%'
      then 'FAIL' else 'OK'
    end
  from src
)
select check_type, item, result
from checks
order by check_type, item;
