-- R1-UI FINAL: restore authenticated DML grants + SELECT policies for
-- ordinary polls and announcements.
--
-- Root cause: fresh_install baselines grant SELECT only; SH-2B added
-- admin INSERT/UPDATE/DELETE RLS policies without matching table grants,
-- and dropped owner/staff SELECT policies without recreating them.
-- Symptom: admin UI "permission denied for table polls" on publish;
-- SELECT returns empty under RLS with no SELECT policy.

begin;

-- ---------------------------------------------------------------------------
-- Table grants (RLS still enforces admin-only writes)
-- ---------------------------------------------------------------------------

grant insert, update, delete on table public.polls to authenticated;
grant insert, delete on table public.poll_options to authenticated;
grant insert, delete on table public.announcements to authenticated;

-- ---------------------------------------------------------------------------
-- SELECT policies — owners and staff may read ordinary polls / options /
-- announcements (writes remain administration-only via existing policies)
-- ---------------------------------------------------------------------------

drop policy if exists polls_owner_staff_select on public.polls;
create policy polls_owner_staff_select
on public.polls
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

drop policy if exists poll_options_owner_staff_select on public.poll_options;
create policy poll_options_owner_staff_select
on public.poll_options
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

drop policy if exists announcements_owner_staff_select on public.announcements;
create policy announcements_owner_staff_select
on public.announcements
for select
to authenticated
using (
  public.is_owner()
  or public.is_staff()
);

commit;
