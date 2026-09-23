-- =============================================================================
-- AMADEUS 11 — documents & decisions verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'table_exists' as check_id, tablename as item,
  case when to_regclass('public.' || tablename) is not null then 'OK' else 'FAIL' end as result
from (values
  ('building_documents'),
  ('general_meetings'),
  ('general_meeting_agenda_items'),
  ('general_meeting_decisions'),
  ('general_meeting_participants'),
  ('general_meeting_votes'),
  ('general_meeting_files')
) as t(tablename)

union all
select 'rls_enabled', c.relname,
  case when c.relrowsecurity then 'OK' else 'FAIL' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'building_documents','general_meetings','general_meeting_agenda_items',
    'general_meeting_decisions','general_meeting_participants',
    'general_meeting_votes','general_meeting_files'
  )

union all
select 'anon_no_select', tablename,
  case when not has_table_privilege('anon', 'public.' || tablename, 'SELECT') then 'OK' else 'FAIL' end
from (values
  ('building_documents'),('general_meetings'),('general_meeting_agenda_items'),
  ('general_meeting_decisions'),('general_meeting_participants'),
  ('general_meeting_votes'),('general_meeting_files')
) as t(tablename)

union all
select 'unique_participant_property', 'general_meeting_participants',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_participants'::regclass
      and contype = 'u'
  ) then 'OK' else 'FAIL' end

union all
select 'unique_agenda_position', 'general_meeting_agenda_items',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_agenda_items'::regclass
      and contype = 'u'
  ) then 'OK' else 'FAIL' end

union all
select 'snapshot_numeric', 'ideal_parts_percent_snapshot',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_meeting_participants'
      and column_name = 'ideal_parts_percent_snapshot' and numeric_precision >= 12
  ) then 'OK' else 'FAIL' end

union all
select 'properties_ideal_parts_untouched', 'properties.ideal_parts_percent',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'ideal_parts_percent'
  ) then 'OK' else 'FAIL' end

union all
select 'polls_untouched', 'polls',
  case when to_regclass('public.polls') is not null then 'OK' else 'FAIL' end

union all
select 'bucket_private', 'building-documents',
  case when exists (
    select 1 from storage.buckets where id = 'building-documents' and public is false
  ) then 'OK' else 'FAIL' end

union all
select 'rpc_search_path', proname,
  case when pg_get_functiondef(p.oid) like '%search_path%' then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'can_manage_building_governance','publish_general_meeting',
    'publish_general_meeting_minutes','archive_building_document','publish_building_document'
  )

union all
select 'rpc_security_definer', p.proname,
  case when p.prosecdef then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'can_manage_building_governance','publish_general_meeting',
    'publish_general_meeting_minutes','archive_building_document','publish_building_document'
  )

union all
select 'anon_no_execute', p.proname,
  case when not has_function_privilege('anon', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'can_manage_building_governance','publish_general_meeting',
    'publish_general_meeting_minutes','archive_building_document','publish_building_document'
  )

union all
select 'utf8_admin_literal', 'can_manage_building_governance',
  case when position(
      convert_to(U&'\0430\0434\043C\0438\043D\0438\0441\0442\0440\0430\0446\0438\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.can_manage_building_governance()'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end

union all
select 'owner_no_participant_catalog', 'general_meeting_participants owner policy',
  case when not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'general_meeting_participants' and cmd = 'SELECT'
      and coalesce(qual, '') like '%is_owner%'
  ) then 'OK' else 'FAIL' end

union all
select 'participants_admin_only_select', 'has_staff_role / can_manage',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'general_meeting_participants' and cmd = 'SELECT'
      and (coalesce(qual, '') like '%can_manage_building_governance%' or coalesce(qual, '') like '%has_staff_role%')
  ) then 'OK' else 'FAIL' end
;
