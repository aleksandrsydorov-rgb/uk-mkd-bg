-- In-person owner check-in stays declared until admin confirms.
-- Online stays auto-confirmed (counts toward quorum immediately).

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
    -- Online answers / confirmations count toward quorum automatically.
    v_status := 'confirmed';
  else
    if not public.gm_in_person_registration_open(v_meeting) then
      raise exception 'declare_general_meeting_attendance: in-person registration opens 1 hour before start'
        using errcode = '42501';
    end if;
    -- Auto-open desk registration window at first in-person application.
    if v_meeting.operational_phase is distinct from 'registration'
       and v_meeting.operational_phase is distinct from 'in_progress' then
      update public.general_meetings as m
         set operational_phase = 'registration',
             registration_opened_at = coalesce(m.registration_opened_at, now()),
             registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email()),
             legal_state = case
               when coalesce(m.legal_state, '') in ('WAITING_FOR_MEETING', 'INVITATION_POSTED', 'NOTIFICATION_RUNNING')
                 then 'CHECK_IN_OPEN'
               else m.legal_state
             end
       where m.id = p_meeting_id
      returning m.* into v_meeting;
    end if;
    -- Admin must confirm personal / representative presence at the desk.
    v_status := 'declared';
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

-- Idempotent auto-open for T−1h window (admin UI / cron-safe).
create or replace function public.gm_ensure_registration_open(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_ensure_registration_open: not allowed' using errcode = '42501';
  end if;

  select m.* into v_row from public.general_meetings as m where m.id = p_meeting_id;
  if not found or v_row.status is distinct from 'published' then
    raise exception 'gm_ensure_registration_open: published meeting not found' using errcode = 'P0002';
  end if;

  if v_row.operational_phase in ('registration', 'in_progress', 'closed') then
    return v_row;
  end if;

  if not public.gm_in_person_registration_open(v_row) then
    return v_row; -- silent no-op until T−1h
  end if;

  update public.general_meetings as m
     set operational_phase = 'registration',
         registration_opened_at = coalesce(m.registration_opened_at, now()),
         registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email()),
         legal_state = case
           when coalesce(m.legal_state, '') in ('WAITING_FOR_MEETING', 'INVITATION_POSTED', 'NOTIFICATION_RUNNING', 'INVITATION_LOCKED')
             then 'CHECK_IN_OPEN'
           else m.legal_state
         end,
         updated_at = now()
   where m.id = p_meeting_id
  returning m.* into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.gm_ensure_registration_open(uuid) from public, anon;
grant execute on function public.gm_ensure_registration_open(uuid) to authenticated;
grant execute on function public.declare_general_meeting_attendance(uuid, bigint, text) to authenticated;
