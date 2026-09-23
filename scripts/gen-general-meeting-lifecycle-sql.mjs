import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';

const hotfix = `-- =============================================================================
-- AMADEUS 11 — general meeting lifecycle (edit / reschedule / cancel)
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Model: successor uses rescheduled_from_meeting_id (no supersedes_meeting_id).
-- Quorum statutory delay (quorum_stage) is NOT a reschedule and does not
-- create a new meeting row.
-- Does NOT touch polls, finance, meters, property registry, ideal_parts_percent,
-- owner auth.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.general_meetings') is null then
    raise exception 'Pre-flight failed: public.general_meetings does not exist.';
  end if;
  if to_regprocedure('public.can_manage_building_governance()') is null then
    raise exception 'Pre-flight failed: public.can_manage_building_governance() does not exist.';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'Pre-flight failed: public.has_staff_role(text) does not exist.';
  end if;
end
$pre$;

alter table public.general_meetings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_email text,
  add column if not exists cancellation_reason text,
  add column if not exists reschedule_reason text,
  add column if not exists rescheduled_from_meeting_id uuid;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'general_meetings_rescheduled_from_fk'
  ) then
    alter table public.general_meetings
      add constraint general_meetings_rescheduled_from_fk
      foreign key (rescheduled_from_meeting_id)
      references public.general_meetings(id);
  end if;
end
$fk$;

create unique index if not exists general_meetings_rescheduled_from_uidx
  on public.general_meetings (rescheduled_from_meeting_id)
  where rescheduled_from_meeting_id is not null;

alter table public.general_meetings drop constraint if exists general_meetings_status_chk;
alter table public.general_meetings
  add constraint general_meetings_status_chk
  check (status in (
    'draft','published','rescheduled','held','minutes_ready','archived','cancelled'
  ));

alter table public.general_meeting_files drop constraint if exists general_meeting_files_type_chk;
alter table public.general_meeting_files
  add constraint general_meeting_files_type_chk
  check (file_type in (
    'invitation','invitation_posting_protocol','agenda','minutes','minutes_notice',
    'minutes_notice_posting_protocol','proxy','absentee_declaration','appendix',
    'cancellation_notice','other'
  ));

-- Invitation legal fields stay frozen after draft. Status / cancel / quorum_stage
-- may still change. This is not a statutory continuation of the same convocation.
create or replace function public.protect_published_meeting_legal_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if OLD.status is not distinct from 'draft' then
    return NEW;
  end if;

  if NEW.meeting_date is distinct from OLD.meeting_date
     or NEW.meeting_time is distinct from OLD.meeting_time
     or NEW.location is distinct from OLD.location
     or NEW.meeting_mode is distinct from OLD.meeting_mode
     or NEW.is_urgent is distinct from OLD.is_urgent then
    raise exception 'general_meetings: published invitation fields cannot be silently updated'
      using errcode = '42501';
  end if;

  if OLD.status in ('held','minutes_ready','archived','cancelled','rescheduled') then
    if NEW.title is distinct from OLD.title
       or NEW.absentee_voting_enabled is distinct from OLD.absentee_voting_enabled
       or NEW.absentee_voting_deadline is distinct from OLD.absentee_voting_deadline then
      raise exception 'general_meetings: closed meeting fields are locked'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$fn$;

drop trigger if exists trg_protect_published_meeting_legal_fields on public.general_meetings;
create trigger trg_protect_published_meeting_legal_fields
before update on public.general_meetings
for each row execute function public.protect_published_meeting_legal_fields();

create or replace function public.protect_meeting_results_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_meeting uuid;
begin
  v_meeting := coalesce(NEW.meeting_id, OLD.meeting_id);
  select m.status into v_status from public.general_meetings as m where m.id = v_meeting;

  if TG_TABLE_NAME = 'general_meeting_decisions' and TG_OP in ('UPDATE','DELETE') then
    raise exception 'general_meeting_decisions: published decision text is immutable'
      using errcode = '42501';
  end if;

  if v_status in ('minutes_ready','archived','cancelled','rescheduled') then
    raise exception 'meeting results are locked after protocol / close'
      using errcode = '42501';
  end if;

  if v_status is distinct from 'published' and v_status is distinct from 'held'
     and v_status is distinct from 'draft' then
    raise exception 'meeting results cannot be changed in this status'
      using errcode = '42501';
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_protect_meeting_decisions_lock on public.general_meeting_decisions;
create trigger trg_protect_meeting_decisions_lock
before insert or update or delete on public.general_meeting_decisions
for each row execute function public.protect_meeting_results_lock();

drop trigger if exists trg_protect_meeting_participants_lock on public.general_meeting_participants;
create trigger trg_protect_meeting_participants_lock
before insert or update or delete on public.general_meeting_participants
for each row execute function public.protect_meeting_results_lock();

drop trigger if exists trg_protect_meeting_votes_lock on public.general_meeting_votes;
create trigger trg_protect_meeting_votes_lock
before insert or update or delete on public.general_meeting_votes
for each row execute function public.protect_meeting_results_lock();

revoke all on function public.protect_published_meeting_legal_fields() from public;
revoke execute on function public.protect_published_meeting_legal_fields() from anon, authenticated;
revoke all on function public.protect_meeting_results_lock() from public;
revoke execute on function public.protect_meeting_results_lock() from anon, authenticated;

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
  if auth.email() is null then
    raise exception 'cancel_general_meeting: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'cancel_general_meeting: not allowed' using errcode = '42501';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 then
    raise exception 'cancel_general_meeting: reason required' using errcode = '22023';
  end if;

  update public.general_meetings as m
     set status = 'cancelled',
         cancelled_at = coalesce(m.cancelled_at, now()),
         cancelled_by_email = coalesce(m.cancelled_by_email, auth.email()),
         cancellation_reason = v_reason
   where m.id = p_meeting_id
     and m.status = 'published'
  returning m.* into v_row;

  if not found then
    raise exception 'cancel_general_meeting: published meeting not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

create or replace function public.reschedule_general_meeting(
  p_meeting_id uuid,
  p_meeting_date date,
  p_meeting_time time,
  p_location text,
  p_meeting_mode text,
  p_reason text
)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old public.general_meetings;
  v_new public.general_meetings;
  v_reason text;
  v_mode text;
begin
  if auth.email() is null then
    raise exception 'reschedule_general_meeting: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'reschedule_general_meeting: not allowed' using errcode = '42501';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 then
    raise exception 'reschedule_general_meeting: reason required' using errcode = '22023';
  end if;
  if p_meeting_date is null then
    raise exception 'reschedule_general_meeting: new date required' using errcode = '22023';
  end if;

  v_mode := coalesce(nullif(trim(p_meeting_mode), ''), 'in_person');
  if v_mode not in ('in_person','hybrid') then
    raise exception 'reschedule_general_meeting: invalid meeting_mode' using errcode = '22023';
  end if;

  select m.* into v_old
  from public.general_meetings as m
  where m.id = p_meeting_id
  for update;

  if not found then
    raise exception 'reschedule_general_meeting: meeting not found' using errcode = 'P0002';
  end if;

  if v_old.status in ('held','minutes_ready','archived','cancelled','rescheduled','draft') then
    raise exception 'reschedule_general_meeting: meeting cannot be rescheduled in this status'
      using errcode = '42501';
  end if;

  if v_old.status is distinct from 'published' then
    raise exception 'reschedule_general_meeting: only published meetings can be rescheduled'
      using errcode = '42501';
  end if;

  insert into public.general_meetings (
    title,
    description,
    meeting_date,
    meeting_time,
    location,
    meeting_mode,
    is_urgent,
    status,
    convoked_by,
    absentee_voting_enabled,
    absentee_voting_deadline,
    online_meeting_url,
    quorum_stage,
    created_by_email,
    rescheduled_from_meeting_id,
    invitation_posted_at,
    published_at,
    published_by_email
  ) values (
    v_old.title,
    v_old.description,
    p_meeting_date,
    p_meeting_time,
    nullif(trim(coalesce(p_location, '')), ''),
    v_mode,
    v_old.is_urgent,
    'draft',
    v_old.convoked_by,
    v_old.absentee_voting_enabled,
    v_old.absentee_voting_deadline,
    v_old.online_meeting_url,
    'initial',
    auth.email(),
    v_old.id,
    null,
    null,
    null
  )
  returning * into v_new;

  insert into public.general_meeting_agenda_items (
    meeting_id, position, title, description, proposed_decision_text
  )
  select v_new.id, a.position, a.title, a.description, a.proposed_decision_text
  from public.general_meeting_agenda_items as a
  where a.meeting_id = v_old.id
  order by a.position;

  update public.general_meetings as m
     set status = 'rescheduled',
         reschedule_reason = v_reason
   where m.id = v_old.id;

  return v_new;
end;
$fn$;

revoke all on function public.cancel_general_meeting(uuid, text) from public;
revoke execute on function public.cancel_general_meeting(uuid, text) from anon;
grant execute on function public.cancel_general_meeting(uuid, text) to authenticated;

revoke all on function public.reschedule_general_meeting(uuid, date, time, text, text, text) from public;
revoke execute on function public.reschedule_general_meeting(uuid, date, time, text, text, text) from anon;
grant execute on function public.reschedule_general_meeting(uuid, date, time, text, text, text) to authenticated;

-- Role literal kept via can_manage_building_governance() which uses has_staff_role('${ADMIN}').
-- is_staff() is not used for lifecycle RPCs.

commit;
`;

const verify = `-- =============================================================================
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
      convert_to(U&'\\0430\\0434\\043C\\0438\\043D\\0438\\0441\\0442\\0440\\0430\\0446\\0438\\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.can_manage_building_governance()'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end

union all
select 'no_mojibake_admin', 'can_manage_building_governance',
  case when pg_get_functiondef('public.can_manage_building_governance()'::regprocedure)
         not like '%\u0430%'
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
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
writeFileSync(join(dir, 'general_meeting_lifecycle_hotfix.sql'), hotfix, { encoding: 'utf8' });
writeFileSync(join(dir, 'general_meeting_lifecycle_verify.sql'), verify, { encoding: 'utf8' });
console.log('wrote general_meeting_lifecycle sql');
