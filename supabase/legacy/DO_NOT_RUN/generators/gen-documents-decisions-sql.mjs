import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';

const hotfix = `-- =============================================================================
-- AMADEUS 11 — Documents & general meetings (ЗУЕС archive)
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Does NOT touch polls, propertyVoteWeight, properties.ideal_parts_percent,
-- owner_email, owns_property, finance, meters.
-- This is NOT EISES and does NOT create fake meeting history.
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'Pre-flight failed: public.has_staff_role(text) does not exist.';
  end if;
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'Pre-flight failed: public.is_owner() does not exist.';
  end if;
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'Pre-flight failed: public.is_staff() does not exist.';
  end if;
  if to_regclass('public.properties') is null then
    raise exception 'Pre-flight failed: public.properties does not exist.';
  end if;
end
$pre$;

create or replace function public.can_manage_building_governance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_staff_role('${ADMIN}');
$fn$;

revoke all on function public.can_manage_building_governance() from public;
revoke execute on function public.can_manage_building_governance() from anon;
grant execute on function public.can_manage_building_governance() to authenticated;

-- ---------------------------------------------------------------------------
-- building_documents
-- ---------------------------------------------------------------------------

create table if not exists public.building_documents (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  description text,
  document_date date,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  status text not null default 'draft',
  version integer not null default 1,
  supersedes_document_id uuid references public.building_documents(id),
  created_by_email text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_email text,
  constraint building_documents_category_chk
    check (category in ('house_rules','budget','annual_report','management','technical','meeting_related','other')),
  constraint building_documents_status_chk
    check (status in ('draft','published','archived')),
  constraint building_documents_version_chk check (version >= 1)
);

create unique index if not exists building_documents_storage_path_uidx
  on public.building_documents (storage_path);

create index if not exists building_documents_status_category_idx
  on public.building_documents (status, category, document_date desc);

-- ---------------------------------------------------------------------------
-- general_meetings
-- ---------------------------------------------------------------------------

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
  represented_ideal_parts_percent numeric(12,6),
  quorum_stage text,
  signed_document_uploaded boolean not null default false,
  external_registry_ref text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_email text,
  constraint general_meetings_mode_chk check (meeting_mode in ('in_person','hybrid')),
  constraint general_meetings_status_chk
    check (status in ('draft','published','held','minutes_ready','archived','cancelled')),
  constraint general_meetings_quorum_stage_chk
    check (quorum_stage is null or quorum_stage in ('initial','after_one_hour','next_day'))
);

create index if not exists general_meetings_date_status_idx
  on public.general_meetings (meeting_date desc, status);

create table if not exists public.general_meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings(id) on delete cascade,
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
  meeting_id uuid not null references public.general_meetings(id) on delete restrict,
  agenda_item_id uuid references public.general_meeting_agenda_items(id) on delete set null,
  decision_number text not null,
  title text not null,
  decision_text text not null,
  protocol_result text not null,
  execution_status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint general_meeting_decisions_result_chk
    check (protocol_result in ('adopted','rejected','information')),
  constraint general_meeting_decisions_exec_chk
    check (execution_status in ('active','executed','cancelled')),
  constraint general_meeting_decisions_number_uidx unique (meeting_id, decision_number)
);

create index if not exists general_meeting_decisions_meeting_idx
  on public.general_meeting_decisions (meeting_id, created_at);

create table if not exists public.general_meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings(id) on delete cascade,
  property_id bigint not null references public.properties(id) on delete restrict,
  participant_name text not null,
  representation_type text not null,
  representative_name text,
  property_number_snapshot text,
  ideal_parts_percent_snapshot numeric(12,6),
  attendance_mode text not null,
  proxy_document_id uuid references public.building_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint general_meeting_participants_repr_chk
    check (representation_type in ('self','proxy')),
  constraint general_meeting_participants_att_chk
    check (attendance_mode in ('in_person','online','absentee')),
  constraint general_meeting_participants_property_uidx unique (meeting_id, property_id)
);

create table if not exists public.general_meeting_votes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings(id) on delete cascade,
  decision_id uuid not null references public.general_meeting_decisions(id) on delete cascade,
  property_id bigint not null references public.properties(id) on delete restrict,
  participant_id uuid references public.general_meeting_participants(id) on delete set null,
  vote text not null,
  ideal_parts_percent_snapshot numeric(12,6),
  vote_method text not null,
  recorded_at timestamptz not null default now(),
  recorded_by_email text,
  constraint general_meeting_votes_vote_chk check (vote in ('for','against','abstain')),
  constraint general_meeting_votes_method_chk check (vote_method in ('in_person','online','absentee')),
  constraint general_meeting_votes_property_decision_uidx unique (decision_id, property_id)
);

create table if not exists public.general_meeting_files (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings(id) on delete cascade,
  document_id uuid not null references public.building_documents(id) on delete restrict,
  file_type text not null,
  title text,
  created_at timestamptz not null default now(),
  constraint general_meeting_files_type_chk
    check (file_type in (
      'invitation','invitation_posting_protocol','agenda','minutes','minutes_notice',
      'minutes_notice_posting_protocol','proxy','absentee_declaration','appendix','other'
    ))
);

create index if not exists general_meeting_files_meeting_idx
  on public.general_meeting_files (meeting_id, file_type);

-- ---------------------------------------------------------------------------
-- triggers: snapshots, no silent overwrite
-- ---------------------------------------------------------------------------

create or replace function public.general_meeting_participant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_parts numeric(12,6);
  v_number text;
begin
  select p.ideal_parts_percent, p.apartment_number::text
    into v_parts, v_number
  from public.properties as p
  where p.id = NEW.property_id;

  if NEW.ideal_parts_percent_snapshot is null then
    NEW.ideal_parts_percent_snapshot := v_parts;
  end if;
  if NEW.property_number_snapshot is null then
    NEW.property_number_snapshot := v_number;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_general_meeting_participant_defaults on public.general_meeting_participants;
create trigger trg_general_meeting_participant_defaults
before insert on public.general_meeting_participants
for each row execute function public.general_meeting_participant_defaults();

create or replace function public.protect_published_building_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if TG_OP = 'DELETE' then
    if OLD.status is not distinct from 'published' then
      raise exception 'building_documents: published documents cannot be deleted'
        using errcode = '42501';
    end if;
    return OLD;
  end if;
  if OLD.status is not distinct from 'published'
     and NEW.storage_path is distinct from OLD.storage_path then
    raise exception 'building_documents: published storage_path cannot be replaced'
      using errcode = '42501';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_protect_published_building_document on public.building_documents;
create trigger trg_protect_published_building_document
before update or delete on public.building_documents
for each row execute function public.protect_published_building_document();

create or replace function public.protect_published_meeting_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_meeting uuid;
begin
  v_meeting := coalesce(NEW.meeting_id, OLD.meeting_id);
  select m.status into v_status from public.general_meetings as m where m.id = v_meeting;
  if v_status is distinct from 'draft' then
    raise exception 'general_meeting_agenda_items: published agenda cannot be silently changed'
      using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_protect_published_meeting_agenda on public.general_meeting_agenda_items;
create trigger trg_protect_published_meeting_agenda
before insert or update or delete on public.general_meeting_agenda_items
for each row execute function public.protect_published_meeting_agenda();

create or replace function public.touch_general_meetings_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  NEW.updated_at := now();
  return NEW;
end;
$fn$;

drop trigger if exists trg_touch_general_meetings_updated_at on public.general_meetings;
create trigger trg_touch_general_meetings_updated_at
before update on public.general_meetings
for each row execute function public.touch_general_meetings_updated_at();

revoke all on function public.general_meeting_participant_defaults() from public;
revoke execute on function public.general_meeting_participant_defaults() from anon, authenticated;
revoke all on function public.protect_published_building_document() from public;
revoke execute on function public.protect_published_building_document() from anon, authenticated;
revoke all on function public.protect_published_meeting_agenda() from public;
revoke execute on function public.protect_published_meeting_agenda() from anon, authenticated;
revoke all on function public.touch_general_meetings_updated_at() from public;
revoke execute on function public.touch_general_meetings_updated_at() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.publish_general_meeting(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
begin
  if auth.email() is null then
    raise exception 'publish_general_meeting: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'publish_general_meeting: not allowed' using errcode = '42501';
  end if;

  update public.general_meetings as m
     set status = 'published',
         published_at = coalesce(m.published_at, now()),
         published_by_email = coalesce(m.published_by_email, auth.email())
   where m.id = p_meeting_id
     and m.status = 'draft'
  returning m.* into v_row;

  if not found then
    raise exception 'publish_general_meeting: draft meeting not found' using errcode = 'P0002';
  end if;

  update public.building_documents as d
     set status = 'published',
         published_at = coalesce(d.published_at, now()),
         published_by_email = coalesce(d.published_by_email, auth.email())
   where d.status = 'draft'
     and d.id in (
       select f.document_id from public.general_meeting_files as f
       where f.meeting_id = p_meeting_id
         and f.file_type in ('invitation','agenda','invitation_posting_protocol')
     );

  return v_row;
end;
$fn$;

create or replace function public.publish_general_meeting_minutes(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
  v_has_minutes boolean;
begin
  if auth.email() is null then
    raise exception 'publish_general_meeting_minutes: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'publish_general_meeting_minutes: not allowed' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.general_meeting_files as f
    join public.building_documents as d on d.id = f.document_id
    where f.meeting_id = p_meeting_id and f.file_type = 'minutes'
  ) into v_has_minutes;

  update public.general_meetings as m
     set status = 'minutes_ready',
         minutes_completed_at = coalesce(m.minutes_completed_at, now()),
         signed_document_uploaded = v_has_minutes
   where m.id = p_meeting_id
     and m.status in ('published','held','minutes_ready')
  returning m.* into v_row;

  if not found then
    raise exception 'publish_general_meeting_minutes: meeting not found' using errcode = 'P0002';
  end if;

  update public.building_documents as d
     set status = 'published',
         published_at = coalesce(d.published_at, now()),
         published_by_email = coalesce(d.published_by_email, auth.email())
   where d.status = 'draft'
     and d.id in (
       select f.document_id from public.general_meeting_files as f
       where f.meeting_id = p_meeting_id
         and f.file_type in ('minutes','minutes_notice','minutes_notice_posting_protocol','appendix')
     );

  return v_row;
end;
$fn$;

create or replace function public.refresh_meeting_represented_parts(p_meeting_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sum numeric(12,6);
begin
  if not public.can_manage_building_governance() then
    raise exception 'refresh_meeting_represented_parts: not allowed' using errcode = '42501';
  end if;

  select coalesce(sum(p.ideal_parts_percent_snapshot), 0)
    into v_sum
  from public.general_meeting_participants as p
  where p.meeting_id = p_meeting_id;

  update public.general_meetings as m
     set represented_ideal_parts_percent = v_sum
   where m.id = p_meeting_id;

  return v_sum;
end;
$fn$;

create or replace function public.archive_building_document(p_document_id uuid)
returns public.building_documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.building_documents;
begin
  if not public.can_manage_building_governance() then
    raise exception 'archive_building_document: not allowed' using errcode = '42501';
  end if;

  update public.building_documents as d
     set status = 'archived'
   where d.id = p_document_id
     and d.status in ('published','draft')
  returning d.* into v_row;

  if not found then
    raise exception 'archive_building_document: document not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.publish_building_document(p_document_id uuid)
returns public.building_documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.building_documents;
begin
  if not public.can_manage_building_governance() then
    raise exception 'publish_building_document: not allowed' using errcode = '42501';
  end if;

  update public.building_documents as d
     set status = 'published',
         published_at = coalesce(d.published_at, now()),
         published_by_email = coalesce(d.published_by_email, auth.email())
   where d.id = p_document_id
     and d.status = 'draft'
  returning d.* into v_row;

  if not found then
    raise exception 'publish_building_document: draft not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.publish_general_meeting(uuid) from public;
revoke execute on function public.publish_general_meeting(uuid) from anon;
grant execute on function public.publish_general_meeting(uuid) to authenticated;

revoke all on function public.publish_general_meeting_minutes(uuid) from public;
revoke execute on function public.publish_general_meeting_minutes(uuid) from anon;
grant execute on function public.publish_general_meeting_minutes(uuid) to authenticated;

revoke all on function public.refresh_meeting_represented_parts(uuid) from public;
revoke execute on function public.refresh_meeting_represented_parts(uuid) from anon;
grant execute on function public.refresh_meeting_represented_parts(uuid) to authenticated;

revoke all on function public.archive_building_document(uuid) from public;
revoke execute on function public.archive_building_document(uuid) from anon;
grant execute on function public.archive_building_document(uuid) to authenticated;

revoke all on function public.publish_building_document(uuid) from public;
revoke execute on function public.publish_building_document(uuid) from anon;
grant execute on function public.publish_building_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- grants + RLS
-- ---------------------------------------------------------------------------

alter table public.building_documents enable row level security;
alter table public.general_meetings enable row level security;
alter table public.general_meeting_agenda_items enable row level security;
alter table public.general_meeting_decisions enable row level security;
alter table public.general_meeting_participants enable row level security;
alter table public.general_meeting_votes enable row level security;
alter table public.general_meeting_files enable row level security;

revoke all on table public.building_documents from anon, public;
revoke all on table public.general_meetings from anon, public;
revoke all on table public.general_meeting_agenda_items from anon, public;
revoke all on table public.general_meeting_decisions from anon, public;
revoke all on table public.general_meeting_participants from anon, public;
revoke all on table public.general_meeting_votes from anon, public;
revoke all on table public.general_meeting_files from anon, public;

grant select, insert, update, delete on table public.building_documents to authenticated;
grant select, insert, update, delete on table public.general_meetings to authenticated;
grant select, insert, update, delete on table public.general_meeting_agenda_items to authenticated;
grant select, insert, update, delete on table public.general_meeting_decisions to authenticated;
grant select, insert, update, delete on table public.general_meeting_participants to authenticated;
grant select, insert, update, delete on table public.general_meeting_votes to authenticated;
grant select, insert, update, delete on table public.general_meeting_files to authenticated;

drop policy if exists building_documents_select on public.building_documents;
create policy building_documents_select on public.building_documents
for select to authenticated
using (
  public.can_manage_building_governance()
  or (public.is_staff() and status in ('published','archived'))
  or (public.is_owner() and status = 'published')
);

drop policy if exists building_documents_insert on public.building_documents;
create policy building_documents_insert on public.building_documents
for insert to authenticated
with check (public.can_manage_building_governance());

drop policy if exists building_documents_update on public.building_documents;
create policy building_documents_update on public.building_documents
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());

drop policy if exists building_documents_delete on public.building_documents;
create policy building_documents_delete on public.building_documents
for delete to authenticated
using (public.can_manage_building_governance() and status = 'draft');

drop policy if exists general_meetings_select on public.general_meetings;
create policy general_meetings_select on public.general_meetings
for select to authenticated
using (
  public.can_manage_building_governance()
  or (public.is_staff() and status <> 'draft')
  or (public.is_owner() and status <> 'draft')
);

drop policy if exists general_meetings_insert on public.general_meetings;
create policy general_meetings_insert on public.general_meetings
for insert to authenticated
with check (public.can_manage_building_governance());

drop policy if exists general_meetings_update on public.general_meetings;
create policy general_meetings_update on public.general_meetings
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());

drop policy if exists general_meetings_delete on public.general_meetings;
create policy general_meetings_delete on public.general_meetings
for delete to authenticated
using (public.can_manage_building_governance() and status = 'draft');

drop policy if exists general_meeting_agenda_select on public.general_meeting_agenda_items;
create policy general_meeting_agenda_select on public.general_meeting_agenda_items
for select to authenticated
using (
  public.can_manage_building_governance()
  or exists (
    select 1 from public.general_meetings as m
    where m.id = meeting_id and m.status <> 'draft'
      and (public.is_owner() or public.is_staff())
  )
);

drop policy if exists general_meeting_agenda_write on public.general_meeting_agenda_items;
create policy general_meeting_agenda_insert on public.general_meeting_agenda_items
for insert to authenticated
with check (public.can_manage_building_governance());
create policy general_meeting_agenda_update on public.general_meeting_agenda_items
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());
create policy general_meeting_agenda_delete on public.general_meeting_agenda_items
for delete to authenticated
using (public.can_manage_building_governance());

drop policy if exists general_meeting_decisions_select on public.general_meeting_decisions;
create policy general_meeting_decisions_select on public.general_meeting_decisions
for select to authenticated
using (
  public.can_manage_building_governance()
  or exists (
    select 1 from public.general_meetings as m
    where m.id = meeting_id and m.status in ('held','minutes_ready','archived')
      and (public.is_owner() or public.is_staff())
  )
);

create policy general_meeting_decisions_insert on public.general_meeting_decisions
for insert to authenticated
with check (public.can_manage_building_governance());
create policy general_meeting_decisions_update on public.general_meeting_decisions
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());
create policy general_meeting_decisions_delete on public.general_meeting_decisions
for delete to authenticated
using (public.can_manage_building_governance());

drop policy if exists general_meeting_participants_select on public.general_meeting_participants;
create policy general_meeting_participants_select on public.general_meeting_participants
for select to authenticated
using (public.can_manage_building_governance());

create policy general_meeting_participants_insert on public.general_meeting_participants
for insert to authenticated
with check (public.can_manage_building_governance());
create policy general_meeting_participants_update on public.general_meeting_participants
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());
create policy general_meeting_participants_delete on public.general_meeting_participants
for delete to authenticated
using (public.can_manage_building_governance());

drop policy if exists general_meeting_votes_select on public.general_meeting_votes;
create policy general_meeting_votes_select on public.general_meeting_votes
for select to authenticated
using (public.can_manage_building_governance());

create policy general_meeting_votes_insert on public.general_meeting_votes
for insert to authenticated
with check (public.can_manage_building_governance());
create policy general_meeting_votes_update on public.general_meeting_votes
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());
create policy general_meeting_votes_delete on public.general_meeting_votes
for delete to authenticated
using (public.can_manage_building_governance());

drop policy if exists general_meeting_files_select on public.general_meeting_files;
create policy general_meeting_files_select on public.general_meeting_files
for select to authenticated
using (
  public.can_manage_building_governance()
  or exists (
    select 1 from public.general_meetings as m
    where m.id = meeting_id and m.status <> 'draft'
      and (public.is_owner() or public.is_staff())
  )
);

create policy general_meeting_files_insert on public.general_meeting_files
for insert to authenticated
with check (public.can_manage_building_governance());
create policy general_meeting_files_update on public.general_meeting_files
for update to authenticated
using (public.can_manage_building_governance())
with check (public.can_manage_building_governance());
create policy general_meeting_files_delete on public.general_meeting_files
for delete to authenticated
using (public.can_manage_building_governance());

-- ---------------------------------------------------------------------------
-- private storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
select 'building-documents', 'building-documents', false
where not exists (select 1 from storage.buckets where id = 'building-documents');

update storage.buckets
   set public = false
 where id = 'building-documents';

drop policy if exists building_documents_storage_select on storage.objects;
create policy building_documents_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'building-documents'
  and exists (
    select 1 from public.building_documents as d
    where d.storage_path = name
  )
);

drop policy if exists building_documents_storage_insert on storage.objects;
create policy building_documents_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
);

drop policy if exists building_documents_storage_update on storage.objects;
create policy building_documents_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
)
with check (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
);

drop policy if exists building_documents_storage_delete on storage.objects;
create policy building_documents_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
);

commit;
`;

const verify = `-- =============================================================================
-- AMADEUS 11 — documents & decisions verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'table_exists' as check_id, tablename as item,
  case when to_regclass('public.' || tablename) is not null then 'OK' else 'FAIL' end as result
from (values
  ('building_documents'),
  ('general_meetings'),
  ('general_meeting_agenda_items'),
  ('general_meeting_decisions'),
  ('general_meeting_participants'),
  ('general_meeting_votes'),
  ('general_meeting_files')
) as t(tablename)

union all
select 'rls_enabled', c.relname,
  case when c.relrowsecurity then 'OK' else 'FAIL' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'building_documents','general_meetings','general_meeting_agenda_items',
    'general_meeting_decisions','general_meeting_participants',
    'general_meeting_votes','general_meeting_files'
  )

union all
select 'anon_no_select', tablename,
  case when not has_table_privilege('anon', 'public.' || tablename, 'SELECT') then 'OK' else 'FAIL' end
from (values
  ('building_documents'),('general_meetings'),('general_meeting_agenda_items'),
  ('general_meeting_decisions'),('general_meeting_participants'),
  ('general_meeting_votes'),('general_meeting_files')
) as t(tablename)

union all
select 'unique_participant_property', 'general_meeting_participants',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_participants'::regclass
      and contype = 'u'
  ) then 'OK' else 'FAIL' end

union all
select 'unique_agenda_position', 'general_meeting_agenda_items',
  case when exists (
    select 1 from pg_constraint
    where conrelid = 'public.general_meeting_agenda_items'::regclass
      and contype = 'u'
  ) then 'OK' else 'FAIL' end

union all
select 'snapshot_numeric', 'ideal_parts_percent_snapshot',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_meeting_participants'
      and column_name = 'ideal_parts_percent_snapshot' and numeric_precision >= 12
  ) then 'OK' else 'FAIL' end

union all
select 'properties_ideal_parts_untouched', 'properties.ideal_parts_percent',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'ideal_parts_percent'
  ) then 'OK' else 'FAIL' end

union all
select 'polls_untouched', 'polls',
  case when to_regclass('public.polls') is not null then 'OK' else 'FAIL' end

union all
select 'bucket_private', 'building-documents',
  case when exists (
    select 1 from storage.buckets where id = 'building-documents' and public is false
  ) then 'OK' else 'FAIL' end

union all
select 'rpc_search_path', proname,
  case when pg_get_functiondef(p.oid) like '%search_path%' then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'can_manage_building_governance','publish_general_meeting',
    'publish_general_meeting_minutes','archive_building_document','publish_building_document'
  )

union all
select 'rpc_security_definer', p.proname,
  case when p.prosecdef then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'can_manage_building_governance','publish_general_meeting',
    'publish_general_meeting_minutes','archive_building_document','publish_building_document'
  )

union all
select 'anon_no_execute', p.proname,
  case when not has_function_privilege('anon', p.oid, 'EXECUTE') then 'OK' else 'FAIL' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'can_manage_building_governance','publish_general_meeting',
    'publish_general_meeting_minutes','archive_building_document','publish_building_document'
  )

union all
select 'utf8_admin_literal', 'can_manage_building_governance',
  case when position(
      convert_to(U&'\\0430\\0434\\043C\\0438\\043D\\0438\\0441\\0442\\0440\\0430\\0446\\0438\\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.can_manage_building_governance()'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end

union all
select 'owner_no_participant_catalog', 'general_meeting_participants owner policy',
  case when not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'general_meeting_participants' and cmd = 'SELECT'
      and coalesce(qual, '') like '%is_owner%'
  ) then 'OK' else 'FAIL' end

union all
select 'participants_admin_only_select', 'has_staff_role / can_manage',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'general_meeting_participants' and cmd = 'SELECT'
      and (coalesce(qual, '') like '%can_manage_building_governance%' or coalesce(qual, '') like '%has_staff_role%')
  ) then 'OK' else 'FAIL' end
;
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
writeFileSync(join(dir, 'documents_decisions_hotfix.sql'), hotfix, { encoding: 'utf8' });
writeFileSync(join(dir, 'documents_decisions_verify.sql'), verify, { encoding: 'utf8' });
console.log('wrote documents_decisions sql');
