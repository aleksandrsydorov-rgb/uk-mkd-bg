-- Чаты и остальные таблицы кабинета: RLS включён, доступ как сейчас
-- (вход по email в браузере, anon-ключ, без Supabase Auth).
-- Выполните в SQL Editor проекта Supabase, к которому привязан сайт.

alter table public.announcements enable row level security;
alter table public.apartment_guests enable row level security;
alter table public.building_settings enable row level security;
alter table public.chat_messages enable row level security;
alter table public.meter_readings enable row level security;
alter table public.owner_transfers enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_suggestions enable row level security;
alter table public.poll_vote_history enable row level security;
alter table public.poll_votes enable row level security;
alter table public.polls enable row level security;
alter table public.properties enable row level security;
alter table public.requests enable row level security;
alter table public.staff enable row level security;
alter table public.support_fee_ledger enable row level security;
alter table public.uk_expenses enable row level security;

drop policy if exists "announcements_all" on public.announcements;
create policy "announcements_all" on public.announcements for all using (true) with check (true);

drop policy if exists "apartment_guests_all" on public.apartment_guests;
create policy "apartment_guests_all" on public.apartment_guests for all using (true) with check (true);

drop policy if exists "building_settings_all" on public.building_settings;
create policy "building_settings_all" on public.building_settings for all using (true) with check (true);

drop policy if exists "chat_messages_all" on public.chat_messages;
create policy "chat_messages_all" on public.chat_messages for all using (true) with check (true);

drop policy if exists "meter_readings_all" on public.meter_readings;
create policy "meter_readings_all" on public.meter_readings for all using (true) with check (true);

drop policy if exists "owner_transfers_all" on public.owner_transfers;
create policy "owner_transfers_all" on public.owner_transfers for all using (true) with check (true);

drop policy if exists "poll_options_all" on public.poll_options;
create policy "poll_options_all" on public.poll_options for all using (true) with check (true);

drop policy if exists "poll_suggestions_all" on public.poll_suggestions;
create policy "poll_suggestions_all" on public.poll_suggestions for all using (true) with check (true);

drop policy if exists "poll_vote_history_all" on public.poll_vote_history;
create policy "poll_vote_history_all" on public.poll_vote_history for all using (true) with check (true);

drop policy if exists "poll_votes_all" on public.poll_votes;
create policy "poll_votes_all" on public.poll_votes for all using (true) with check (true);

drop policy if exists "polls_all" on public.polls;
create policy "polls_all" on public.polls for all using (true) with check (true);

drop policy if exists "properties_all" on public.properties;
create policy "properties_all" on public.properties for all using (true) with check (true);

drop policy if exists "requests_all" on public.requests;
create policy "requests_all" on public.requests for all using (true) with check (true);

drop policy if exists "staff_all" on public.staff;
create policy "staff_all" on public.staff for all using (true) with check (true);

drop policy if exists "support_fee_ledger_all" on public.support_fee_ledger;
create policy "support_fee_ledger_all" on public.support_fee_ledger for all using (true) with check (true);

drop policy if exists "uk_expenses_all" on public.uk_expenses;
create policy "uk_expenses_all" on public.uk_expenses for all using (true) with check (true);
