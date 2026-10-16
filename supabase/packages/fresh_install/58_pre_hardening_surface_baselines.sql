-- =============================================================================
-- IS-10c fresh-install — Pre-hardening surface baselines
-- =============================================================================
-- Tables required by early chronological SH-2* migrations (DROP POLICY / ALTER)
-- that historically lived only on the production schema (no CREATE in migrations).
-- Sources: legacy/DO_NOT_RUN (DDL only) + generated database.types shapes.
-- Empty: no apartments, owners, tickets, votes, expenses, or assessments.
-- No open using(true) write policies — hardening migrations attach RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ownership Transfer
-- ---------------------------------------------------------------------------
create table if not exists public.owner_transfers (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties (id) on delete cascade,
  from_owner_name text,
  from_owner_email text,
  from_owner_phone text,
  to_owner_name text not null,
  to_owner_email text not null,
  to_owner_phone text,
  note text,
  status text not null default 'ожидает',
  decided_at timestamptz,
  decided_by text,
  reject_reason text
);

create index if not exists owner_transfers_property_idx
  on public.owner_transfers (property_id);
create index if not exists owner_transfers_status_idx
  on public.owner_transfers (status);

alter table public.owner_transfers enable row level security;
revoke all on table public.owner_transfers from public, anon;
revoke all on table public.owner_transfers from authenticated;
grant select on table public.owner_transfers to authenticated;

-- ---------------------------------------------------------------------------
-- UK Budget / Expenses (shell — no expense rows)
-- ---------------------------------------------------------------------------
create table if not exists public.uk_expenses (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  expense_date date not null,
  amount numeric(12, 2) not null,
  title text,
  created_by text,
  status text null,
  photo_urls text[] null,
  approved_by text null,
  approved_at timestamptz null
);

alter table public.uk_expenses enable row level security;
revoke all on table public.uk_expenses from public, anon;
revoke all on table public.uk_expenses from authenticated;
grant select on table public.uk_expenses to authenticated;

-- ---------------------------------------------------------------------------
-- Tickets (requests) + Chat
-- ---------------------------------------------------------------------------
create table if not exists public.requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint null references public.properties (id) on delete set null,
  subject text null,
  description text null,
  status text null default 'новая',
  priority text null,
  owner_name text null,
  owner_phone text null,
  category text null,
  photo_url text null,
  created_by_role text null,
  created_by_email text null
);

create index if not exists requests_property_idx on public.requests (property_id);

alter table public.requests enable row level security;
revoke all on table public.requests from public, anon;
revoke all on table public.requests from authenticated;
grant select on table public.requests to authenticated;

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties (id) on delete cascade,
  sender text not null,
  message text not null,
  read_by_uk boolean not null default false,
  read_by_owner boolean not null default false,
  photo_url text null,
  file_name text null,
  guest_access_id uuid null,
  sender_email text null
);

create index if not exists chat_messages_property_idx
  on public.chat_messages (property_id, created_at desc);

alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from public, anon;
revoke all on table public.chat_messages from authenticated;
grant select on table public.chat_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Residence / Guest Mode dependencies
-- ---------------------------------------------------------------------------
create table if not exists public.apartment_guests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  middle_name text null,
  birth_year integer null,
  is_child boolean not null default false,
  check_in date null,
  check_out date null,
  is_permanent boolean null
);

create index if not exists apartment_guests_property_idx
  on public.apartment_guests (property_id);

alter table public.apartment_guests enable row level security;
revoke all on table public.apartment_guests from public, anon;
revoke all on table public.apartment_guests from authenticated;
grant select on table public.apartment_guests to authenticated;

create table if not exists public.apartment_pets (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties (id) on delete cascade,
  kind text null,
  name text null,
  note text null
);

alter table public.apartment_pets enable row level security;
revoke all on table public.apartment_pets from public, anon;
revoke all on table public.apartment_pets from authenticated;
grant select on table public.apartment_pets to authenticated;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  title text null,
  body text null,
  created_by text null
);

alter table public.announcements enable row level security;
revoke all on table public.announcements from public, anon;
revoke all on table public.announcements from authenticated;
grant select on table public.announcements to authenticated;

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------
create table if not exists public.polls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  title text not null,
  body text,
  category text not null default 'опрос',
  status text not null default 'открыт',
  deadline date,
  created_by text,
  photo_url text null,
  budget_eur numeric(12, 2) null,
  voting_starts timestamptz null,
  result text not null default '',
  result_option_id bigint null
);

create table if not exists public.poll_options (
  id bigint generated always as identity primary key,
  poll_id bigint not null references public.polls (id) on delete cascade,
  label text not null,
  sort_order integer not null default 0
);

create table if not exists public.poll_votes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  poll_id bigint not null references public.polls (id) on delete cascade,
  option_id bigint not null references public.poll_options (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete cascade,
  registry_people_id bigint null,
  weight numeric(12, 6) null,
  unique (poll_id, property_id)
);

create table if not exists public.poll_vote_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  poll_id bigint not null references public.polls (id) on delete cascade,
  option_id bigint not null references public.poll_options (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete cascade,
  weight numeric(12, 6) null
);

create table if not exists public.poll_suggestions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties (id) on delete cascade,
  category text not null default 'ремонт',
  title text not null,
  body text,
  status text not null default 'новая'
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_vote_history enable row level security;
alter table public.poll_suggestions enable row level security;

revoke all on table public.polls from public, anon, authenticated;
revoke all on table public.poll_options from public, anon, authenticated;
revoke all on table public.poll_votes from public, anon, authenticated;
revoke all on table public.poll_vote_history from public, anon, authenticated;
revoke all on table public.poll_suggestions from public, anon, authenticated;
grant select on table public.polls to authenticated;
grant select on table public.poll_options to authenticated;
grant select on table public.poll_votes to authenticated;
grant select on table public.poll_vote_history to authenticated;
grant select on table public.poll_suggestions to authenticated;

-- ---------------------------------------------------------------------------
-- Support Fee assessments / policies / allocations (empty — no obligations)
-- Canonical CREATE from legacy support_fee_annual_pricing_hotfix.sql (DDL only).
-- ---------------------------------------------------------------------------
create table if not exists public.support_fee_annual_policies (
  id uuid primary key default gen_random_uuid(),
  billing_year integer not null unique
    check (billing_year >= 2000 and billing_year <= 2100),
  enabled boolean not null default true,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed')),
  early_discount_percent numeric(5, 2) not null default 10
    check (early_discount_percent >= 0 and early_discount_percent <= 100),
  late_increase_percent numeric(5, 2) not null default 10
    check (late_increase_percent >= 0 and late_increase_percent <= 100),
  early_payment_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create table if not exists public.support_fee_assessments (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  billing_year integer not null
    check (billing_year >= 2000 and billing_year <= 2100),
  policy_id uuid references public.support_fee_annual_policies (id) on delete set null,
  charge_ledger_id bigint references public.support_fee_ledger (id) on delete set null,
  base_amount numeric(12, 2) not null,
  discount_percent numeric(5, 2) not null default 0,
  increase_percent numeric(5, 2) not null default 0,
  early_amount numeric(12, 2) not null,
  late_amount numeric(12, 2) not null,
  early_deadline_at timestamptz,
  pricing_rule text not null
    check (pricing_rule in ('early_full_payment', 'late', 'standard')),
  pricing_reason_code text
    check (
      pricing_reason_code in (
        'early_fully_covered_by_credit',
        'early_fully_covered_by_payments',
        'early_fully_covered_mixed',
        'early_not_fully_covered',
        'policy_disabled'
      )
    ),
  qualification_status text not null
    check (qualification_status in ('not_checked', 'qualified', 'not_qualified')),
  qualification_checked_at timestamptz,
  available_credit_at_check numeric(12, 2) not null default 0,
  amount_covered_at_check numeric(12, 2) not null default 0,
  dedicated_payment_at_check numeric(12, 2) not null default 0,
  applied_credit_amount numeric(12, 2) not null default 0,
  applied_payment_amount numeric(12, 2) not null default 0,
  final_amount numeric(12, 2) not null,
  remaining_due numeric(12, 2) not null default 0,
  balance_before numeric(12, 2),
  balance_after numeric(12, 2),
  status text not null default 'open'
    check (status in ('open', 'paid')),
  created_at timestamptz not null default now(),
  created_by_email text,
  finalized_at timestamptz,
  finalized_by_email text,
  correction_reason text,
  correction_at timestamptz,
  correction_by_email text,
  unique (property_id, billing_year)
);

create table if not exists public.support_fee_allocations (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references public.support_fee_assessments (id) on delete cascade,
  ledger_entry_id bigint references public.support_fee_ledger (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  allocation_type text not null check (allocation_type in ('payment', 'credit')),
  created_at timestamptz not null default now(),
  created_by_email text
);

create index if not exists support_fee_assessments_property_idx
  on public.support_fee_assessments (property_id, billing_year desc);
create index if not exists support_fee_allocations_assessment_idx
  on public.support_fee_allocations (assessment_id, created_at);

alter table public.support_fee_annual_policies enable row level security;
alter table public.support_fee_assessments enable row level security;
alter table public.support_fee_allocations enable row level security;

revoke all on table public.support_fee_annual_policies from public, anon, authenticated;
revoke all on table public.support_fee_assessments from public, anon, authenticated;
revoke all on table public.support_fee_allocations from public, anon, authenticated;
grant select on table public.support_fee_annual_policies to authenticated;
grant select on table public.support_fee_assessments to authenticated;
grant select on table public.support_fee_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- Building documents (canonical CREATE from documents_decisions_hotfix)
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
  supersedes_document_id uuid references public.building_documents (id),
  created_by_email text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_email text,
  constraint building_documents_category_chk
    check (
      category in (
        'house_rules',
        'budget',
        'annual_report',
        'management',
        'technical',
        'meeting_related',
        'other'
      )
    ),
  constraint building_documents_status_chk
    check (status in ('draft', 'published', 'archived')),
  constraint building_documents_version_chk check (version >= 1)
);

create unique index if not exists building_documents_storage_path_uidx
  on public.building_documents (storage_path);
create index if not exists building_documents_status_category_idx
  on public.building_documents (status, category, document_date desc);

alter table public.building_documents enable row level security;
revoke all on table public.building_documents from public, anon, authenticated;
grant select on table public.building_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Meeting participants / votes / files (after building_documents FK target)
-- ---------------------------------------------------------------------------
create table if not exists public.general_meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete restrict,
  participant_name text not null,
  representation_type text not null,
  representative_name text,
  property_number_snapshot text,
  ideal_parts_percent_snapshot numeric(12, 6),
  attendance_mode text not null,
  proxy_document_id uuid references public.building_documents (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint general_meeting_participants_repr_chk
    check (representation_type in ('self', 'proxy')),
  constraint general_meeting_participants_att_chk
    check (attendance_mode in ('in_person', 'online', 'absentee')),
  constraint general_meeting_participants_property_uidx unique (meeting_id, property_id)
);

create table if not exists public.general_meeting_votes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  decision_id uuid not null
    references public.general_meeting_decisions (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete restrict,
  participant_id uuid
    references public.general_meeting_participants (id) on delete set null,
  vote text not null,
  ideal_parts_percent_snapshot numeric(12, 6),
  vote_method text not null,
  recorded_at timestamptz not null default now(),
  recorded_by_email text,
  constraint general_meeting_votes_vote_chk check (vote in ('for', 'against', 'abstain')),
  constraint general_meeting_votes_method_chk
    check (vote_method in ('in_person', 'online', 'absentee')),
  constraint general_meeting_votes_property_decision_uidx unique (decision_id, property_id)
);

create table if not exists public.general_meeting_files (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  document_id uuid not null references public.building_documents (id) on delete restrict,
  file_type text not null,
  title text,
  created_at timestamptz not null default now(),
  constraint general_meeting_files_type_chk
    check (
      file_type in (
        'invitation',
        'invitation_posting_protocol',
        'agenda',
        'minutes',
        'minutes_notice',
        'minutes_notice_posting_protocol',
        'proxy',
        'absentee_declaration',
        'appendix',
        'other'
      )
    )
);

create index if not exists general_meeting_files_meeting_idx
  on public.general_meeting_files (meeting_id, file_type);

alter table public.general_meeting_participants enable row level security;
alter table public.general_meeting_votes enable row level security;
alter table public.general_meeting_files enable row level security;
revoke all on table public.general_meeting_participants from public, anon, authenticated;
revoke all on table public.general_meeting_votes from public, anon, authenticated;
revoke all on table public.general_meeting_files from public, anon, authenticated;
grant select on table public.general_meeting_participants to authenticated;
grant select on table public.general_meeting_votes to authenticated;
grant select on table public.general_meeting_files to authenticated;

-- ---------------------------------------------------------------------------
-- Meeting online links / quorum / vote events (full-workflow satellites)
-- ---------------------------------------------------------------------------
create table if not exists public.general_meeting_online_links (
  meeting_id uuid primary key references public.general_meetings (id) on delete cascade,
  join_url text not null,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create table if not exists public.general_meeting_quorum_checks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  stage text not null,
  quorum_rule text not null,
  represented_ideal_parts_percent numeric(12, 6),
  declared_ideal_parts_percent numeric(12, 6),
  required_percent numeric(12, 6),
  calculation_status text not null,
  threshold_met boolean,
  meeting_can_proceed boolean not null default false,
  property_count integer,
  registered_property_count integer,
  missing_ideal_parts_count integer,
  review_note text,
  checked_at timestamptz not null default now(),
  recorded_by_email text,
  constraint general_meeting_quorum_checks_status_chk
    check (
      calculation_status in (
        'not_checked',
        'incomplete',
        'not_met',
        'met',
        'allowed_by_stage',
        'requires_review'
      )
    ),
  constraint general_meeting_quorum_checks_stage_chk
    check (stage in ('initial', 'after_one_hour', 'next_day'))
);

create table if not exists public.general_meeting_vote_events (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid references public.general_meeting_votes (id) on delete cascade,
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  decision_id uuid not null,
  property_id bigint not null,
  vote text not null,
  vote_source text,
  recorded_at timestamptz not null default now(),
  recorded_by_email text,
  constraint general_meeting_vote_events_vote_chk
    check (vote in ('for', 'against', 'abstain'))
);

create index if not exists general_meeting_quorum_checks_meeting_idx
  on public.general_meeting_quorum_checks (meeting_id, checked_at desc);

alter table public.general_meeting_online_links enable row level security;
alter table public.general_meeting_quorum_checks enable row level security;
alter table public.general_meeting_vote_events enable row level security;
revoke all on table public.general_meeting_online_links from public, anon, authenticated;
revoke all on table public.general_meeting_quorum_checks from public, anon, authenticated;
revoke all on table public.general_meeting_vote_events from public, anon, authenticated;
grant select on table public.general_meeting_online_links to authenticated;
grant select on table public.general_meeting_quorum_checks to authenticated;
grant select on table public.general_meeting_vote_events to authenticated;

-- SH-2D revokes execute on these formula/trigger helpers; they must exist first.
-- Canonical bodies from legacy general_meeting_full_workflow_hotfix (DDL only).
create or replace function public.protect_meeting_results_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;

create or replace function public.gm_threshold_met(
  p_value numeric,
  p_comparator text,
  p_required numeric
)
returns boolean
language sql
immutable
as $fn$
  select case
    when p_value is null or p_required is null or p_comparator is null then null
    when p_comparator = 'gt' then p_value > p_required
    when p_comparator = 'gte' then p_value >= p_required
    else null
  end;
$fn$;

create or replace function public.gm_quorum_required_percent(p_stage text, p_rule text)
returns numeric
language sql
immutable
as $fn$
  select case
    when p_rule = 'dominant_owner_75' then 75::numeric
    when p_stage = 'initial' then 51::numeric
    when p_stage = 'after_one_hour' then 26::numeric
    else null
  end;
$fn$;

create or replace function public.gm_apply_majority_preset(p_rule text)
returns table (
  majority_rule text,
  threshold_comparator text,
  required_percent numeric,
  denominator_basis text
)
language sql
immutable
as $fn$
  select x.majority_rule, x.threshold_comparator, x.required_percent, x.denominator_basis
  from (
    select
      p_rule as majority_rule,
      case p_rule
        when 'unanimous_all_ideal_parts' then 'gte'
        when 'at_least_75_all_ideal_parts' then 'gte'
        when 'at_least_75_eligible_ideal_parts' then 'gte'
        when 'at_least_51_all_ideal_parts' then 'gte'
        when 'more_than_50_all_ideal_parts' then 'gt'
        when 'more_than_50_represented_ideal_parts' then 'gt'
        when 'more_than_half_independent_units' then 'gt'
        else 'gte'
      end as threshold_comparator,
      case p_rule
        when 'unanimous_all_ideal_parts' then 100::numeric
        when 'at_least_75_all_ideal_parts' then 75::numeric
        when 'at_least_75_eligible_ideal_parts' then 75::numeric
        when 'at_least_51_all_ideal_parts' then 51::numeric
        else 50::numeric
      end as required_percent,
      case p_rule
        when 'more_than_50_represented_ideal_parts' then 'represented_ideal_parts'
        when 'at_least_75_eligible_ideal_parts' then 'eligible_ideal_parts'
        when 'more_than_half_independent_units' then 'independent_units'
        else 'all_ideal_parts'
      end as denominator_basis
  ) as x;
$fn$;

-- Legacy operational shells referenced by SH-2D sequence revoke list.
create table if not exists public.n525_commands (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  status text null,
  user_id uuid null,
  command_text text null
);

create table if not exists public.owner_email (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text null,
  property_id bigint null references public.properties (id) on delete set null
);

alter table public.n525_commands enable row level security;
alter table public.owner_email enable row level security;
revoke all on table public.n525_commands from public, anon, authenticated;
revoke all on table public.owner_email from public, anon, authenticated;

comment on table public.owner_transfers is
  'Ownership transfer requests. Fresh-install: empty — no transfers.';
comment on table public.uk_expenses is
  'UK expenses journal shell. Fresh-install: empty — no synthetic expenses.';
comment on table public.support_fee_assessments is
  'Support Fee assessments. Fresh-install: empty — no preconfigured obligations.';
