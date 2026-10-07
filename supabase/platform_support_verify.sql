-- =============================================================================
-- Platform Support VERIFY (READ-ONLY after apply)
-- Expect OK (INFO allowed for invoice count if Master synced later).
-- Guards object existence so a mistaken pre-apply run reports FAIL, not SQL crash.
-- =============================================================================

with objs as (
  select
    to_regclass('public.building_modules') as building_modules,
    to_regclass('public.platform_installations') as platform_installations,
    to_regclass('public.platform_support_messages') as platform_support_messages,
    to_regclass('public.platform_billing_invoices') as platform_billing_invoices,
    to_regprocedure('public.platform_support_get_account(text,text)') as fn_get_account,
    to_regprocedure('public.platform_support_send_message(text,jsonb,text,text)') as fn_send_message
),
checks as (
  select 'module_enabled_platform_core' as check_id,
         case
           when o.building_modules is null then 'FAIL'
           when exists (
             select 1 from public.building_modules b
             where b.module_key = 'platform_support' and b.enabled = true
           ) then 'OK'
           else 'FAIL'
         end as status,
         'platform_support enabled (platform-core)'::text as note
  from objs o
  union all
  select 'rls_installations',
         case when exists (
           select 1 from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'platform_installations' and c.relrowsecurity
         ) then 'OK' else 'FAIL' end,
         'RLS on platform_installations'
  from objs o
  union all
  select 'rls_messages',
         case when exists (
           select 1 from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'platform_support_messages' and c.relrowsecurity
         ) then 'OK' else 'FAIL' end,
         'RLS on platform_support_messages'
  from objs o
  union all
  select 'no_direct_select_grant',
         case
           when o.platform_support_messages is null then 'FAIL'
           when not has_table_privilege('authenticated', 'public.platform_support_messages', 'select')
             then 'OK'
           else 'FAIL'
         end,
         'authenticated has no direct select on messages'
  from objs o
  union all
  select 'no_direct_insert_grant',
         case
           when o.platform_support_messages is null then 'FAIL'
           when not has_table_privilege('authenticated', 'public.platform_support_messages', 'insert')
             then 'OK'
           else 'FAIL'
         end,
         'authenticated has no direct insert on messages'
  from objs o
  union all
  select 'execute_get_account',
         case
           when o.fn_get_account is null then 'FAIL'
           when has_function_privilege(
             'authenticated',
             'public.platform_support_get_account(text,text)',
             'execute'
           ) then 'OK'
           else 'FAIL'
         end,
         'authenticated can execute get_account'
  from objs o
  union all
  select 'execute_send_message',
         case
           when o.fn_send_message is null then 'FAIL'
           when has_function_privilege(
             'authenticated',
             'public.platform_support_send_message(text,jsonb,text,text)',
             'execute'
           ) then 'OK'
           else 'FAIL'
         end,
         'authenticated can execute send_message'
  from objs o
  union all
  select 'disable_guard_trigger',
         case when exists (
           select 1 from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'building_modules'
             and t.tgname in ('platform_core_prevent_disable_biu', 'platform_support_prevent_disable_biu')
             and not t.tgisinternal
         ) then 'OK' else 'FAIL' end,
         'prevent-disable trigger on building_modules (platform-core)'
  from objs o
  union all
  -- No static FROM platform_billing_invoices (would crash if verify run pre-apply).
  select 'invoice_table_empty_or_synced',
         case
           when o.platform_billing_invoices is null then 'FAIL'
           when coalesce((
             select c.reltuples
             from pg_class c
             where c.oid = o.platform_billing_invoices
           ), 0) <= 0 then 'OK'
           else 'INFO'
         end,
         case
           when o.platform_billing_invoices is null then 'platform_billing_invoices missing'
           else format(
             'invoices_reltuples=%s',
             coalesce((
               select c.reltuples
               from pg_class c
               where c.oid = o.platform_billing_invoices
             ), 0)
           )
         end
  from objs o
  union all
  select 'sender_role_constraint',
         case when exists (
           select 1 from pg_constraint
           where conname = 'platform_support_messages_role_chk'
         ) then 'OK' else 'FAIL' end,
         'sender_role check constraint'
  from objs o
)
select *
from checks
order by
  case status when 'FAIL' then 0 when 'INFO' then 1 else 2 end,
  check_id;
