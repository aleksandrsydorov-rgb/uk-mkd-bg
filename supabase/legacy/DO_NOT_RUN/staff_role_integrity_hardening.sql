-- =============================================================================
-- AMADEUS 11 — staff write policies: close role-escalation via is_staff()
-- =============================================================================
-- Does NOT change staff_select (salary visibility is a later issue).
-- Does NOT change table GRANT on public.staff.
-- INSERT / UPDATE / DELETE: only has_staff_role('администрация').
-- Requires public.has_staff_role(text) already created.
-- This file has no BEGIN/COMMIT.
-- =============================================================================

drop policy if exists staff_staff_insert on public.staff;
drop policy if exists staff_staff_update on public.staff;
drop policy if exists staff_staff_delete on public.staff;
drop policy if exists staff_admin_insert on public.staff;
drop policy if exists staff_admin_update on public.staff;
drop policy if exists staff_admin_delete on public.staff;

create policy staff_admin_insert
on public.staff
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
);

create policy staff_admin_update
on public.staff
for update
to authenticated
using (
  public.has_staff_role('администрация')
)
with check (true);

create policy staff_admin_delete
on public.staff
for delete
to authenticated
using (
  public.has_staff_role('администрация')
);
