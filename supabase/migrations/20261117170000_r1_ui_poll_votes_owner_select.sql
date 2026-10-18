-- R1-UI-POLISH: restore owner SELECT on poll_votes (attention / duplicate UI).
--
-- SH-2B left only polls_admin_select-equivalent admin SELECT on poll_votes.
-- Owners cast via SECURITY DEFINER cast_poll_vote, but client refresh of
-- poll_votes returned empty under RLS → overview kept «Вы ещё не проголосовали»
-- after a successful vote. Restore owns_property SELECT (legacy rls_polls).

begin;

drop policy if exists poll_votes_owner_select on public.poll_votes;
create policy poll_votes_owner_select
on public.poll_votes
for select
to authenticated
using (public.owns_property(property_id));

-- Staff (non-admin) may also need tallies in assigned work UIs; keep admin policy
-- and allow is_staff() read (matches pre-hardening staff_select intent).
drop policy if exists poll_votes_staff_select on public.poll_votes;
create policy poll_votes_staff_select
on public.poll_votes
for select
to authenticated
using (public.is_staff());

commit;
