-- Restrictive RLS and SECURITY DEFINER voting RPCs.
-- Apply after public.is_staff(), public.is_owner(), public.owns_property(bigint).
-- poll_options / poll_votes / poll_vote_history: ON DELETE CASCADE from polls.id.

begin;

create or replace function public.poll_building_total_weight()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(sum(case
      when p.area_sqm is not null and p.area_sqm > 0 then p.area_sqm
      else 0
    end), 0) > 0
    then coalesce(sum(case
      when p.area_sqm is not null and p.area_sqm > 0 then p.area_sqm
      else 0
    end), 0)
    else count(*)::numeric
  end
  from public.properties as p;
$$;

revoke all on function public.poll_building_total_weight() from public;
revoke execute on function public.poll_building_total_weight() from anon;
revoke execute on function public.poll_building_total_weight() from authenticated;

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
  where lower(btrim(p.owner_email)) = lower(btrim(v_email))
  on conflict on constraint poll_votes_poll_id_property_id_key do update
    set option_id = excluded.option_id,
        weight = excluded.weight;

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
as $$
declare
  v_total numeric;
begin
  if not (public.is_owner() or public.is_staff()) then
    raise exception 'get_poll_tallies: owner or staff required'
      using errcode = '42501';
  end if;

  v_total := public.poll_building_total_weight();

  return query
  select
    o.poll_id,
    o.id,
    coalesce(sum(
      case
        when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
        else 0
      end
    ), 0)::numeric,
    count(v.property_id)::integer,
    coalesce(v_total, 0),
    (
      case
        when coalesce(v_total, 0) > 0 then
          (
            coalesce(sum(
              case
                when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
                else 0
              end
            ), 0) / v_total
          ) * 100
        else 0
      end
    )::numeric
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id
   and v.poll_id = o.poll_id
  left join public.properties as pr
    on pr.id = v.property_id
  group by o.poll_id, o.id;
end;
$$;

revoke all on function public.get_poll_tallies() from public;
revoke execute on function public.get_poll_tallies() from anon;
grant execute on function public.get_poll_tallies() to authenticated;

-- polls

alter table public.polls enable row level security;

drop policy if exists polls_all on public.polls;
drop policy if exists polls_delete on public.polls;
drop policy if exists polls_insert on public.polls;
drop policy if exists polls_select on public.polls;
drop policy if exists polls_update on public.polls;

revoke all on table public.polls from anon;
revoke all on table public.polls from authenticated;

grant select, insert, update, delete
on table public.polls
to authenticated;

create policy polls_owner_staff_select
on public.polls
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

create policy polls_staff_insert
on public.polls
for insert
to authenticated
with check (public.is_staff());

create policy polls_staff_update
on public.polls
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

create policy polls_staff_delete
on public.polls
for delete
to authenticated
using (public.is_staff());

-- poll_options

alter table public.poll_options enable row level security;

drop policy if exists poll_options_all on public.poll_options;
drop policy if exists poll_options_delete on public.poll_options;
drop policy if exists poll_options_insert on public.poll_options;
drop policy if exists poll_options_select on public.poll_options;
drop policy if exists poll_options_update on public.poll_options;

revoke all on table public.poll_options from anon;
revoke all on table public.poll_options from authenticated;

grant select, insert
on table public.poll_options
to authenticated;

create policy poll_options_owner_staff_select
on public.poll_options
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

create policy poll_options_staff_insert
on public.poll_options
for insert
to authenticated
with check (public.is_staff());

-- poll_votes

alter table public.poll_votes enable row level security;

drop policy if exists poll_votes_all on public.poll_votes;
drop policy if exists poll_votes_delete on public.poll_votes;
drop policy if exists poll_votes_insert on public.poll_votes;
drop policy if exists poll_votes_select on public.poll_votes;
drop policy if exists poll_votes_update on public.poll_votes;

revoke all on table public.poll_votes from anon;
revoke all on table public.poll_votes from authenticated;

grant select
on table public.poll_votes
to authenticated;

create policy poll_votes_staff_select
on public.poll_votes
for select
to authenticated
using (public.is_staff());

create policy poll_votes_owner_select
on public.poll_votes
for select
to authenticated
using (public.owns_property(property_id));

-- poll_vote_history

alter table public.poll_vote_history enable row level security;

drop policy if exists poll_vote_history_all on public.poll_vote_history;
drop policy if exists poll_vote_history_insert on public.poll_vote_history;
drop policy if exists poll_vote_history_select on public.poll_vote_history;

revoke all on table public.poll_vote_history from anon;
revoke all on table public.poll_vote_history from authenticated;

grant select
on table public.poll_vote_history
to authenticated;

create policy poll_vote_history_staff_select
on public.poll_vote_history
for select
to authenticated
using (public.is_staff());

-- poll_suggestions (unused in the app: lock down)

alter table public.poll_suggestions enable row level security;

drop policy if exists poll_suggestions_all on public.poll_suggestions;
drop policy if exists poll_suggestions_delete on public.poll_suggestions;
drop policy if exists poll_suggestions_insert on public.poll_suggestions;
drop policy if exists poll_suggestions_select on public.poll_suggestions;
drop policy if exists poll_suggestions_update on public.poll_suggestions;

revoke all on table public.poll_suggestions from anon;
revoke all on table public.poll_suggestions from authenticated;

commit;
