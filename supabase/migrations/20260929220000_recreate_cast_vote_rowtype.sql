-- Recreate RPCs that SELECT * INTO table rowtypes after column adds
-- (source_poll_id on agenda_items, Meeting Core cols on general_meetings).
-- Stale plpgsql tupledesc → "structure of query does not match function result type".

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
  v_party_id bigint;
  v_email text := lower(btrim(coalesce(auth.email(), '')));
begin
  if v_email = '' then
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

  select op.registry_people_id into v_party_id
  from public.owner_voting_parties(v_email) as op
  where op.property_id = p_property_id
  order by op.registry_people_id nulls last
  limit 1;

  return public.gm_write_vote(
    v_item.meeting_id,
    p_agenda_item_id,
    p_property_id,
    p_vote,
    'owner_portal',
    coalesce(v_method, 'in_person'),
    v_party_id
  );
end;
$fn$;

revoke all on function public.cast_general_meeting_vote(uuid, bigint, text) from public, anon;
grant execute on function public.cast_general_meeting_vote(uuid, bigint, text) to authenticated;

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
  if not found then
    raise exception 'get_general_meeting_online_join_url: meeting not found' using errcode = 'P0002';
  end if;
  if v_meeting.meeting_mode is distinct from 'hybrid' then
    raise exception 'get_general_meeting_online_join_url: not hybrid' using errcode = '42501';
  end if;
  v_start := public.gm_meeting_starts_at(v_meeting);
  if now() < v_start - interval '3 hours' or now() > v_start + interval '8 hours' then
    if v_meeting.operational_phase not in ('registration', 'in_progress') then
      raise exception 'get_general_meeting_online_join_url: outside window' using errcode = '42501';
    end if;
  end if;

  select true into v_ok
  from public.general_meeting_participants as p
  where p.meeting_id = p_meeting_id
    and public.owns_property(p.property_id)
    and p.attendance_mode = 'online'
    and p.attendance_status in ('declared', 'confirmed', 'requires_representation_confirmation')
    and p.left_at is null
  limit 1;
  if v_ok is not true and not public.can_manage_building_governance() then
    raise exception 'get_general_meeting_online_join_url: check-in required' using errcode = '42501';
  end if;

  select l.join_url into v_url from public.general_meeting_online_links as l where l.meeting_id = p_meeting_id;
  if v_url is null then
    v_url := nullif(trim(coalesce(v_meeting.online_meeting_url, '')), '');
  end if;
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

revoke all on function public.get_general_meeting_online_join_url(uuid) from public, anon;
grant execute on function public.get_general_meeting_online_join_url(uuid) to authenticated;
