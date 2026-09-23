-- =============================================================================
-- AMADEUS 11 — electricity finance verification (READ ONLY)
-- Encoding: UTF-8 (no BOM). Does not CREATE/ALTER/DROP/GRANT/INSERT/UPDATE.
-- =============================================================================

with defs as (
  select
    to_regclass('public.electricity_tariffs') as tariffs_rel,
    to_regclass('public.electricity_charges') as charges_rel,
    to_regclass('public.electricity_ledger') as ledger_rel,
    to_regprocedure('public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)') as submit_oid,
    to_regprocedure('public.set_electricity_tariff(numeric, numeric, date, text)') as tariff_oid,
    to_regprocedure('public.record_electricity_payment(bigint, numeric, text, uuid)') as pay_oid,
    to_regprocedure('public.get_electricity_balance(bigint)') as bal_oid
),
src as (
  select
    d.*,
    case when d.submit_oid is not null then pg_get_functiondef(d.submit_oid) else '' end as submit_def,
    case when d.tariff_oid is not null then pg_get_functiondef(d.tariff_oid) else '' end as tariff_def,
    case when d.pay_oid is not null then pg_get_functiondef(d.pay_oid) else '' end as pay_def,
    case when d.bal_oid is not null then pg_get_functiondef(d.bal_oid) else '' end as bal_def
  from defs as d
),
checks as (
  select 'exists'::text as check_type, 'electricity_tariffs'::text as item,
    case when tariffs_rel is not null then 'OK' else 'FAIL' end as result
  from src
  union all
  select 'exists', 'electricity_charges',
    case when charges_rel is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'electricity_ledger',
    case when ledger_rel is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'submit_electricity_reading',
    case when submit_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'set_electricity_tariff',
    case when tariff_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'record_electricity_payment',
    case when pay_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'exists', 'get_electricity_balance',
    case when bal_oid is not null then 'OK' else 'FAIL' end
  from src
  union all
  select 'column', 'electricity_tariffs.day_price_eur_per_kwh',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'electricity_tariffs'
        and column_name = 'day_price_eur_per_kwh'
    ) then 'OK' else 'FAIL' end
  union all
  select 'column', 'electricity_tariffs.night_price_eur_per_kwh',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'electricity_tariffs'
        and column_name = 'night_price_eur_per_kwh'
    ) then 'OK' else 'FAIL' end
  union all
  select 'unique', 'electricity_tariffs.valid_from',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_tariffs'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%valid_from%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'unique', 'electricity_charges.idempotency_key',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_charges'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%idempotency_key%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'unique', 'electricity_ledger.idempotency_key',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.electricity_ledger'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%idempotency_key%'
    ) then 'OK' else 'FAIL' end
  union all
  select 'rls_enabled', 'electricity_tariffs',
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_tariffs' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end
  union all
  select 'rls_enabled', 'electricity_charges',
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_charges' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end
  union all
  select 'rls_enabled', 'electricity_ledger',
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'electricity_ledger' and c.relrowsecurity
    ) then 'OK' else 'FAIL' end
  union all
  select 'no_write_policy', 'electricity_finance_tables',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename in ('electricity_tariffs', 'electricity_charges', 'electricity_ledger')
        and cmd <> 'SELECT'
    ) then 'FAIL' else 'OK' end
  union all
  select 'select_grant', 'electricity_tariffs',
    case when has_table_privilege('authenticated', 'public.electricity_tariffs', 'select') then 'OK' else 'FAIL' end
  union all
  select 'no_authenticated_write', 'electricity_tariffs',
    case when has_table_privilege('authenticated', 'public.electricity_tariffs', 'insert')
      or has_table_privilege('authenticated', 'public.electricity_tariffs', 'update')
      or has_table_privilege('authenticated', 'public.electricity_tariffs', 'delete')
    then 'FAIL' else 'OK' end
  union all
  select 'no_authenticated_write', 'electricity_charges',
    case when has_table_privilege('authenticated', 'public.electricity_charges', 'insert')
      or has_table_privilege('authenticated', 'public.electricity_charges', 'update')
      or has_table_privilege('authenticated', 'public.electricity_charges', 'delete')
    then 'FAIL' else 'OK' end
  union all
  select 'no_authenticated_write', 'electricity_ledger',
    case when has_table_privilege('authenticated', 'public.electricity_ledger', 'insert')
      or has_table_privilege('authenticated', 'public.electricity_ledger', 'update')
      or has_table_privilege('authenticated', 'public.electricity_ledger', 'delete')
    then 'FAIL' else 'OK' end
  union all
  select 'no_anon_table', 'electricity_tariffs',
    case when has_table_privilege('anon', 'public.electricity_tariffs', 'select')
      or has_table_privilege('anon', 'public.electricity_tariffs', 'insert')
    then 'FAIL' else 'OK' end
  union all
  select 'no_anon_table', 'electricity_charges',
    case when has_table_privilege('anon', 'public.electricity_charges', 'select')
      or has_table_privilege('anon', 'public.electricity_charges', 'insert')
    then 'FAIL' else 'OK' end
  union all
  select 'no_anon_table', 'electricity_ledger',
    case when has_table_privilege('anon', 'public.electricity_ledger', 'select')
      or has_table_privilege('anon', 'public.electricity_ledger', 'insert')
    then 'FAIL' else 'OK' end
  union all
  select 'execute_authenticated', 'submit_electricity_reading',
    case when submit_oid is not null
      and has_function_privilege('authenticated', submit_oid, 'execute')
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'no_anon_execute', 'submit_electricity_reading',
    case when submit_oid is null then 'FAIL'
      when has_function_privilege('anon', submit_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_anon_execute', 'record_electricity_payment',
    case when pay_oid is null then 'FAIL'
      when has_function_privilege('anon', pay_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_anon_execute', 'get_electricity_balance',
    case when bal_oid is null then 'FAIL'
      when has_function_privilege('anon', bal_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_anon_execute', 'set_electricity_tariff',
    case when tariff_oid is null then 'FAIL'
      when has_function_privilege('anon', tariff_oid, 'execute') then 'FAIL'
      else 'OK' end
  from src
  union all
  select 'no_public_execute', 'electricity_finance_rpcs',
    case when exists (
      select 1 from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name in (
          'submit_electricity_reading',
          'set_electricity_tariff',
          'record_electricity_payment',
          'get_electricity_balance'
        )
        and grantee = 'PUBLIC'
        and privilege_type = 'EXECUTE'
    ) then 'FAIL' else 'OK' end
  union all
  select 'submit_tariff_snapshot', 'submit_electricity_reading',
    case when submit_def ilike '%electricity_tariffs%'
      and submit_def ilike '%valid_from <= p_reading_date%'
      and submit_def ilike '%electricity_charges%'
      and submit_def ilike '%electricity_ledger%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'submit_server_calc', 'submit_electricity_reading',
    case when submit_def ilike '%round(v_cons_day * v_tariff.day_price_eur_per_kwh, 2)%'
      and submit_def ilike '%round(v_cons_night * v_tariff.night_price_eur_per_kwh, 2)%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'zero_consumption_no_ledger', 'submit_electricity_reading',
    case when submit_def ilike '%total_amount_eur > 0%'
      and submit_def ilike '%insert into public.electricity_ledger%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'no_backfill', 'submit_electricity_reading',
    case when submit_def ilike '%insert into public.electricity_charges%'
      and submit_def not ilike '%from public.meter_readings%backfill%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'payment_roles', 'record_electricity_payment',
    case when pay_def like '%has_staff_role(''администрация'')%'
      and pay_def like '%has_staff_role(''бухгалтер'')%'
      and pay_def not like '%has_staff_role(''инженер'')%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'tariff_roles', 'set_electricity_tariff',
    case when tariff_def like '%has_staff_role(''администрация'')%'
      and tariff_def like '%has_staff_role(''бухгалтер'')%'
      and tariff_def not like '%has_staff_role(''инженер'')%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'balance_roles', 'get_electricity_balance',
    case when bal_def like '%owns_property%'
      and bal_def like '%has_staff_role(''администрация'')%'
      and bal_def like '%has_staff_role(''бухгалтер'')%'
      and bal_def not like '%has_staff_role(''инженер'')%'
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'utf8_role_admin', 'record_electricity_payment',
    case when position('администрация' in pay_def) > 0
      and octet_length('администрация') = char_length('администрация') * 2
      and position(chr(65533) in pay_def) = 0
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'utf8_role_accountant', 'get_electricity_balance',
    case when position('бухгалтер' in bal_def) > 0
      and octet_length('бухгалтер') = char_length('бухгалтер') * 2
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'utf8_role_engineer_submit', 'submit_electricity_reading',
    case when position('инженер' in submit_def) > 0
      and octet_length('инженер') = char_length('инженер') * 2
    then 'OK' else 'FAIL' end
  from src
  union all
  select 'no_mojibake', 'finance_rpcs',
    case when position(chr(65533) in submit_def || pay_def || tariff_def || bal_def) > 0
    then 'FAIL' else 'OK' end
  from src
)
select check_type, item, result
from checks
order by
  case when result = 'FAIL' then 0 else 1 end,
  check_type,
  item;
