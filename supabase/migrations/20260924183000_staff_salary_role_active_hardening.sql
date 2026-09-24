-- AMADEUS 11 SH-1: staff, salary, role, and active-access hardening.
-- Canonical staff roles are exact UTF-8 values:
-- администрация, бухгалтер, инженер, уборщик.

begin;

do $$
begin
  if exists (
    select 1
    from public.staff as s
    where s.role is null
       or s.role not in ('администрация', 'бухгалтер', 'инженер', 'уборщик')
  ) then
    raise exception 'SH-1 pre-flight failed: staff contains a null, empty, or unknown role';
  end if;
end;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where lower(btrim(s.email)) = lower(btrim(auth.email()))
      and s.active is true
      and s.role in ('администрация', 'бухгалтер', 'инженер', 'уборщик')
  );
$$;

revoke all on function public.is_staff() from public;
revoke execute on function public.is_staff() from anon;
grant execute on function public.is_staff() to authenticated;

create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_role in ('администрация', 'бухгалтер', 'инженер', 'уборщик')
    and exists (
      select 1
      from public.staff as s
      where lower(btrim(s.email)) = lower(btrim(auth.email()))
        and s.active is true
        and s.role = p_role
    );
$$;

revoke all on function public.has_staff_role(text) from public;
revoke execute on function public.has_staff_role(text) from anon;
grant execute on function public.has_staff_role(text) to authenticated;

create or replace function public.can_manage_support_fees()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер');
$$;

revoke all on function public.can_manage_support_fees() from public;
revoke execute on function public.can_manage_support_fees() from anon;
revoke execute on function public.can_manage_support_fees() from authenticated;

create or replace function public.can_approve_uk_expenses()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_staff_role('администрация');
$$;

revoke all on function public.can_approve_uk_expenses() from public;
revoke execute on function public.can_approve_uk_expenses() from anon;
grant execute on function public.can_approve_uk_expenses() to authenticated;

drop policy if exists staff_all on public.staff;
drop policy if exists staff_select on public.staff;
drop policy if exists staff_staff_insert on public.staff;
drop policy if exists staff_staff_update on public.staff;
drop policy if exists staff_staff_delete on public.staff;
drop policy if exists staff_admin_insert on public.staff;
drop policy if exists staff_admin_update on public.staff;
drop policy if exists staff_admin_delete on public.staff;

create policy staff_select
on public.staff
for select
to authenticated
using (public.is_staff());

create policy staff_admin_insert
on public.staff
for insert
to authenticated
with check (public.has_staff_role('администрация'));

create policy staff_admin_update
on public.staff
for update
to authenticated
using (public.has_staff_role('администрация'))
with check (true);

create policy staff_admin_delete
on public.staff
for delete
to authenticated
using (public.has_staff_role('администрация'));

revoke all on table public.staff from anon;
revoke all on table public.staff from authenticated;
grant insert, update, delete on table public.staff to authenticated;
grant select (id, created_at, name, email, phone, role, active)
on table public.staff
to authenticated;

create or replace function public.get_staff_salaries()
returns table (
  id bigint,
  salary_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'get_staff_salaries: not allowed'
      using errcode = '42501';
  end if;

  return query
  select s.id, s.salary_eur
  from public.staff as s
  order by s.id;
end;
$$;

revoke all on function public.get_staff_salaries() from public;
revoke execute on function public.get_staff_salaries() from anon;
grant execute on function public.get_staff_salaries() to authenticated;

drop policy if exists building_settings_staff_insert
on public.building_settings;
drop policy if exists building_settings_staff_update
on public.building_settings;
drop policy if exists building_settings_admin_insert
on public.building_settings;
drop policy if exists building_settings_admin_update
on public.building_settings;

create policy building_settings_admin_insert
on public.building_settings
for insert
to authenticated
with check (public.has_staff_role('администрация'));

create policy building_settings_admin_update
on public.building_settings
for update
to authenticated
using (public.has_staff_role('администрация'))
with check (public.has_staff_role('администрация'));

commit;
