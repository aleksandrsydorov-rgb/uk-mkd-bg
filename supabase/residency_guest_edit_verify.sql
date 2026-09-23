-- =============================================================================
-- AMADEUS 11 — update_apartment_guest verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'rpc_exists' as check_id, 'update_apartment_guest' as item,
  case when to_regprocedure('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)') is not null
    then 'OK' else 'FAIL' end as result
union all
select 'search_path_empty', 'update_apartment_guest',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    like '%search_path%'
    then 'OK' else 'FAIL' end
union all
select 'security_definer', 'update_apartment_guest',
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_apartment_guest' and p.prosecdef
  ) then 'OK' else 'FAIL' end
union all
select 'uses_auth_email', 'update_apartment_guest',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    like '%auth.email()%'
    then 'OK' else 'FAIL' end
union all
select 'uses_owns_property', 'update_apartment_guest',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    like '%owns_property%'
    then 'OK' else 'FAIL' end
union all
select 'no_authenticated_table_update', 'apartment_guests',
  case when not has_table_privilege('authenticated', 'public.apartment_guests', 'UPDATE')
    then 'OK' else 'FAIL' end
union all
select 'no_property_id_param', 'cannot reassign property',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    not like '%p_property_id%'
    then 'OK' else 'FAIL' end
union all
select 'anon_no_execute', 'update_apartment_guest',
  case when not has_function_privilege('anon', 'public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)', 'EXECUTE')
    then 'OK' else 'FAIL' end
union all
select 'utf8_admin_literal', 'update_apartment_guest',
  case when position(
      convert_to(U&'\0430\0434\043C\0438\043D\0438\0441\0442\0440\0430\0446\0438\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end
union all
select 'delete_rls_owns_property', 'apartment_guests delete',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'apartment_guests' and cmd = 'DELETE'
      and coalesce(qual, '') like '%owns_property%'
  ) then 'OK' else 'FAIL' end
union all
select 'occupancy_status_untouched', 'properties.occupancy_status',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'occupancy_status'
  ) then 'OK' else 'FAIL' end
union all
select 'owns_property_untouched', 'owner_email',
  case when pg_get_functiondef('public.owns_property(bigint)'::regprocedure) like '%owner_email%'
    then 'OK' else 'FAIL' end
;
