-- Meeting Core Stage 1–6 domain (local migration ONLY — do not db push without explicit command)
-- Evolve in-place on general_meetings*. Property Book remains SoT.

begin;

-- ---------------------------------------------------------------------------
-- Ruleset
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_rulesets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  version_label text not null,
  effective_from date not null default current_date,
  rules_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.meeting_rulesets (code, title, version_label, rules_json)
values (
  'BG_ZUES_2026_09',
  'ЗУЕС / Bulgaria condominium meeting rules',
  '2026-09',
  jsonb_build_object(
    'notice_days_ordinary', 7,
    'notice_hours_urgent', 24,
    'earliest_meeting_days_ordinary', 8,
    'earliest_meeting_hours_urgent', 24,
    'quorum_initial_percent', 51,
    'quorum_dominant_initial_percent', 75,
    'dominant_owner_threshold_percent', 51,
    'quorum_after_one_hour_percent', 26,
    'proxy_max_principals', 3,
    'protocol_days_after_meeting', 7,
    'absentee_days', 7,
    'absentee_forbidden_categories', jsonb_build_array('election_management', 'election_control'),
    'majority_codes', jsonb_build_array(
      'unanimous_all_ideal_parts',
      'at_least_75_all_ideal_parts',
      'at_least_75_eligible_ideal_parts',
      'at_least_51_all_ideal_parts',
      'more_than_50_all_ideal_parts',
      'more_than_50_represented_ideal_parts',
      'more_than_half_independent_units'
    ),
    'manager_term_years_max', 2,
    'board_min_members', 3,
    'board_odd_required', true,
    'control_term_years', 2,
    'needs_legal_signoff', true
  )
)
on conflict (code) do update
  set title = excluded.title,
      version_label = excluded.version_label,
      rules_json = excluded.rules_json,
      active = true;

-- ---------------------------------------------------------------------------
-- Extend general_meetings
-- ---------------------------------------------------------------------------

alter table public.general_meetings
  add column if not exists ruleset_id uuid null
    references public.meeting_rulesets (id) on delete restrict;

alter table public.general_meetings
  add column if not exists legal_state text null;

alter table public.general_meetings
  add column if not exists meeting_type text null;

alter table public.general_meetings
  add column if not exists legal_convener_kind text null;

alter table public.general_meetings
  add column if not exists legal_convener_note text null;

alter table public.general_meetings
  add column if not exists invitation_locked_at timestamptz null;

alter table public.general_meetings
  add column if not exists ownership_drift_alert boolean not null default false;

alter table public.general_meetings
  add column if not exists ownership_drift_detail text null;

alter table public.general_meetings
  add column if not exists check_in_blocked_reason text null;

alter table public.general_meetings
  add column if not exists show_live_results boolean not null default false;

alter table public.general_meetings
  add column if not exists filing_regime text null;

alter table public.general_meetings
  add column if not exists filing_status text null;

alter table public.general_meetings
  add column if not exists hybrid_house_rules_ok boolean not null default false;

update public.general_meetings as m
   set ruleset_id = r.id
  from public.meeting_rulesets as r
 where m.ruleset_id is null
   and r.code = 'BG_ZUES_2026_09';

update public.general_meetings
   set legal_state = case
     when status = 'draft' then 'DRAFT'
     when status = 'cancelled' then 'CANCELLED'
     when status = 'rescheduled' then 'CANCELLED'
     when status = 'minutes_ready' then 'PROTOCOL_SIGNED'
     when status = 'archived' then 'CLOSED'
     when status = 'held' then 'MEETING_FINISHED'
     when status = 'published' and operational_phase = 'registration' then 'CHECK_IN_OPEN'
     when status = 'published' and operational_phase = 'in_progress' then 'MEETING_IN_PROGRESS'
     when status = 'published' and operational_phase = 'closed' then 'MEETING_FINISHED'
     when status = 'published' then 'WAITING_FOR_MEETING'
     else coalesce(legal_state, 'DRAFT')
   end
 where legal_state is null;

update public.general_meetings
   set meeting_type = coalesce(meeting_type, case when is_urgent then 'URGENT' else 'EXTRAORDINARY' end)
 where meeting_type is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'general_meetings_meeting_type_chk'
  ) then
    alter table public.general_meetings
      add constraint general_meetings_meeting_type_chk
      check (meeting_type is null or meeting_type in (
        'REPORTING', 'REPORTING_ELECTION', 'EXTRAORDINARY', 'URGENT'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'general_meetings_filing_regime_chk'
  ) then
    alter table public.general_meetings
      add constraint general_meetings_filing_regime_chk
      check (filing_regime is null or filing_regime in ('LEGACY_MUNICIPAL', 'EISES_REGISTRY'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invitation versions
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_invitation_versions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  version_no integer not null,
  generated_at timestamptz not null default now(),
  locked_at timestamptz null,
  content_hash text not null,
  legal_deadline_basis text null,
  title_bg text null,
  body_bg text null,
  title_ru text null,
  body_ru text null,
  title_en text null,
  body_en text null,
  pdf_document_id bigint null,
  supersedes_version_id uuid null
    references public.meeting_invitation_versions (id) on delete set null,
  posted_at timestamptz null,
  posted_place text null,
  posting_photo_url text null,
  posting_protocol_document_id bigint null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint meeting_invitation_versions_meeting_ver_uidx unique (meeting_id, version_no),
  constraint meeting_invitation_versions_hash_nonempty check (length(btrim(content_hash)) > 0)
);

create index if not exists meeting_invitation_versions_meeting_idx
  on public.meeting_invitation_versions (meeting_id, version_no desc);

-- ---------------------------------------------------------------------------
-- Dual snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_notice_snapshots (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.general_meetings (id) on delete cascade,
  frozen_at timestamptz not null default now(),
  roster_hash text not null,
  total_ideal_parts_percent numeric(14, 6) not null default 0,
  object_count integer not null default 0,
  party_count integer not null default 0,
  created_by_email text null,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_notice_snapshot_parties (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.meeting_notice_snapshots (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete restrict,
  registry_people_id bigint null,
  apartment_number bigint null,
  party_email text null,
  party_name text null,
  ideal_parts_percent numeric(14, 6) not null default 0,
  ownership_share_percent numeric(14, 6) null,
  relation_type text null
);

create index if not exists meeting_notice_snapshot_parties_snap_idx
  on public.meeting_notice_snapshot_parties (snapshot_id);

create table if not exists public.meeting_voting_snapshots (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.general_meetings (id) on delete cascade,
  frozen_at timestamptz not null default now(),
  roster_hash text not null,
  total_ideal_parts_percent numeric(14, 6) not null default 0,
  object_count integer not null default 0,
  party_count integer not null default 0,
  dominant_owner_over_51 boolean not null default false,
  created_by_email text null,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_voting_snapshot_parties (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.meeting_voting_snapshots (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete restrict,
  registry_people_id bigint null,
  apartment_number bigint null,
  party_email text null,
  party_name text null,
  ideal_parts_percent numeric(14, 6) not null default 0,
  ownership_share_percent numeric(14, 6) null,
  relation_type text null,
  representable_right_key text not null,
  constraint meeting_voting_snapshot_parties_right_uidx unique (snapshot_id, representable_right_key)
);

create index if not exists meeting_voting_snapshot_parties_snap_idx
  on public.meeting_voting_snapshot_parties (snapshot_id);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_audit_log (
  id bigserial primary key,
  meeting_id uuid null references public.general_meetings (id) on delete set null,
  action text not null,
  actor_email text null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists meeting_audit_log_meeting_idx
  on public.meeting_audit_log (meeting_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Stage 2: notifications
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_notifications (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  kind text not null,
  channel text not null,
  recipient_email text null,
  recipient_snapshot jsonb not null default '{}'::jsonb,
  provider_id text null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'failed', 'skipped')),
  error_text text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint meeting_notifications_kind_chk check (kind in (
    'INVITATION', 'MEETING_REMINDER_7D', 'MEETING_REMINDER_3D', 'MEETING_REMINDER_1D',
    'PROTOCOL_READY', 'CANCELLATION', 'OWNERSHIP_CHANGE_ALERT', 'DEADLINE_ADMIN'
  )),
  constraint meeting_notifications_channel_chk check (channel in (
    'email', 'in_app', 'system', 'sms', 'other'
  ))
);

create index if not exists meeting_notifications_meeting_idx
  on public.meeting_notifications (meeting_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Stage 3: proxies
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_proxies (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  principal_property_id bigint not null references public.properties (id) on delete restrict,
  principal_registry_people_id bigint null,
  representative_email text null,
  representative_name text not null,
  document_id bigint null,
  source text not null default 'admin_paper'
    check (source in ('owner_self_service', 'admin_paper')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'revoked', 'rejected')),
  created_by_email text null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists meeting_proxies_meeting_idx
  on public.meeting_proxies (meeting_id);

create index if not exists meeting_proxies_rep_idx
  on public.meeting_proxies (meeting_id, lower(representative_name));

-- ---------------------------------------------------------------------------
-- Stage 4: absentee declarations
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_absentee_declarations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  agenda_item_id uuid not null references public.general_meeting_agenda_items (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete restrict,
  registry_people_id bigint null,
  vote text not null check (vote in ('for', 'against', 'abstain')),
  document_id bigint null,
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected')),
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint meeting_absentee_unique_right unique (agenda_item_id, property_id, registry_people_id)
);

-- ---------------------------------------------------------------------------
-- Stage 5: protocol
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_protocols (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.general_meetings (id) on delete cascade,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SIGNING', 'SIGNED')),
  content_hash text null,
  body_bg text null,
  body_ru text null,
  body_en text null,
  document_id bigint null,
  signed_at timestamptz null,
  signature_mode text null
    check (signature_mode is null or signature_mode in (
      'WET_SCAN', 'INTERNAL_ACKNOWLEDGEMENT', 'ADVANCED_PROVIDER', 'QES'
    )),
  wet_scan_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_documents (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  doc_type text not null,
  title text not null,
  building_document_id bigint null,
  content_hash text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint meeting_documents_type_chk check (doc_type in (
    'convene_basis', 'invitation', 'invitation_posting_protocol', 'notification_register',
    'attendance_sheet', 'proxy', 'online_participant_register', 'quorum_report',
    'voting_sheet', 'absentee_declaration', 'final_protocol', 'protocol_attachment',
    'protocol_ready_announcement', 'announcement_posting_protocol', 'certified_copy',
    'decision_extract', 'board_chairman_election_protocol', 'control_chairman_election_protocol',
    'municipality_eises_package', 'bank_authorization', 'handover_protocol',
    'registration_confirmation', 'other'
  ))
);

create index if not exists meeting_documents_meeting_idx
  on public.meeting_documents (meeting_id, doc_type);

-- ---------------------------------------------------------------------------
-- Stage 6: candidates, governance, challenges
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_candidates (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  election_type text not null
    check (election_type in (
      'manager', 'management_board', 'control_board', 'controller', 'cashier', 'other'
    )),
  display_name text not null,
  registry_people_id bigint null,
  status text not null default 'DRAFT'
    check (status in (
      'DRAFT', 'VERIFIED', 'INCLUDED_IN_AGENDA', 'LOCKED', 'VOTED', 'ELECTED', 'NOT_ELECTED'
    )),
  agenda_item_id uuid null references public.general_meeting_agenda_items (id) on delete set null,
  locked_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.governance_terms (
  id uuid primary key default gen_random_uuid(),
  body_kind text not null
    check (body_kind in ('manager', 'management_board', 'control_board', 'controller', 'cashier')),
  started_at date not null,
  ends_at date null,
  meeting_id uuid null references public.general_meetings (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'ended', 'void')),
  created_at timestamptz not null default now()
);

create table if not exists public.governance_members (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.governance_terms (id) on delete cascade,
  display_name text not null,
  role_in_body text null,
  registry_people_id bigint null,
  is_chair boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_challenges (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'closed', 'legal_hold')),
  reason text not null,
  legal_hold boolean not null default false,
  document_id bigint null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  closed_at timestamptz null
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.meeting_rulesets enable row level security;
alter table public.meeting_invitation_versions enable row level security;
alter table public.meeting_notice_snapshots enable row level security;
alter table public.meeting_notice_snapshot_parties enable row level security;
alter table public.meeting_voting_snapshots enable row level security;
alter table public.meeting_voting_snapshot_parties enable row level security;
alter table public.meeting_audit_log enable row level security;
alter table public.meeting_notifications enable row level security;
alter table public.meeting_proxies enable row level security;
alter table public.meeting_absentee_declarations enable row level security;
alter table public.meeting_protocols enable row level security;
alter table public.meeting_documents enable row level security;
alter table public.meeting_candidates enable row level security;
alter table public.governance_terms enable row level security;
alter table public.governance_members enable row level security;
alter table public.meeting_challenges enable row level security;

revoke all on table public.meeting_rulesets from public, anon;
revoke all on table public.meeting_invitation_versions from public, anon;
revoke all on table public.meeting_notice_snapshots from public, anon;
revoke all on table public.meeting_notice_snapshot_parties from public, anon;
revoke all on table public.meeting_voting_snapshots from public, anon;
revoke all on table public.meeting_voting_snapshot_parties from public, anon;
revoke all on table public.meeting_audit_log from public, anon;
revoke all on table public.meeting_notifications from public, anon;
revoke all on table public.meeting_proxies from public, anon;
revoke all on table public.meeting_absentee_declarations from public, anon;
revoke all on table public.meeting_protocols from public, anon;
revoke all on table public.meeting_documents from public, anon;
revoke all on table public.meeting_candidates from public, anon;
revoke all on table public.governance_terms from public, anon;
revoke all on table public.governance_members from public, anon;
revoke all on table public.meeting_challenges from public, anon;

grant select on table public.meeting_rulesets to authenticated;
grant select on table public.meeting_invitation_versions to authenticated;
grant select on table public.meeting_notice_snapshots to authenticated;
grant select on table public.meeting_voting_snapshots to authenticated;
grant select on table public.meeting_proxies to authenticated;
grant select on table public.meeting_protocols to authenticated;
grant select on table public.meeting_documents to authenticated;
grant select on table public.meeting_candidates to authenticated;
grant select on table public.governance_terms to authenticated;
grant select on table public.governance_members to authenticated;

drop policy if exists meeting_rulesets_select on public.meeting_rulesets;
create policy meeting_rulesets_select on public.meeting_rulesets
  for select to authenticated using (true);

drop policy if exists meeting_invitation_versions_select on public.meeting_invitation_versions;
create policy meeting_invitation_versions_select on public.meeting_invitation_versions
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (
      select 1 from public.properties as p where public.owns_property(p.id)
    )
  );

drop policy if exists meeting_notice_snapshots_select on public.meeting_notice_snapshots;
create policy meeting_notice_snapshots_select on public.meeting_notice_snapshots
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

drop policy if exists meeting_voting_snapshots_select on public.meeting_voting_snapshots;
create policy meeting_voting_snapshots_select on public.meeting_voting_snapshots
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

drop policy if exists meeting_proxies_select on public.meeting_proxies;
create policy meeting_proxies_select on public.meeting_proxies
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or public.owns_property(principal_property_id)
    or (
      representative_email is not null
      and lower(btrim(representative_email)) = lower(btrim(coalesce(auth.email(), '')))
    )
  );

drop policy if exists meeting_protocols_select on public.meeting_protocols;
create policy meeting_protocols_select on public.meeting_protocols
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

drop policy if exists meeting_documents_select on public.meeting_documents;
create policy meeting_documents_select on public.meeting_documents
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

drop policy if exists meeting_candidates_select on public.meeting_candidates;
create policy meeting_candidates_select on public.meeting_candidates
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

drop policy if exists governance_terms_select on public.governance_terms;
create policy governance_terms_select on public.governance_terms
  for select to authenticated using (true);

drop policy if exists governance_members_select on public.governance_members;
create policy governance_members_select on public.governance_members
  for select to authenticated using (true);

-- Admin-only tables (no owner policy = deny by default under RLS)
drop policy if exists meeting_audit_log_admin on public.meeting_audit_log;
create policy meeting_audit_log_admin on public.meeting_audit_log
  for select to authenticated using (public.can_manage_building_governance());

drop policy if exists meeting_notifications_admin on public.meeting_notifications;
create policy meeting_notifications_admin on public.meeting_notifications
  for select to authenticated using (public.can_manage_building_governance());

drop policy if exists meeting_challenges_select on public.meeting_challenges;
create policy meeting_challenges_select on public.meeting_challenges
  for select to authenticated
  using (
    public.can_manage_building_governance()
    or exists (select 1 from public.properties as p where public.owns_property(p.id))
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.gm_audit(
  p_meeting_id uuid,
  p_action text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.meeting_audit_log (meeting_id, action, actor_email, detail)
  values (
    p_meeting_id,
    p_action,
    lower(nullif(btrim(coalesce(auth.email(), '')), '')),
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.gm_audit(uuid, text, jsonb) from public, anon;

create or replace function public.gm_book_roster_hash()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(x.k, '|' order by x.k), ''))
  from (
    select
      p.id::text || ':' || coalesce(r.id::text, 'prop') || ':' ||
      coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::text || ':' ||
      lower(coalesce(r.email, p.owner_email, '')) as k
    from public.properties as p
    left join public.property_registry_people as r
      on r.property_id = p.id
     and r.relation_type = 'owner'
     and r.deregistered_at is null
  ) as x;
$$;

revoke all on function public.gm_book_roster_hash() from public, anon;

create or replace function public.gm_default_ruleset_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.meeting_rulesets as r
  where r.code = 'BG_ZUES_2026_09' and r.active is true
  limit 1;
$$;

revoke all on function public.gm_default_ruleset_id() from public, anon;

-- Freeze notice snapshot from Property Book
create or replace function public.gm_freeze_notice_snapshot(p_meeting_id uuid)
returns public.meeting_notice_snapshots
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_hash text;
  v_snap public.meeting_notice_snapshots%rowtype;
  v_total numeric := 0;
  v_objects integer := 0;
  v_parties integer := 0;
begin
  if v_email is null then
    raise exception 'gm_freeze_notice_snapshot: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'gm_freeze_notice_snapshot: not allowed' using errcode = '42501';
  end if;
  if p_meeting_id is null then
    raise exception 'gm_freeze_notice_snapshot: meeting required' using errcode = '22023';
  end if;
  if exists (select 1 from public.meeting_notice_snapshots as s where s.meeting_id = p_meeting_id) then
    raise exception 'gm_freeze_notice_snapshot: already frozen' using errcode = 'P0001';
  end if;

  v_hash := public.gm_book_roster_hash();

  insert into public.meeting_notice_snapshots (
    meeting_id, roster_hash, created_by_email
  ) values (
    p_meeting_id, v_hash, v_email
  )
  returning * into v_snap;

  insert into public.meeting_notice_snapshot_parties (
    snapshot_id, property_id, registry_people_id, apartment_number,
    party_email, party_name, ideal_parts_percent, ownership_share_percent, relation_type
  )
  select
    v_snap.id,
    p.id,
    r.id,
    p.apartment_number,
    coalesce(r.email, p.owner_email),
    nullif(btrim(concat_ws(' ', r.first_name, r.last_name)), ''),
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0),
    r.ownership_share_percent,
    coalesce(r.relation_type, 'owner')
  from public.properties as p
  left join public.property_registry_people as r
    on r.property_id = p.id
   and r.relation_type = 'owner'
   and r.deregistered_at is null;

  select
    coalesce(sum(sp.ideal_parts_percent), 0),
    count(distinct sp.property_id)::integer,
    count(*)::integer
  into v_total, v_objects, v_parties
  from public.meeting_notice_snapshot_parties as sp
  where sp.snapshot_id = v_snap.id;

  update public.meeting_notice_snapshots as s
     set total_ideal_parts_percent = v_total,
         object_count = v_objects,
         party_count = v_parties
   where s.id = v_snap.id
  returning * into v_snap;

  perform public.gm_audit(p_meeting_id, 'NOTICE_SNAPSHOT_FROZEN', jsonb_build_object(
    'snapshot_id', v_snap.id, 'roster_hash', v_hash
  ));
  return v_snap;
end;
$fn$;

revoke all on function public.gm_freeze_notice_snapshot(uuid) from public, anon;
grant execute on function public.gm_freeze_notice_snapshot(uuid) to authenticated;

-- Freeze voting snapshot
create or replace function public.gm_freeze_voting_snapshot(p_meeting_id uuid)
returns public.meeting_voting_snapshots
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_hash text;
  v_snap public.meeting_voting_snapshots%rowtype;
  v_total numeric := 0;
  v_objects integer := 0;
  v_parties integer := 0;
  v_dominant boolean := false;
  v_notice_hash text;
begin
  if v_email is null then
    raise exception 'gm_freeze_voting_snapshot: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'gm_freeze_voting_snapshot: not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.meeting_voting_snapshots as s where s.meeting_id = p_meeting_id) then
    raise exception 'gm_freeze_voting_snapshot: already frozen' using errcode = 'P0001';
  end if;

  v_hash := public.gm_book_roster_hash();
  select s.roster_hash into v_notice_hash
  from public.meeting_notice_snapshots as s
  where s.meeting_id = p_meeting_id;

  if v_notice_hash is not null and v_notice_hash is distinct from v_hash then
    update public.general_meetings as m
       set ownership_drift_alert = true,
           ownership_drift_detail = 'OWNERSHIP_CHANGED_AFTER_INVITATION',
           check_in_blocked_reason = 'OWNERSHIP_CHANGED_AFTER_INVITATION',
           updated_at = now()
     where m.id = p_meeting_id;
    perform public.gm_audit(p_meeting_id, 'OWNERSHIP_CHANGED_AFTER_INVITATION', jsonb_build_object(
      'notice_hash', v_notice_hash, 'voting_hash', v_hash
    ));
    raise exception 'gm_freeze_voting_snapshot: OWNERSHIP_CHANGED_AFTER_INVITATION'
      using errcode = 'P0001';
  end if;

  insert into public.meeting_voting_snapshots (
    meeting_id, roster_hash, created_by_email
  ) values (
    p_meeting_id, v_hash, v_email
  )
  returning * into v_snap;

  insert into public.meeting_voting_snapshot_parties (
    snapshot_id, property_id, registry_people_id, apartment_number,
    party_email, party_name, ideal_parts_percent, ownership_share_percent,
    relation_type, representable_right_key
  )
  select
    v_snap.id,
    p.id,
    r.id,
    p.apartment_number,
    coalesce(r.email, p.owner_email),
    nullif(btrim(concat_ws(' ', r.first_name, r.last_name)), ''),
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0),
    r.ownership_share_percent,
    coalesce(r.relation_type, 'owner'),
    p.id::text || ':' || coalesce(r.id::text, 'prop')
  from public.properties as p
  left join public.property_registry_people as r
    on r.property_id = p.id
   and r.relation_type = 'owner'
   and r.deregistered_at is null;

  select
    coalesce(sum(sp.ideal_parts_percent), 0),
    count(distinct sp.property_id)::integer,
    count(*)::integer,
    exists (
      select 1
      from public.meeting_voting_snapshot_parties as q
      where q.snapshot_id = v_snap.id
        and q.ideal_parts_percent > 51
    )
  into v_total, v_objects, v_parties, v_dominant
  from public.meeting_voting_snapshot_parties as sp
  where sp.snapshot_id = v_snap.id;

  update public.meeting_voting_snapshots as s
     set total_ideal_parts_percent = v_total,
         object_count = v_objects,
         party_count = v_parties,
         dominant_owner_over_51 = v_dominant
   where s.id = v_snap.id
  returning * into v_snap;

  update public.general_meetings as m
     set ownership_drift_alert = false,
         ownership_drift_detail = null,
         check_in_blocked_reason = null,
         updated_at = now()
   where m.id = p_meeting_id
     and coalesce(m.check_in_blocked_reason, '') = 'OWNERSHIP_CHANGED_AFTER_INVITATION';

  perform public.gm_audit(p_meeting_id, 'VOTING_SNAPSHOT_FROZEN', jsonb_build_object(
    'snapshot_id', v_snap.id, 'dominant_owner_over_51', v_dominant
  ));
  return v_snap;
end;
$fn$;

revoke all on function public.gm_freeze_voting_snapshot(uuid) from public, anon;
grant execute on function public.gm_freeze_voting_snapshot(uuid) to authenticated;

create or replace function public.gm_detect_ownership_drift(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_notice text;
  v_current text;
  v_drift boolean;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_detect_ownership_drift: not allowed' using errcode = '42501';
  end if;
  select s.roster_hash into v_notice
  from public.meeting_notice_snapshots as s
  where s.meeting_id = p_meeting_id;
  if v_notice is null then
    return jsonb_build_object('has_notice_snapshot', false, 'drift', false);
  end if;
  v_current := public.gm_book_roster_hash();
  v_drift := v_notice is distinct from v_current;
  if v_drift then
    update public.general_meetings as m
       set ownership_drift_alert = true,
           ownership_drift_detail = 'OWNERSHIP_CHANGED_AFTER_INVITATION',
           check_in_blocked_reason = 'OWNERSHIP_CHANGED_AFTER_INVITATION',
           updated_at = now()
     where m.id = p_meeting_id;
    perform public.gm_audit(p_meeting_id, 'OWNERSHIP_CHANGED_AFTER_INVITATION', jsonb_build_object(
      'notice_hash', v_notice, 'current_hash', v_current
    ));
  end if;
  return jsonb_build_object(
    'has_notice_snapshot', true,
    'drift', v_drift,
    'notice_hash', v_notice,
    'current_hash', v_current
  );
end;
$fn$;

revoke all on function public.gm_detect_ownership_drift(uuid) from public, anon;
grant execute on function public.gm_detect_ownership_drift(uuid) to authenticated;

-- Allowed transitions (subset for foundation; expanded later)
create or replace function public.gm_transition(
  p_meeting_id uuid,
  p_to_state text,
  p_note text default null
)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings%rowtype;
  v_from text;
  v_to text := upper(nullif(btrim(coalesce(p_to_state, '')), ''));
  v_ok boolean := false;
begin
  if auth.email() is null then
    raise exception 'gm_transition: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'gm_transition: not allowed' using errcode = '42501';
  end if;
  if v_to is null then
    raise exception 'gm_transition: state required' using errcode = '22023';
  end if;

  select m.* into v_row
  from public.general_meetings as m
  where m.id = p_meeting_id
  for update;
  if not found then
    raise exception 'gm_transition: not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.meeting_challenges as c
    where c.meeting_id = p_meeting_id and c.legal_hold is true and c.status = 'legal_hold'
  ) and v_to not in ('DISPUTED', 'LEGAL_HOLD', 'CLOSED') then
    raise exception 'gm_transition: LEGAL_HOLD' using errcode = 'P0001';
  end if;

  v_from := coalesce(v_row.legal_state, 'DRAFT');

  if v_to = 'CHECK_IN_OPEN' and coalesce(v_row.check_in_blocked_reason, '') <> '' then
    raise exception 'gm_transition: check-in blocked: %', v_row.check_in_blocked_reason
      using errcode = 'P0001';
  end if;

  -- Permitted edges (foundation + later stages)
  if (v_from, v_to) in (
    ('DRAFT', 'PRECHECK'),
    ('PRECHECK', 'SCHEDULED'),
    ('SCHEDULED', 'AGENDA_READY'),
    ('AGENDA_READY', 'INVITATION_READY'),
    ('INVITATION_READY', 'INVITATION_LOCKED'),
    ('INVITATION_LOCKED', 'INVITATION_POSTED'),
    ('INVITATION_POSTED', 'NOTIFICATION_RUNNING'),
    ('NOTIFICATION_RUNNING', 'WAITING_FOR_MEETING'),
    ('WAITING_FOR_MEETING', 'CHECK_IN_OPEN'),
    ('CHECK_IN_OPEN', 'VOTING_SNAPSHOT_LOCKED'),
    ('VOTING_SNAPSHOT_LOCKED', 'QUORUM_CHECK'),
    ('QUORUM_CHECK', 'MEETING_IN_PROGRESS'),
    ('QUORUM_CHECK', 'ADJOURNED_1_HOUR'),
    ('ADJOURNED_1_HOUR', 'QUORUM_CHECK'),
    ('ADJOURNED_1_HOUR', 'ADJOURNED_NEXT_SESSION'),
    ('ADJOURNED_NEXT_SESSION', 'QUORUM_CHECK'),
    ('MEETING_IN_PROGRESS', 'MEETING_FINISHED'),
    ('MEETING_FINISHED', 'ABSENTEE_VOTING'),
    ('MEETING_FINISHED', 'PROTOCOL_DRAFT'),
    ('ABSENTEE_VOTING', 'PROTOCOL_DRAFT'),
    ('PROTOCOL_DRAFT', 'PROTOCOL_SIGNING'),
    ('PROTOCOL_SIGNING', 'PROTOCOL_SIGNED'),
    ('PROTOCOL_SIGNED', 'PROTOCOL_NOTICE_POSTED'),
    ('PROTOCOL_NOTICE_POSTED', 'CHALLENGE_WINDOW'),
    ('CHALLENGE_WINDOW', 'CLOSED'),
    ('CHALLENGE_WINDOW', 'DISPUTED'),
    ('DISPUTED', 'LEGAL_HOLD'),
    ('LEGAL_HOLD', 'CLOSED'),
    ('DRAFT', 'CANCELLED'),
    ('PRECHECK', 'CANCELLED'),
    ('SCHEDULED', 'CANCELLED'),
    ('AGENDA_READY', 'CANCELLED'),
    ('INVITATION_READY', 'CANCELLED'),
    ('INVITATION_LOCKED', 'CANCELLED'),
    ('INVITATION_POSTED', 'CANCELLED'),
    ('NOTIFICATION_RUNNING', 'CANCELLED'),
    ('WAITING_FOR_MEETING', 'CANCELLED')
  ) then
    v_ok := true;
  end if;

  -- Compat: allow jumping DRAFT -> INVITATION_LOCKED when publishing path
  if not v_ok and v_from = 'DRAFT' and v_to = 'WAITING_FOR_MEETING' then
    v_ok := true;
  end if;
  if not v_ok and v_from = 'WAITING_FOR_MEETING' and v_to = 'MEETING_IN_PROGRESS' then
    v_ok := true;
  end if;

  if not v_ok then
    raise exception 'gm_transition: invalid % -> %', v_from, v_to using errcode = 'P0001';
  end if;

  update public.general_meetings as m
     set legal_state = v_to,
         invitation_locked_at = case
           when v_to = 'INVITATION_LOCKED' then coalesce(m.invitation_locked_at, now())
           else m.invitation_locked_at
         end,
         status = case
           when v_to = 'CANCELLED' then 'cancelled'
           when v_to in ('PROTOCOL_SIGNED', 'PROTOCOL_NOTICE_POSTED', 'CHALLENGE_WINDOW') then 'minutes_ready'
           when v_to = 'CLOSED' then 'archived'
           when v_to in ('MEETING_FINISHED', 'ABSENTEE_VOTING', 'PROTOCOL_DRAFT', 'PROTOCOL_SIGNING') then 'held'
           when v_to in ('CHECK_IN_OPEN', 'VOTING_SNAPSHOT_LOCKED', 'QUORUM_CHECK', 'MEETING_IN_PROGRESS',
                         'ADJOURNED_1_HOUR', 'ADJOURNED_NEXT_SESSION', 'WAITING_FOR_MEETING',
                         'INVITATION_LOCKED', 'INVITATION_POSTED', 'NOTIFICATION_RUNNING') then 'published'
           when v_to in ('DRAFT', 'PRECHECK', 'SCHEDULED', 'AGENDA_READY', 'INVITATION_READY') then 'draft'
           else m.status
         end,
         operational_phase = case
           when v_to = 'CHECK_IN_OPEN' then 'registration'
           when v_to in ('MEETING_IN_PROGRESS', 'QUORUM_CHECK', 'VOTING_SNAPSHOT_LOCKED') then 'in_progress'
           when v_to in ('MEETING_FINISHED', 'PROTOCOL_DRAFT', 'PROTOCOL_SIGNING', 'PROTOCOL_SIGNED',
                         'PROTOCOL_NOTICE_POSTED', 'CHALLENGE_WINDOW', 'CLOSED', 'CANCELLED') then 'closed'
           else m.operational_phase
         end,
         updated_at = now()
   where m.id = p_meeting_id
  returning * into v_row;

  perform public.gm_audit(p_meeting_id, 'STATE_TRANSITION', jsonb_build_object(
    'from', v_from, 'to', v_to, 'note', p_note
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_transition(uuid, text, text) from public, anon;
grant execute on function public.gm_transition(uuid, text, text) to authenticated;

-- Invitation version lock
create or replace function public.gm_lock_invitation_version(
  p_meeting_id uuid,
  p_title_bg text,
  p_body_bg text,
  p_title_ru text default null,
  p_body_ru text default null,
  p_title_en text default null,
  p_body_en text default null
)
returns public.meeting_invitation_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_ver integer;
  v_hash text;
  v_row public.meeting_invitation_versions%rowtype;
  v_prev uuid;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_lock_invitation_version: not allowed' using errcode = '42501';
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_ver
  from public.meeting_invitation_versions as v
  where v.meeting_id = p_meeting_id;

  select v.id into v_prev
  from public.meeting_invitation_versions as v
  where v.meeting_id = p_meeting_id
  order by v.version_no desc
  limit 1;

  v_hash := md5(
    coalesce(p_title_bg, '') || '|' || coalesce(p_body_bg, '') || '|' ||
    coalesce(p_title_ru, '') || '|' || coalesce(p_body_ru, '') || '|' ||
    coalesce(p_title_en, '') || '|' || coalesce(p_body_en, '')
  );

  insert into public.meeting_invitation_versions (
    meeting_id, version_no, locked_at, content_hash,
    title_bg, body_bg, title_ru, body_ru, title_en, body_en,
    supersedes_version_id, created_by_email, legal_deadline_basis
  ) values (
    p_meeting_id, v_ver, now(), v_hash,
    p_title_bg, p_body_bg, p_title_ru, p_body_ru, p_title_en, p_body_en,
    v_prev, v_email, 'BG_ZUES_2026_09'
  )
  returning * into v_row;

  update public.general_meetings as m
     set invitation_locked_at = coalesce(m.invitation_locked_at, now()),
         legal_state = case
           when coalesce(m.legal_state, 'DRAFT') in ('DRAFT', 'PRECHECK', 'SCHEDULED', 'AGENDA_READY', 'INVITATION_READY')
             then 'INVITATION_LOCKED'
           else m.legal_state
         end,
         updated_at = now()
   where m.id = p_meeting_id;

  if not exists (select 1 from public.meeting_notice_snapshots as s where s.meeting_id = p_meeting_id) then
    perform public.gm_freeze_notice_snapshot(p_meeting_id);
  end if;

  perform public.gm_audit(p_meeting_id, 'INVITATION_LOCKED', jsonb_build_object(
    'version_id', v_row.id, 'version_no', v_ver, 'content_hash', v_hash
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_lock_invitation_version(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.gm_lock_invitation_version(uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.gm_record_invitation_posting(
  p_meeting_id uuid,
  p_posted_at timestamptz,
  p_posted_place text,
  p_photo_url text default null
)
returns public.meeting_invitation_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_invitation_versions%rowtype;
  v_urgent boolean;
  v_earliest timestamptz;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_record_invitation_posting: not allowed' using errcode = '42501';
  end if;

  select v.* into v_row
  from public.meeting_invitation_versions as v
  where v.meeting_id = p_meeting_id
  order by v.version_no desc
  limit 1
  for update;
  if not found or v_row.locked_at is null then
    raise exception 'gm_record_invitation_posting: lock invitation first' using errcode = 'P0001';
  end if;

  select m.is_urgent into v_urgent from public.general_meetings as m where m.id = p_meeting_id;
  if coalesce(v_urgent, false) then
    v_earliest := p_posted_at + interval '24 hours';
  else
    v_earliest := p_posted_at + interval '7 days';
  end if;

  update public.meeting_invitation_versions as v
     set posted_at = p_posted_at,
         posted_place = nullif(btrim(coalesce(p_posted_place, '')), ''),
         posting_photo_url = p_photo_url
   where v.id = v_row.id
  returning * into v_row;

  update public.general_meetings as m
     set invitation_posted_at = coalesce(m.invitation_posted_at, p_posted_at),
         legal_state = case
           when coalesce(m.legal_state, '') in ('INVITATION_LOCKED', 'INVITATION_READY') then 'INVITATION_POSTED'
           else m.legal_state
         end,
         updated_at = now()
   where m.id = p_meeting_id;

  perform public.gm_audit(p_meeting_id, 'INVITATION_POSTED', jsonb_build_object(
    'version_id', v_row.id,
    'posted_at', p_posted_at,
    'earliest_meeting_at', v_earliest
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_record_invitation_posting(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.gm_record_invitation_posting(uuid, timestamptz, text, text) to authenticated;

create or replace function public.gm_earliest_meeting_at(p_meeting_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_posted timestamptz;
  v_urgent boolean;
begin
  select v.posted_at, m.is_urgent
    into v_posted, v_urgent
  from public.general_meetings as m
  left join lateral (
    select iv.posted_at
    from public.meeting_invitation_versions as iv
    where iv.meeting_id = m.id
    order by iv.version_no desc
    limit 1
  ) as v on true
  where m.id = p_meeting_id;
  if v_posted is null then
    return null;
  end if;
  if coalesce(v_urgent, false) then
    return v_posted + interval '24 hours';
  end if;
  return v_posted + interval '7 days';
end;
$fn$;

revoke all on function public.gm_earliest_meeting_at(uuid) from public, anon;
grant execute on function public.gm_earliest_meeting_at(uuid) to authenticated;

-- Proxy create with max 3
create or replace function public.gm_create_proxy(
  p_meeting_id uuid,
  p_principal_property_id bigint,
  p_representative_name text,
  p_representative_email text default null,
  p_source text default 'admin_paper',
  p_principal_registry_people_id bigint default null
)
returns public.meeting_proxies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_representative_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_representative_email, '')), ''));
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'admin_paper');
  v_cnt integer;
  v_row public.meeting_proxies%rowtype;
  v_max integer := 3;
begin
  if auth.email() is null then
    raise exception 'gm_create_proxy: not authenticated' using errcode = '28000';
  end if;
  if v_source = 'admin_paper' then
    if not public.can_manage_building_governance() then
      raise exception 'gm_create_proxy: not allowed' using errcode = '42501';
    end if;
  else
    if not public.owns_property(p_principal_property_id)
       and not public.can_manage_building_governance() then
      raise exception 'gm_create_proxy: not allowed' using errcode = '42501';
    end if;
  end if;
  if v_name is null then
    raise exception 'gm_create_proxy: representative required' using errcode = '22023';
  end if;

  select coalesce((r.rules_json ->> 'proxy_max_principals')::integer, 3)
    into v_max
  from public.general_meetings as m
  join public.meeting_rulesets as r on r.id = m.ruleset_id
  where m.id = p_meeting_id;

  select count(*)::integer into v_cnt
  from public.meeting_proxies as p
  where p.meeting_id = p_meeting_id
    and p.status = 'active'
    and lower(p.representative_name) = lower(v_name);

  if v_cnt >= coalesce(v_max, 3) then
    raise exception 'gm_create_proxy: max % principals per representative', coalesce(v_max, 3)
      using errcode = 'P0001';
  end if;

  insert into public.meeting_proxies (
    meeting_id, principal_property_id, principal_registry_people_id,
    representative_name, representative_email, source, status, created_by_email
  ) values (
    p_meeting_id, p_principal_property_id, p_principal_registry_people_id,
    v_name, v_email, v_source, 'active',
    lower(nullif(btrim(coalesce(auth.email(), '')), ''))
  )
  returning * into v_row;

  perform public.gm_audit(p_meeting_id, 'PROXY_CREATED', jsonb_build_object('proxy_id', v_row.id));
  return v_row;
end;
$fn$;

revoke all on function public.gm_create_proxy(uuid, bigint, text, text, text, bigint) from public, anon;
grant execute on function public.gm_create_proxy(uuid, bigint, text, text, text, bigint) to authenticated;

-- Log notification (delivery log)
create or replace function public.gm_log_notification(
  p_meeting_id uuid,
  p_kind text,
  p_channel text,
  p_recipient_email text default null,
  p_recipient_snapshot jsonb default '{}'::jsonb,
  p_status text default 'sent',
  p_provider_id text default null,
  p_error text default null
)
returns public.meeting_notifications
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_notifications%rowtype;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_log_notification: not allowed' using errcode = '42501';
  end if;
  insert into public.meeting_notifications (
    meeting_id, kind, channel, recipient_email, recipient_snapshot,
    provider_id, status, error_text, sent_at
  ) values (
    p_meeting_id, p_kind, p_channel,
    lower(nullif(btrim(coalesce(p_recipient_email, '')), '')),
    coalesce(p_recipient_snapshot, '{}'::jsonb),
    p_provider_id,
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'sent'),
    p_error,
    case when coalesce(p_status, 'sent') in ('sent', 'delivered') then now() else null end
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.gm_log_notification(uuid, text, text, text, jsonb, text, text, text) from public, anon;
grant execute on function public.gm_log_notification(uuid, text, text, text, jsonb, text, text, text) to authenticated;

-- Protocol upsert / sign (WET_SCAN)
create or replace function public.gm_upsert_protocol_draft(
  p_meeting_id uuid,
  p_body_bg text,
  p_body_ru text default null,
  p_body_en text default null
)
returns public.meeting_protocols
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_protocols%rowtype;
  v_hash text;
  v_existing text;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_upsert_protocol_draft: not allowed' using errcode = '42501';
  end if;

  select p.status into v_existing
  from public.meeting_protocols as p
  where p.meeting_id = p_meeting_id;
  if v_existing = 'SIGNED' then
    raise exception 'gm_upsert_protocol_draft: signed protocol immutable' using errcode = 'P0001';
  end if;

  v_hash := md5(coalesce(p_body_bg, '') || '|' || coalesce(p_body_ru, '') || '|' || coalesce(p_body_en, ''));
  insert into public.meeting_protocols (meeting_id, status, body_bg, body_ru, body_en, content_hash)
  values (p_meeting_id, 'DRAFT', p_body_bg, p_body_ru, p_body_en, v_hash)
  on conflict (meeting_id) do update
    set body_bg = excluded.body_bg,
        body_ru = excluded.body_ru,
        body_en = excluded.body_en,
        content_hash = excluded.content_hash,
        status = 'DRAFT',
        updated_at = now()
  returning * into v_row;

  perform public.gm_audit(p_meeting_id, 'PROTOCOL_DRAFT', jsonb_build_object('protocol_id', v_row.id));
  return v_row;
end;
$fn$;

revoke all on function public.gm_upsert_protocol_draft(uuid, text, text, text) from public, anon;
grant execute on function public.gm_upsert_protocol_draft(uuid, text, text, text) to authenticated;

create or replace function public.gm_sign_protocol_wet_scan(
  p_meeting_id uuid,
  p_wet_scan_url text
)
returns public.meeting_protocols
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_protocols%rowtype;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_sign_protocol_wet_scan: not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_wet_scan_url, '')), '') is null then
    raise exception 'gm_sign_protocol_wet_scan: scan url required' using errcode = '22023';
  end if;
  update public.meeting_protocols as p
     set status = 'SIGNED',
         signature_mode = 'WET_SCAN',
         wet_scan_url = p_wet_scan_url,
         signed_at = now(),
         updated_at = now()
   where p.meeting_id = p_meeting_id
     and p.status in ('DRAFT', 'SIGNING')
  returning * into v_row;
  if not found then
    raise exception 'gm_sign_protocol_wet_scan: protocol not found or already signed'
      using errcode = 'P0001';
  end if;
  perform public.gm_transition(p_meeting_id, 'PROTOCOL_SIGNED', 'wet_scan');
  perform public.gm_audit(p_meeting_id, 'PROTOCOL_SIGNED', jsonb_build_object('mode', 'WET_SCAN'));
  return v_row;
end;
$fn$;

revoke all on function public.gm_sign_protocol_wet_scan(uuid, text) from public, anon;
grant execute on function public.gm_sign_protocol_wet_scan(uuid, text) to authenticated;

-- Challenge + legal hold
create or replace function public.gm_open_challenge(
  p_meeting_id uuid,
  p_reason text,
  p_legal_hold boolean default false
)
returns public.meeting_challenges
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_challenges%rowtype;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_open_challenge: not allowed' using errcode = '42501';
  end if;
  insert into public.meeting_challenges (
    meeting_id, reason, legal_hold, status, created_by_email
  ) values (
    p_meeting_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    coalesce(p_legal_hold, false),
    case when coalesce(p_legal_hold, false) then 'legal_hold' else 'open' end,
    lower(nullif(btrim(coalesce(auth.email(), '')), ''))
  )
  returning * into v_row;
  update public.general_meetings as m
     set legal_state = case when coalesce(p_legal_hold, false) then 'LEGAL_HOLD' else 'DISPUTED' end,
         updated_at = now()
   where m.id = p_meeting_id;
  perform public.gm_audit(p_meeting_id, 'CHALLENGE_OPENED', jsonb_build_object(
    'challenge_id', v_row.id, 'legal_hold', p_legal_hold
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_open_challenge(uuid, text, boolean) from public, anon;
grant execute on function public.gm_open_challenge(uuid, text, boolean) to authenticated;

-- Bind default ruleset on insert
create or replace function public.gm_meetings_bi_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.ruleset_id is null then
    new.ruleset_id := public.gm_default_ruleset_id();
  end if;
  if new.legal_state is null then
    new.legal_state := 'DRAFT';
  end if;
  if new.meeting_type is null then
    new.meeting_type := case when coalesce(new.is_urgent, false) then 'URGENT' else 'EXTRAORDINARY' end;
  end if;
  return new;
end;
$fn$;

drop trigger if exists gm_meetings_bi_defaults on public.general_meetings;
create trigger gm_meetings_bi_defaults
  before insert on public.general_meetings
  for each row
  execute function public.gm_meetings_bi_defaults();

-- Block direct legal_state updates except from SECURITY DEFINER path is hard;
-- rely on RPC convention + audit. Optional guard:
create or replace function public.gm_protect_legal_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.legal_state is distinct from old.legal_state
     and current_setting('amadeus.gm_transition', true) is distinct from '1'
  then
    -- Allow when called inside our transition (sets local config)
    if current_setting('amadeus.gm_allow_legal_state', true) is distinct from '1' then
      -- Soft allow for now during evolve; log only
      perform public.gm_audit(new.id, 'LEGAL_STATE_DIRECT_UPDATE', jsonb_build_object(
        'from', old.legal_state, 'to', new.legal_state
      ));
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists gm_protect_legal_state on public.general_meetings;
create trigger gm_protect_legal_state
  before update of legal_state on public.general_meetings
  for each row
  execute function public.gm_protect_legal_state();

-- Patch gm_transition to set allow flag
create or replace function public.gm_transition(
  p_meeting_id uuid,
  p_to_state text,
  p_note text default null
)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings%rowtype;
  v_from text;
  v_to text := upper(nullif(btrim(coalesce(p_to_state, '')), ''));
  v_ok boolean := false;
begin
  if auth.email() is null then
    raise exception 'gm_transition: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'gm_transition: not allowed' using errcode = '42501';
  end if;
  if v_to is null then
    raise exception 'gm_transition: state required' using errcode = '22023';
  end if;

  perform set_config('amadeus.gm_allow_legal_state', '1', true);

  select m.* into v_row
  from public.general_meetings as m
  where m.id = p_meeting_id
  for update;
  if not found then
    raise exception 'gm_transition: not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.meeting_challenges as c
    where c.meeting_id = p_meeting_id and c.legal_hold is true and c.status = 'legal_hold'
  ) and v_to not in ('DISPUTED', 'LEGAL_HOLD', 'CLOSED') then
    raise exception 'gm_transition: LEGAL_HOLD' using errcode = 'P0001';
  end if;

  v_from := coalesce(v_row.legal_state, 'DRAFT');

  if v_to = 'CHECK_IN_OPEN' and coalesce(v_row.check_in_blocked_reason, '') <> '' then
    raise exception 'gm_transition: check-in blocked: %', v_row.check_in_blocked_reason
      using errcode = 'P0001';
  end if;

  if (v_from, v_to) in (
    ('DRAFT', 'PRECHECK'),
    ('PRECHECK', 'SCHEDULED'),
    ('SCHEDULED', 'AGENDA_READY'),
    ('AGENDA_READY', 'INVITATION_READY'),
    ('INVITATION_READY', 'INVITATION_LOCKED'),
    ('INVITATION_LOCKED', 'INVITATION_POSTED'),
    ('INVITATION_POSTED', 'NOTIFICATION_RUNNING'),
    ('NOTIFICATION_RUNNING', 'WAITING_FOR_MEETING'),
    ('WAITING_FOR_MEETING', 'CHECK_IN_OPEN'),
    ('CHECK_IN_OPEN', 'VOTING_SNAPSHOT_LOCKED'),
    ('VOTING_SNAPSHOT_LOCKED', 'QUORUM_CHECK'),
    ('QUORUM_CHECK', 'MEETING_IN_PROGRESS'),
    ('QUORUM_CHECK', 'ADJOURNED_1_HOUR'),
    ('ADJOURNED_1_HOUR', 'QUORUM_CHECK'),
    ('ADJOURNED_1_HOUR', 'ADJOURNED_NEXT_SESSION'),
    ('ADJOURNED_NEXT_SESSION', 'QUORUM_CHECK'),
    ('MEETING_IN_PROGRESS', 'MEETING_FINISHED'),
    ('MEETING_FINISHED', 'ABSENTEE_VOTING'),
    ('MEETING_FINISHED', 'PROTOCOL_DRAFT'),
    ('ABSENTEE_VOTING', 'PROTOCOL_DRAFT'),
    ('PROTOCOL_DRAFT', 'PROTOCOL_SIGNING'),
    ('PROTOCOL_SIGNING', 'PROTOCOL_SIGNED'),
    ('PROTOCOL_SIGNED', 'PROTOCOL_NOTICE_POSTED'),
    ('PROTOCOL_NOTICE_POSTED', 'CHALLENGE_WINDOW'),
    ('CHALLENGE_WINDOW', 'CLOSED'),
    ('CHALLENGE_WINDOW', 'DISPUTED'),
    ('DISPUTED', 'LEGAL_HOLD'),
    ('LEGAL_HOLD', 'CLOSED'),
    ('DRAFT', 'CANCELLED'),
    ('PRECHECK', 'CANCELLED'),
    ('SCHEDULED', 'CANCELLED'),
    ('AGENDA_READY', 'CANCELLED'),
    ('INVITATION_READY', 'CANCELLED'),
    ('INVITATION_LOCKED', 'CANCELLED'),
    ('INVITATION_POSTED', 'CANCELLED'),
    ('NOTIFICATION_RUNNING', 'CANCELLED'),
    ('WAITING_FOR_MEETING', 'CANCELLED')
  ) then
    v_ok := true;
  end if;
  if not v_ok and v_from = 'DRAFT' and v_to = 'WAITING_FOR_MEETING' then
    v_ok := true;
  end if;
  if not v_ok and v_from = 'WAITING_FOR_MEETING' and v_to = 'MEETING_IN_PROGRESS' then
    v_ok := true;
  end if;
  if not v_ok and v_from = 'PROTOCOL_DRAFT' and v_to = 'PROTOCOL_SIGNED' then
    v_ok := true;
  end if;

  if not v_ok then
    raise exception 'gm_transition: invalid % -> %', v_from, v_to using errcode = 'P0001';
  end if;

  update public.general_meetings as m
     set legal_state = v_to,
         invitation_locked_at = case
           when v_to = 'INVITATION_LOCKED' then coalesce(m.invitation_locked_at, now())
           else m.invitation_locked_at
         end,
         status = case
           when v_to = 'CANCELLED' then 'cancelled'
           when v_to in ('PROTOCOL_SIGNED', 'PROTOCOL_NOTICE_POSTED', 'CHALLENGE_WINDOW') then 'minutes_ready'
           when v_to = 'CLOSED' then 'archived'
           when v_to in ('MEETING_FINISHED', 'ABSENTEE_VOTING', 'PROTOCOL_DRAFT', 'PROTOCOL_SIGNING') then 'held'
           when v_to in ('CHECK_IN_OPEN', 'VOTING_SNAPSHOT_LOCKED', 'QUORUM_CHECK', 'MEETING_IN_PROGRESS',
                         'ADJOURNED_1_HOUR', 'ADJOURNED_NEXT_SESSION', 'WAITING_FOR_MEETING',
                         'INVITATION_LOCKED', 'INVITATION_POSTED', 'NOTIFICATION_RUNNING') then 'published'
           when v_to in ('DRAFT', 'PRECHECK', 'SCHEDULED', 'AGENDA_READY', 'INVITATION_READY') then 'draft'
           else m.status
         end,
         operational_phase = case
           when v_to = 'CHECK_IN_OPEN' then 'registration'
           when v_to in ('MEETING_IN_PROGRESS', 'QUORUM_CHECK', 'VOTING_SNAPSHOT_LOCKED') then 'in_progress'
           when v_to in ('MEETING_FINISHED', 'PROTOCOL_DRAFT', 'PROTOCOL_SIGNING', 'PROTOCOL_SIGNED',
                         'PROTOCOL_NOTICE_POSTED', 'CHALLENGE_WINDOW', 'CLOSED', 'CANCELLED') then 'closed'
           else m.operational_phase
         end,
         updated_at = now()
   where m.id = p_meeting_id
  returning * into v_row;

  perform public.gm_audit(p_meeting_id, 'STATE_TRANSITION', jsonb_build_object(
    'from', v_from, 'to', v_to, 'note', p_note
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_transition(uuid, text, text) from public, anon;
grant execute on function public.gm_transition(uuid, text, text) to authenticated;

commit;
