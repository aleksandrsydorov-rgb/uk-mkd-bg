-- Догнать колонки, которые уже использует кабинет, но их нет в текущей базе.
alter table public.properties add column if not exists owner_type text;
alter table public.properties add column if not exists company_name text;

alter table public.staff add column if not exists salary_eur numeric;
alter table public.staff add column if not exists active boolean default true;
