-- =============================================================================
-- AMADEUS 11 — general meeting lifecycle verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'column_exists' as check_id, column_name as item,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_meetings' and column_name = c.column_name
  ) then 'OK' else 'FAIL' end as result
from (values
  ('cancelled_at'),
  ('cancelled_by_email'),
  ('cancellation_reason'),
  ('rescheduled_from_meeting_id')
) as c(column_name)

union all
select 'no_supersedes_meeting_id', 'rescheduled_from_meeting_id only',
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_meetings'
      and column_name = 'supersedes_meeting_id'
  ) then 'OK' else 'FAIL' end

union all
select 'status_includes_rescheduled', 'general_meetings_status_chk',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meetings'::regclass
      and conname = 'general_meetings_status_chk'
      and pg_get_constraintdef(oid) like '%rescheduled%'
      and pg_get_constraintdef(oid) like '%cancelled%'
      and pg_get_constraintdef(oid) like '%draft%'
      and pg_get_constraintdef(oid) like '%published%'
  ) then 'OK' else 'FAIL' end

union all
select 'rpc_exists', proname,
  case when to_regprocedure('public.' || proname || sig) is not null then 'OK' else 'FAIL' end
from (values
  ('cancel_general_meeting','(uuid,text)'),
  ('reschedule_general_meeting','(uuid,date,time,text,text,text)')
) as t(proname, sig)

union all
select 'rpc_search_path', p.proname,
  case when pg_get_functiondef(p.oid) like '%search_path%' then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cancel_general_meeting','reschedule_general_meeting')

union all
select 'rpc_security_definer', p.proname,
  case when p.prosecdef then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cancel_general_meeting','reschedule_general_meeting')

union all
select 'anon_no_execute', p.proname,
  case when not has_function_privilege('anon', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cancel_general_meeting','reschedule_general_meeting')

union all
select 'public_no_execute', p.proname,
  case when not has_function_privilege('public', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cancel_general_meeting','reschedule_general_meeting')

union all
select 'lifecycle_uses_governance_not_is_staff', p.proname,
  case when pg_get_functiondef(p.oid) like '%can_manage_building_governance%'
        and pg_get_functiondef(p.oid) not like '%is_staff()%'
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cancel_general_meeting','reschedule_general_meeting')

union all
select 'utf8_admin_via_governance', 'can_manage_building_governance',
  case when position(
      convert_to(U&'\0430\0434\043C\0438\043D\0438\0441\0442\0440\0430\0446\0438\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.can_manage_building_governance()'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end

union all
select 'no_mojibake_admin', 'can_manage_building_governance',
  case when pg_get_functiondef('public.can_manage_building_governance()'::regprocedure)
         not like '%а%'
       then 'OK' else 'FAIL' end

union all
select 'delete_policy_draft_only', 'general_meetings_delete',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'general_meetings' and cmd = 'DELETE'
      and coalesce(qual, '') like '%draft%'
  ) then 'OK' else 'FAIL' end

union all
select 'quorum_stage_column', 'quorum_stage kept on same meeting',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_meetings' and column_name = 'quorum_stage'
  ) then 'OK' else 'FAIL' end

union all
select 'polls_untouched', 'polls',
  case when to_regclass('public.polls') is not null then 'OK' else 'FAIL' end
;
