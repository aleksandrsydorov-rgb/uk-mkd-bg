-- =============================================================================
-- AMADEUS 11 — support fee annual pricing verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'table_exists' as check_id, t.item, case when to_regclass(t.item) is not null then 'OK' else 'FAIL' end as result
from (values
  ('public.support_fee_ledger'),
  ('public.support_fee_annual_policies'),
  ('public.support_fee_assessments'),
  ('public.support_fee_allocations')
) as t(item)

union all
select 'untouched_other_modules', t.item,
  case when to_regclass(t.item) is null then 'N/A' else 'OK' end
from (values
  ('public.water_ledger'),
  ('public.electricity_ledger'),
  ('public.capital_repair_ledger'),
  ('public.general_meetings'),
  ('public.polls')
) as t(item)

union all
select 'unique_property_year', 'support_fee_assessments',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.support_fee_assessments'::regclass
      and contype = 'u'
  ) then 'OK' else 'FAIL' end

union all
select 'function_exists', f.item,
  case when to_regprocedure(f.item) is not null then 'OK' else 'FAIL' end
from (values
  ('public.finalize_support_fee_assessment(bigint,integer)'),
  ('public.finalize_support_fee_year(integer)'),
  ('public.preview_support_fee_year(bigint,integer)'),
  ('public.upsert_support_fee_annual_policy(integer,boolean,numeric,numeric,timestamptz)'),
  ('public.publish_support_fee_annual_policy(integer)'),
  ('public.support_fee_early_deadline(integer)'),
  ('public.charge_support_fee(bigint,text)'),
  ('public.record_support_payment(bigint,numeric,text)'),
  ('public.can_manage_support_fees()')
) as f(item)

union all
select 'security_definer', p.proname,
  case when p.prosecdef then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'finalize_support_fee_assessment',
    'preview_support_fee_year',
    'upsert_support_fee_annual_policy',
    'charge_support_fee',
    'record_support_payment'
  )

union all
select 'search_path_empty', p.proname,
  case when pg_get_functiondef(p.oid) like '%search_path%'
        and (
          pg_get_functiondef(p.oid) like '%search_path = ''''%'
          or pg_get_functiondef(p.oid) like '%search_path TO ''''%'
        )
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'finalize_support_fee_assessment',
    'preview_support_fee_year',
    'charge_support_fee',
    'record_support_payment'
  )

union all
select 'uses_can_manage_support_fees', p.proname,
  case when pg_get_functiondef(p.oid) like '%can_manage_support_fees()%'
        and pg_get_functiondef(p.oid) not like '%is_staff()%'
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'finalize_support_fee_assessment',
    'upsert_support_fee_annual_policy',
    'charge_support_fee'
  )

union all
select 'sofia_cutoff', 'support_fee_early_deadline',
  case when pg_get_functiondef('public.support_fee_early_deadline(integer)'::regprocedure)
            like '%Europe/Sofia%'
       then 'OK' else 'FAIL' end

union all
select 'full_payment_only', 'finalize_support_fee_assessment',
  case when pg_get_functiondef('public.finalize_support_fee_assessment(bigint,integer)'::regprocedure)
            like '%v_over >= v_early%'
       then 'OK' else 'FAIL' end

union all
select 'owner_cannot_write_policy', 'policies',
  case when not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'support_fee_annual_policies'
      and cmd in ('INSERT','UPDATE','DELETE')
  ) then 'OK' else 'FAIL' end

union all
select 'anon_denied', p.proname,
  case when not has_function_privilege('anon', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalize_support_fee_assessment'

union all
select 'authenticated_execute', p.proname,
  case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalize_support_fee_assessment'

union all
select 'public_denied', p.proname,
  case when not has_function_privilege('public', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalize_support_fee_assessment'

union all
select 'assessment_snapshot_cols', c.column_name,
  case when exists (
    select 1 from information_schema.columns x
    where x.table_schema = 'public'
      and x.table_name = 'support_fee_assessments'
      and x.column_name = c.column_name
  ) then 'OK' else 'FAIL' end
from (values
  ('billing_year'),
  ('base_amount'),
  ('early_amount'),
  ('late_amount'),
  ('pricing_rule'),
  ('qualification_checked_at'),
  ('available_credit_at_check'),
  ('amount_covered_at_check'),
  ('applied_credit_amount'),
  ('discount_percent'),
  ('increase_percent'),
  ('final_amount')
) as c(column_name)

union all
select 'no_mojibake_finalize', 'finalize_support_fee_assessment',
  case when pg_get_functiondef('public.finalize_support_fee_assessment(bigint,integer)'::regprocedure)
            not like '%\u0430%'
       then 'OK' else 'FAIL' end
;
