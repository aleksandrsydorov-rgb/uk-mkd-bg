-- =============================================================================
-- Restore the signed-in staff write path for uk_expenses.
-- The fresh-install baseline grants authenticated SELECT only. SH-2A kept the
-- administration DELETE policy and did not recreate INSERT, UPDATE, or SELECT.
-- The admin screen writes as the signed-in user. service_role is not a browser path.
-- Table privileges go to authenticated; the policies below are the condition.
-- Publish stays administration-only. An accountant may create and edit an
-- unpublished row. Delete remains the existing administration policy.
-- =============================================================================

grant insert, update, delete on table public.uk_expenses to authenticated;

drop policy if exists uk_expenses_owner_staff_select on public.uk_expenses;
create policy uk_expenses_owner_staff_select
on public.uk_expenses
for select
to authenticated
using (
  public.is_staff()
  or (
    public.is_owner()
    and public.uk_expense_is_published(status)
  )
);

drop policy if exists uk_expenses_staff_insert on public.uk_expenses;
create policy uk_expenses_staff_insert
on public.uk_expenses
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  or (
    public.has_staff_role('бухгалтер')
    and not public.uk_expense_is_published(status)
  )
);

drop policy if exists uk_expenses_staff_update on public.uk_expenses;
create policy uk_expenses_staff_update
on public.uk_expenses
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or (
    public.has_staff_role('бухгалтер')
    and not public.uk_expense_is_published(status)
  )
)
with check (
  public.has_staff_role('администрация')
  or (
    public.has_staff_role('бухгалтер')
    and not public.uk_expense_is_published(status)
  )
);
