alter table public.polls add column if not exists photo_url text;
alter table public.polls add column if not exists budget_eur numeric(12, 2);
alter table public.polls add column if not exists voting_starts date;
alter table public.polls add column if not exists result text not null default 'идёт';
alter table public.polls add column if not exists result_option_id bigint;

alter table public.poll_votes add column if not exists weight numeric(12, 2);

create table if not exists public.poll_vote_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  poll_id bigint not null references public.polls(id) on delete cascade,
  option_id bigint not null references public.poll_options(id) on delete cascade,
  property_id bigint not null references public.properties(id) on delete cascade,
  weight numeric(12, 2)
);

alter table public.poll_vote_history enable row level security;

drop policy if exists "poll_vote_history_select" on public.poll_vote_history;
drop policy if exists "poll_vote_history_insert" on public.poll_vote_history;
create policy "poll_vote_history_select" on public.poll_vote_history for select using (true);
create policy "poll_vote_history_insert" on public.poll_vote_history for insert with check (true);
