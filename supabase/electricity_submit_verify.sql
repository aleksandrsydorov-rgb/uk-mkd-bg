-- =============================================================================
-- AMADEUS 11 — electricity submit verification (READ ONLY)
-- =============================================================================
-- Does not CREATE/ALTER/DROP/GRANT/DELETE/INSERT/UPDATE.
--
-- Static checks on submit_electricity_reading + has_staff_role:
--   - staff = has_staff_role('администрация') OR has_staff_role('инженер')
--   - helper requires staff.active IS TRUE (NULL and FALSE are not staff)
--   - RPC does not use active IS NOT FALSE / direct public.staff lookup
--   - staff_only: IF NOT v_is_el_staff THEN DENY; source = staff
--     (does not require owns_property)
--   - owner_and_staff: staff branch before owner
--   - accountant / cleaner are not authorized roles in the RPC body
--
-- Runtime matrix (cannot impersonate here; follow from helper + branching):
--   administration active=true  → authorized
--   engineer        active=true  → authorized
--   administration active=NULL  → NOT authorized
--   engineer        active=false → NOT authorized
--   accountant                    → NOT authorized
--   cleaner                       → NOT authorized
-- Encoding: UTF-8. FAIL if role literals are mojibake (Р° / Рё / РЅ).
-- =============================================================================

with fn as (
  select
    to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') as fn_oid
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
  select 'exists'::text as check_type, 'submit_electricity_reading'::text as item,
    case when fn_oid is not null then 'OK' else 'FAIL' end as result
  from fn

  union all
  select 'security_definer', 'submit_electricity_reading',
    case when prosecdef then 'OK' else 'FAIL' end
  from defs

  union all
  select 'empty_search_path', 'submit_electricity_reading',
    case
      when exists (
        select 1 from unnest(proconfig) as cfg(val)
        where cfg.val like 'search_path=%'
          and replace(replace(cfg.val, 'search_path=', ''), '"', '') = ''
      )
      or def ilike '%set search_path = ''''%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'execute_authenticated', 'submit_electricity_reading',
    case when has_function_privilege('authenticated', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from fn

  union all
  select 'no_execute_anon', 'submit_electricity_reading',
    case when has_function_privilege('anon', fn_oid, 'execute') then 'FAIL' else 'OK' end
  from fn

  union all
  select 'no_execute_public', 'submit_electricity_reading',
    case when has_function_privilege('public', fn_oid, 'execute') then 'FAIL' else 'OK' end
  from fn

  union all
  select 'owns_property', 'submit_electricity_reading',
    case when def like '%owns_property%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'mode_owner_and_staff', 'submit_electricity_reading',
    case when def like '%owner_and_staff%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'mode_staff_only', 'submit_electricity_reading',
    case when def like '%staff_only%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'mode_disabled', 'submit_electricity_reading',
    case when def like '%disabled%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'staff_only_independent', 'submit_electricity_reading',
    case
      when def ilike '%staff_only%'
       and def ilike '%if not v_is_el_staff then%'
       and def like '%v_via := ''staff''%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'staff_only_no_owns_required', 'submit_electricity_reading',
    case
      when def ilike '%staff_only%'
       and def like '%v_via := ''staff''%'
       and def not ilike '%s.active is not false%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'staff_before_owner_in_owner_and_staff', 'submit_electricity_reading',
    case
      when position('if v_is_el_staff then' in lower(def)) > 0
       and position('elsif v_is_owner then' in lower(def)) > 0
       and position('if v_is_el_staff then' in lower(def))
         < position('elsif v_is_owner then' in lower(def))
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'strict_has_staff_role_only', 'submit_electricity_reading',
    case
      when def like '%has_staff_role(''администрация'')%'
       and def like '%has_staff_role(''инженер'')%'
       and def not ilike '%s.active is not false%'
       and def not ilike '%from public.staff as s%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'role_literals_unicode', 'submit_electricity_reading',
    case
      when def like '%has_staff_role(''администрация'')%'
       and def like '%has_staff_role(''инженер'')%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'no_role_mojibake', 'submit_electricity_reading',
    case
      when def like '%Р°%'
        or def like '%Рё%'
        or def like '%РЅ%'
        or def like '%Ð°%'
        or def like '%Ð¸%'
        or def like '%Ð½%'
      then 'FAIL' else 'OK'
    end
  from defs

  union all
  select 'no_accountant_cleaner', 'submit_electricity_reading',
    case
      when def not like '%бухгалтер%' and def not like '%уборщик%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'helper_active_is_true', 'has_staff_role',
    case
      when to_regprocedure('public.has_staff_role(text)') is not null
       and pg_get_functiondef('public.has_staff_role(text)'::regprocedure) ilike '%s.active is true%'
       and pg_get_functiondef('public.has_staff_role(text)'::regprocedure) not ilike '%s.active is not false%'
      then 'OK' else 'FAIL'
    end

  union all
  select 'server_previous', 'submit_electricity_reading',
    case
      when def like '%electricity_day%'
       and def like '%cannot be lower than previous%'
       and def not like '%p_previous%'
      then 'OK' else 'FAIL'
    end
  from defs

  union all
  select 'property_lock', 'submit_electricity_reading',
    case when def ilike '%for update%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'idempotency', 'submit_electricity_reading',
    case when def like '%idempotency_key%' and def like '%Idempotency key conflict%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'auth_email_source', 'submit_electricity_reading',
    case when def like '%auth.email()%' and def like '%v_via%' then 'OK' else 'FAIL' end
  from defs

  union all
  select 'no_client_source', 'submit_electricity_reading',
    case when def like '%p_submitted%' or def like '%p_source%' then 'FAIL' else 'OK' end
  from defs

  union all
  select 'rls_enabled', 'meter_readings',
    case when relrowsecurity then 'OK' else 'FAIL' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'meter_readings'

  union all
  select 'no_insert_policy', 'meter_readings',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'meter_readings' and cmd = 'INSERT'
    ) then 'FAIL' else 'OK' end

  union all
  select 'no_update_policy', 'meter_readings',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'meter_readings' and cmd = 'UPDATE'
    ) then 'FAIL' else 'OK' end

  union all
  select 'no_delete_policy', 'meter_readings',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'meter_readings' and cmd = 'DELETE'
    ) then 'FAIL' else 'OK' end

  union all
  select 'select_owns_or_staff', 'meter_readings',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'meter_readings' and cmd = 'SELECT'
        and (
          coalesce(qual, '') like '%owns_property%'
          or coalesce(qual, '') like '%is_staff%'
        )
    ) then 'OK' else 'FAIL' end

  union all
  select 'no_table_insert_grant', 'meter_readings',
    case when has_table_privilege('authenticated', 'public.meter_readings', 'insert') then 'FAIL' else 'OK' end

  union all
  select 'no_anon_table', 'meter_readings',
    case when has_table_privilege('anon', 'public.meter_readings', 'insert') then 'FAIL' else 'OK' end

  union all
  select 'column', 'electricity_mode',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'building_settings' and column_name = 'electricity_mode'
    ) then 'OK' else 'FAIL' end

  union all
  select 'column', 'submitted_source',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'meter_readings' and column_name = 'submitted_source'
    ) then 'OK' else 'FAIL' end

  union all
  select 'column', 'idempotency_key',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'meter_readings' and column_name = 'idempotency_key'
    ) then 'OK' else 'FAIL' end

  union all
  select 'index', 'meter_readings_electricity_idempotency_idx',
    case when exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'meter_readings_electricity_idempotency_idx'
    ) then 'OK' else 'FAIL' end

  union all
  select 'mode_check_constraint', 'building_settings.electricity_mode',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.building_settings'::regclass
        and pg_get_constraintdef(oid) ilike '%owner_and_staff%'
        and pg_get_constraintdef(oid) ilike '%staff_only%'
        and pg_get_constraintdef(oid) ilike '%disabled%'
    ) then 'OK' else 'FAIL' end
)
select check_type, item, result
from checks
order by check_type, item;

select
  case
    when to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') is null then 'FAIL'
    else 'OK'
  end as electricity_submit_verify_summary;

-- Read-only: staff rows that fail has_staff_role() because active IS NULL.
select
  s.id,
  s.email,
  s.role,
  s.active
from public.staff as s
where s.active is null
order by lower(btrim(coalesce(s.email, ''))), s.id;
