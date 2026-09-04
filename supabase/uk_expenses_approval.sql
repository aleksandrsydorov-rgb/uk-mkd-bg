-- Утверждение расходов УК и до 5 фото (чеки, купленные материалы).
-- Существующие записи считаются уже опубликованными.

alter table public.uk_expenses
  add column if not exists status text,
  add column if not exists photo_urls text[] not null default '{}',
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

update public.uk_expenses
set status = 'опубликован'
where status is null or trim(status) = '';

alter table public.uk_expenses
  alter column status set default 'на проверке';

alter table public.uk_expenses
  alter column status set not null;

alter table public.uk_expenses
  drop constraint if exists uk_expenses_status_check;

alter table public.uk_expenses
  add constraint uk_expenses_status_check
  check (status in ('на проверке', 'опубликован'));
