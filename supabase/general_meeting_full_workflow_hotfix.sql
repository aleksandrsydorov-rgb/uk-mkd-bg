-- =============================================================================
-- AMADEUS 11 — general meeting full workflow (incremental)
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Idempotent where reasonable. Does NOT duplicate documents_decisions /
-- lifecycle tables. Does NOT touch polls, finance, meters, registry,
-- properties.ideal_parts_percent, owner_email.
-- Admin lifecycle: public.has_staff_role('администрация') via can_manage_building_governance().
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.general_meetings') is null then
    raise exception 'Pre-flight failed: public.general_meetings does not exist.';
  end if;
  if to_regclass('public.general_meeting_agenda_items') is null then
    raise exception 'Pre-flight failed: public.general_meeting_agenda_items does not exist.';
  end if;
  if to_regprocedure('public.can_manage_building_governance()') is null then
    raise exception 'Pre-flight failed: public.can_manage_building_governance() does not exist.';
  end if;
  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;
end
$pre$;

alter table public.general_meetings
  add column if not exists operational_phase text not null default 'idle',
  add column if not exists registration_opened_at timestamptz,
  add column if not exists registration_opened_by_email text,
  add column if not exists meeting_started_at timestamptz,
  add column if not exists meeting_started_by_email text,
  add column if not exists meeting_ended_at timestamptz,
  add column if not exists meeting_ended_by_email text,
  add column if not exists meeting_can_proceed boolean not null default false,
  add column if not exists quorum_rule text not null default 'standard_zues',
  add column if not exists quorum_rule_note text;

alter table public.general_meetings drop constraint if exists general_meetings_phase_chk;
alter table public.general_meetings
  add constraint general_meetings_phase_chk
  check (operational_phase in ('idle','registration','in_progress','closed'));

alter table public.general_meetings drop constraint if exists general_meetings_quorum_rule_chk;
alter table public.general_meetings
  add constraint general_meetings_quorum_rule_chk
  check (quorum_rule in ('standard_zues','dominant_owner_75','requires_review'));

alter table public.general_meeting_agenda_items
  add column if not exists decision_category text,
  add column if not exists majority_rule text not null default 'more_than_50_represented_ideal_parts',
  add column if not exists threshold_comparator text not null default 'gt',
  add column if not exists required_percent numeric(12,6) not null default 50,
  add column if not exists denominator_basis text not null default 'represented_ideal_parts',
  add column if not exists legal_basis text,
  add column if not exists voting_status text not null default 'pending',
  add column if not exists voting_opened_at timestamptz,
  add column if not exists voting_closed_at timestamptz,
  add column if not exists for_percent numeric(12,6),
  add column if not exists against_percent numeric(12,6),
  add column if not exists abstain_percent numeric(12,6),
  add column if not exists denominator_percent numeric(12,6),
  add column if not exists computed_threshold_status text,
  add column if not exists result_override_reason text;

alter table public.general_meeting_agenda_items drop constraint if exists general_meeting_agenda_vote_status_chk;
alter table public.general_meeting_agenda_items
  add constraint general_meeting_agenda_vote_status_chk
  check (voting_status in ('pending','open','closed'));

alter table public.general_meeting_agenda_items drop constraint if exists general_meeting_agenda_majority_chk;
alter table public.general_meeting_agenda_items
  add constraint general_meeting_agenda_majority_chk
  check (majority_rule in (
    'unanimous_all_ideal_parts','at_least_75_all_ideal_parts','at_least_75_eligible_ideal_parts',
    'at_least_51_all_ideal_parts','more_than_50_all_ideal_parts','more_than_50_represented_ideal_parts',
    'more_than_half_independent_units','manual_rule'
  ));

alter table public.general_meeting_agenda_items drop constraint if exists general_meeting_agenda_cmp_chk;
alter table public.general_meeting_agenda_items
  add constraint general_meeting_agenda_cmp_chk
  check (threshold_comparator in ('gt','gte'));

alter table public.general_meeting_agenda_items drop constraint if exists general_meeting_agenda_denom_chk;
alter table public.general_meeting_agenda_items
  add constraint general_meeting_agenda_denom_chk
  check (denominator_basis in ('all_ideal_parts','represented_ideal_parts','eligible_ideal_parts','independent_units'));

alter table public.general_meeting_participants
  add column if not exists attendance_source text not null default 'administration',
  add column if not exists attendance_status text not null default 'declared',
  add column if not exists declared_at timestamptz,
  add column if not exists declared_by_email text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by_email text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists left_at timestamptz,
  add column if not exists left_reason text,
  add column if not exists online_link_opened_at timestamptz;

alter table public.general_meeting_participants drop constraint if exists general_meeting_participants_src_chk;
alter table public.general_meeting_participants
  add constraint general_meeting_participants_src_chk
  check (attendance_source in ('owner_self_checkin','administration'));

alter table public.general_meeting_participants drop constraint if exists general_meeting_participants_st_chk;
alter table public.general_meeting_participants
  add constraint general_meeting_participants_st_chk
  check (attendance_status in ('declared','confirmed','rejected','requires_representation_confirmation'));

alter table public.general_meeting_votes
  add column if not exists vote_source text not null default 'administration';

alter table public.general_meeting_votes drop constraint if exists general_meeting_votes_source_chk;
alter table public.general_meeting_votes
  add constraint general_meeting_votes_source_chk
  check (vote_source in ('owner_portal','administration','proxy','online','absentee'));

alter table public.general_meeting_decisions
  add column if not exists computed_threshold_status text,
  add column if not exists result_override_reason text,
  add column if not exists for_percent numeric(12,6),
  add column if not exists against_percent numeric(12,6),
  add column if not exists abstain_percent numeric(12,6);

create table if not exists public.general_meeting_online_links (
  meeting_id uuid primary key references public.general_meetings(id) on delete cascade,
  join_url text not null,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create table if not exists public.general_meeting_quorum_checks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings(id) on delete cascade,
  stage text not null,
  quorum_rule text not null,
  represented_ideal_parts_percent numeric(12,6),
  declared_ideal_parts_percent numeric(12,6),
  required_percent numeric(12,6),
  calculation_status text not null,
  threshold_met boolean,
  meeting_can_proceed boolean not null default false,
  property_count integer,
  registered_property_count integer,
  missing_ideal_parts_count integer,
  review_note text,
  checked_at timestamptz not null default now(),
  recorded_by_email text,
  constraint general_meeting_quorum_checks_status_chk
    check (calculation_status in ('not_checked','incomplete','not_met','met','allowed_by_stage','requires_review')),
  constraint general_meeting_quorum_checks_stage_chk
    check (stage in ('initial','after_one_hour','next_day'))
);

create table if not exists public.general_meeting_vote_events (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid references public.general_meeting_votes(id) on delete cascade,
  meeting_id uuid not null references public.general_meetings(id) on delete cascade,
  decision_id uuid not null,
  property_id bigint not null,
  vote text not null,
  vote_source text,
  recorded_at timestamptz not null default now(),
  recorded_by_email text,
  constraint general_meeting_vote_events_vote_chk check (vote in ('for','against','abstain'))
);

create index if not exists general_meeting_quorum_checks_meeting_idx
  on public.general_meeting_quorum_checks (meeting_id, checked_at desc);

-- Always snapshot from properties; never trust client-supplied weight.
create or replace function public.general_meeting_participant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_parts numeric(12,6);
  v_number text;
  v_name text;
begin
  select p.ideal_parts_percent, p.apartment_number::text, p.owner_name
    into v_parts, v_number, v_name
  from public.properties as p
  where p.id = NEW.property_id;

  NEW.ideal_parts_percent_snapshot := v_parts;
  NEW.property_number_snapshot := coalesce(NEW.property_number_snapshot, v_number);
  if NEW.participant_name is null or btrim(NEW.participant_name) = '' then
    NEW.participant_name := coalesce(v_name, v_number, 'owner');
  end if;
  return NEW;
end;
$fn$;

create or replace function public.protect_meeting_results_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_phase text;
  v_meeting uuid;
begin
  v_meeting := coalesce(NEW.meeting_id, OLD.meeting_id);
  select m.status, m.operational_phase into v_status, v_phase
  from public.general_meetings as m where m.id = v_meeting;

  if TG_TABLE_NAME = 'general_meeting_decisions' and TG_OP = 'DELETE' then
    raise exception 'general_meeting_decisions: published decision text is immutable'
      using errcode = '42501';
  end if;

  if TG_TABLE_NAME = 'general_meeting_decisions' and TG_OP = 'UPDATE' then
    if NEW.title is distinct from OLD.title
       or NEW.decision_text is distinct from OLD.decision_text then
      if v_status is distinct from 'draft' then
        raise exception 'general_meeting_decisions: decision text is locked'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if v_status in ('minutes_ready','archived','cancelled','rescheduled') then
    if TG_TABLE_NAME in ('general_meeting_participants','general_meeting_votes') then
      raise exception 'meeting results are locked after protocol / close'
        using errcode = '42501';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;

create or replace function public.gm_threshold_met(
  p_value numeric,
  p_comparator text,
  p_required numeric
)
returns boolean
language sql
immutable
as $fn$
  select case
    when p_value is null or p_required is null or p_comparator is null then null
    when p_comparator = 'gt' then p_value > p_required
    when p_comparator = 'gte' then p_value >= p_required
    else null
  end;
$fn$;

create or replace function public.gm_quorum_required_percent(p_stage text, p_rule text)
returns numeric
language sql
immutable
as $fn$
  select case
    when p_rule = 'dominant_owner_75' then 75::numeric
    when p_stage = 'initial' then 51::numeric
    when p_stage = 'after_one_hour' then 26::numeric
    else null
  end;
$fn$;

create or replace function public.gm_apply_majority_preset(p_rule text)
returns table (
  majority_rule text,
  threshold_comparator text,
  required_percent numeric,
  denominator_basis text
)
language sql
immutable
as $fn$
  select x.majority_rule, x.threshold_comparator, x.required_percent, x.denominator_basis
  from (
    select p_rule as majority_rule,
      case p_rule
        when 'unanimous_all_ideal_parts' then 'gte'
        when 'at_least_75_all_ideal_parts' then 'gte'
        when 'at_least_75_eligible_ideal_parts' then 'gte'
        when 'at_least_51_all_ideal_parts' then 'gte'
        when 'more_than_50_all_ideal_parts' then 'gt'
        when 'more_than_50_represented_ideal_parts' then 'gt'
        when 'more_than_half_independent_units' then 'gt'
        else 'gte'
      end as threshold_comparator,
      case p_rule
        when 'unanimous_all_ideal_parts' then 100::numeric
        when 'at_least_75_all_ideal_parts' then 75::numeric
        when 'at_least_75_eligible_ideal_parts' then 75::numeric
        when 'at_least_51_all_ideal_parts' then 51::numeric
        else 50::numeric
      end as required_percent,
      case p_rule
        when 'more_than_50_represented_ideal_parts' then 'represented_ideal_parts'
        when 'at_least_75_eligible_ideal_parts' then 'eligible_ideal_parts'
        when 'more_than_half_independent_units' then 'independent_units'
        else 'all_ideal_parts'
      end as denominator_basis
  ) as x;
$fn$;

create or replace function public.calculate_general_meeting_quorum(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_meeting public.general_meetings;
  v_confirmed numeric(12,6);
  v_declared numeric(12,6);
  v_all numeric(12,6);
  v_missing integer;
  v_count integer;
  v_req numeric(12,6);
  v_status text;
  v_met boolean;
  v_proceed boolean := false;
  v_special boolean;
begin
  if auth.email() is null then
    raise exception 'calculate_general_meeting_quorum: not authenticated' using errcode = '28000';
  end if;
  if not (public.can_manage_building_governance() or public.is_owner()) then
    raise exception 'calculate_general_meeting_quorum: not allowed' using errcode = '42501';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if not found then
    raise exception 'calculate_general_meeting_quorum: meeting not found' using errcode = 'P0002';
  end if;

  select count(*) filter (where p.ideal_parts_percent is null),
         sum(p.ideal_parts_percent)
    into v_missing, v_all
  from public.properties as p;

  select coalesce(sum(par.ideal_parts_percent_snapshot) filter (
           where par.attendance_status = 'confirmed' and par.left_at is null
             and par.ideal_parts_percent_snapshot is not null), 0),
         coalesce(sum(par.ideal_parts_percent_snapshot) filter (
           where par.attendance_status in ('declared','confirmed','requires_representation_confirmation')
             and par.left_at is null and par.rejected_at is null
             and par.ideal_parts_percent_snapshot is not null), 0),
         count(*) filter (where par.attendance_status = 'confirmed' and par.left_at is null)
    into v_confirmed, v_declared, v_count
  from public.general_meeting_participants as par
  where par.meeting_id = p_meeting_id;

  select exists (
    select 1 from public.general_meeting_agenda_items as a
    where a.meeting_id = p_meeting_id
      and a.majority_rule in (
        'unanimous_all_ideal_parts','at_least_75_all_ideal_parts','at_least_75_eligible_ideal_parts',
        'at_least_51_all_ideal_parts','manual_rule'
      )
  ) into v_special;

  v_req := public.gm_quorum_required_percent(
    coalesce(v_meeting.quorum_stage, 'initial'),
    v_meeting.quorum_rule
  );

  if v_missing > 0 or v_all is null then
    v_status := 'incomplete';
    v_met := null;
  elsif v_meeting.quorum_rule = 'requires_review' or (v_special and v_meeting.quorum_rule = 'standard_zues') then
    v_status := 'requires_review';
    v_met := null;
  elsif coalesce(v_meeting.quorum_stage, 'initial') = 'next_day' then
    v_status := 'allowed_by_stage';
    v_met := null;
    v_proceed := true;
  else
    v_met := public.gm_threshold_met(v_confirmed, 'gte', v_req);
    if v_met then
      v_status := 'met';
      v_proceed := true;
    else
      v_status := 'not_met';
    end if;
  end if;

  return jsonb_build_object(
    'calculation_status', v_status,
    'quorum_rule', v_meeting.quorum_rule,
    'quorum_stage', coalesce(v_meeting.quorum_stage, 'initial'),
    'confirmed_percent', v_confirmed,
    'declared_percent', v_declared,
    'required_percent', v_req,
    'all_ideal_parts_percent', v_all,
    'registered_property_count', v_count,
    'missing_ideal_parts_count', v_missing,
    'threshold_met', v_met,
    'meeting_can_proceed', v_proceed
  );
end;
$fn$;

create or replace function public.record_general_meeting_quorum_check(
  p_meeting_id uuid,
  p_review_note text default null
)
returns public.general_meeting_quorum_checks
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_calc jsonb;
  v_row public.general_meeting_quorum_checks;
  v_proceed boolean;
  v_note text;
begin
  if not public.can_manage_building_governance() then
    raise exception 'record_general_meeting_quorum_check: not allowed' using errcode = '42501';
  end if;
  v_calc := public.calculate_general_meeting_quorum(p_meeting_id);
  v_proceed := coalesce((v_calc->>'meeting_can_proceed')::boolean, false);
  v_note := nullif(trim(coalesce(p_review_note, '')), '');
  if v_calc->>'calculation_status' = 'requires_review' then
    if v_note is null then
      v_proceed := false;
    else
      v_proceed := true;
    end if;
  end if;

  insert into public.general_meeting_quorum_checks (
    meeting_id, stage, quorum_rule, represented_ideal_parts_percent, declared_ideal_parts_percent,
    required_percent, calculation_status, threshold_met, meeting_can_proceed,
    property_count, registered_property_count, missing_ideal_parts_count, review_note, recorded_by_email
  ) values (
    p_meeting_id,
    v_calc->>'quorum_stage',
    v_calc->>'quorum_rule',
    (v_calc->>'confirmed_percent')::numeric,
    (v_calc->>'declared_percent')::numeric,
    (v_calc->>'required_percent')::numeric,
    v_calc->>'calculation_status',
    (v_calc->>'threshold_met')::boolean,
    v_proceed,
    (v_calc->>'registered_property_count')::integer,
    (v_calc->>'registered_property_count')::integer,
    (v_calc->>'missing_ideal_parts_count')::integer,
    v_note,
    auth.email()
  )
  returning * into v_row;

  update public.general_meetings as m
     set meeting_can_proceed = v_proceed,
         represented_ideal_parts_percent = (v_calc->>'confirmed_percent')::numeric
   where m.id = p_meeting_id;

  return v_row;
end;
$fn$;

create or replace function public.open_general_meeting_registration(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
begin
  if not public.can_manage_building_governance() then
    raise exception 'open_general_meeting_registration: not allowed' using errcode = '42501';
  end if;
  update public.general_meetings as m
     set operational_phase = 'registration',
         registration_opened_at = coalesce(m.registration_opened_at, now()),
         registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email())
   where m.id = p_meeting_id
     and m.status = 'published'
  returning m.* into v_row;
  if not found then
    raise exception 'open_general_meeting_registration: published meeting not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.advance_general_meeting_quorum_stage(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
  v_next text;
begin
  if not public.can_manage_building_governance() then
    raise exception 'advance_general_meeting_quorum_stage: not allowed' using errcode = '42501';
  end if;
  select case coalesce(m.quorum_stage, 'initial')
           when 'initial' then 'after_one_hour'
           when 'after_one_hour' then 'next_day'
           else m.quorum_stage
         end
    into v_next
  from public.general_meetings as m
  where m.id = p_meeting_id and m.status = 'published';
  if not found then
    raise exception 'advance_general_meeting_quorum_stage: meeting not found' using errcode = 'P0002';
  end if;
  update public.general_meetings as m
     set quorum_stage = v_next,
         meeting_can_proceed = false
   where m.id = p_meeting_id
  returning m.* into v_row;
  return v_row;
end;
$fn$;

create or replace function public.declare_general_meeting_attendance(
  p_meeting_id uuid,
  p_property_id bigint,
  p_attendance_mode text
)
returns public.general_meeting_participants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_meeting public.general_meetings;
  v_property bigint;
  v_row public.general_meeting_participants;
  v_mode text;
  v_name text;
begin
  if auth.email() is null then
    raise exception 'declare_general_meeting_attendance: not authenticated' using errcode = '28000';
  end if;
  v_mode := nullif(trim(p_attendance_mode), '');
  if v_mode not in ('in_person','online') then
    raise exception 'declare_general_meeting_attendance: invalid mode' using errcode = '22023';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'declare_general_meeting_attendance: not your property' using errcode = '42501';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if not found or v_meeting.status is distinct from 'published' then
    raise exception 'declare_general_meeting_attendance: meeting not open' using errcode = '42501';
  end if;
  if v_meeting.operational_phase is distinct from 'registration'
     and v_meeting.operational_phase is distinct from 'in_progress' then
    raise exception 'declare_general_meeting_attendance: registration closed' using errcode = '42501';
  end if;
  if v_mode = 'online' and v_meeting.meeting_mode is distinct from 'hybrid' then
    raise exception 'declare_general_meeting_attendance: online not available' using errcode = '42501';
  end if;

  v_property := p_property_id;
  select p.owner_name into v_name from public.properties as p where p.id = v_property;

  insert into public.general_meeting_participants (
    meeting_id, property_id, participant_name, representation_type, attendance_mode,
    attendance_source, attendance_status, declared_at, declared_by_email
  ) values (
    p_meeting_id, v_property, coalesce(v_name, auth.email()), 'self', v_mode,
    'owner_self_checkin', 'declared', now(), auth.email()
  )
  on conflict (meeting_id, property_id) do update
    set attendance_mode = excluded.attendance_mode,
        declared_at = now(),
        declared_by_email = auth.email(),
        attendance_status = case
          when public.general_meeting_participants.attendance_status = 'confirmed'
            and public.general_meeting_participants.declared_by_email is distinct from auth.email()
            then 'requires_representation_confirmation'
          when public.general_meeting_participants.attendance_status = 'confirmed'
            then public.general_meeting_participants.attendance_status
          else 'declared'
        end,
        rejected_at = null
  returning * into v_row;

  if v_row.attendance_status = 'confirmed' then
    null;
  end if;
  return v_row;
end;
$fn$;

create or replace function public.confirm_general_meeting_attendance(p_participant_id uuid)
returns public.general_meeting_participants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meeting_participants;
begin
  if not public.can_manage_building_governance() then
    raise exception 'confirm_general_meeting_attendance: not allowed' using errcode = '42501';
  end if;
  update public.general_meeting_participants as p
     set attendance_status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_email = auth.email(),
         rejected_at = null
   where p.id = p_participant_id
     and p.attendance_status in ('declared','requires_representation_confirmation','rejected')
  returning p.* into v_row;
  if not found then
    raise exception 'confirm_general_meeting_attendance: participant not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.reject_general_meeting_attendance(
  p_participant_id uuid,
  p_reason text
)
returns public.general_meeting_participants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meeting_participants;
begin
  if not public.can_manage_building_governance() then
    raise exception 'reject_general_meeting_attendance: not allowed' using errcode = '42501';
  end if;
  update public.general_meeting_participants as p
     set attendance_status = 'rejected',
         rejected_at = now(),
         rejected_reason = nullif(trim(coalesce(p_reason, '')), '')
   where p.id = p_participant_id
  returning p.* into v_row;
  if not found then
    raise exception 'reject_general_meeting_attendance: participant not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.register_general_meeting_participant(
  p_meeting_id uuid,
  p_property_id bigint,
  p_attendance_mode text,
  p_representation_type text,
  p_representative_name text default null,
  p_confirm boolean default true
)
returns public.general_meeting_participants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meeting_participants;
  v_mode text;
  v_repr text;
  v_meeting public.general_meetings;
begin
  if not public.can_manage_building_governance() then
    raise exception 'register_general_meeting_participant: not allowed' using errcode = '42501';
  end if;
  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if not found or v_meeting.status is distinct from 'published' then
    raise exception 'register_general_meeting_participant: meeting not open' using errcode = '42501';
  end if;
  v_mode := coalesce(nullif(trim(p_attendance_mode), ''), 'in_person');
  v_repr := coalesce(nullif(trim(p_representation_type), ''), 'self');
  if v_mode not in ('in_person','online') then
    raise exception 'register_general_meeting_participant: invalid mode' using errcode = '22023';
  end if;
  insert into public.general_meeting_participants (
    meeting_id, property_id, participant_name, representation_type, representative_name,
    attendance_mode, attendance_source, attendance_status, declared_at, declared_by_email,
    confirmed_at, confirmed_by_email
  )
  select p_meeting_id, p.id, coalesce(p.owner_name, p.apartment_number::text), v_repr,
         nullif(trim(coalesce(p_representative_name, '')), ''),
         v_mode, 'administration',
         case when p_confirm then 'confirmed' else 'declared' end,
         now(), auth.email(),
         case when p_confirm then now() else null end,
         case when p_confirm then auth.email() else null end
  from public.properties as p
  where p.id = p_property_id
  on conflict (meeting_id, property_id) do update
    set attendance_mode = excluded.attendance_mode,
        representation_type = excluded.representation_type,
        representative_name = excluded.representative_name,
        attendance_source = 'administration',
        attendance_status = excluded.attendance_status,
        confirmed_at = excluded.confirmed_at,
        confirmed_by_email = excluded.confirmed_by_email,
        rejected_at = null,
        left_at = null
  returning * into v_row;
  if not found then
    raise exception 'register_general_meeting_participant: property not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.mark_general_meeting_participant_left(
  p_participant_id uuid,
  p_reason text default null
)
returns public.general_meeting_participants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meeting_participants;
begin
  if not public.can_manage_building_governance() then
    raise exception 'mark_general_meeting_participant_left: not allowed' using errcode = '42501';
  end if;
  update public.general_meeting_participants as p
     set left_at = now(),
         left_reason = nullif(trim(coalesce(p_reason, '')), '')
   where p.id = p_participant_id
  returning p.* into v_row;
  if not found then
    raise exception 'mark_general_meeting_participant_left: not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.start_general_meeting(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
  v_check public.general_meeting_quorum_checks;
begin
  if not public.can_manage_building_governance() then
    raise exception 'start_general_meeting: not allowed' using errcode = '42501';
  end if;
  select c.* into v_check
  from public.general_meeting_quorum_checks as c
  where c.meeting_id = p_meeting_id
  order by c.checked_at desc
  limit 1;
  if not found or v_check.meeting_can_proceed is not true then
    raise exception 'start_general_meeting: quorum/proceed check missing or not allowed'
      using errcode = '42501';
  end if;
  if v_check.calculation_status = 'incomplete' then
    raise exception 'start_general_meeting: ideal parts incomplete' using errcode = '42501';
  end if;

  update public.general_meetings as m
     set operational_phase = 'in_progress',
         meeting_started_at = coalesce(m.meeting_started_at, now()),
         meeting_started_by_email = coalesce(m.meeting_started_by_email, auth.email()),
         meeting_can_proceed = true
   where m.id = p_meeting_id
     and m.status = 'published'
     and m.operational_phase in ('registration','idle')
  returning m.* into v_row;
  if not found then
    raise exception 'start_general_meeting: meeting cannot start' using errcode = '42501';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.open_general_meeting_vote(p_agenda_item_id uuid)
returns public.general_meeting_agenda_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item public.general_meeting_agenda_items;
  v_meeting public.general_meetings;
  v_open integer;
  v_preset record;
begin
  if not public.can_manage_building_governance() then
    raise exception 'open_general_meeting_vote: not allowed' using errcode = '42501';
  end if;
  select a.* into v_item from public.general_meeting_agenda_items as a where a.id = p_agenda_item_id;
  if not found then
    raise exception 'open_general_meeting_vote: agenda not found' using errcode = 'P0002';
  end if;
  select m.* into v_meeting from public.general_meetings as m where m.id = v_item.meeting_id;
  if v_meeting.operational_phase is distinct from 'in_progress' or v_meeting.meeting_started_at is null then
    raise exception 'open_general_meeting_vote: meeting not started' using errcode = '42501';
  end if;
  select count(*) into v_open
  from public.general_meeting_agenda_items as a
  where a.meeting_id = v_item.meeting_id and a.voting_status = 'open';
  if v_open > 0 then
    raise exception 'open_general_meeting_vote: another question is open' using errcode = '42501';
  end if;

  select * into v_preset from public.gm_apply_majority_preset(v_item.majority_rule);

  insert into public.general_meeting_decisions (
    meeting_id, agenda_item_id, decision_number, title, decision_text, protocol_result
  )
  select v_item.meeting_id, v_item.id, v_item.position::text, v_item.title,
         coalesce(v_item.proposed_decision_text, v_item.title), 'information'
  where not exists (
    select 1 from public.general_meeting_decisions as d where d.agenda_item_id = v_item.id
  );

  update public.general_meeting_agenda_items as a
     set voting_status = 'open',
         voting_opened_at = now(),
         threshold_comparator = v_preset.threshold_comparator,
         required_percent = v_preset.required_percent,
         denominator_basis = v_preset.denominator_basis
   where a.id = v_item.id
     and a.voting_status = 'pending'
  returning a.* into v_item;
  if not found then
    raise exception 'open_general_meeting_vote: question not pending' using errcode = '42501';
  end if;
  return v_item;
end;
$fn$;

create or replace function public.gm_write_vote(
  p_meeting_id uuid,
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text,
  p_source text,
  p_method text
)
returns public.general_meeting_votes
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_meeting public.general_meetings;
  v_item public.general_meeting_agenda_items;
  v_part public.general_meeting_participants;
  v_decision uuid;
  v_row public.general_meeting_votes;
begin
  if p_vote not in ('for','against','abstain') then
    raise exception 'gm_write_vote: invalid vote' using errcode = '22023';
  end if;
  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if v_meeting.operational_phase is distinct from 'in_progress' or v_meeting.meeting_started_at is null then
    raise exception 'gm_write_vote: meeting not started' using errcode = '42501';
  end if;
  if v_meeting.status in ('held','cancelled','rescheduled','draft','archived','minutes_ready') then
    raise exception 'gm_write_vote: meeting closed' using errcode = '42501';
  end if;
  select a.* into v_item from public.general_meeting_agenda_items as a
  where a.id = p_agenda_item_id and a.meeting_id = p_meeting_id;
  if v_item.voting_status is distinct from 'open' then
    raise exception 'gm_write_vote: question not open' using errcode = '42501';
  end if;
  select p.* into v_part from public.general_meeting_participants as p
  where p.meeting_id = p_meeting_id and p.property_id = p_property_id;
  if not found or v_part.attendance_status is distinct from 'confirmed' or v_part.left_at is not null then
    raise exception 'gm_write_vote: property not confirmed present' using errcode = '42501';
  end if;
  if v_part.ideal_parts_percent_snapshot is null then
    raise exception 'gm_write_vote: missing ideal parts snapshot' using errcode = '22023';
  end if;
  select d.id into v_decision from public.general_meeting_decisions as d
  where d.agenda_item_id = p_agenda_item_id;
  if v_decision is null then
    raise exception 'gm_write_vote: decision missing' using errcode = 'P0002';
  end if;

  insert into public.general_meeting_votes (
    meeting_id, decision_id, property_id, participant_id, vote,
    ideal_parts_percent_snapshot, vote_method, vote_source, recorded_by_email
  ) values (
    p_meeting_id, v_decision, p_property_id, v_part.id, p_vote,
    v_part.ideal_parts_percent_snapshot, p_method, p_source, auth.email()
  )
  on conflict (decision_id, property_id) do update
    set vote = excluded.vote,
        vote_method = excluded.vote_method,
        vote_source = excluded.vote_source,
        recorded_at = now(),
        recorded_by_email = auth.email(),
        ideal_parts_percent_snapshot = excluded.ideal_parts_percent_snapshot
  returning * into v_row;

  insert into public.general_meeting_vote_events (
    vote_id, meeting_id, decision_id, property_id, vote, vote_source, recorded_by_email
  ) values (
    v_row.id, p_meeting_id, v_decision, p_property_id, p_vote, p_source, auth.email()
  );
  return v_row;
end;
$fn$;

create or replace function public.cast_general_meeting_vote(
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text
)
returns public.general_meeting_votes
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item public.general_meeting_agenda_items;
  v_method text;
begin
  if auth.email() is null then
    raise exception 'cast_general_meeting_vote: not authenticated' using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'cast_general_meeting_vote: not your property' using errcode = '42501';
  end if;
  select a.* into v_item from public.general_meeting_agenda_items as a where a.id = p_agenda_item_id;
  if not found then
    raise exception 'cast_general_meeting_vote: agenda not found' using errcode = 'P0002';
  end if;
  select case par.attendance_mode when 'online' then 'online' else 'in_person' end
    into v_method
  from public.general_meeting_participants as par
  where par.meeting_id = v_item.meeting_id and par.property_id = p_property_id;
  return public.gm_write_vote(
    v_item.meeting_id, p_agenda_item_id, p_property_id, p_vote, 'owner_portal', coalesce(v_method, 'in_person')
  );
end;
$fn$;

create or replace function public.record_general_meeting_vote(
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text
)
returns public.general_meeting_votes
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item public.general_meeting_agenda_items;
begin
  if not public.can_manage_building_governance() then
    raise exception 'record_general_meeting_vote: not allowed' using errcode = '42501';
  end if;
  select a.* into v_item from public.general_meeting_agenda_items as a where a.id = p_agenda_item_id;
  return public.gm_write_vote(
    v_item.meeting_id, p_agenda_item_id, p_property_id, p_vote, 'administration', 'in_person'
  );
end;
$fn$;

create or replace function public.close_general_meeting_vote(p_agenda_item_id uuid)
returns public.general_meeting_agenda_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item public.general_meeting_agenda_items;
  v_meeting public.general_meetings;
  v_for numeric(12,6);
  v_against numeric(12,6);
  v_abstain numeric(12,6);
  v_repr numeric(12,6);
  v_all numeric(12,6);
  v_units_for integer;
  v_units_all integer;
  v_den numeric(12,6);
  v_status text;
  v_met boolean;
begin
  if not public.can_manage_building_governance() then
    raise exception 'close_general_meeting_vote: not allowed' using errcode = '42501';
  end if;
  select a.* into v_item from public.general_meeting_agenda_items as a where a.id = p_agenda_item_id for update;
  if v_item.voting_status is distinct from 'open' then
    raise exception 'close_general_meeting_vote: question not open' using errcode = '42501';
  end if;
  select m.* into v_meeting from public.general_meetings as m where m.id = v_item.meeting_id;

  select coalesce(sum(v.ideal_parts_percent_snapshot) filter (where v.vote = 'for'), 0),
         coalesce(sum(v.ideal_parts_percent_snapshot) filter (where v.vote = 'against'), 0),
         coalesce(sum(v.ideal_parts_percent_snapshot) filter (where v.vote = 'abstain'), 0),
         count(*) filter (where v.vote = 'for')
    into v_for, v_against, v_abstain, v_units_for
  from public.general_meeting_votes as v
  join public.general_meeting_decisions as d on d.id = v.decision_id
  where d.agenda_item_id = p_agenda_item_id;

  v_repr := v_for + v_against + v_abstain;
  select sum(p.ideal_parts_percent), count(*) into v_all, v_units_all from public.properties as p;
  if exists (select 1 from public.properties as p where p.ideal_parts_percent is null)
       and v_item.denominator_basis in ('all_ideal_parts','eligible_ideal_parts') then
    v_status := 'incomplete';
    v_met := null;
  elsif v_item.majority_rule in ('manual_rule','at_least_75_eligible_ideal_parts') then
    v_status := 'requires_review';
    v_met := null;
  elsif v_item.denominator_basis = 'independent_units' then
    v_met := public.gm_threshold_met(
      (v_units_for::numeric * 100) / nullif(v_units_all, 0),
      v_item.threshold_comparator,
      v_item.required_percent
    );
  elsif v_item.denominator_basis = 'represented_ideal_parts' then
    v_met := public.gm_threshold_met(
      case when v_repr = 0 then null else (v_for / v_repr) * 100 end,
      v_item.threshold_comparator,
      v_item.required_percent
    );
  else
    v_met := public.gm_threshold_met(v_for, v_item.threshold_comparator, v_item.required_percent);
  end if;

  if v_status is null then
    if v_met is null then
      v_status := 'incomplete';
    elsif v_met then
      v_status := 'met';
    else
      v_status := 'not_met';
    end if;
  end if;

  update public.general_meeting_agenda_items as a
     set voting_status = 'closed',
         voting_closed_at = now(),
         for_percent = v_for,
         against_percent = v_against,
         abstain_percent = v_abstain,
         denominator_percent = v_repr,
         computed_threshold_status = v_status
   where a.id = p_agenda_item_id
  returning a.* into v_item;

  update public.general_meeting_decisions as d
     set computed_threshold_status = v_status,
         for_percent = v_for,
         against_percent = v_against,
         abstain_percent = v_abstain,
         protocol_result = case
           when v_status = 'met' then 'adopted'
           when v_status = 'not_met' then 'rejected'
           else d.protocol_result
         end
   where d.agenda_item_id = p_agenda_item_id;

  return v_item;
end;
$fn$;

create or replace function public.set_general_meeting_protocol_result(
  p_decision_id uuid,
  p_protocol_result text,
  p_override_reason text default null
)
returns public.general_meeting_decisions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meeting_decisions;
  v_reason text;
begin
  if not public.can_manage_building_governance() then
    raise exception 'set_general_meeting_protocol_result: not allowed' using errcode = '42501';
  end if;
  if p_protocol_result not in ('adopted','rejected','information') then
    raise exception 'set_general_meeting_protocol_result: invalid result' using errcode = '22023';
  end if;
  select d.* into v_row from public.general_meeting_decisions as d where d.id = p_decision_id;
  v_reason := nullif(trim(coalesce(p_override_reason, '')), '');
  if v_row.computed_threshold_status is not null
     and v_row.computed_threshold_status is distinct from 'requires_review'
     and ((p_protocol_result = 'adopted' and v_row.computed_threshold_status is distinct from 'met')
       or (p_protocol_result = 'rejected' and v_row.computed_threshold_status is distinct from 'not_met'))
     and v_reason is null then
    raise exception 'set_general_meeting_protocol_result: override reason required' using errcode = '22023';
  end if;
  update public.general_meeting_decisions as d
     set protocol_result = p_protocol_result,
         result_override_reason = v_reason
   where d.id = p_decision_id
  returning d.* into v_row;
  return v_row;
end;
$fn$;

create or replace function public.finish_general_meeting(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
  v_open integer;
begin
  if not public.can_manage_building_governance() then
    raise exception 'finish_general_meeting: not allowed' using errcode = '42501';
  end if;
  select count(*) into v_open
  from public.general_meeting_agenda_items as a
  where a.meeting_id = p_meeting_id and a.voting_status = 'open';
  if v_open > 0 then
    raise exception 'finish_general_meeting: open votes remain' using errcode = '42501';
  end if;
  update public.general_meetings as m
     set status = 'held',
         operational_phase = 'closed',
         meeting_ended_at = now(),
         meeting_ended_by_email = auth.email()
   where m.id = p_meeting_id
     and m.status = 'published'
     and m.operational_phase = 'in_progress'
  returning m.* into v_row;
  if not found then
    raise exception 'finish_general_meeting: meeting cannot finish' using errcode = '42501';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.set_general_meeting_online_url(
  p_meeting_id uuid,
  p_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.can_manage_building_governance() then
    raise exception 'set_general_meeting_online_url: not allowed' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_url, '')), '') is null then
    delete from public.general_meeting_online_links where meeting_id = p_meeting_id;
    update public.general_meetings set online_meeting_url = null where id = p_meeting_id;
    return;
  end if;
  insert into public.general_meeting_online_links (meeting_id, join_url, updated_by_email)
  values (p_meeting_id, trim(p_url), auth.email())
  on conflict (meeting_id) do update
    set join_url = excluded.join_url,
        updated_at = now(),
        updated_by_email = auth.email();
  update public.general_meetings set online_meeting_url = null where id = p_meeting_id;
end;
$fn$;

create or replace function public.get_general_meeting_online_join_url(p_meeting_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_meeting public.general_meetings;
  v_url text;
  v_ok boolean := false;
  v_start timestamptz;
begin
  if auth.email() is null then
    raise exception 'get_general_meeting_online_join_url: not authenticated' using errcode = '28000';
  end if;
  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if v_meeting.meeting_mode is distinct from 'hybrid' then
    raise exception 'get_general_meeting_online_join_url: not hybrid' using errcode = '42501';
  end if;
  v_start := (v_meeting.meeting_date::timestamp + coalesce(v_meeting.meeting_time, time '00:00'))
             at time zone 'Europe/Sofia';
  if now() < v_start - interval '3 hours' or now() > v_start + interval '8 hours' then
    if v_meeting.operational_phase not in ('registration','in_progress') then
      raise exception 'get_general_meeting_online_join_url: outside window' using errcode = '42501';
    end if;
  end if;

  select true into v_ok
  from public.general_meeting_participants as p
  join public.properties as pr on pr.id = p.property_id
  where p.meeting_id = p_meeting_id
    and public.owns_property(p.property_id)
    and p.attendance_mode = 'online'
    and p.attendance_status in ('declared','confirmed','requires_representation_confirmation')
    and p.left_at is null
  limit 1;
  if v_ok is not true and not public.can_manage_building_governance() then
    raise exception 'get_general_meeting_online_join_url: check-in required' using errcode = '42501';
  end if;

  select l.join_url into v_url from public.general_meeting_online_links as l where l.meeting_id = p_meeting_id;
  if v_url is null then
    raise exception 'get_general_meeting_online_join_url: url missing' using errcode = 'P0002';
  end if;

  update public.general_meeting_participants as p
     set online_link_opened_at = coalesce(p.online_link_opened_at, now())
   where p.meeting_id = p_meeting_id
     and public.owns_property(p.property_id)
     and p.attendance_mode = 'online';

  return v_url;
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
  if char_length(v_reason) < 3 or p_meeting_date is null then
    raise exception 'reschedule_general_meeting: reason and date required' using errcode = '22023';
  end if;
  v_mode := coalesce(nullif(trim(p_meeting_mode), ''), 'in_person');
  if v_mode not in ('in_person','hybrid') then
    raise exception 'reschedule_general_meeting: invalid meeting_mode' using errcode = '22023';
  end if;
  select m.* into v_old from public.general_meetings as m where m.id = p_meeting_id for update;
  if v_old.status is distinct from 'published' then
    raise exception 'reschedule_general_meeting: only published meetings can be rescheduled' using errcode = '42501';
  end if;

  insert into public.general_meetings (
    title, description, meeting_date, meeting_time, location, meeting_mode, is_urgent,
    status, convoked_by, absentee_voting_enabled, absentee_voting_deadline, quorum_stage,
    quorum_rule, created_by_email, rescheduled_from_meeting_id,
    invitation_posted_at, published_at, published_by_email, operational_phase
  ) values (
    v_old.title, v_old.description, p_meeting_date, p_meeting_time,
    nullif(trim(coalesce(p_location, '')), ''), v_mode, v_old.is_urgent,
    'draft', v_old.convoked_by, v_old.absentee_voting_enabled, v_old.absentee_voting_deadline, 'initial',
    v_old.quorum_rule, auth.email(), v_old.id, null, null, null, 'idle'
  )
  returning * into v_new;

  insert into public.general_meeting_agenda_items (
    meeting_id, position, title, description, proposed_decision_text,
    decision_category, majority_rule, threshold_comparator, required_percent, denominator_basis, legal_basis
  )
  select v_new.id, a.position, a.title, a.description, a.proposed_decision_text,
         a.decision_category, a.majority_rule, a.threshold_comparator, a.required_percent, a.denominator_basis, a.legal_basis
  from public.general_meeting_agenda_items as a
  where a.meeting_id = v_old.id
  order by a.position;

  update public.general_meetings as m
     set status = 'rescheduled', reschedule_reason = v_reason, operational_phase = 'closed'
   where m.id = v_old.id;
  return v_new;
end;
$fn$;

alter table public.general_meeting_online_links enable row level security;
alter table public.general_meeting_quorum_checks enable row level security;
alter table public.general_meeting_vote_events enable row level security;

revoke all on table public.general_meeting_online_links from anon, public;
revoke all on table public.general_meeting_quorum_checks from anon, public;
revoke all on table public.general_meeting_vote_events from anon, public;
revoke insert, update, delete on table public.general_meeting_votes from authenticated;
revoke insert, update, delete on table public.general_meeting_quorum_checks from authenticated;
revoke insert, update, delete on table public.general_meeting_vote_events from authenticated;
revoke insert, update, delete on table public.general_meeting_online_links from authenticated;
grant select on table public.general_meeting_quorum_checks to authenticated;
grant select on table public.general_meeting_vote_events to authenticated;

drop policy if exists general_meeting_online_links_admin on public.general_meeting_online_links;
create policy general_meeting_online_links_admin on public.general_meeting_online_links
for all to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());

drop policy if exists general_meeting_quorum_checks_select on public.general_meeting_quorum_checks;
create policy general_meeting_quorum_checks_select on public.general_meeting_quorum_checks
for select to authenticated
using (public.can_manage_building_governance());

drop policy if exists general_meeting_vote_events_select on public.general_meeting_vote_events;
create policy general_meeting_vote_events_select on public.general_meeting_vote_events
for select to authenticated
using (public.can_manage_building_governance());

drop policy if exists general_meeting_votes_select on public.general_meeting_votes;
create policy general_meeting_votes_select on public.general_meeting_votes
for select to authenticated
using (
  public.can_manage_building_governance()
  or public.owns_property(property_id)
);

drop policy if exists general_meeting_participants_select on public.general_meeting_participants;
create policy general_meeting_participants_select on public.general_meeting_participants
for select to authenticated
using (
  public.can_manage_building_governance()
  or public.owns_property(property_id)
);

-- Direct client writes remain admin-gated; critical lifecycle goes through RPC (SECURITY DEFINER).
drop policy if exists general_meeting_participants_insert on public.general_meeting_participants;
drop policy if exists general_meeting_participants_update on public.general_meeting_participants;
drop policy if exists general_meeting_participants_delete on public.general_meeting_participants;
revoke insert, update, delete on table public.general_meeting_participants from authenticated;

drop policy if exists general_meeting_decisions_insert on public.general_meeting_decisions;
drop policy if exists general_meeting_decisions_update on public.general_meeting_decisions;
drop policy if exists general_meeting_decisions_delete on public.general_meeting_decisions;
revoke insert, update, delete on table public.general_meeting_decisions from authenticated;


revoke all on function public.gm_threshold_met from public;
revoke execute on function public.gm_threshold_met from anon;

revoke all on function public.gm_quorum_required_percent from public;
revoke execute on function public.gm_quorum_required_percent from anon;

revoke all on function public.calculate_general_meeting_quorum from public;
revoke execute on function public.calculate_general_meeting_quorum from anon;

revoke all on function public.record_general_meeting_quorum_check from public;
revoke execute on function public.record_general_meeting_quorum_check from anon;

revoke all on function public.open_general_meeting_registration from public;
revoke execute on function public.open_general_meeting_registration from anon;

revoke all on function public.advance_general_meeting_quorum_stage from public;
revoke execute on function public.advance_general_meeting_quorum_stage from anon;

revoke all on function public.declare_general_meeting_attendance from public;
revoke execute on function public.declare_general_meeting_attendance from anon;

revoke all on function public.confirm_general_meeting_attendance from public;
revoke execute on function public.confirm_general_meeting_attendance from anon;

revoke all on function public.reject_general_meeting_attendance from public;
revoke execute on function public.reject_general_meeting_attendance from anon;

revoke all on function public.register_general_meeting_participant from public;
revoke execute on function public.register_general_meeting_participant from anon;

revoke all on function public.mark_general_meeting_participant_left from public;
revoke execute on function public.mark_general_meeting_participant_left from anon;

revoke all on function public.start_general_meeting from public;
revoke execute on function public.start_general_meeting from anon;

revoke all on function public.open_general_meeting_vote from public;
revoke execute on function public.open_general_meeting_vote from anon;

revoke all on function public.cast_general_meeting_vote from public;
revoke execute on function public.cast_general_meeting_vote from anon;

revoke all on function public.record_general_meeting_vote from public;
revoke execute on function public.record_general_meeting_vote from anon;

revoke all on function public.close_general_meeting_vote from public;
revoke execute on function public.close_general_meeting_vote from anon;

revoke all on function public.set_general_meeting_protocol_result from public;
revoke execute on function public.set_general_meeting_protocol_result from anon;

revoke all on function public.finish_general_meeting from public;
revoke execute on function public.finish_general_meeting from anon;

revoke all on function public.set_general_meeting_online_url from public;
revoke execute on function public.set_general_meeting_online_url from anon;

revoke all on function public.get_general_meeting_online_join_url from public;
revoke execute on function public.get_general_meeting_online_join_url from anon;

revoke all on function public.reschedule_general_meeting from public;
revoke execute on function public.reschedule_general_meeting from anon;

grant execute on function public.gm_threshold_met(numeric, text, numeric) to authenticated;
grant execute on function public.gm_quorum_required_percent(text, text) to authenticated;
grant execute on function public.gm_apply_majority_preset(text) to authenticated;
grant execute on function public.calculate_general_meeting_quorum(uuid) to authenticated;
grant execute on function public.record_general_meeting_quorum_check(uuid, text) to authenticated;
grant execute on function public.open_general_meeting_registration(uuid) to authenticated;
grant execute on function public.advance_general_meeting_quorum_stage(uuid) to authenticated;
grant execute on function public.declare_general_meeting_attendance(uuid, bigint, text) to authenticated;
grant execute on function public.confirm_general_meeting_attendance(uuid) to authenticated;
grant execute on function public.reject_general_meeting_attendance(uuid, text) to authenticated;
grant execute on function public.register_general_meeting_participant(uuid, bigint, text, text, text, boolean) to authenticated;
grant execute on function public.mark_general_meeting_participant_left(uuid, text) to authenticated;
grant execute on function public.start_general_meeting(uuid) to authenticated;
grant execute on function public.open_general_meeting_vote(uuid) to authenticated;
grant execute on function public.cast_general_meeting_vote(uuid, bigint, text) to authenticated;
grant execute on function public.record_general_meeting_vote(uuid, bigint, text) to authenticated;
grant execute on function public.close_general_meeting_vote(uuid) to authenticated;
grant execute on function public.set_general_meeting_protocol_result(uuid, text, text) to authenticated;
grant execute on function public.finish_general_meeting(uuid) to authenticated;
grant execute on function public.set_general_meeting_online_url(uuid, text) to authenticated;
grant execute on function public.get_general_meeting_online_join_url(uuid) to authenticated;
grant execute on function public.reschedule_general_meeting(uuid, date, time, text, text, text) to authenticated;

revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from public;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from anon, authenticated;

commit;
