-- =============================================================================
-- AMADEUS 11 — live electricity RPC inspection (READ ONLY)
-- =============================================================================
-- Does not CREATE/ALTER/DROP/GRANT/INSERT/UPDATE/DELETE.
-- Run in production SQL editor. Does not change business logic.
--
-- Frontend PostgREST call (admin submit):
--   rpc submit_electricity_reading
--   named args:
--     p_property_id       (JS number -> bigint)
--     p_day_reading       (numeric)
--     p_night_reading     (numeric)
--     p_reading_date      (date / ISO date string)
--     p_idempotency_key   (uuid)
-- Expected identity: submit_electricity_reading(bigint, numeric, numeric, date, uuid)
-- =============================================================================

-- 1) All overloads of submit_electricity_reading
select
  p.oid::regprocedure::text as signature,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result,
  p.prosecdef as security_definer
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_electricity_reading'
order by 1;

-- 2) Live source of every submit_electricity_reading overload
select
  p.oid::regprocedure::text as signature,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_electricity_reading'
order by 1;

-- 3) Live has_staff_role(text)
select pg_get_functiondef(
  'public.has_staff_role(text)'::regprocedure
) as has_staff_role_def;

-- 4) Helper overloads / search_path / security
select
  p.oid::regprocedure::text as signature,
  p.prosecdef as security_definer,
  p.proconfig as config,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'has_staff_role'
order by 1;
