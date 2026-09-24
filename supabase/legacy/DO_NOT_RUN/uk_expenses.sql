create table if not exists public.uk_expenses (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  expense_date date not null,
  amount numeric(12, 2) not null,
  title text,
  created_by text
);

alter table public.uk_expenses enable row level security;

drop policy if exists "uk_expenses_select" on public.uk_expenses;
drop policy if exists "uk_expenses_insert" on public.uk_expenses;
drop policy if exists "uk_expenses_update" on public.uk_expenses;
drop policy if exists "uk_expenses_delete" on public.uk_expenses;

create policy "uk_expenses_select" on public.uk_expenses for select using (true);
create policy "uk_expenses_insert" on public.uk_expenses for insert with check (true);
create policy "uk_expenses_update" on public.uk_expenses for update using (true);
create policy "uk_expenses_delete" on public.uk_expenses for delete using (true);
