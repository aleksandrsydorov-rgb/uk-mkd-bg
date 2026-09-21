-- Restrictive RLS for public.announcements and public.uk_expenses.
-- Apply after public.is_staff(), public.is_owner(), public.owns_property(bigint).

begin;

create or replace function public.can_approve_uk_expenses()
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
      and s.active is not false
      and (
        btrim(coalesce(s.role, '')) = ''
        or lower(btrim(s.role)) ~ 'админ|administr|управляющ|директор|председател|управител|менедж|\ymanager\y|(^|[[:space:]])ук([[:space:]]|$)'
      )
  );
$$;

revoke all on function public.can_approve_uk_expenses() from public;
revoke execute on function public.can_approve_uk_expenses() from anon;
grant execute on function public.can_approve_uk_expenses() to authenticated;

-- announcements

alter table public.announcements enable row level security;

drop policy if exists announcements_all
on public.announcements;

revoke all on table public.announcements from anon;
revoke all on table public.announcements from authenticated;

grant select, insert, delete
on table public.announcements
to authenticated;

create policy announcements_owner_staff_select
on public.announcements
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

create policy announcements_staff_insert
on public.announcements
for insert
to authenticated
with check (
  public.is_staff()
);

create policy announcements_staff_delete
on public.announcements
for delete
to authenticated
using (
  public.is_staff()
);

-- uk_expenses

alter table public.uk_expenses enable row level security;

drop policy if exists uk_expenses_all
on public.uk_expenses;
drop policy if exists uk_expenses_delete
on public.uk_expenses;
drop policy if exists uk_expenses_insert
on public.uk_expenses;
drop policy if exists uk_expenses_select
on public.uk_expenses;
drop policy if exists uk_expenses_update
on public.uk_expenses;

revoke all on table public.uk_expenses from anon;
revoke all on table public.uk_expenses from authenticated;

grant select, insert, update, delete
on table public.uk_expenses
to authenticated;

create policy uk_expenses_owner_staff_select
on public.uk_expenses
for select
to authenticated
using (
  public.is_staff()
  or (
    public.is_owner()
    and (
      lower(btrim(status)) in ('опубликован', 'approved', 'published')
      or btrim(status) = ''
    )
  )
);

create policy uk_expenses_staff_insert
on public.uk_expenses
for insert
to authenticated
with check (
  public.is_staff()
  and (
    public.can_approve_uk_expenses()
    or not (
      lower(btrim(status)) in ('опубликован', 'approved', 'published')
      or btrim(status) = ''
    )
  )
);

create policy uk_expenses_staff_update
on public.uk_expenses
for update
to authenticated
using (
  public.is_staff()
  and (
    public.can_approve_uk_expenses()
    or not (
      lower(btrim(status)) in ('опубликован', 'approved', 'published')
      or btrim(status) = ''
    )
  )
)
with check (
  public.is_staff()
  and (
    public.can_approve_uk_expenses()
    or not (
      lower(btrim(status)) in ('опубликован', 'approved', 'published')
      or btrim(status) = ''
    )
  )
);

create policy uk_expenses_staff_delete
on public.uk_expenses
for delete
to authenticated
using (
  public.is_staff()
);

commit;
