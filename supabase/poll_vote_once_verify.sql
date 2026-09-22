-- =============================================================================
-- AMADEUS 11 — poll vote once verification (READ-ONLY)
-- =============================================================================
-- Does not CREATE/ALTER/DROP/GRANT/DELETE. Does not change existing votes.
-- =============================================================================

-- Duplicate voter/poll rows (must be empty before UNIQUE can be added if missing)
select
  v.poll_id,
  v.property_id,
  count(*) as row_count
from public.poll_votes as v
group by v.poll_id, v.property_id
having count(*) > 1
order by row_count desc, v.poll_id, v.property_id;

with checks as (
  select 'rls_enabled'::text as check_type, 'poll_votes'::text as item,
    case when c.relrowsecurity then 'OK' else 'FAIL' end as result
  from pg_class as c
  where c.relname = 'poll_votes'
    and c.relnamespace = 'public'::regnamespace

  union all
  select 'unique_poll_property', 'poll_votes',
    case when exists (
      select 1
      from pg_constraint as x
      where x.conrelid = 'public.poll_votes'::regclass
        and x.contype in ('u', 'p')
        and (
          x.conname = 'poll_votes_poll_id_property_id_key'
          or pg_get_constraintdef(x.oid) ilike '%(poll_id, property_id)%'
        )
    ) then 'OK' else 'FAIL' end

  union all
  select 'no_duplicate_pairs', 'poll_votes',
    case when exists (
      select 1
      from public.poll_votes
      group by poll_id, property_id
      having count(*) > 1
    ) then 'FAIL' else 'OK' end

  union all
  select 'votes_preserved', 'poll_votes',
    case when (select count(*) from public.poll_votes) >= 0 then 'OK' else 'FAIL' end

  union all
  select 'no_update_policy', 'poll_votes',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'poll_votes' and cmd = 'UPDATE'
    ) then 'FAIL' else 'OK' end

  union all
  select 'no_delete_policy', 'poll_votes',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'poll_votes' and cmd = 'DELETE'
    ) then 'FAIL' else 'OK' end

  union all
  select 'no_insert_policy', 'poll_votes',
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'poll_votes' and cmd = 'INSERT'
    ) then 'FAIL' else 'OK' end

  union all
  select 'no_table_update_grant', 'authenticated',
    case when has_table_privilege('authenticated', 'public.poll_votes', 'update') then 'FAIL' else 'OK' end

  union all
  select 'no_table_delete_grant', 'authenticated',
    case when has_table_privilege('authenticated', 'public.poll_votes', 'delete') then 'FAIL' else 'OK' end

  union all
  select 'no_table_insert_grant', 'authenticated',
    case when has_table_privilege('authenticated', 'public.poll_votes', 'insert') then 'FAIL' else 'OK' end

  union all
  select 'select_grant', 'authenticated',
    case when has_table_privilege('authenticated', 'public.poll_votes', 'select') then 'OK' else 'FAIL' end

  union all
  select 'rpc_exists', 'cast_poll_vote',
    case when to_regprocedure('public.cast_poll_vote(bigint, bigint)') is not null then 'OK' else 'FAIL' end

  union all
  select 'rpc_execute_authenticated', 'cast_poll_vote',
    case when has_function_privilege('authenticated', 'public.cast_poll_vote(bigint, bigint)', 'execute')
      then 'OK' else 'FAIL' end

  union all
  select 'rpc_no_execute_anon', 'cast_poll_vote',
    case when has_function_privilege('anon', 'public.cast_poll_vote(bigint, bigint)', 'execute')
      then 'FAIL' else 'OK' end

  union all
  select 'rpc_no_on_conflict_update', 'cast_poll_vote',
    case
      when pg_get_functiondef('public.cast_poll_vote(bigint, bigint)'::regprocedure)
           ~* 'on conflict[\s\S]*do update' then 'FAIL'
      else 'OK'
    end

  union all
  select 'rpc_already_voted_guard', 'cast_poll_vote',
    case
      when pg_get_functiondef('public.cast_poll_vote(bigint, bigint)'::regprocedure)
           like '%already voted%' then 'OK'
      else 'FAIL'
    end
),
final_rows as (
  select check_type, item, result from checks
)
select check_type, item, result
from final_rows
order by check_type;

select count(*) as poll_votes_count from public.poll_votes;
