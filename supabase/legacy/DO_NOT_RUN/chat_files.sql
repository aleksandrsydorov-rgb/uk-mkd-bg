-- Вложения в чате жилец ↔ УК.
-- Выполните в SQL Editor проекта Supabase.

alter table public.chat_messages
  add column if not exists photo_url text;

alter table public.chat_messages
  add column if not exists file_name text;
