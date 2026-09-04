create table if not exists public.polls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  title text not null,
  body text,
  category text not null default 'опрос',
  status text not null default 'открыт',
  deadline date,
  created_by text
);

create table if not exists public.poll_options (
  id bigint generated always as identity primary key,
  poll_id bigint not null references public.polls(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0
);

create table if not exists public.poll_votes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  poll_id bigint not null references public.polls(id) on delete cascade,
  option_id bigint not null references public.poll_options(id) on delete cascade,
  property_id bigint not null references public.properties(id) on delete cascade,
  unique (poll_id, property_id)
);

create table if not exists public.poll_suggestions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties(id) on delete cascade,
  category text not null default 'ремонт',
  title text not null,
  body text,
  status text not null default 'новая'
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_suggestions enable row level security;

drop policy if exists "polls_select" on public.polls;
drop policy if exists "polls_insert" on public.polls;
drop policy if exists "polls_update" on public.polls;
drop policy if exists "polls_delete" on public.polls;
create policy "polls_select" on public.polls for select using (true);
create policy "polls_insert" on public.polls for insert with check (true);
create policy "polls_update" on public.polls for update using (true);
create policy "polls_delete" on public.polls for delete using (true);

drop policy if exists "poll_options_select" on public.poll_options;
drop policy if exists "poll_options_insert" on public.poll_options;
drop policy if exists "poll_options_update" on public.poll_options;
drop policy if exists "poll_options_delete" on public.poll_options;
create policy "poll_options_select" on public.poll_options for select using (true);
create policy "poll_options_insert" on public.poll_options for insert with check (true);
create policy "poll_options_update" on public.poll_options for update using (true);
create policy "poll_options_delete" on public.poll_options for delete using (true);

drop policy if exists "poll_votes_select" on public.poll_votes;
drop policy if exists "poll_votes_insert" on public.poll_votes;
drop policy if exists "poll_votes_update" on public.poll_votes;
drop policy if exists "poll_votes_delete" on public.poll_votes;
create policy "poll_votes_select" on public.poll_votes for select using (true);
create policy "poll_votes_insert" on public.poll_votes for insert with check (true);
create policy "poll_votes_update" on public.poll_votes for update using (true);
create policy "poll_votes_delete" on public.poll_votes for delete using (true);

drop policy if exists "poll_suggestions_select" on public.poll_suggestions;
drop policy if exists "poll_suggestions_insert" on public.poll_suggestions;
drop policy if exists "poll_suggestions_update" on public.poll_suggestions;
drop policy if exists "poll_suggestions_delete" on public.poll_suggestions;
create policy "poll_suggestions_select" on public.poll_suggestions for select using (true);
create policy "poll_suggestions_insert" on public.poll_suggestions for insert with check (true);
create policy "poll_suggestions_update" on public.poll_suggestions for update using (true);
create policy "poll_suggestions_delete" on public.poll_suggestions for delete using (true);
