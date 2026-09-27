-- Stage 4: party voting — polls + GM by registry owner ideal_parts.

begin;

-- ---------------------------------------------------------------------------
-- poll_votes / history: party column + uniqueness
-- ---------------------------------------------------------------------------

alter table public.poll_votes
  add column if not exists registry_people_id bigint
    references public.property_registry_people (id) on delete restrict;

alter table public.poll_vote_history
  add column if not exists registry_people_id bigint
    references public.property_registry_people (id) on delete restrict;

do $do$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.poll_votes'::regclass
      and conname = 'poll_votes_poll_id_property_id_key'
  ) then
    alter table public.poll_votes drop constraint poll_votes_poll_id_property_id_key;
  end if;
end;
$do$;

create unique index if not exists poll_votes_poll_party_uidx
  on public.poll_votes (poll_id, registry_people_id)
  where registry_people_id is not null;

create unique index if not exists poll_votes_poll_property_legacy_uidx
  on public.poll_votes (poll_id, property_id)
  where registry_people_id is null;

create index if not exists poll_votes_registry_people_idx
  on public.poll_votes (registry_people_id)
  where registry_people_id is not null;

-- ---------------------------------------------------------------------------
-- GM votes: party column + uniqueness
-- ---------------------------------------------------------------------------

alter table public.general_meeting_votes
  add column if not exists registry_people_id bigint
    references public.property_registry_people (id) on delete restrict;

alter table public.general_meeting_votes
  add column if not exists vote_source text;

update public.general_meeting_votes
   set vote_source = 'administration'
 where vote_source is null;

alter table public.general_meeting_votes
  alter column vote_source set default 'administration';

do $do$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_votes'::regclass
      and conname = 'general_meeting_votes_property_decision_uidx'
  ) then
    alter table public.general_meeting_votes
      drop constraint general_meeting_votes_property_decision_uidx;
  end if;
  -- alternate name used in some deploys
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_votes'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%decision_id%property_id%'
  ) then
    execute (
      select 'alter table public.general_meeting_votes drop constraint ' || quote_ident(conname)
      from pg_constraint
      where conrelid = 'public.general_meeting_votes'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%decision_id%property_id%'
      limit 1
    );
  end if;
end;
$do$;

create unique index if not exists general_meeting_votes_decision_party_uidx
  on public.general_meeting_votes (decision_id, registry_people_id)
  where registry_people_id is not null;

create unique index if not exists general_meeting_votes_decision_property_legacy_uidx
  on public.general_meeting_votes (decision_id, property_id)
  where registry_people_id is null;

-- ---------------------------------------------------------------------------
-- Active owner parties for an email (book + legacy sole fallback)
-- ---------------------------------------------------------------------------

create or replace function public.owner_voting_parties(p_email text default null)
returns table (
  registry_people_id bigint,
  property_id bigint,
  ideal_parts_percent numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, auth.email(), '')));
begin
  if v_email = '' then
    return;
  end if;

  return query
  select
    r.id,
    r.property_id,
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::numeric
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.relation_type = 'owner'
    and r.deregistered_at is null
    and lower(btrim(coalesce(r.email, ''))) = v_email
    and coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0) > 0;

  -- Legacy sole: owner_email match with no active book owner for that email
  return query
  select
    null::bigint,
    p.id,
    coalesce(p.ideal_parts_percent, 0)::numeric
  from public.properties as p
  where lower(btrim(coalesce(p.owner_email, ''))) = v_email
    and coalesce(p.ideal_parts_percent, 0) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
        and lower(btrim(coalesce(r.email, ''))) = v_email
    );
end;
$fn$;

revoke all on function public.owner_voting_parties(text) from public;
revoke all on function public.owner_voting_parties(text) from anon;
grant execute on function public.owner_voting_parties(text) to authenticated;

-- Parties for one property (admin / GM record)
create or replace function public.property_voting_parties(p_property_id bigint)
returns table (
  registry_people_id bigint,
  property_id bigint,
  ideal_parts_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    r.id,
    r.property_id,
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::numeric
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0) > 0
  union all
  select
    null::bigint,
    p.id,
    coalesce(p.ideal_parts_percent, 0)::numeric
  from public.properties as p
  where p.id = p_property_id
    and coalesce(p.ideal_parts_percent, 0) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
    );
$fn$;

revoke all on function public.property_voting_parties(bigint) from public;
revoke all on function public.property_voting_parties(bigint) from anon;
grant execute on function public.property_voting_parties(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Poll weight = sum of property ideal_parts (building 100%)
-- ---------------------------------------------------------------------------

create or replace function public.poll_building_total_weight()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.ideal_parts_percent), 0)::numeric
  from public.properties as p
  where p.ideal_parts_percent is not null
    and p.ideal_parts_percent > 0;
$$;

revoke all on function public.poll_building_total_weight() from public;
revoke all on function public.poll_building_total_weight() from anon;
revoke all on function public.poll_building_total_weight() from authenticated;

-- ---------------------------------------------------------------------------
-- cast_poll_vote: one ballot row per owner party of the caller
-- ---------------------------------------------------------------------------

create or replace function public.cast_poll_vote(p_poll_id bigint, p_option_id bigint)
returns table (
  poll_id bigint,
  status text,
  result text,
  result_option_id bigint,
  winner_option_id bigint,
  winner_weight numeric,
  total_building_weight numeric,
  accepted boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  poll_rec public.polls%rowtype;
  v_party_count integer;
  v_total numeric;
  v_winner_id bigint;
  v_winner_weight numeric;
  v_accepted boolean;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'cast_poll_vote: authentication required'
      using errcode = '42501';
  end if;

  select count(*)::integer into v_party_count
  from public.owner_voting_parties(v_email);
  if coalesce(v_party_count, 0) = 0 then
    raise exception 'cast_poll_vote: only an apartment owner may vote'
      using errcode = '42501';
  end if;

  select * into poll_rec
  from public.polls as pl
  where pl.id = p_poll_id
  for update;

  if not found then
    raise exception 'cast_poll_vote: poll not found' using errcode = '42501';
  end if;
  if poll_rec.status is distinct from 'открыт' then
    raise exception 'cast_poll_vote: poll is not open' using errcode = '42501';
  end if;
  if poll_rec.result is not distinct from 'принято' then
    raise exception 'cast_poll_vote: poll already accepted' using errcode = '42501';
  end if;
  if poll_rec.voting_starts is not null and poll_rec.voting_starts > current_date then
    raise exception 'cast_poll_vote: voting has not started' using errcode = '42501';
  end if;
  if poll_rec.deadline is not null and poll_rec.deadline < current_date then
    raise exception 'cast_poll_vote: voting deadline has passed' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.poll_options as o
    where o.id = p_option_id and o.poll_id = p_poll_id
  ) then
    raise exception 'cast_poll_vote: option does not belong to this poll'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.poll_votes as v
    join public.owner_voting_parties(v_email) as op
      on (
        (op.registry_people_id is not null and v.registry_people_id = op.registry_people_id)
        or (op.registry_people_id is null and v.registry_people_id is null
            and v.property_id = op.property_id)
      )
    where v.poll_id = p_poll_id
  ) then
    raise exception 'You have already voted in this poll.';
  end if;

  begin
    insert into public.poll_votes (
      poll_id, option_id, property_id, registry_people_id, weight
    )
    select
      p_poll_id,
      p_option_id,
      op.property_id,
      op.registry_people_id,
      op.ideal_parts_percent
    from public.owner_voting_parties(v_email) as op;
  exception
    when unique_violation then
      raise exception 'You have already voted in this poll.';
  end;

  insert into public.poll_vote_history (
    poll_id, option_id, property_id, registry_people_id, weight
  )
  select
    p_poll_id,
    p_option_id,
    op.property_id,
    op.registry_people_id,
    op.ideal_parts_percent
  from public.owner_voting_parties(v_email) as op;

  v_total := public.poll_building_total_weight();

  select o.id, coalesce(sum(v.weight), 0)
    into v_winner_id, v_winner_weight
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id and v.poll_id = o.poll_id
  where o.poll_id = p_poll_id
  group by o.id, o.sort_order
  order by coalesce(sum(v.weight), 0) desc, o.sort_order asc, o.id asc
  limit 1;

  v_accepted :=
    v_total is not null
    and v_total > 0
    and v_winner_id is not null
    and (v_winner_weight / v_total) >= 0.51;

  if v_accepted then
    update public.polls
       set status = 'закрыт',
           result = 'принято',
           result_option_id = v_winner_id
     where id = p_poll_id;
  end if;

  return query
  select
    pl.id,
    pl.status,
    pl.result,
    pl.result_option_id,
    v_winner_id,
    coalesce(v_winner_weight, 0),
    coalesce(v_total, 0),
    v_accepted
  from public.polls as pl
  where pl.id = p_poll_id;
end;
$fn$;

revoke all on function public.cast_poll_vote(bigint, bigint) from public;
revoke execute on function public.cast_poll_vote(bigint, bigint) from anon;
grant execute on function public.cast_poll_vote(bigint, bigint) to authenticated;

-- Tallies use stored weight (ideal parts)
create or replace function public.get_poll_tallies()
returns table (
  poll_id bigint,
  option_id bigint,
  option_weight numeric,
  apartment_count integer,
  total_building_weight numeric,
  percentage numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_total numeric;
begin
  if not (public.is_owner() or public.has_staff_role('администрация')) then
    raise exception 'get_poll_tallies: owner or administration required'
      using errcode = '42501';
  end if;

  v_total := public.poll_building_total_weight();

  return query
  select
    o.poll_id,
    o.id,
    coalesce(sum(v.weight), 0)::numeric,
    count(distinct v.property_id)::integer,
    coalesce(v_total, 0),
    (
      case
        when coalesce(v_total, 0) > 0 then
          (coalesce(sum(v.weight), 0) / v_total) * 100
        else 0
      end
    )::numeric
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id and v.poll_id = o.poll_id
  group by o.poll_id, o.id;
end;
$fn$;

revoke all on function public.get_poll_tallies() from public;
revoke execute on function public.get_poll_tallies() from anon;
grant execute on function public.get_poll_tallies() to authenticated;

create or replace function public.set_poll_lifecycle(p_poll_id bigint, p_close boolean)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  poll_rec public.polls%rowtype;
  v_total numeric;
  v_winner_id bigint;
  v_winner_weight numeric;
  v_accepted boolean;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'set_poll_lifecycle: administration required'
      using errcode = '42501';
  end if;

  select * into poll_rec from public.polls where id = p_poll_id for update;
  if not found then
    raise exception 'set_poll_lifecycle: poll not found' using errcode = '42501';
  end if;

  if p_close is not true then
    update public.polls
       set status = 'открыт',
           result = 'идёт',
           result_option_id = null
     where id = p_poll_id
     returning * into poll_rec;
    return poll_rec;
  end if;

  v_total := public.poll_building_total_weight();

  select o.id, coalesce(sum(v.weight), 0)
    into v_winner_id, v_winner_weight
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id and v.poll_id = o.poll_id
  where o.poll_id = p_poll_id
  group by o.id, o.sort_order
  order by coalesce(sum(v.weight), 0) desc, o.sort_order asc, o.id asc
  limit 1;

  v_accepted :=
    v_total is not null
    and v_total > 0
    and v_winner_id is not null
    and (v_winner_weight / v_total) >= 0.51;

  update public.polls
     set status = 'закрыт',
         result = case when v_accepted then 'принято' else 'не принято' end,
         result_option_id = case when v_accepted then v_winner_id else null end
   where id = p_poll_id
   returning * into poll_rec;

  return poll_rec;
end;
$fn$;

revoke all on function public.set_poll_lifecycle(bigint, boolean) from public;
revoke execute on function public.set_poll_lifecycle(bigint, boolean) from anon;
grant execute on function public.set_poll_lifecycle(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- GM write vote: party-aware (manual upsert — partial unique indexes)
-- ---------------------------------------------------------------------------

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
begin
  if p_vote not in ('for', 'against', 'abstain') then
    raise exception 'gm_write_vote: invalid vote' using errcode = '22023';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if v_meeting.operational_phase is distinct from 'in_progress' or v_meeting.meeting_started_at is null then
    raise exception 'gm_write_vote: meeting not started' using errcode = '42501';
  end if;
  if v_meeting.status in ('held', 'cancelled', 'rescheduled', 'draft', 'archived', 'minutes_ready') then
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
    raise exception 'gm_write_vote: decision missing' using errcode = 'P0002';
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
    update public.general_meeting_votes as v
       set vote = p_vote,
           vote_method = p_method,
           vote_source = p_source,
           recorded_at = now(),
           recorded_by_email = auth.email(),
           ideal_parts_percent_snapshot = v_ideal,
           participant_id = v_part.id,
           registry_people_id = v_party_id
     where v.id = v_row.id
     returning * into v_row;
  else
    insert into public.general_meeting_votes (
      meeting_id, decision_id, property_id, registry_people_id, participant_id, vote,
      ideal_parts_percent_snapshot, vote_method, vote_source, recorded_by_email
    ) values (
      p_meeting_id, v_decision, p_property_id, v_party_id, v_part.id, p_vote,
      v_ideal, p_method, p_source, auth.email()
    )
    returning * into v_row;
  end if;

  insert into public.general_meeting_vote_events (
    vote_id, meeting_id, decision_id, property_id, vote, vote_source, recorded_by_email
  ) values (
    v_row.id, p_meeting_id, v_decision, p_property_id, p_vote, p_source, auth.email()
  );

  return v_row;
end;
$fn$;

-- Keep 6-arg overload for existing callers
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
  v_row public.general_meeting_votes;
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

  -- Vote only the caller's party on this property
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
  v_row public.general_meeting_votes;
  v_op record;
begin
  if not public.can_manage_building_governance() then
    raise exception 'record_general_meeting_vote: not allowed' using errcode = '42501';
  end if;
  select a.* into v_item from public.general_meeting_agenda_items as a where a.id = p_agenda_item_id;
  if not found then
    raise exception 'record_general_meeting_vote: agenda not found' using errcode = 'P0002';
  end if;

  -- Admin records the same choice for every owner party of the property
  for v_op in
    select * from public.property_voting_parties(p_property_id)
  loop
    v_row := public.gm_write_vote(
      v_item.meeting_id,
      p_agenda_item_id,
      p_property_id,
      p_vote,
      'administration',
      'in_person',
      v_op.registry_people_id
    );
  end loop;

  if v_row is null then
    raise exception 'record_general_meeting_vote: no voting parties' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from public;
revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text, bigint) from public;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from anon, authenticated;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text, bigint) from anon, authenticated;

revoke all on function public.cast_general_meeting_vote(uuid, bigint, text) from public;
revoke execute on function public.cast_general_meeting_vote(uuid, bigint, text) from anon;
grant execute on function public.cast_general_meeting_vote(uuid, bigint, text) to authenticated;

revoke all on function public.record_general_meeting_vote(uuid, bigint, text) from public;
revoke execute on function public.record_general_meeting_vote(uuid, bigint, text) from anon;
grant execute on function public.record_general_meeting_vote(uuid, bigint, text) to authenticated;

commit;
