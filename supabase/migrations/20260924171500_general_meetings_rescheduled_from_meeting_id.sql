-- AMADEUS 11 — apply missing general_meetings reschedule link columns
-- Canonical source: supabase/general_meeting_lifecycle_hotfix.sql (schema DDL only).
-- Live reschedule_general_meeting already writes these columns; Owner selects them.
-- Does NOT replace RPCs, status checks, quorum, voting, or lifecycle functions.

alter table public.general_meetings
  add column if not exists reschedule_reason text,
  add column if not exists rescheduled_from_meeting_id uuid;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'general_meetings_rescheduled_from_fk'
  ) then
    alter table public.general_meetings
      add constraint general_meetings_rescheduled_from_fk
      foreign key (rescheduled_from_meeting_id)
      references public.general_meetings(id);
  end if;
end
$fk$;

create unique index if not exists general_meetings_rescheduled_from_uidx
  on public.general_meetings (rescheduled_from_meeting_id)
  where rescheduled_from_meeting_id is not null;

-- Ensure PostgREST exposes the new columns immediately after apply.
notify pgrst, 'reload schema';
