-- Meeting Core Stage 4 extras: vote immutability guard + absentee submit gate
-- Local only — no production push without explicit command.

begin;

-- Prevent changing or deleting cast votes (immutable after submit)
create or replace function public.gm_votes_immutable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'general_meeting_votes: immutable after submit'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (
    new.vote is distinct from old.vote
    or new.decision_id is distinct from old.decision_id
    or new.property_id is distinct from old.property_id
    or new.registry_people_id is distinct from old.registry_people_id
    or new.ideal_parts_percent_snapshot is distinct from old.ideal_parts_percent_snapshot
  ) then
    raise exception 'general_meeting_votes: immutable after submit'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists gm_votes_no_update on public.general_meeting_votes;
create trigger gm_votes_no_update
  before update on public.general_meeting_votes
  for each row
  execute function public.gm_votes_immutable_trg();

drop trigger if exists gm_votes_no_delete on public.general_meeting_votes;
create trigger gm_votes_no_delete
  before delete on public.general_meeting_votes
  for each row
  execute function public.gm_votes_immutable_trg();

-- Absentee declaration with category gate
create or replace function public.gm_submit_absentee_declaration(
  p_meeting_id uuid,
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text,
  p_registry_people_id bigint default null,
  p_document_id bigint default null
)
returns public.meeting_absentee_declarations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vote text := lower(nullif(btrim(coalesce(p_vote, '')), ''));
  v_cat text;
  v_forbidden jsonb;
  v_row public.meeting_absentee_declarations%rowtype;
  v_deadline date;
begin
  if auth.email() is null then
    raise exception 'gm_submit_absentee: not authenticated' using errcode = '28000';
  end if;
  if not (
    public.can_manage_building_governance()
    or public.owns_property(p_property_id)
  ) then
    raise exception 'gm_submit_absentee: not allowed' using errcode = '42501';
  end if;
  if v_vote is null or v_vote not in ('for', 'against', 'abstain') then
    raise exception 'gm_submit_absentee: invalid vote' using errcode = '22023';
  end if;

  select a.decision_category into v_cat
  from public.general_meeting_agenda_items as a
  where a.id = p_agenda_item_id and a.meeting_id = p_meeting_id;
  if v_cat is null and not exists (
    select 1 from public.general_meeting_agenda_items as a
    where a.id = p_agenda_item_id and a.meeting_id = p_meeting_id
  ) then
    raise exception 'gm_submit_absentee: agenda item not found' using errcode = 'P0002';
  end if;

  select r.rules_json -> 'absentee_forbidden_categories'
    into v_forbidden
  from public.general_meetings as m
  join public.meeting_rulesets as r on r.id = m.ruleset_id
  where m.id = p_meeting_id;

  if v_forbidden is not null
     and jsonb_typeof(v_forbidden) = 'array'
     and v_forbidden ? coalesce(v_cat, '')
  then
    raise exception 'gm_submit_absentee: category forbidden for absentee'
      using errcode = 'P0001';
  end if;

  -- Also block known election majority labels in title/category soft match
  if coalesce(v_cat, '') in ('election_management', 'election_control') then
    raise exception 'gm_submit_absentee: elections forbidden' using errcode = 'P0001';
  end if;

  select m.absentee_voting_deadline into v_deadline
  from public.general_meetings as m where m.id = p_meeting_id;
  if v_deadline is not null and current_date > v_deadline then
    raise exception 'gm_submit_absentee: window closed' using errcode = 'P0001';
  end if;

  insert into public.meeting_absentee_declarations (
    meeting_id, agenda_item_id, property_id, registry_people_id,
    vote, document_id, status, created_by_email
  ) values (
    p_meeting_id, p_agenda_item_id, p_property_id, p_registry_people_id,
    v_vote, p_document_id, 'submitted',
    lower(nullif(btrim(coalesce(auth.email(), '')), ''))
  )
  returning * into v_row;

  perform public.gm_audit(p_meeting_id, 'ABSENTEE_SUBMITTED', jsonb_build_object(
    'declaration_id', v_row.id, 'agenda_item_id', p_agenda_item_id
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_submit_absentee_declaration(uuid, uuid, bigint, text, bigint, bigint) from public, anon;
grant execute on function public.gm_submit_absentee_declaration(uuid, uuid, bigint, text, bigint, bigint) to authenticated;

-- Seed REPORTING_ELECTION agenda template helper
create or replace function public.gm_seed_reporting_election_agenda(p_meeting_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n integer := 0;
  v_type text;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_seed_reporting_election_agenda: not allowed' using errcode = '42501';
  end if;
  select m.meeting_type into v_type from public.general_meetings as m where m.id = p_meeting_id;
  if v_type is distinct from 'REPORTING_ELECTION' and v_type is distinct from 'REPORTING' then
    raise exception 'gm_seed_reporting_election_agenda: wrong meeting_type'
      using errcode = 'P0001';
  end if;

  -- Idempotent: only if no agenda yet
  if exists (select 1 from public.general_meeting_agenda_items as a where a.meeting_id = p_meeting_id) then
    return 0;
  end if;

  insert into public.general_meeting_agenda_items (
    meeting_id, position, title, description, decision_category, majority_rule
  ) values
    (p_meeting_id, 1, 'Потвърждаване на председателстващия', null, 'procedural', 'more_than_50_represented_ideal_parts'),
    (p_meeting_id, 2, 'Избор на протоколчик', null, 'procedural', 'more_than_50_represented_ideal_parts'),
    (p_meeting_id, 3, 'Отчет на управлението', null, 'report', 'more_than_50_represented_ideal_parts'),
    (p_meeting_id, 4, 'Отчет за изпълнение на бюджета', null, 'budget_report', 'more_than_50_represented_ideal_parts'),
    (p_meeting_id, 5, 'Отчет на контролния орган', null, 'control_report', 'more_than_50_represented_ideal_parts'),
    (p_meeting_id, 6, 'План за работа', null, 'work_plan', 'more_than_50_represented_ideal_parts'),
    (p_meeting_id, 7, 'Приемане на бюджет', null, 'budget_approval', 'more_than_50_all_ideal_parts');

  get diagnostics v_n = row_count;

  if v_type = 'REPORTING_ELECTION' then
    insert into public.general_meeting_agenda_items (
      meeting_id, position, title, description, decision_category, majority_rule
    ) values
      (p_meeting_id, 8, 'Модел на управление', null, 'election_management', 'more_than_50_all_ideal_parts'),
      (p_meeting_id, 9, 'Избор на управител / УС', null, 'election_management', 'more_than_50_all_ideal_parts'),
      (p_meeting_id, 10, 'Модел на контрол', null, 'election_control', 'more_than_50_all_ideal_parts'),
      (p_meeting_id, 11, 'Избор на контролен орган', null, 'election_control', 'more_than_50_all_ideal_parts');
    get diagnostics v_n = row_count;
    v_n := v_n + 7;
  end if;

  update public.general_meetings
     set meeting_type = v_type,
         updated_at = now()
   where id = p_meeting_id;

  perform public.gm_audit(p_meeting_id, 'AGENDA_TEMPLATE_SEEDED', jsonb_build_object(
    'meeting_type', v_type, 'items', v_n
  ));
  return v_n;
end;
$fn$;

revoke all on function public.gm_seed_reporting_election_agenda(uuid) from public, anon;
grant execute on function public.gm_seed_reporting_election_agenda(uuid) to authenticated;

-- Register meeting document row
create or replace function public.gm_register_document(
  p_meeting_id uuid,
  p_doc_type text,
  p_title text,
  p_building_document_id bigint default null,
  p_content_hash text default null
)
returns public.meeting_documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_documents%rowtype;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_register_document: not allowed' using errcode = '42501';
  end if;
  insert into public.meeting_documents (
    meeting_id, doc_type, title, building_document_id, content_hash, created_by_email
  ) values (
    p_meeting_id, p_doc_type, p_title, p_building_document_id, p_content_hash,
    lower(nullif(btrim(coalesce(auth.email(), '')), ''))
  )
  returning * into v_row;
  perform public.gm_audit(p_meeting_id, 'DOCUMENT_REGISTERED', jsonb_build_object(
    'document_id', v_row.id, 'doc_type', p_doc_type
  ));
  return v_row;
end;
$fn$;

revoke all on function public.gm_register_document(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.gm_register_document(uuid, text, text, bigint, text) to authenticated;

-- Governance term create
create or replace function public.gm_create_governance_term(
  p_body_kind text,
  p_started_at date,
  p_ends_at date default null,
  p_meeting_id uuid default null
)
returns public.governance_terms
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.governance_terms%rowtype;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_create_governance_term: not allowed' using errcode = '42501';
  end if;
  insert into public.governance_terms (body_kind, started_at, ends_at, meeting_id, status)
  values (p_body_kind, p_started_at, p_ends_at, p_meeting_id, 'active')
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.gm_create_governance_term(text, date, date, uuid) from public, anon;
grant execute on function public.gm_create_governance_term(text, date, date, uuid) to authenticated;

commit;
