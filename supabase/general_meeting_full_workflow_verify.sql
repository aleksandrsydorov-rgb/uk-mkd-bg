-- =============================================================================
-- AMADEUS 11 — general meeting full workflow verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'threshold_gt_50_eq' as check_id, '50 > 50'::text as item,
  case when public.gm_threshold_met(50::numeric, 'gt', 50::numeric) is false then 'OK' else 'FAIL' end as result
union all
select 'threshold_gt_50_plus', '50.000001 > 50',
  case when public.gm_threshold_met(50.000001::numeric, 'gt', 50::numeric) is true then 'OK' else 'FAIL' end
union all
select 'threshold_gte_51', '51 >= 51',
  case when public.gm_threshold_met(51::numeric, 'gte', 51::numeric) is true then 'OK' else 'FAIL' end
union all
select 'threshold_gte_50_999', '50.999999 >= 51',
  case when public.gm_threshold_met(50.999999::numeric, 'gte', 51::numeric) is false then 'OK' else 'FAIL' end
union all
select 'quorum_initial_51', 'initial',
  case when public.gm_quorum_required_percent('initial','standard_zues') = 51 then 'OK' else 'FAIL' end
union all
select 'quorum_hour_26', 'after_one_hour',
  case when public.gm_quorum_required_percent('after_one_hour','standard_zues') = 26 then 'OK' else 'FAIL' end
union all
select 'quorum_hour_not_26', '25.999999 vs 26',
  case when public.gm_threshold_met(25.999999::numeric, 'gte', 26::numeric) is false then 'OK' else 'FAIL' end
union all
select 'quorum_hour_met', '26 >= 26',
  case when public.gm_threshold_met(26::numeric, 'gte', 26::numeric) is true then 'OK' else 'FAIL' end
union all
select 'dominant_75_fail', '74.999999',
  case when public.gm_threshold_met(74.999999::numeric, 'gte', 75::numeric) is false then 'OK' else 'FAIL' end
union all
select 'dominant_75_met', '75',
  case when public.gm_threshold_met(75::numeric, 'gte', public.gm_quorum_required_percent('initial','dominant_owner_75')) is true then 'OK' else 'FAIL' end
union all
select 'next_day_no_auto_percent', 'next_day',
  case when public.gm_quorum_required_percent('next_day','standard_zues') is null then 'OK' else 'FAIL' end
union all
select 'case_a_represented', '30/55 > 50',
  case when public.gm_threshold_met((30::numeric/55)*100, 'gt', 50::numeric) is true then 'OK' else 'FAIL' end
union all
select 'case_b_all_51', '30 >= 51',
  case when public.gm_threshold_met(30::numeric, 'gte', 51::numeric) is false then 'OK' else 'FAIL' end
union all
select 'table_quorum_checks', 'general_meeting_quorum_checks',
  case when to_regclass('public.general_meeting_quorum_checks') is not null then 'OK' else 'FAIL' end
union all
select 'table_online_links', 'general_meeting_online_links',
  case when to_regclass('public.general_meeting_online_links') is not null then 'OK' else 'FAIL' end
union all
select 'unique_participant_property', 'participants',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_participants'::regclass and contype = 'u'
  ) then 'OK' else 'FAIL' end
union all
select 'unique_vote_property_decision', 'votes',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_votes'::regclass and contype = 'u'
  ) then 'OK' else 'FAIL' end
union all
select 'rpc_security_definer', p.proname,
  case when p.prosecdef then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'start_general_meeting','cast_general_meeting_vote','open_general_meeting_vote',
  'close_general_meeting_vote','declare_general_meeting_attendance','get_general_meeting_online_join_url'
)
union all
select 'anon_no_execute', p.proname,
  case when not has_function_privilege('anon', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'start_general_meeting','cast_general_meeting_vote','confirm_general_meeting_attendance',
  'get_general_meeting_online_join_url','record_general_meeting_quorum_check'
)
union all
select 'search_path', p.proname,
  case when pg_get_functiondef(p.oid) like '%search_path%' then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'start_general_meeting','cast_general_meeting_vote','declare_general_meeting_attendance'
)
union all
select 'uses_governance_not_is_staff', p.proname,
  case when pg_get_functiondef(p.oid) like '%can_manage_building_governance%'
        and pg_get_functiondef(p.oid) not like '%is_staff()%'
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'start_general_meeting','open_general_meeting_vote','confirm_general_meeting_attendance'
)
union all
select 'utf8_admin_via_governance', 'can_manage_building_governance',
  case when position(
      convert_to(U&'\0430\0434\043C\0438\043D\0438\0441\0442\0440\0430\0446\0438\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.can_manage_building_governance()'::regprocedure), 'UTF8')
    ) > 0 then 'OK' else 'FAIL' end
union all
select 'authenticated_no_direct_vote_insert', 'general_meeting_votes',
  case when not has_table_privilege('authenticated', 'public.general_meeting_votes', 'INSERT') then 'OK' else 'FAIL' end
union all
select 'polls_untouched', 'polls',
  case when to_regclass('public.polls') is not null then 'OK' else 'FAIL' end
union all
select 'properties_ideal_parts_untouched', 'ideal_parts_percent',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'ideal_parts_percent'
  ) then 'OK' else 'FAIL' end
;
