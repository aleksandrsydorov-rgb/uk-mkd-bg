-- Attendance mode rules:
-- online → cannot switch to in_person
-- in_person → may switch to online until T-49h
-- new online: until T-49h; new in_person: until T-49h (intent) or from T-1h (desk)

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
  v_existing public.general_meeting_participants;
  v_mode text;
  v_name text;
  v_status text := 'confirmed';
  v_start timestamptz;
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

  v_start := public.gm_meeting_starts_at(v_meeting);
  if now() > v_start + interval '8 hours' then
    raise exception 'declare_general_meeting_attendance: meeting finished' using errcode = '42501';
  end if;

  select p.* into v_existing
  from public.general_meeting_participants as p
  where p.meeting_id = p_meeting_id and p.property_id = p_property_id;

  if found then
    -- Online is final: cannot switch to in-person.
    if v_existing.attendance_mode = 'online' and v_mode = 'in_person' then
      raise exception 'declare_general_meeting_attendance: online cannot switch to in-person'
        using errcode = '42501';
    end if;
    -- In-person may switch to online only while online confirm window is open (before T-49h).
    if v_existing.attendance_mode = 'in_person' and v_mode = 'online' then
      if not public.gm_online_confirm_open(v_meeting) then
        raise exception 'declare_general_meeting_attendance: online confirm closed 49h before start'
          using errcode = '42501';
      end if;
    end if;
  else
    if v_mode = 'online' then
      if not public.gm_online_confirm_open(v_meeting) then
        raise exception 'declare_general_meeting_attendance: online confirm closed 49h before start'
          using errcode = '42501';
      end if;
    else
      -- Early in-person intent while online window open, or desk check-in from T-1h.
      if not (
        public.gm_online_confirm_open(v_meeting)
        or public.gm_in_person_registration_open(v_meeting)
      ) then
        raise exception 'declare_general_meeting_attendance: in-person not available now'
          using errcode = '42501';
      end if;
      if public.gm_in_person_registration_open(v_meeting)
         and v_meeting.operational_phase is distinct from 'registration'
         and v_meeting.operational_phase is distinct from 'in_progress' then
        update public.general_meetings as m
           set operational_phase = 'registration',
               registration_opened_at = coalesce(m.registration_opened_at, now()),
               registration_opened_by_email = coalesce(m.registration_opened_by_email, auth.email())
         where m.id = p_meeting_id
        returning m.* into v_meeting;
      end if;
    end if;
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
    now(), auth.email()
  )
  on conflict (meeting_id, property_id) do update
    set attendance_mode = excluded.attendance_mode,
        declared_at = now(),
        declared_by_email = auth.email(),
        attendance_status = case
          when public.general_meeting_participants.attendance_status = 'confirmed'
            and public.general_meeting_participants.declared_by_email is distinct from auth.email()
            then 'requires_representation_confirmation'
          when public.general_meeting_participants.attendance_status is distinct from 'rejected'
            then 'confirmed'
          else excluded.attendance_status
        end,
        confirmed_at = case
          when public.general_meeting_participants.attendance_status is distinct from 'rejected'
            then coalesce(public.general_meeting_participants.confirmed_at, now())
          else public.general_meeting_participants.confirmed_at
        end,
        confirmed_by_email = case
          when public.general_meeting_participants.attendance_status is distinct from 'rejected'
            then coalesce(public.general_meeting_participants.confirmed_by_email, auth.email())
          else public.general_meeting_participants.confirmed_by_email
        end,
        rejected_at = null
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.declare_general_meeting_attendance(uuid, bigint, text) from public, anon;
grant execute on function public.declare_general_meeting_attendance(uuid, bigint, text) to authenticated;
