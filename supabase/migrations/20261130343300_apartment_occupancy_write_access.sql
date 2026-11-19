-- Restore authenticated write access for household occupancy tables.
-- Baselines granted SELECT only; RLS policies for guests existed without INSERT/DELETE grants.
-- apartment_pets had RLS enabled with no policies (legacy policies never migrated).

begin;

revoke all on table public.apartment_guests from public, anon;
grant select, insert, update, delete on table public.apartment_guests to authenticated;
grant all on table public.apartment_guests to service_role;

revoke all on table public.apartment_pets from public, anon;
grant select, insert, update, delete on table public.apartment_pets to authenticated;
grant all on table public.apartment_pets to service_role;

do $$
begin
  if to_regclass('public.apartment_guests_id_seq') is not null then
    grant usage, select on sequence public.apartment_guests_id_seq to authenticated;
    grant all on sequence public.apartment_guests_id_seq to service_role;
  end if;
  if to_regclass('public.apartment_pets_id_seq') is not null then
    grant usage, select on sequence public.apartment_pets_id_seq to authenticated;
    grant all on sequence public.apartment_pets_id_seq to service_role;
  end if;
end $$;

drop policy if exists apartment_guests_admin_owner_update on public.apartment_guests;
create policy apartment_guests_admin_owner_update
on public.apartment_guests
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
)
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_pets_admin_owner_select on public.apartment_pets;
create policy apartment_pets_admin_owner_select
on public.apartment_pets
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_pets_admin_owner_insert on public.apartment_pets;
create policy apartment_pets_admin_owner_insert
on public.apartment_pets
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_pets_admin_owner_update on public.apartment_pets;
create policy apartment_pets_admin_owner_update
on public.apartment_pets
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
)
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_pets_admin_owner_delete on public.apartment_pets;
create policy apartment_pets_admin_owner_delete
on public.apartment_pets
for delete
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

commit;
