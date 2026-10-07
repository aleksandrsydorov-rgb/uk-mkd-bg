-- =============================================================================
-- Platform Support PREFLIGHT (READ-ONLY)
-- Safe BEFORE and AFTER migration 20261008010000_platform_support_module.sql.
--
-- Rules:
-- - Never static FROM / CALL of objects introduced by that migration.
-- - Missing migration objects → BOOTSTRAP_REQUIRED (expected pre-apply), not SQL error.
-- - Existing prerequisites (module_catalog / building_modules) still FAIL when broken.
-- =============================================================================

with objs as (
  select
    to_regclass('public.module_catalog') as module_catalog,
    to_regclass('public.building_modules') as building_modules,
    to_regclass('public.platform_installations') as platform_installations,
    to_regclass('public.platform_account_state') as platform_account_state,
    to_regclass('public.platform_support_threads') as platform_support_threads,
    to_regclass('public.platform_support_messages') as platform_support_messages,
    to_regclass('public.platform_billing_invoices') as platform_billing_invoices,
    to_regclass('public.platform_support_audit') as platform_support_audit,
    -- Not created by this migration (reserved name / future) — report INFO if absent.
    to_regclass('public.platform_billing_payments') as platform_billing_payments,
    to_regprocedure('public.platform_support_module_enabled()') as fn_module_enabled,
    to_regprocedure('public.platform_support_assert_admin()') as fn_assert_admin,
    to_regprocedure('public.platform_support_sanitize_tech_context(jsonb)') as fn_sanitize,
    to_regprocedure('public.platform_support_ensure_bootstrap(text,text)') as fn_bootstrap,
    to_regprocedure('public.platform_support_get_account(text,text)') as fn_get_account,
    to_regprocedure('public.platform_support_list_invoices(text,text)') as fn_list_invoices,
    to_regprocedure('public.platform_support_get_conversation(text,text)') as fn_get_conversation,
    to_regprocedure('public.platform_support_send_message(text,jsonb,text,text)') as fn_send_message,
    to_regprocedure('public.platform_support_mark_read(text,text)') as fn_mark_read,
    to_regprocedure('public.platform_support_unread_count(text,text)') as fn_unread_count,
    to_regprocedure('public.platform_support_audit_write(uuid,text,jsonb)') as fn_audit_write,
    to_regprocedure('public.platform_support_prevent_disable_trg()') as fn_prevent_disable_trg
),
prereq as (
  select
    case
      when o.module_catalog is null then 'FAIL'
      when exists (
        select 1
        from public.module_catalog c
        where c.module_key = 'platform_support' and c.implemented = true
      ) then 'OK'
      else 'BOOTSTRAP_REQUIRED'
    end as module_catalog_row,
    case
      when o.building_modules is null then 'FAIL'
      when exists (
        select 1
        from public.building_modules b
        where b.module_key = 'platform_support'
      ) then 'OK'
      else 'BOOTSTRAP_REQUIRED'
    end as building_modules_row,
    case
      when o.building_modules is null then 'FAIL'
      when not exists (
        select 1
        from public.building_modules b
        where b.module_key = 'platform_support'
      ) then 'BOOTSTRAP_REQUIRED'
      when exists (
        select 1
        from public.building_modules b
        where b.module_key = 'platform_support' and b.enabled = true
      ) then 'OK'
      else 'FAIL'
    end as platform_core_forced_enabled,
    case
      when o.module_catalog is null then 'FAIL'
      when exists (
        select 1
        from public.module_catalog
        where module_key in ('water', 'internet', 'chat', 'support_fee', 'budget')
      ) then 'OK'
      else 'INFO'
    end as unrelated_modules_untouched
  from objs o
),
checks as (
  select 'prereq_module_catalog' as check_id,
         case when o.module_catalog is not null then 'OK' else 'FAIL' end as status,
         'public.module_catalog must exist'::text as note
  from objs o
  union all
  select 'prereq_building_modules',
         case when o.building_modules is not null then 'OK' else 'FAIL' end,
         'public.building_modules must exist'
  from objs o
  union all
  select 'module_catalog_row', p.module_catalog_row,
         'module_catalog.platform_support implemented=true'
  from prereq p
  union all
  select 'building_modules_row', p.building_modules_row,
         'building_modules.platform_support present'
  from prereq p
  union all
  select 'platform_core_forced_enabled', p.platform_core_forced_enabled,
         'platform_support enabled when row exists (platform-core)'
  from prereq p
  union all
  select 'table_installations',
         case when o.platform_installations is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_installations'
  from objs o
  union all
  select 'table_account_state',
         case when o.platform_account_state is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_account_state'
  from objs o
  union all
  select 'table_threads',
         case when o.platform_support_threads is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_threads'
  from objs o
  union all
  select 'table_messages',
         case when o.platform_support_messages is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_messages'
  from objs o
  union all
  select 'table_invoices',
         case when o.platform_billing_invoices is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_billing_invoices'
  from objs o
  union all
  select 'table_audit',
         case when o.platform_support_audit is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_audit'
  from objs o
  union all
  select 'table_payments_absent_by_design',
         case
           when o.platform_billing_payments is null then 'INFO'
           else 'INFO'
         end,
         'platform_billing_payments not created by 20261008010000 (optional later)'
  from objs o
  union all
  select 'rpc_module_enabled',
         case when o.fn_module_enabled is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_module_enabled()'
  from objs o
  union all
  select 'rpc_assert_admin',
         case when o.fn_assert_admin is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_assert_admin()'
  from objs o
  union all
  select 'rpc_sanitize',
         case when o.fn_sanitize is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_sanitize_tech_context(jsonb)'
  from objs o
  union all
  select 'rpc_bootstrap',
         case when o.fn_bootstrap is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_ensure_bootstrap(text,text)'
  from objs o
  union all
  select 'rpc_get_account',
         case when o.fn_get_account is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_get_account(text,text)'
  from objs o
  union all
  select 'rpc_list_invoices',
         case when o.fn_list_invoices is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_list_invoices(text,text)'
  from objs o
  union all
  select 'rpc_get_conversation',
         case when o.fn_get_conversation is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_get_conversation(text,text)'
  from objs o
  union all
  select 'rpc_send_message',
         case when o.fn_send_message is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_send_message(text,jsonb,text,text)'
  from objs o
  union all
  select 'rpc_mark_read',
         case when o.fn_mark_read is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_mark_read(text,text)'
  from objs o
  union all
  select 'rpc_unread_count',
         case when o.fn_unread_count is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_unread_count(text,text)'
  from objs o
  union all
  select 'rpc_audit_write',
         case when o.fn_audit_write is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_audit_write(uuid,text,jsonb)'
  from objs o
  union all
  select 'fn_prevent_disable_trg',
         case when o.fn_prevent_disable_trg is not null then 'OK' else 'BOOTSTRAP_REQUIRED' end,
         'platform_support_prevent_disable_trg()'
  from objs o
  union all
  -- Row count must NOT static-FROM platform_billing_invoices (crashes pre-apply).
  -- Presence-only here; emptiness is verified post-apply via catalog stats / verify.sql.
  select 'no_invented_invoices',
         case
           when o.platform_billing_invoices is null then 'BOOTSTRAP_REQUIRED'
           when coalesce((
             select c.reltuples
             from pg_class c
             where c.oid = o.platform_billing_invoices
           ), 0) <= 0 then 'OK'
           else 'INFO'
         end,
         'invoice table absent pre-apply = BOOTSTRAP_REQUIRED; empty estimate via pg_class.reltuples when present'
  from objs o
  union all
  select 'unrelated_modules_untouched', p.unrelated_modules_untouched,
         'preflight does not mutate other modules; presence check only'
  from prereq p
)
select *
from checks
order by
  case status when 'FAIL' then 0 when 'BOOTSTRAP_REQUIRED' then 1 when 'INFO' then 2 else 3 end,
  check_id;
