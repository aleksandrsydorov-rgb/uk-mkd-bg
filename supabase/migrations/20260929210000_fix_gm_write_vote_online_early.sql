-- Fix online early vote: valid protocol_result + plpgsql wrapper (SQL SELECT * mismatch).

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
  v_dec_n integer;
begin
  if p_vote not in ('for', 'against', 'abstain') then
    raise exception 'gm_write_vote: invalid vote' using errcode = '22023';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if not found then
    raise exception 'gm_write_vote: meeting not found' using errcode = 'P0002';
  end if;
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
      'information'
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

-- Recreate 6-arg overload as plpgsql (avoids SQL "structure of query does not match").
drop function if exists public.gm_write_vote(uuid, uuid, bigint, text, text, text);

create function public.gm_write_vote(
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
begin
  return public.gm_write_vote(
    p_meeting_id, p_agenda_item_id, p_property_id, p_vote, p_source, p_method, null::bigint
  );
end;
$fn$;

revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from public, anon;
revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text, bigint) from public, anon;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from anon, authenticated;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text, bigint) from anon, authenticated;
-- cast_general_meeting_vote / record_general_meeting_vote remain the authenticated entry points
