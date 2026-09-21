-- Core RLS for properties, staff, n525_commands.
-- Apply after public.is_staff(), public.is_owner(), public.owns_property(bigint)
-- and support-fee SECURITY DEFINER RPCs.
-- Staff DELETE on properties may cascade related history via existing FKs.

begin;

create or replace function public.enforce_properties_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      if coalesce(NEW.debt, 0) <> 0
         or coalesce(NEW.overpayment, 0) <> 0 then
        raise exception 'properties: initial debt and overpayment must be zero'
          using errcode = '42501';
      end if;
    end if;
    return NEW;
  end if;

  if current_user in ('anon', 'authenticated') then
    if NEW.debt is distinct from OLD.debt
       or NEW.overpayment is distinct from OLD.overpayment then
      raise exception 'properties: debt and overpayment can only change via support-fee RPC'
        using errcode = '42501';
    end if;
  end if;

  if current_user in ('anon', 'authenticated') and not public.is_staff() then
    if not public.owns_property(OLD.id) then
      raise exception 'properties: owner can update only own apartments'
        using errcode = '42501';
    end if;

    if (
      to_jsonb(NEW) - array[
        'occupant_kind',
        'occupant_name',
        'occupant_phone',
        'occupant_email',
        'occupant_until',
        'occupancy_status',
        'status',
        'pet_info'
      ]
    ) is distinct from (
      to_jsonb(OLD) - array[
        'occupant_kind',
        'occupant_name',
        'occupant_phone',
        'occupant_email',
        'occupant_until',
        'occupancy_status',
        'status',
        'pet_info'
      ]
    ) then
      raise exception 'properties: owner cannot change protected columns'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

revoke all on function public.enforce_properties_update() from public;
revoke execute on function public.enforce_properties_update() from anon;
revoke execute on function public.enforce_properties_update() from authenticated;

drop trigger if exists enforce_properties_update on public.properties;
create trigger enforce_properties_update
before insert or update on public.properties
for each row
execute function public.enforce_properties_update();

-- properties

alter table public.properties enable row level security;

drop policy if exists properties_all on public.properties;
drop policy if exists properties_owner_staff_select on public.properties;
drop policy if exists properties_staff_insert on public.properties;
drop policy if exists properties_staff_update on public.properties;
drop policy if exists properties_owner_update on public.properties;
drop policy if exists properties_staff_delete on public.properties;

revoke all on table public.properties from anon;
revoke all on table public.properties from authenticated;

grant select, insert, update, delete
on table public.properties
to authenticated;

create policy properties_owner_staff_select
on public.properties
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(id)
);

create policy properties_staff_insert
on public.properties
for insert
to authenticated
with check (public.is_staff());

create policy properties_staff_update
on public.properties
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

create policy properties_owner_update
on public.properties
for update
to authenticated
using (public.owns_property(id))
with check (public.owns_property(id));

create policy properties_staff_delete
on public.properties
for delete
to authenticated
using (public.is_staff());

-- staff
-- UPDATE USING (is_staff()) WITH CHECK (true):
-- row must be updatable while the caller is currently active staff.
-- NEW.active = false would make is_staff() false, so WITH CHECK (is_staff())
-- would block self-deactivate. Current UI allows that; WITH CHECK (true) keeps it.

alter table public.staff enable row level security;

drop policy if exists staff_all on public.staff;
drop policy if exists staff_select on public.staff;
drop policy if exists staff_staff_insert on public.staff;
drop policy if exists staff_staff_update on public.staff;
drop policy if exists staff_staff_delete on public.staff;

revoke all on table public.staff from anon;
revoke all on table public.staff from authenticated;

grant select, insert, update, delete
on table public.staff
to authenticated;

create policy staff_select
on public.staff
for select
to authenticated
using (
  public.is_staff()
  or lower(btrim(email)) = lower(btrim(auth.email()))
);

create policy staff_staff_insert
on public.staff
for insert
to authenticated
with check (public.is_staff());

create policy staff_staff_update
on public.staff
for update
to authenticated
using (public.is_staff())
with check (true);

create policy staff_staff_delete
on public.staff
for delete
to authenticated
using (public.is_staff());

-- n525_commands: unused by the app

alter table public.n525_commands enable row level security;

drop policy if exists n525_commands_all on public.n525_commands;
drop policy if exists n525_commands_select on public.n525_commands;
drop policy if exists n525_commands_insert on public.n525_commands;
drop policy if exists n525_commands_update on public.n525_commands;
drop policy if exists n525_commands_delete on public.n525_commands;

revoke all on table public.n525_commands from anon;
revoke all on table public.n525_commands from authenticated;

commit;
