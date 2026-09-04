-- Email сотрудника = вход в панель УК (тот же экран, что у жильцов).
alter table public.staff add column if not exists email text;

create unique index if not exists staff_email_lower
  on public.staff (lower(email))
  where email is not null and length(trim(email)) > 0;
