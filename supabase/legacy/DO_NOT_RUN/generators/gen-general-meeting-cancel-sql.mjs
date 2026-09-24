import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';

const hotfix = `-- =============================================================================
-- AMADEUS 11 — cancel columns + cancel RPC; rescheduled CHECK only if required
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Does NOT recreate meeting_started_at / meeting_ended_at columns.
-- Does NOT replace attendance / quorum / voting / Meet URL RPCs.
-- Does NOT touch polls, finance, meters, registry, storage.
-- =============================================================================

begin;

do $pre$
declare
  v_def text;
begin
  if to_regclass('public.general_meetings') is null then
    raise exception 'Pre-flight failed: public.general_meetings does not exist.';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'Pre-flight failed: public.has_staff_role(text) does not exist.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_meetings' and column_name = 'status'
  ) then
    raise exception 'Pre-flight failed: general_meetings.status does not exist.';
  end if;

  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.general_meetings'::regclass
    and conname = 'general_meetings_status_chk';

  if v_def is null then
    raise exception 'Pre-flight failed: general_meetings_status_chk does not exist.';
  end if;
  if v_def not like '%cancelled%' then
    raise exception 'Pre-flight failed: cancelled is not allowed by general_meetings_status_chk. def=%', v_def;
  end if;
end
$pre$;

alter table public.general_meetings
  add column if not exists cancelled_at timestamptz;

alter table public.general_meetings
  add column if not exists cancelled_by_email text;

alter table public.general_meetings
  add column if not exists cancellation_reason text;

-- cancelled is already allowed. Do not rewrite the CHECK for cancellation.
-- If live reschedule_general_meeting writes status='rescheduled', add only that value.
do $resched_status$
declare
  v_def text;
  v_fn text;
  v_sets_rescheduled boolean := false;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.general_meetings'::regclass
    and conname = 'general_meetings_status_chk';

  if v_def like '%rescheduled%' then
    return;
  end if;

  select string_agg(pg_get_functiondef(p.oid), chr(10))
    into v_fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'reschedule_general_meeting';

  if v_fn is not null
     and (
       v_fn like '%status = ''rescheduled''%'
       or v_fn like '%status=''rescheduled''%'
     )
  then
    v_sets_rescheduled := true;
  end if;

  if not v_sets_rescheduled then
    return;
  end if;

  alter table public.general_meetings drop constraint general_meetings_status_chk;
  alter table public.general_meetings
    add constraint general_meetings_status_chk
    check (status in (
      'draft',
      'published',
      'held',
      'minutes_ready',
      'archived',
      'cancelled',
      'rescheduled'
    ));
end
$resched_status$;

create or replace function public.cancel_general_meeting(
  p_meeting_id uuid,
  p_reason text
)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
  v_reason text;
begin
  if p_meeting_id is null then
    raise exception 'cancel_general_meeting: meeting id required' using errcode = '22023';
  end if;
  if auth.email() is null then
    raise exception 'cancel_general_meeting: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('${ADMIN}') then
    raise exception 'cancel_general_meeting: not allowed' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'cancel_general_meeting: reason required' using errcode = '22023';
  end if;

  select m.* into v_row
  from public.general_meetings as m
  where m.id = p_meeting_id
  for update;

  if not found then
    raise exception 'cancel_general_meeting: meeting not found' using errcode = 'P0002';
  end if;

  if v_row.status in ('held','minutes_ready','archived','cancelled','rescheduled','draft') then
    raise exception 'cancel_general_meeting: meeting cannot be cancelled in this status'
      using errcode = '42501';
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'cancel_general_meeting: only a published upcoming meeting can be cancelled'
      using errcode = '42501';
  end if;

  if v_row.meeting_date < (timezone('Europe/Sofia', now()))::date then
    raise exception 'cancel_general_meeting: past meeting cannot be cancelled'
      using errcode = '42501';
  end if;

  update public.general_meetings as m
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_email = auth.email(),
         cancellation_reason = v_reason
   where m.id = p_meeting_id
  returning m.* into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.cancel_general_meeting(uuid, text) from public;
revoke all on function public.cancel_general_meeting(uuid, text) from anon;
revoke execute on function public.cancel_general_meeting(uuid, text) from anon;
grant execute on function public.cancel_general_meeting(uuid, text) to authenticated;

commit;
`;

const verify = `-- =============================================================================
-- AMADEUS 11 — cancel_general_meeting verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'function_exists' as check_id, 'cancel_general_meeting(uuid,text)' as item,
  case when to_regprocedure('public.cancel_general_meeting(uuid,text)') is not null
       then 'OK' else 'FAIL' end as result

union all
select 'arg_names', array_to_string(p.proargnames, ','),
  case when p.proargnames = array['p_meeting_id','p_reason']::text[] then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'cancel_general_meeting'
  and pg_get_function_identity_arguments(p.oid) = 'p_meeting_id uuid, p_reason text'

union all
select 'arg_types', pg_get_function_identity_arguments(p.oid),
  case when pg_get_function_identity_arguments(p.oid) = 'p_meeting_id uuid, p_reason text'
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'security_definer', p.proname,
  case when p.prosecdef then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

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
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'authenticated_execute', p.proname,
  case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'anon_no_execute', p.proname,
  case when not has_function_privilege('anon', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'public_no_execute', p.proname,
  case when not has_function_privilege('public', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'uses_has_staff_role_admin', p.proname,
  case when position(
         convert_to('has_staff_role(' || chr(39), 'UTF8')
         in convert_to(pg_get_functiondef(p.oid), 'UTF8')
       ) > 0
       and position(
         convert_to(U&'\\0430\\0434\\043C\\0438\\043D\\0438\\0441\\0442\\0440\\0430\\0446\\0438\\044F', 'UTF8')
         in convert_to(pg_get_functiondef(p.oid), 'UTF8')
       ) > 0
       and pg_get_functiondef(p.oid) not like '%is_staff()%'
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'no_mojibake_admin', p.proname,
  case when pg_get_functiondef(p.oid) not like '%\\u0430%'
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'column_exists', c.column_name,
  case when exists (
    select 1 from information_schema.columns x
    where x.table_schema = 'public' and x.table_name = 'general_meetings' and x.column_name = c.column_name
  ) then 'OK' else 'FAIL' end
from (values
  ('status'),
  ('cancelled_at'),
  ('cancelled_by_email'),
  ('cancellation_reason')
) as c(column_name)

union all
select 'returns_general_meetings', pg_get_function_result(p.oid),
  case when pg_get_function_result(p.oid) in ('general_meetings','public.general_meetings')
       then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_general_meeting'

union all
select 'status_allows_cancelled', 'general_meetings_status_chk',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meetings'::regclass
      and conname = 'general_meetings_status_chk'
      and pg_get_constraintdef(oid) like '%cancelled%'
  ) then 'OK' else 'FAIL' end

union all
select 'rescheduled_status_supported', 'reschedule_general_meeting',
  case
    when not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'reschedule_general_meeting'
    ) then 'N/A'
    when not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'reschedule_general_meeting'
        and (
          pg_get_functiondef(p.oid) like '%status = ''rescheduled''%'
          or pg_get_functiondef(p.oid) like '%status=''rescheduled''%'
        )
    ) then 'NOT REQUIRED'
    when exists (
      select 1 from pg_constraint
      where conrelid = 'public.general_meetings'::regclass
        and conname = 'general_meetings_status_chk'
        and pg_get_constraintdef(oid) like '%rescheduled%'
    ) then 'OK'
    else 'FAIL'
  end
;
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
writeFileSync(join(dir, 'general_meeting_cancel_hotfix.sql'), hotfix, { encoding: 'utf8' });
writeFileSync(join(dir, 'general_meeting_cancel_verify.sql'), verify, { encoding: 'utf8' });
console.log('wrote general_meeting_cancel sql');
