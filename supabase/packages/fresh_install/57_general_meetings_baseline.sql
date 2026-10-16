-- =============================================================================
-- IS-10c fresh-install — General Meetings baseline (canonical CREATE)
-- =============================================================================
-- Source: supabase/legacy/DO_NOT_RUN/documents_decisions_hotfix.sql (DDL only).
-- No meeting/decision rows. No building_documents (participants deferred).
-- =============================================================================

create table if not exists public.general_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  meeting_date date not null,
  meeting_time time,
  location text,
  meeting_mode text not null default 'in_person',
  is_urgent boolean not null default false,
  status text not null default 'draft',
  convoked_by text,
  invitation_posted_at timestamptz,
  minutes_completed_at timestamptz,
  minutes_notice_posted_at timestamptz,
  absentee_voting_enabled boolean not null default false,
  absentee_voting_deadline timestamptz,
  online_meeting_url text,
  represented_ideal_parts_percent numeric(12, 6),
  quorum_stage text,
  signed_document_uploaded boolean not null default false,
  external_registry_ref text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_email text,
  reschedule_reason text null,
  rescheduled_from_meeting_id uuid null,
  constraint general_meetings_mode_chk check (meeting_mode in ('in_person', 'hybrid')),
  constraint general_meetings_status_chk
    check (status in ('draft', 'published', 'held', 'minutes_ready', 'archived', 'cancelled')),
  constraint general_meetings_quorum_stage_chk
    check (quorum_stage is null or quorum_stage in ('initial', 'after_one_hour', 'next_day'))
);

comment on table public.general_meetings is
  'General meeting shell. Fresh-install: empty — no seeded meetings.';

create index if not exists general_meetings_date_status_idx
  on public.general_meetings (meeting_date desc, status);

-- Operational columns from legacy general_meeting_full_workflow_hotfix.
-- Required before meeting_core_foundation legal_state backfill references
-- operational_phase.
alter table public.general_meetings
  add column if not exists operational_phase text not null default 'idle',
  add column if not exists registration_opened_at timestamptz,
  add column if not exists registration_opened_by_email text,
  add column if not exists meeting_started_at timestamptz,
  add column if not exists meeting_started_by_email text,
  add column if not exists meeting_ended_at timestamptz,
  add column if not exists meeting_ended_by_email text,
  add column if not exists meeting_can_proceed boolean not null default false,
  add column if not exists quorum_rule text not null default 'standard_zues',
  add column if not exists quorum_rule_note text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_email text,
  add column if not exists cancellation_reason text;

do $op$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'general_meetings_operational_phase_chk'
  ) then
    alter table public.general_meetings
      add constraint general_meetings_operational_phase_chk
      check (operational_phase in ('idle', 'registration', 'in_progress', 'closed'));
  end if;
end
$op$;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'general_meetings_rescheduled_from_fk'
  ) then
    alter table public.general_meetings
      add constraint general_meetings_rescheduled_from_fk
      foreign key (rescheduled_from_meeting_id)
      references public.general_meetings (id);
  end if;
end
$fk$;

create unique index if not exists general_meetings_rescheduled_from_uidx
  on public.general_meetings (rescheduled_from_meeting_id)
  where rescheduled_from_meeting_id is not null;

create table if not exists public.general_meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  position integer not null,
  title text not null,
  description text,
  proposed_decision_text text,
  created_at timestamptz not null default now(),
  constraint general_meeting_agenda_position_chk check (position >= 1),
  constraint general_meeting_agenda_meeting_position_uidx unique (meeting_id, position)
);

create table if not exists public.general_meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete restrict,
  agenda_item_id uuid references public.general_meeting_agenda_items (id) on delete set null,
  decision_number text not null,
  title text not null,
  decision_text text not null,
  protocol_result text not null,
  execution_status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint general_meeting_decisions_result_chk
    check (protocol_result in ('adopted', 'rejected', 'information')),
  constraint general_meeting_decisions_exec_chk
    check (execution_status in ('active', 'executed', 'cancelled')),
  constraint general_meeting_decisions_number_uidx unique (meeting_id, decision_number)
);

create index if not exists general_meeting_decisions_meeting_idx
  on public.general_meeting_decisions (meeting_id, created_at);

alter table public.general_meetings enable row level security;
alter table public.general_meeting_agenda_items enable row level security;
alter table public.general_meeting_decisions enable row level security;

revoke all on table public.general_meetings from public, anon, authenticated;
revoke all on table public.general_meeting_agenda_items from public, anon, authenticated;
revoke all on table public.general_meeting_decisions from public, anon, authenticated;
grant select on table public.general_meetings to authenticated;
grant select on table public.general_meeting_agenda_items to authenticated;
grant select on table public.general_meeting_decisions to authenticated;

do $$
begin
  if to_regclass('public.tariff_versions') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'tariff_versions_decision_id_fkey'
     ) then
    alter table public.tariff_versions
      add constraint tariff_versions_decision_id_fkey
      foreign key (decision_id)
      references public.general_meeting_decisions (id)
      on delete restrict;
  end if;
end $$;
