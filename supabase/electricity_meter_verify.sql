-- =============================================================================
-- AMADEUS 11 — electricity physical meter verification (READ ONLY)
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Does not CREATE/ALTER/DROP/GRANT/DELETE/INSERT/UPDATE.
-- =============================================================================

with defs as (
  select
    to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') as submit_oid,
    to_regprocedure('public.assign_electricity_meter(bigint, text, numeric, numeric, date)') as assign_oid,
    to_regprocedure('public.replace_electricity_meter(bigint, text, numeric, numeric, date, text)') as replace_oid,
    to_regprocedure('public.has_staff_role(text)') as helper_oid
),
src as (
  select
    d.*,
    case when d.submit_oid is not null then pg_get_functiondef(d.submit_oid) else '' end as submit_def,
    case when d.assign_oid is not null then pg_get_functiondef(d.assign_oid) else '' end as assign_def,
    case when d.replace_oid is not null then pg_get_functiondef(d.replace_oid) else '' end as replace_def
  from defs as d
),
checks as (
  select 'exists'::text as check_type, 'electricity_meters'::text as item,
    case when to_regclass('public.electricity_meters') is not null then 'OK' else 'FAIL' end as result

  union all
  select 'rls_enabled', 'electricity_meters',
    case when exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_meters' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end

  union all
  select 'unique_meter_number', 'electricity_meters',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_meters'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%meter_number%'
    ) then 'OK' else 'FAIL' end

  union all
  select 'one_active_per_property', 'electricity_meters',
    case when exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'electricity_meters_one_active_per_property_idx'
    ) then 'OK' else 'FAIL' end

  union all
  select 'column', 'meter_readings.electricity_meter_id',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'meter_readings' and column_name = 'electricity_meter_id'
    ) then 'OK' else 'FAIL' end

  union all
  select 'fk', 'meter_readings_electricity_meter_id_fkey',
    case when exists (
      select 1 from pg_constraint
      where conname = 'meter_readings_electricity_meter_id_fkey'
    ) then 'OK' else 'FAIL' end

  union all
  select 'select_grant', 'electricity_meters',
    case when has_table_privilege('authenticated', 'public.electricity_meters', 'select') then 'OK' else 'FAIL' end

  union all
  select 'no_authenticated_write', 'electricity_meters',
    case
      when has_table_privilege('authenticated', 'public.electricity_meters', 'insert')
        or has_table_privilege('authenticated', 'public.electricity_meters', 'update')
        or has_table_privilege('authenticated', 'public.electricity_meters', 'delete')
      then 'FAIL' else 'OK'
    end

  union all
  select 'no_anon_table', 'electricity_meters',
    case
      when has_table_privilege('anon', 'public.electricity_meters', 'select')
        or has_table_privilege('anon', 'public.electricity_meters', 'insert')
      then 'FAIL' else 'OK'
    end

  union all
  select 'policy', 'electricity_meters_select owner',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'electricity_meters' and policyname = 'electricity_meters_select'
        and qual like '%owns_property%'
    ) then 'OK' else 'FAIL' end

  union all
  select 'function', 'assign_electricity_meter',
    case when assign_oid is not null then 'OK' else 'FAIL' end
  from src

  union all
  select 'function', 'replace_electricity_meter',
    case when replace_oid is not null then 'OK' else 'FAIL' end
  from src

  union all
  select 'execute_authenticated', 'assign_electricity_meter',
    case when assign_oid is not null and has_function_privilege('authenticated', assign_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'execute_authenticated', 'replace_electricity_meter',
    case when replace_oid is not null and has_function_privilege('authenticated', replace_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_anon', 'assign_electricity_meter',
    case when assign_oid is not null and not has_function_privilege('anon', assign_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_anon', 'replace_electricity_meter',
    case when replace_oid is not null and not has_function_privilege('anon', replace_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_public', 'assign_electricity_meter',
    case when assign_oid is not null and not has_function_privilege('public', assign_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'roles_assign', 'assign_electricity_meter',
    case
      when assign_def like '%has_staff_role(''администрация'')%'
       and assign_def like '%has_staff_role(''инженер'')%'
       and assign_def not like '%бухгалтер%'
       and assign_def not like '%уборщик%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'roles_replace', 'replace_electricity_meter',
    case
      when replace_def like '%has_staff_role(''администрация'')%'
       and replace_def like '%has_staff_role(''инженер'')%'
       and replace_def not like '%бухгалтер%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'submit_uses_active_meter', 'submit_electricity_reading',
    case
      when submit_def like '%electricity_meters%'
       and submit_def like '%Electricity meter is not assigned.%'
       and submit_def like '%electricity_meter_id%'
       and submit_def like '%initial_day_reading%'
       and submit_def like '%initial_night_reading%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'submit_meter_scoped_previous', 'submit_electricity_reading',
    case
      when submit_def like '%r.electricity_meter_id = v_meter.id%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'replace_retains_old', 'replace_electricity_meter',
    case
      when replace_def ilike '%retired_at%'
       and replace_def not ilike '%delete from public.electricity_meters%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'role_literals_unicode', 'submit_electricity_reading',
    case
      when submit_def like '%has_staff_role(''администрация'')%'
       and submit_def like '%has_staff_role(''инженер'')%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'no_role_mojibake', 'submit_electricity_reading',
    case
      when submit_def like '%Р°%'
        or submit_def like '%Ра%'
        or assign_def like '%Ра%'
        or replace_def like '%Ра%'
        or submit_def like '%Ð%'
      then 'FAIL' else 'OK'
    end
  from src
)
select check_type, item, result
from checks
order by check_type, item;
