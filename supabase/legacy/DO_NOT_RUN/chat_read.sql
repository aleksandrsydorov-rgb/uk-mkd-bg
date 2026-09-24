-- Флаги прочтения чата + право UPDATE для anon (кабинет без Supabase Auth).
-- Выполните в SQL Editor проекта Supabase.

alter table public.chat_messages
  add column if not exists read_by_uk boolean default false;

alter table public.chat_messages
  add column if not exists read_by_owner boolean default false;

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_all" on public.chat_messages;
create policy "chat_messages_all" on public.chat_messages
  for all using (true) with check (true);

grant select, insert, update, delete on table public.chat_messages to anon, authenticated;
