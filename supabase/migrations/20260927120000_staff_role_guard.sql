-- Allow staff role «охрана» end-to-end: helpers, CHECK, admin upsert RPC.

begin;

create or replace function public.is_allowed_staff_role(p_role text)
returns boolean
language sql
immutable
as $$
  select p_role in ('администрация', 'бухгалтер', 'инженер', 'уборщик', 'охрана');
$$;

revoke all on function public.is_allowed_staff_role(text) from public;
revoke all on function public.is_allowed_staff_role(text) from anon;
grant execute on function public.is_allowed_staff_role(text) to authenticated;

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
      and public.is_allowed_staff_role(s.role)
  );
$$;

create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_allowed_staff_role(p_role)
    and exists (
      select 1
      from public.staff as s
      where lower(btrim(s.email)) = lower(btrim(auth.email()))
        and s.active is true
        and s.role = p_role
    );
$$;

create or replace function public.current_staff_id()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff as s
  where lower(btrim(s.email)) = lower(btrim(auth.email()))
    and s.active is true
    and public.is_allowed_staff_role(s.role)
  order by s.id
  limit 1;
$$;

-- Drop legacy role checks (any name) that omit охрана, then add canonical one.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint as c
    join pg_class as t on t.oid = c.conrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'staff'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
      and pg_get_constraintdef(c.oid) ilike '%администрация%'
  loop
    execute format('alter table public.staff drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.staff
  drop constraint if exists staff_role_allowed_check;

alter table public.staff
  add constraint staff_role_allowed_check
  check (public.is_allowed_staff_role(role));

drop policy if exists staff_admin_insert on public.staff;
create policy staff_admin_insert
on public.staff
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  and public.is_allowed_staff_role(role)
);

drop policy if exists staff_admin_update on public.staff;
create policy staff_admin_update
on public.staff
for update
to authenticated
using (public.has_staff_role('администрация'))
with check (
  public.has_staff_role('администрация')
  and public.is_allowed_staff_role(role)
);

create or replace function public.admin_upsert_staff(
  p_id integer,
  p_name text,
  p_role text,
  p_email text,
  p_phone text,
  p_active boolean,
  p_salary_eur numeric
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id integer;
  v_name text := btrim(coalesce(p_name, ''));
  v_role text := btrim(coalesce(p_role, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then
    raise exception 'admin_upsert_staff: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_upsert_staff: not allowed'
      using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'admin_upsert_staff: name required'
      using errcode = '22023';
  end if;
  if not public.is_allowed_staff_role(v_role) then
    raise exception 'admin_upsert_staff: invalid role'
      using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.staff as s (name, role, email, phone, active, salary_eur)
    values (v_name, v_role, v_email, v_phone, coalesce(p_active, true), p_salary_eur)
    returning s.id into v_id;
  else
    update public.staff as s
    set
      name = v_name,
      role = v_role,
      email = v_email,
      phone = v_phone,
      active = coalesce(p_active, true),
      salary_eur = p_salary_eur
    where s.id = p_id
    returning s.id into v_id;
    if v_id is null then
      raise exception 'admin_upsert_staff: staff not found'
        using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$fn$;

revoke all on function public.admin_upsert_staff(integer, text, text, text, text, boolean, numeric) from public;
revoke all on function public.admin_upsert_staff(integer, text, text, text, text, boolean, numeric) from anon;
grant execute on function public.admin_upsert_staff(integer, text, text, text, text, boolean, numeric) to authenticated;

commit;
