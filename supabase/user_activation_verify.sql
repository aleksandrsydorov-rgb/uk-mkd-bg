-- =============================================================================
-- User Activation VERIFY (READ-ONLY after apply)
-- =============================================================================

with objs as (
  select
    to_regclass('public.user_activation_profiles') as profiles,
    to_regclass('public.user_activation_reminders') as reminders,
    to_regprocedure('public.admin_user_activation_dashboard()') as fn_dashboard,
    to_regprocedure('public.user_activation_touch_activity()') as fn_touch
),
checks as (
  select 'module_enabled_platform_core' as check_id,
         case when exists (
           select 1 from public.building_modules b
           where b.module_key = 'user_activation' and b.enabled = true
         ) then 'OK' else 'FAIL' end as status,
         'user_activation enabled'::text as note
  union all
  select 'is_platform_core_key',
         case when public.is_platform_core_module_key('user_activation') then 'OK' else 'FAIL' end,
         'is_platform_core_module_key(user_activation)'
  union all
  select 'rls_profiles',
         case when exists (
           select 1 from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'user_activation_profiles' and c.relrowsecurity
         ) then 'OK' else 'FAIL' end,
         'RLS on profiles'
  union all
  select 'no_direct_select_profiles',
         case
           when o.profiles is null then 'FAIL'
           when not has_table_privilege('authenticated', 'public.user_activation_profiles', 'select')
             then 'OK'
           else 'FAIL'
         end,
         'authenticated has no direct select on profiles'
  from objs o
  union all
  select 'execute_dashboard',
         case
           when o.fn_dashboard is null then 'FAIL'
           when has_function_privilege('authenticated', 'public.admin_user_activation_dashboard()', 'execute')
             then 'OK'
           else 'FAIL'
         end,
         'authenticated can execute dashboard'
  from objs o
  union all
  select 'execute_touch',
         case
           when o.fn_touch is null then 'FAIL'
           when has_function_privilege('authenticated', 'public.user_activation_touch_activity()', 'execute')
             then 'OK'
           else 'FAIL'
         end,
         'authenticated can execute touch_activity'
  from objs o
  union all
  select 'platform_core_trigger',
         case when exists (
           select 1 from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'building_modules'
             and t.tgname = 'platform_core_prevent_disable_biu'
             and not t.tgisinternal
         ) then 'OK' else 'FAIL' end,
         'platform_core_prevent_disable_biu'
  union all
  select 'module_enabled_always_true',
         case when public.user_activation_module_enabled() then 'OK' else 'FAIL' end,
         'user_activation_module_enabled() returns true'
)
select *
from checks
order by
  case status when 'FAIL' then 0 when 'INFO' then 1 else 2 end,
  check_id;
