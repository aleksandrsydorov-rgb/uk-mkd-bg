-- =============================================================================
-- AMADEUS 11 — poll vote once / immutable vote hotfix
-- =============================================================================
-- One vote per poll per property. No UPDATE of existing votes.
-- Does not DELETE votes. If duplicate (poll_id, property_id) rows exist,
-- UNIQUE is skipped (see NOTICE); resolve duplicates separately.
-- =============================================================================

BEGIN;

-- Unique (poll_id, property_id) if missing and no duplicates.
DO $once$
DECLARE
  v_dups integer;
  v_has_unique boolean;
BEGIN
  SELECT count(*)::integer INTO v_dups
  FROM (
    SELECT 1
    FROM public.poll_votes
    GROUP BY poll_id, property_id
    HAVING count(*) > 1
  ) AS d;

  IF v_dups > 0 THEN
    RAISE NOTICE 'poll_vote_once: % duplicate (poll_id, property_id) groups — UNIQUE not added', v_dups;
    RETURN;
  END IF;

  SELECT exists (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.poll_votes'::regclass
      AND c.contype IN ('u', 'p')
      AND (
        c.conname = 'poll_votes_poll_id_property_id_key'
        OR pg_get_constraintdef(c.oid) ILIKE '%(poll_id, property_id)%'
      )
  ) INTO v_has_unique;

  IF NOT v_has_unique THEN
    ALTER TABLE public.poll_votes
      ADD CONSTRAINT poll_votes_poll_id_property_id_key UNIQUE (poll_id, property_id);
  END IF;
END
$once$;

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
as $$
declare
  v_email text;
  poll_rec public.polls%rowtype;
  v_owned integer;
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

  select count(*)::integer
    into v_owned
  from public.properties as p
  where lower(btrim(p.owner_email)) = lower(btrim(v_email));

  if coalesce(v_owned, 0) = 0 then
    raise exception 'cast_poll_vote: only an apartment owner may vote'
      using errcode = '42501';
  end if;

  select *
    into poll_rec
  from public.polls as pl
  where pl.id = p_poll_id
  for update;

  if not found then
    raise exception 'cast_poll_vote: poll not found'
      using errcode = '42501';
  end if;

  if poll_rec.status is distinct from 'открыт' then
    raise exception 'cast_poll_vote: poll is not open'
      using errcode = '42501';
  end if;

  if poll_rec.result is not distinct from 'принято' then
    raise exception 'cast_poll_vote: poll already accepted'
      using errcode = '42501';
  end if;

  if poll_rec.voting_starts is not null and poll_rec.voting_starts > current_date then
    raise exception 'cast_poll_vote: voting has not started'
      using errcode = '42501';
  end if;

  if poll_rec.deadline is not null and poll_rec.deadline < current_date then
    raise exception 'cast_poll_vote: voting deadline has passed'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.poll_options as o
    where o.id = p_option_id
      and o.poll_id = p_poll_id
  ) then
    raise exception 'cast_poll_vote: option does not belong to this poll'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.poll_votes as v
    join public.properties as p
      on p.id = v.property_id
    where v.poll_id = p_poll_id
      and lower(btrim(p.owner_email)) = lower(btrim(v_email))
  ) then
    raise exception 'You have already voted in this poll.';
  end if;

  begin
    insert into public.poll_votes (poll_id, option_id, property_id, weight)
    select
      p_poll_id,
      p_option_id,
      p.id,
      case
        when p.area_sqm is not null and p.area_sqm > 0 then p.area_sqm
        else 0
      end
    from public.properties as p
    where lower(btrim(p.owner_email)) = lower(btrim(v_email));
  exception
    when unique_violation then
      raise exception 'You have already voted in this poll.';
  end;

  insert into public.poll_vote_history (poll_id, option_id, property_id, weight)
  select
    p_poll_id,
    p_option_id,
    p.id,
    case
      when p.area_sqm is not null and p.area_sqm > 0 then p.area_sqm
      else 0
    end
  from public.properties as p
  where lower(btrim(p.owner_email)) = lower(btrim(v_email));

  v_total := public.poll_building_total_weight();

  select o.id, coalesce(sum(
    case
      when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
      else 0
    end
  ), 0)
    into v_winner_id, v_winner_weight
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id
   and v.poll_id = o.poll_id
  left join public.properties as pr
    on pr.id = v.property_id
  where o.poll_id = p_poll_id
  group by o.id, o.sort_order
  order by coalesce(sum(
    case
      when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
      else 0
    end
  ), 0) desc,
           o.sort_order asc,
           o.id asc
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
$$;

revoke all on function public.cast_poll_vote(bigint, bigint) from public;
revoke execute on function public.cast_poll_vote(bigint, bigint) from anon;
grant execute on function public.cast_poll_vote(bigint, bigint) to authenticated;

-- Table: authenticated may SELECT only. No INSERT/UPDATE/DELETE via PostgREST.
alter table public.poll_votes enable row level security;

drop policy if exists poll_votes_insert on public.poll_votes;
drop policy if exists poll_votes_update on public.poll_votes;
drop policy if exists poll_votes_delete on public.poll_votes;
drop policy if exists "poll_votes_insert" on public.poll_votes;
drop policy if exists "poll_votes_update" on public.poll_votes;
drop policy if exists "poll_votes_delete" on public.poll_votes;
drop policy if exists poll_votes_all on public.poll_votes;
drop policy if exists "poll_votes_all" on public.poll_votes;

revoke all on table public.poll_votes from public;
revoke all on table public.poll_votes from anon;
revoke all on table public.poll_votes from authenticated;

grant select on table public.poll_votes to authenticated;

COMMIT;
