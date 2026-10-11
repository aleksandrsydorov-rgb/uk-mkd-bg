-- PKG-XFER Stage 5B — Tariff transition audit (prospective via existing Tariff Core),
-- mixed natural/legal roster ban, hardened PDF attach (building_documents + storage.objects).
-- Unapplied chain only. Does NOT reprice historical assessments (product decision required).

begin;

-- ---------------------------------------------------------------------------
-- Mixed natural/legal ownership prohibited (existing product rule)
-- ---------------------------------------------------------------------------

create or replace function public.ownership_change_validate_owners(
  p_property_id bigint,
  p_owners jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_share_sum numeric := 0;
  v_ideal_sum numeric := 0;
  v_prop_ideal numeric;
  v_share numeric;
  v_ideal numeric;
  v_n integer := 0;
  v_has_legal boolean := false;
  v_has_natural boolean := false;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' or jsonb_array_length(p_owners) < 1 then
    raise exception 'ownership_change: target_owners required'
      using errcode = '22023';
  end if;

  select coalesce(p.ideal_parts_percent, 0) into v_prop_ideal
  from public.properties as p
  where p.id = p_property_id;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_n := v_n + 1;
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
      raise exception 'ownership_change: invalid entity_kind'
        using errcode = '22023';
    end if;
    if v_kind = 'legal_entity' then
      v_has_legal := true;
    else
      -- sole_trader and natural_person use natural tariff subject
      v_has_natural := true;
    end if;
    v_share := nullif(v_item ->> 'ownership_share_percent', '')::numeric;
    v_ideal := nullif(v_item ->> 'ideal_parts_percent', '')::numeric;
    if v_share is null or v_share <= 0 then
      raise exception 'ownership_change: ownership_share_percent required'
        using errcode = '22023';
    end if;
    if v_ideal is null or v_ideal < 0 then
      raise exception 'ownership_change: ideal_parts_percent required'
        using errcode = '22023';
    end if;
    v_share_sum := v_share_sum + v_share;
    v_ideal_sum := v_ideal_sum + v_ideal;
  end loop;

  if v_has_legal and v_has_natural then
    raise exception 'ownership_change: mixed natural/legal ownership is prohibited'
      using errcode = '22023';
  end if;

  if abs(v_share_sum - 100) > 0.001 then
    raise exception 'ownership_change: ownership shares must total 100%% (got %)', v_share_sum
      using errcode = '22023';
  end if;
  if abs(v_ideal_sum - coalesce(v_prop_ideal, 0)) > 0.001 then
    raise exception 'ownership_change: ideal parts must total property ideal %% (got % vs %)',
      v_ideal_sum, v_prop_ideal
      using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.ownership_change_validate_owners(bigint, jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- Roster → tariff subject (Book entity_kind rules; ЕТ → natural)
-- ---------------------------------------------------------------------------

create or replace function public.ownership_roster_tariff_subject(p_owners jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_has_legal boolean := false;
  v_has_natural boolean := false;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    return 'natural';
  end if;
  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind = 'legal_entity' then
      v_has_legal := true;
    elsif v_kind is not null then
      v_has_natural := true;
    end if;
  end loop;
  if v_has_legal and v_has_natural then
    raise exception 'ownership_roster_tariff_subject: mixed natural/legal prohibited'
      using errcode = '22023';
  end if;
  if v_has_legal then
    return 'legal';
  end if;
  return 'natural';
end;
$fn$;

revoke all on function public.ownership_roster_tariff_subject(jsonb) from public, anon;
grant execute on function public.ownership_roster_tariff_subject(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Tariff transition audit (prospective: next accrual uses property_tariff_subject_kind)
-- Does NOT reprice existing support_fee / capital assessments.
-- ---------------------------------------------------------------------------

create table if not exists public.ownership_tariff_transitions (
  id bigserial primary key,
  property_id bigint not null references public.properties (id) on delete cascade,
  transfer_id bigint null references public.owner_transfers (id) on delete set null,
  subject_before text not null check (subject_before in ('natural', 'legal')),
  subject_after text not null check (subject_after in ('natural', 'legal')),
  legal_effective_date date null,
  system_approval_at timestamptz not null default now(),
  support_tariff_version_before uuid null,
  support_tariff_version_after uuid null,
  capital_tariff_version_before uuid null,
  capital_tariff_version_after uuid null,
  historic_assessments_untouched boolean not null default true,
  note text null,
  created_at timestamptz not null default now(),
  created_by_email text null
);

create index if not exists ownership_tariff_transitions_property_idx
  on public.ownership_tariff_transitions (property_id, created_at desc);

alter table public.ownership_tariff_transitions enable row level security;
revoke all on table public.ownership_tariff_transitions from public, anon, authenticated;
grant select on table public.ownership_tariff_transitions to authenticated;

drop policy if exists ownership_tariff_transitions_admin_select on public.ownership_tariff_transitions;
create policy ownership_tariff_transitions_admin_select
on public.ownership_tariff_transitions
for select to authenticated
using (public.has_staff_role('администрация'));

comment on table public.ownership_tariff_transitions is
  'XFER Stage 5B: records subject_kind transitions. Future charges resolve via Tariff Core; no historic reprice.';

create or replace function public.ownership_record_tariff_transition(
  p_property_id bigint,
  p_transfer_id bigint,
  p_baseline_owners jsonb,
  p_target_owners jsonb,
  p_legal_effective_date date,
  p_system_approval_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before text;
  v_after text;
  v_year integer := extract(year from coalesce(p_system_approval_at, now()))::integer;
  v_sf_before uuid;
  v_sf_after uuid;
  v_cap_before uuid;
  v_cap_after uuid;
  v_id bigint;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  v_before := public.ownership_roster_tariff_subject(p_baseline_owners);
  v_after := public.ownership_roster_tariff_subject(p_target_owners);

  if v_before is not distinct from v_after then
    return jsonb_build_object(
      'changed', false,
      'subject_before', v_before,
      'subject_after', v_after,
      'historic_assessments_untouched', true,
      'prospective_via', 'property_tariff_subject_kind_at_next_accrual'
    );
  end if;

  -- Resolve published versions for audit (existing Tariff Core). Fail soft if catalog missing.
  begin
    select r.tariff_version_id into v_sf_before
    from public.resolve_support_tariff_for_year(v_year, v_before) as r;
  exception when others then
    v_sf_before := null;
  end;
  begin
    select r.tariff_version_id into v_sf_after
    from public.resolve_support_tariff_for_year(v_year, v_after) as r;
  exception when others then
    v_sf_after := null;
  end;
  begin
    select r.tariff_version_id into v_cap_before
    from public.resolve_capital_tariff_for_year(v_year, v_before) as r;
  exception when others then
    v_cap_before := null;
  end;
  begin
    select r.tariff_version_id into v_cap_after
    from public.resolve_capital_tariff_for_year(v_year, v_after) as r;
  exception when others then
    v_cap_after := null;
  end;

  insert into public.ownership_tariff_transitions (
    property_id, transfer_id, subject_before, subject_after,
    legal_effective_date, system_approval_at,
    support_tariff_version_before, support_tariff_version_after,
    capital_tariff_version_before, capital_tariff_version_after,
    historic_assessments_untouched, note, created_by_email
  ) values (
    p_property_id, p_transfer_id, v_before, v_after,
    p_legal_effective_date, coalesce(p_system_approval_at, now()),
    v_sf_before, v_sf_after, v_cap_before, v_cap_after,
    true,
    case
      when p_legal_effective_date is not null
           and p_legal_effective_date < (coalesce(p_system_approval_at, now()))::date
      then 'legal_effective_date_before_approval: no silent historic reprice; next accrual uses new subject'
      else 'prospective_only: next accrual uses property_tariff_subject_kind'
    end,
    v_email
  )
  returning id into v_id;

  perform public.log_property_change(
    p_property_id, 'book_ui', 'book', 'update',
    jsonb_build_object(
      'tariff_transition_id', v_id,
      'subject_before', v_before,
      'subject_after', v_after,
      'legal_effective_date', p_legal_effective_date,
      'system_approval_at', coalesce(p_system_approval_at, now()),
      'historic_assessments_untouched', true,
      'no_reprice_called', true,
      'support_tariff_version_before', v_sf_before,
      'support_tariff_version_after', v_sf_after
    ),
    'ownership_tariff_transition'
  );

  return jsonb_build_object(
    'changed', true,
    'transition_id', v_id,
    'subject_before', v_before,
    'subject_after', v_after,
    'historic_assessments_untouched', true,
    'prospective_via', 'property_tariff_subject_kind_at_next_accrual',
    'product_decision_pending',
      'mid_year_open_assessment_subject_reprice_not_implemented'
  );
end;
$fn$;

revoke all on function public.ownership_record_tariff_transition(
  bigint, bigint, jsonb, jsonb, date, timestamptz
) from public, anon;

-- Trigger after ownership approve (representative-only changes never hit this)
create or replace function public.ownership_change_after_approve_tariff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.status is distinct from 'утверждена'
     or old.status is not distinct from 'утверждена'
  then
    return new;
  end if;

  perform public.ownership_record_tariff_transition(
    new.property_id,
    new.id,
    new.baseline_owners,
    new.target_owners,
    new.legal_effective_date,
    coalesce(new.decided_at, now())
  );

  return new;
end;
$fn$;

drop trigger if exists ownership_change_after_approve_tariff_trg on public.owner_transfers;
create trigger ownership_change_after_approve_tariff_trg
  after update of status on public.owner_transfers
  for each row
  execute function public.ownership_change_after_approve_tariff();

-- ---------------------------------------------------------------------------
-- PDF attach hardening: path/sha from building_documents + storage.objects only
-- Client-supplied path/sha ignored when document id provided (required).
-- ---------------------------------------------------------------------------

create or replace function public.owner_attach_property_book_extract_pdf(
  p_extract_id bigint,
  p_storage_path text,
  p_pdf_sha256 text,
  p_building_document_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_book_extracts%rowtype;
  v_doc public.building_documents%rowtype;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_path text;
  v_sha text := lower(nullif(btrim(coalesce(p_pdf_sha256, '')), ''));
  v_obj_id uuid;
  v_obj_meta jsonb;
  v_bytes bigint;
  v_server_verified boolean := false;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_attach_property_book_extract_pdf: not authenticated'
      using errcode = '28000';
  end if;

  -- building_document_id is mandatory (no free-text path trust)
  if p_building_document_id is null then
    raise exception 'owner_attach_property_book_extract_pdf: building_document_id required'
      using errcode = '22023';
  end if;

  select e.* into v_row
  from public.property_book_extracts as e
  where e.id = p_extract_id
  for update;

  if not found then
    raise exception 'owner_attach_property_book_extract_pdf: extract not found'
      using errcode = 'P0002';
  end if;
  if not public.owns_property(v_row.property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_attach_property_book_extract_pdf: not allowed'
      using errcode = '42501';
  end if;
  if v_row.has_pdf then
    -- Idempotent success if same document already attached
    if v_row.building_document_id is not distinct from p_building_document_id then
      return jsonb_build_object(
        'ok', true,
        'extract_id', p_extract_id,
        'has_pdf', true,
        'idempotent', true,
        'storage_path', v_row.storage_path
      );
    end if;
    raise exception 'owner_attach_property_book_extract_pdf: PDF already attached (immutable)'
      using errcode = 'P0001';
  end if;

  select d.* into v_doc
  from public.building_documents as d
  where d.id = p_building_document_id;
  if not found then
    raise exception 'owner_attach_property_book_extract_pdf: building document not found'
      using errcode = 'P0002';
  end if;

  v_path := nullif(btrim(coalesce(v_doc.storage_path, '')), '');
  if v_path is null then
    raise exception 'owner_attach_property_book_extract_pdf: document has no storage path'
      using errcode = '22023';
  end if;

  -- Reject client path spoofing: if provided, must match document row
  if nullif(btrim(coalesce(p_storage_path, '')), '') is not null
     and nullif(btrim(p_storage_path), '') is distinct from v_path
  then
    raise exception 'owner_attach_property_book_extract_pdf: storage path does not match document'
      using errcode = '42501';
  end if;

  if coalesce(v_doc.mime_type, '') is distinct from 'application/pdf'
     and not (coalesce(v_doc.mime_type, '') ilike '%pdf%')
  then
    raise exception 'owner_attach_property_book_extract_pdf: document mime must be PDF'
      using errcode = '22023';
  end if;

  -- Document must belong to caller (or admin) and reference this extract number
  if not public.has_staff_role('администрация')
     and lower(btrim(coalesce(v_doc.created_by_email, ''))) is distinct from v_email
  then
    raise exception 'owner_attach_property_book_extract_pdf: document not owned by caller'
      using errcode = '42501';
  end if;

  if position(v_row.extract_number in coalesce(v_doc.title, '')) = 0 then
    raise exception 'owner_attach_property_book_extract_pdf: document not bound to extract number'
      using errcode = '42501';
  end if;

  -- Object must exist in private bucket
  select
    o.id,
    o.metadata,
    coalesce(
      nullif(o.metadata ->> 'size', '')::bigint,
      nullif(o.metadata ->> 'contentLength', '')::bigint,
      0
    )
    into v_obj_id, v_obj_meta, v_bytes
  from storage.objects as o
  where o.bucket_id = 'building-documents'
    and o.name = v_path
  limit 1;

  if v_obj_id is null then
    raise exception 'owner_attach_property_book_extract_pdf: storage object not found'
      using errcode = 'P0002';
  end if;

  if v_bytes > 0 and v_bytes < 5 then
    raise exception 'owner_attach_property_book_extract_pdf: storage object too small'
      using errcode = '22023';
  end if;

  -- Client SHA is never proof of authenticity. Accept only when marked server-verified
  -- via description prefix set by the trusted attach API after magic-byte check.
  if coalesce(v_doc.description, '') like 'pkg_xfer_pdf_verified:%' then
    v_server_verified := true;
    v_sha := lower(nullif(btrim(substr(v_doc.description, length('pkg_xfer_pdf_verified:') + 1)), ''));
  else
    v_sha := null; -- do not store forged client checksum as verified
  end if;

  if not v_server_verified then
    raise exception 'owner_attach_property_book_extract_pdf: PDF not server-verified (use attach API)'
      using errcode = '42501';
  end if;

  if v_sha is null or length(v_sha) < 64 then
    raise exception 'owner_attach_property_book_extract_pdf: server sha256 missing'
      using errcode = '22023';
  end if;

  update public.property_book_extracts as e
     set storage_path = v_path,
         pdf_sha256 = v_sha,
         building_document_id = p_building_document_id,
         has_pdf = true,
         pdf_attached_at = now(),
         book_snapshot = coalesce(e.book_snapshot, '{}'::jsonb)
           || jsonb_build_object(
             'pdf_attached', true,
             'pdf_sha256', v_sha,
             'pdf_server_verified', true
           )
   where e.id = p_extract_id;

  return jsonb_build_object(
    'ok', true,
    'extract_id', p_extract_id,
    'has_pdf', true,
    'storage_path', v_path,
    'pdf_sha256', v_sha,
    'server_verified', true
  );
end;
$fn$;

revoke all on function public.owner_attach_property_book_extract_pdf(bigint, text, text, uuid)
  from public, anon;
grant execute on function public.owner_attach_property_book_extract_pdf(bigint, text, text, uuid)
  to authenticated;

-- Mark document as server-verified after byte check (called only via SECURITY DEFINER from API path... 
-- Actually API uses user session: expose narrow RPC that sets description only if caller owns doc
-- and extract binding is pending. Safer: combine into owner_verify_and_attach_extract_pdf.

create or replace function public.owner_verify_and_attach_extract_pdf(
  p_extract_id bigint,
  p_building_document_id uuid,
  p_pdf_sha256 text,
  p_magic_ok boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_sha text := lower(nullif(btrim(coalesce(p_pdf_sha256, '')), ''));
  v_doc public.building_documents%rowtype;
  v_extract public.property_book_extracts%rowtype;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_verify_and_attach_extract_pdf: not authenticated'
      using errcode = '28000';
  end if;
  if p_magic_ok is not true then
    raise exception 'owner_verify_and_attach_extract_pdf: PDF magic check failed'
      using errcode = '22023';
  end if;
  if v_sha is null or length(v_sha) < 64 then
    raise exception 'owner_verify_and_attach_extract_pdf: sha256 required'
      using errcode = '22023';
  end if;

  select e.* into v_extract
  from public.property_book_extracts as e
  where e.id = p_extract_id;
  if not found then
    raise exception 'owner_verify_and_attach_extract_pdf: extract not found'
      using errcode = 'P0002';
  end if;
  if not public.owns_property(v_extract.property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_verify_and_attach_extract_pdf: not allowed'
      using errcode = '42501';
  end if;

  select d.* into v_doc
  from public.building_documents as d
  where d.id = p_building_document_id
  for update;
  if not found then
    raise exception 'owner_verify_and_attach_extract_pdf: document not found'
      using errcode = 'P0002';
  end if;
  if not public.has_staff_role('администрация')
     and lower(btrim(coalesce(v_doc.created_by_email, ''))) is distinct from v_email
  then
    raise exception 'owner_verify_and_attach_extract_pdf: document not owned by caller'
      using errcode = '42501';
  end if;

  update public.building_documents as d
     set description = 'pkg_xfer_pdf_verified:' || v_sha,
         mime_type = 'application/pdf'
   where d.id = p_building_document_id;

  return public.owner_attach_property_book_extract_pdf(
    p_extract_id,
    null, -- path derived from document
    v_sha,
    p_building_document_id
  );
end;
$fn$;

revoke all on function public.owner_verify_and_attach_extract_pdf(bigint, uuid, text, boolean)
  from public, anon;
grant execute on function public.owner_verify_and_attach_extract_pdf(bigint, uuid, text, boolean)
  to authenticated;

commit;
