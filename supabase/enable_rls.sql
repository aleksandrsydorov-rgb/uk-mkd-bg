-- Включает RLS на таблицах с меткой UNRESTRICTED.
-- Политики using (true) оставляют работу кабинета как сейчас
-- (вход по email в браузере, без Supabase Auth).
-- Это убирает предупреждение и даёт точку, где потом сузить доступ.
-- Настоящая защита появится только с логином через Supabase Auth.

alter table public.announcements enable row level security;
alter table public.meter_readings enable row level security;
alter table public.properties enable row level security;
alter table public.requests enable row level security;
alter table public.staff enable row level security;

drop policy if exists "announcements_all" on public.announcements;
create policy "announcements_all" on public.announcements for all using (true) with check (true);

drop policy if exists "meter_readings_all" on public.meter_readings;
create policy "meter_readings_all" on public.meter_readings for all using (true) with check (true);

drop policy if exists "properties_all" on public.properties;
create policy "properties_all" on public.properties for all using (true) with check (true);

drop policy if exists "requests_all" on public.requests;
create policy "requests_all" on public.requests for all using (true) with check (true);

drop policy if exists "staff_all" on public.staff;
create policy "staff_all" on public.staff for all using (true) with check (true);
