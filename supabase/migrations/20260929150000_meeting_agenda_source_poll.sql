-- Meeting agenda: link poll result for OS ratification.
alter table public.general_meeting_agenda_items
  add column if not exists source_poll_id bigint null
    references public.polls (id) on delete set null;

create unique index if not exists general_meeting_agenda_items_source_poll_uidx
  on public.general_meeting_agenda_items (source_poll_id)
  where source_poll_id is not null;

comment on column public.general_meeting_agenda_items.source_poll_id is
  'Optional poll whose result is put on the agenda for general-meeting ratification.';
