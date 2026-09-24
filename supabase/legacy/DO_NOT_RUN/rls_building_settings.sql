-- Restrictive RLS for public.building_settings.
-- Shared house settings: authenticated may read; only staff may insert/update.

begin;

alter table public.building_settings enable row level security;

drop policy if exists building_settings_all
on public.building_settings;

revoke all on table public.building_settings from anon;

revoke all on table public.building_settings from authenticated;

grant select, insert, update
on table public.building_settings
to authenticated;

create policy building_settings_authenticated_select
on public.building_settings
for select
to authenticated
using (true);

create policy building_settings_staff_insert
on public.building_settings
for insert
to authenticated
with check (public.is_staff());

create policy building_settings_staff_update
on public.building_settings
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

commit;
