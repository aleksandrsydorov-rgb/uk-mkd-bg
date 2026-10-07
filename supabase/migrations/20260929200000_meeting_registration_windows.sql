-- In-person check-in from T-1h; online confirm until T-49h (then annulled);
-- online-confirmed owners may vote on agenda items immediately (before live start).

update public.meeting_rulesets
   set rules_json = coalesce(rules_json, '{}'::jsonb) || jsonb_build_object(
     'in_person_check_in_hours_before', 1,
     'online_confirm_hours_before', 49
   )
 where code = 'BG_ZUES_2026_09';

create or replace function public.gm_meeting_starts_at(p_meeting public.general_meetings)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select (p_meeting.meeting_date::timestamp + coalesce(p_meeting.meeting_time, time '00:00'))
         at time zone 'Europe/Sofia';
$fn$;

create or replace function public.gm_in_person_registration_open(p_meeting public.general_meetings, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_now >= public.gm_meeting_starts_at(p_meeting) - interval '1 hour';
$fn$;

create or replace function public.gm_online_confirm_open(p_meeting public.general_meetings, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $fn$
  -- Confirmation of online participation / invitation notice is annulled from T-49h.
  select p_now < public.gm_meeting_starts_at(p_meeting) - interval '49 hours';
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

  select m.* into v_row from public.general_meetings as m where m.id = p_meeting_id;
  if not found or v_row.status is distinct from 'published' then
    raise exception 'open_general_meeting_registration: published meeting not found' using errcode = 'P0002';
  end if;
  if not public.gm_in_person_registration_open(v_row) then
    raise exception 'open_general_meeting_registration: opens 1 hour before meeting start'
      using errcode = '42501';
  end if;

  update public.general_meetings as m
     set operational_phase = 'registration',
         registration_opened_at = coalesce(m.registration_opened_at, now()),
         registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email())
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
  v_status text;
begin
  if auth.email() is null then
    raise exception 'declare_general_meeting_attendance: not authenticated' using errcode = '28000';
  end if;
  v_mode := nullif(trim(p_attendance_mode), '');
  if v_mode not in ('in_person', 'online') then
    raise exception 'declare_general_meeting_attendance: invalid mode' using errcode = '22023';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'declare_general_meeting_attendance: not your property' using errcode = '42501';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if not found or v_meeting.status is distinct from 'published' then
    raise exception 'declare_general_meeting_attendance: meeting not open' using errcode = '42501';
  end if;
  if v_mode = 'online' and v_meeting.meeting_mode is distinct from 'hybrid' then
    raise exception 'declare_general_meeting_attendance: online not available' using errcode = '42501';
  end if;

  if v_mode = 'online' then
    if not public.gm_online_confirm_open(v_meeting) then
      raise exception 'declare_general_meeting_attendance: online confirm closed 49h before start'
        using errcode = '42501';
    end if;
    v_status := 'confirmed';
  else
    if not public.gm_in_person_registration_open(v_meeting) then
      raise exception 'declare_general_meeting_attendance: in-person registration opens 1 hour before start'
        using errcode = '42501';
    end if;
    -- Auto-open desk registration window when first in-person check-in happens.
    if v_meeting.operational_phase is distinct from 'registration'
       and v_meeting.operational_phase is distinct from 'in_progress' then
      update public.general_meetings as m
         set operational_phase = 'registration',
             registration_opened_at = coalesce(m.registration_opened_at, now()),
             registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email())
       where m.id = p_meeting_id
      returning m.* into v_meeting;
    end if;
    v_status := 'confirmed';
  end if;

  v_property := p_property_id;
  select p.owner_name into v_name from public.properties as p where p.id = v_property;

  insert into public.general_meeting_participants (
    meeting_id, property_id, participant_name, representation_type, attendance_mode,
    attendance_source, attendance_status, declared_at, declared_by_email,
    confirmed_at, confirmed_by_email
  ) values (
    p_meeting_id, v_property, coalesce(v_name, auth.email()), 'self', v_mode,
    'owner_self_checkin', v_status, now(), auth.email(),
    case when v_status = 'confirmed' then now() else null end,
    case when v_status = 'confirmed' then auth.email() else null end
  )
  on conflict (meeting_id, property_id) do update
    set attendance_mode = excluded.attendance_mode,
        declared_at = now(),
        declared_by_email = auth.email(),
        attendance_status = case
          when public.general_meeting_participants.attendance_status = 'confirmed'
            and public.general_meeting_participants.declared_by_email is distinct from auth.email()
            then 'requires_representation_confirmation'
          when v_status = 'confirmed'
            and public.general_meeting_participants.attendance_status is distinct from 'rejected'
            then 'confirmed'
          when public.general_meeting_participants.attendance_status = 'confirmed'
            then public.general_meeting_participants.attendance_status
          else v_status
        end,
        confirmed_at = case
          when v_status = 'confirmed' then coalesce(public.general_meeting_participants.confirmed_at, now())
          else public.general_meeting_participants.confirmed_at
        end,
        confirmed_by_email = case
          when v_status = 'confirmed' then coalesce(public.general_meeting_participants.confirmed_by_email, auth.email())
          else public.general_meeting_participants.confirmed_by_email
        end,
        rejected_at = null
  returning * into v_row;

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
  if v_mode not in ('in_person', 'online') then
    raise exception 'register_general_meeting_participant: invalid mode' using errcode = '22023';
  end if;

  if v_mode = 'in_person' and not public.gm_in_person_registration_open(v_meeting) then
    raise exception 'register_general_meeting_participant: in-person opens 1 hour before start'
      using errcode = '42501';
  end if;
  if v_mode = 'online' and not public.gm_online_confirm_open(v_meeting) then
    raise exception 'register_general_meeting_participant: online confirm closed 49h before start'
      using errcode = '42501';
  end if;

  if v_mode = 'in_person'
     and v_meeting.operational_phase is distinct from 'registration'
     and v_meeting.operational_phase is distinct from 'in_progress' then
    update public.general_meetings as m
       set operational_phase = 'registration',
           registration_opened_at = coalesce(m.registration_opened_at, now()),
           registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email())
     where m.id = p_meeting_id;
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

-- Online-confirmed may vote before live start on pending/open questions.
create or replace function public.gm_write_vote(
  p_meeting_id uuid,
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text,
  p_source text,
  p_method text,
  p_registry_people_id bigint
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
  v_party_id bigint := p_registry_people_id;
  v_ideal numeric;
  v_live boolean := false;
  v_online_early boolean := false;
  v_dec_n text;
begin
  if p_vote not in ('for', 'against', 'abstain') then
    raise exception 'gm_write_vote: invalid vote' using errcode = '22023';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if v_meeting.status in ('held', 'cancelled', 'rescheduled', 'draft', 'archived', 'minutes_ready') then
    raise exception 'gm_write_vote: meeting closed' using errcode = '42501';
  end if;

  select a.* into v_item from public.general_meeting_agenda_items as a
  where a.id = p_agenda_item_id and a.meeting_id = p_meeting_id;
  if not found then
    raise exception 'gm_write_vote: agenda not found' using errcode = 'P0002';
  end if;

  select p.* into v_part from public.general_meeting_participants as p
  where p.meeting_id = p_meeting_id and p.property_id = p_property_id;
  if not found or v_part.attendance_status is distinct from 'confirmed' or v_part.left_at is not null then
    raise exception 'gm_write_vote: property not confirmed present' using errcode = '42501';
  end if;

  v_live := v_meeting.operational_phase = 'in_progress'
    and v_meeting.meeting_started_at is not null
    and v_item.voting_status = 'open';

  v_online_early := v_part.attendance_mode = 'online'
    and v_meeting.status = 'published'
    and v_item.voting_status in ('pending', 'open');

  if not v_live and not v_online_early then
    raise exception 'gm_write_vote: voting not available' using errcode = '42501';
  end if;

  if v_party_id is null then
    select op.registry_people_id, op.ideal_parts_percent
      into v_party_id, v_ideal
    from public.property_voting_parties(p_property_id) as op
    order by op.registry_people_id nulls last
    limit 1;
  else
    select op.ideal_parts_percent into v_ideal
    from public.property_voting_parties(p_property_id) as op
    where op.registry_people_id is not distinct from v_party_id;
  end if;

  if v_ideal is null then
    v_ideal := v_part.ideal_parts_percent_snapshot;
  end if;
  if v_ideal is null then
    raise exception 'gm_write_vote: missing ideal parts' using errcode = '22023';
  end if;

  select d.id into v_decision from public.general_meeting_decisions as d
  where d.agenda_item_id = p_agenda_item_id;
  if v_decision is null then
    select coalesce(max(nullif(regexp_replace(d.decision_number, '\D', '', 'g'), '')::int), 0) + 1
      into v_dec_n
    from public.general_meeting_decisions as d
    where d.meeting_id = p_meeting_id;
    insert into public.general_meeting_decisions (
      meeting_id, agenda_item_id, decision_number, title, decision_text, protocol_result
    ) values (
      p_meeting_id,
      p_agenda_item_id,
      coalesce(v_dec_n::text, v_item.position::text),
      v_item.title,
      coalesce(v_item.proposed_decision_text, v_item.title),
      'pending'
    )
    returning id into v_decision;
  end if;

  if v_party_id is not null then
    select v.* into v_row
    from public.general_meeting_votes as v
    where v.decision_id = v_decision and v.registry_people_id = v_party_id;
  else
    select v.* into v_row
    from public.general_meeting_votes as v
    where v.decision_id = v_decision
      and v.property_id = p_property_id
      and v.registry_people_id is null;
  end if;

  if found then
    raise exception 'gm_write_vote: vote already cast' using errcode = '42501';
  end if;

  insert into public.general_meeting_votes (
    meeting_id, decision_id, property_id, registry_people_id, participant_id, vote,
    ideal_parts_percent_snapshot, vote_method, vote_source, recorded_by_email
  ) values (
    p_meeting_id, v_decision, p_property_id, v_party_id, v_part.id, p_vote,
    v_ideal, p_method, p_source, auth.email()
  )
  returning * into v_row;

  insert into public.general_meeting_vote_events (
    vote_id, meeting_id, decision_id, property_id, vote, vote_source, recorded_by_email
  ) values (
    v_row.id, p_meeting_id, v_decision, p_property_id, p_vote, p_source, auth.email()
  );

  return v_row;
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
language sql
security definer
set search_path = ''
as $fn$
  select * from public.gm_write_vote(
    p_meeting_id, p_agenda_item_id, p_property_id, p_vote, p_source, p_method, null::bigint
  );
$fn$;

revoke all on function public.gm_meeting_starts_at(public.general_meetings) from public, anon;
revoke all on function public.gm_in_person_registration_open(public.general_meetings, timestamptz) from public, anon;
revoke all on function public.gm_online_confirm_open(public.general_meetings, timestamptz) from public, anon;
