-- =============================================================================
-- User Activation PREFLIGHT (READ-ONLY)
-- Safe BEFORE and AFTER migration 20261008020000_user_activation_module.sql.
-- No static FROM of migration-introduced tables.
-- =============================================================================

with objs as (
  select
    to_regclass('public.module_catalog') as module_catalog,
    to_regclass('public.building_modules') as building_modules,
    to_regclass('public.property_registry_people') as property_registry_people,
    to_regclass('public.property_access_invites') as property_access_invites,
    to_regclass('public.user_activation_profiles') as user_activation_profiles,
    to_regclass('public.user_activation_reminders') as user_activation_reminders,
    to_regclass('public.user_activation_audit') as user_activation_audit,
    to_regprocedure('public.admin_user_activation_dashboard()') as fn_dashboard,
    to_regprocedure('public.admin_user_activation_list(text,text)') as fn_list,
    to_regprocedure('public.admin_user_activation_create_reminder(text,text,bigint,text,boolean)') as fn_reminder,
    to_regprocedure('public.user_activation_touch_activity()') as fn_touch,
    to_regprocedure('public.is_platform_core_module_key(text)') as fn_core_key
),
prereq as (
  select
    case when o.module_catalog is not null then 'OK' else 'FAIL' end as module_catalog_present,
    case when o.building_modules is not null then 'OK' else 'FAIL' end as building_modules_present,
    case when o.property_registry_people is not null then 'OK' else 'FAIL' end as book_present,
    case when o.property_access_invites is not null then 'OK' else 'FAIL' end as invites_present,
    case
      when o.module_catalog is null then 'FAIL'
      when exists (
        select 1 from public.module_catalog c
        where c.module_key = 'user_activation' and c.implemented = true
      ) then 'OK'
      else 'BOOTSTRAP_REQUIRED'
    end as catalog_row,
    case
      when o.building_modules is null then 'FAIL'
      when not exists (
        select 1 from public.building_modules b where b.module_key = 'user_activation'
      ) then 'BOOTSTRAP_REQUIRED'
      when exists (
        select 1 from public.building_modules b
        where b.module_key = 'user_activation' and b.enabled = true
      ) then 'OK'
      else 'FAIL'
    end as platform_core_enabled
  from objs o
),
checks as (
  select 'prereq_module_catalog' as check_id, p.module_catalog_present as status,
         'module_catalog must exist'::text as note from prereq p
  union all
  select 'prereq_building_modules', p.building_modules_present, 'building_modules must exist' from prereq p
  union all
  select 'prereq_property_book', p.book_present, 'property_registry_people must exist' from prereq p
  union all
  select 'prereq_invites', p.invites_present, 'property_access_invites must exist' from prereq p
  union all
  select 'catalog_user_activation', p.catalog_row, 'module_catalog.user_activation implemented' from prereq p
  union all
  select 'building_modules_forced_on', p.platform_core_enabled, 'user_activation enabled (platform-core)' from prereq p
  union all
  select 'table_profiles',
         case when o.user_activation_profiles is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'user_activation_profiles'
  from objs o
  union all
  select 'table_reminders',
         case when o.user_activation_reminders is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'user_activation_reminders'
  from objs o
  union all
  select 'table_audit',
         case when o.user_activation_audit is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'user_activation_audit'
  from objs o
  union all
  select 'rpc_dashboard',
         case when o.fn_dashboard is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'admin_user_activation_dashboard'
  from objs o
  union all
  select 'rpc_list',
         case when o.fn_list is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'admin_user_activation_list'
  from objs o
  union all
  select 'rpc_reminder',
         case when o.fn_reminder is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'admin_user_activation_create_reminder'
  from objs o
  union all
  select 'rpc_touch',
         case when o.fn_touch is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'user_activation_touch_activity'
  from objs o
  union all
  select 'rpc_platform_core_key',
         case when o.fn_core_key is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'is_platform_core_module_key'
  from objs o
)
select *
from checks
order by
  case status when 'FAIL' then 0 when 'BOOTSTRAP_REQUIRED' then 1 when 'INFO' then 2 else 3 end,
  check_id;
