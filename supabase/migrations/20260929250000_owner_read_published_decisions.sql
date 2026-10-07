-- Owners need to read decisions during published meetings to map their votes to agenda items.

drop policy if exists general_meeting_decisions_select on public.general_meeting_decisions;
create policy general_meeting_decisions_select on public.general_meeting_decisions
for select to authenticated
using (
  public.can_manage_building_governance()
  or exists (
    select 1
    from public.general_meetings as m
    where m.id = general_meeting_decisions.meeting_id
      and m.status = any (array['published', 'held', 'minutes_ready', 'archived'])
      and (public.is_owner() or public.is_staff())
  )
);
