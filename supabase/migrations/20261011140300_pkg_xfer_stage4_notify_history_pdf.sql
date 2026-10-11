-- PKG-XFER Stage 4 — notify privacy, PDF attach, certified fulfillment, history polish.
-- Depends on 20261011140000 + 20261011140100. Forward-only. Do not apply remotely yet.

begin;

-- ---------------------------------------------------------------------------
-- Extract PDF archive columns (honest has_pdf — never claim PDF from HTML alone)
-- ---------------------------------------------------------------------------

alter table public.property_book_extracts
  add column if not exists pdf_sha256 text null;

alter table public.property_book_extracts
  add column if not exists building_document_id uuid null;

alter table public.property_book_extracts
  add column if not exists has_pdf boolean not null default false;

alter table public.property_book_extracts
  add column if not exists pdf_attached_at timestamptz null;

comment on column public.property_book_extracts.has_pdf is
  'True only after a real PDF file was attached in Documents Core storage.';

comment on column public.property_book_extracts.storage_path is
  'Private storage path of PDF when has_pdf. Null means HTML/JSON snapshot only — not a PDF.';

-- Allow certified status + invite_available notification event
alter table public.ownership_change_notifications
  drop constraint if exists ownership_change_notifications_event_chk;

alter table public.ownership_change_notifications
  add constraint ownership_change_notifications_event_chk
  check (event_kind in (
    'submitted', 'approved', 'rejected', 'cancelled',
    'admin_pending', 'inheritance_pending', 'representative_changed',
    'correction_recorded', 'extract_certified_requested',
    'invite_available', 'access_revoked', 'certified_fulfilled', 'certified_rejected'
  ));

-- Honest email delivery labels
create or replace function public.ownership_change_notify(
  p_transfer_id bigint,
  p_property_id bigint,
  p_event_kind text,
  p_emails text[],
  p_payload jsonb default '{}'::jsonb,
  p_recipient_role text default 'owner'
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_provider boolean := false;
  v_seen text[] := array[]::text[];
  v_payload jsonb;
begin
  select s.email_provider_configured into v_provider
  from public.ownership_change_settings as s
  where s.id = 1;

  -- Privacy: never put supporting paths / document bodies in general notifications
  v_payload := coalesce(p_payload, '{}'::jsonb)
    - 'supporting_document_path'
    - 'document_path'
    - 'death_document_path'
    - 'baseline'
    - 'target'
    - 'before_owners'
    - 'after_owners';

  foreach v_email in array coalesce(p_emails, array[]::text[])
  loop
    v_email := lower(nullif(btrim(coalesce(v_email, '')), ''));
    if v_email is null or v_email = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_email);
    insert into public.ownership_change_notifications (
      transfer_id, property_id, event_kind, recipient_email, recipient_role,
      in_app_delivered, email_attempted, email_delivered, email_skip_reason, payload
    ) values (
      p_transfer_id,
      p_property_id,
      p_event_kind,
      v_email,
      p_recipient_role,
      true,
      false,
      false,
      case
        when coalesce(v_provider, false) then 'NOT_SENT_NO_PROVIDER_ACCEPTANCE'
        else 'NOT_CONFIGURED'
      end,
      v_payload
    );
  end loop;
end;
$fn$;

revoke all on function public.ownership_change_notify(bigint, bigint, text, text[], jsonb, text)
  from public, anon;

-- On approval: invite_available for new owners; access_revoked for removed baseline owners
create or replace function public.ownership_change_after_approve_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_new text[];
  v_old text[];
  v_removed text[];
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.status is distinct from 'утверждена'
     or old.status is not distinct from 'утверждена'
  then
    return new;
  end if;

  select coalesce(array_agg(distinct lower(btrim(x))), array[]::text[])
    into v_new
  from (
    select nullif(btrim(coalesce(e.value ->> 'email', '')), '') as x
    from jsonb_array_elements(coalesce(new.target_owners, '[]'::jsonb)) as e(value)
  ) as s
  where s.x is not null;

  select coalesce(array_agg(distinct lower(btrim(x))), array[]::text[])
    into v_old
  from (
    select nullif(btrim(coalesce(e.value ->> 'email', '')), '') as x
    from jsonb_array_elements(coalesce(new.baseline_owners, '[]'::jsonb)) as e(value)
  ) as s
  where s.x is not null;

  select coalesce(array_agg(e), array[]::text[])
    into v_removed
  from unnest(v_old) as e
  where not (e = any (v_new));

  if coalesce(array_length(v_new, 1), 0) > 0 then
    perform public.ownership_change_notify(
      new.id, new.property_id, 'invite_available',
      v_new,
      jsonb_build_object('transfer_id', new.id, 'invite_hint', true)
    );
  end if;

  if coalesce(array_length(v_removed, 1), 0) > 0 then
    perform public.ownership_change_notify(
      new.id, new.property_id, 'access_revoked',
      v_removed,
      jsonb_build_object('transfer_id', new.id)
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists ownership_change_after_approve_notify_trg on public.owner_transfers;
create trigger ownership_change_after_approve_notify_trg
  after update of status on public.owner_transfers
  for each row
  execute function public.ownership_change_after_approve_notify();

-- ---------------------------------------------------------------------------
-- Attach real PDF (Documents Core path) — immutable content fields stay frozen
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
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_sha text := lower(nullif(btrim(coalesce(p_pdf_sha256, '')), ''));
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_attach_property_book_extract_pdf: not authenticated'
      using errcode = '28000';
  end if;
  if v_path is null or v_sha is null or length(v_sha) < 32 then
    raise exception 'owner_attach_property_book_extract_pdf: storage path and pdf sha256 required'
      using errcode = '22023';
  end if;
  -- Reject free-text pretend paths (must look like private storage object path)
  if position('/' in v_path) = 0 or v_path ~* '\s' then
    raise exception 'owner_attach_property_book_extract_pdf: invalid storage path'
      using errcode = '22023';
  end if;

  select e.* into v_row
  from public.property_book_extracts as e
  where e.id = p_extract_id
  for update;

  if not found then
    raise exception 'owner_attach_property_book_extract_pdf: not found' using errcode = 'P0002';
  end if;
  if not public.owns_property(v_row.property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_attach_property_book_extract_pdf: not allowed'
      using errcode = '42501';
  end if;
  if v_row.has_pdf then
    raise exception 'owner_attach_property_book_extract_pdf: PDF already attached (immutable)'
      using errcode = 'P0001';
  end if;

  update public.property_book_extracts as e
     set storage_path = v_path,
         pdf_sha256 = v_sha,
         building_document_id = p_building_document_id,
         has_pdf = true,
         pdf_attached_at = now(),
         book_snapshot = coalesce(e.book_snapshot, '{}'::jsonb)
           || jsonb_build_object('pdf_attached', true, 'pdf_sha256', v_sha)
   where e.id = p_extract_id;

  return jsonb_build_object(
    'ok', true,
    'extract_id', p_extract_id,
    'has_pdf', true,
    'storage_path', v_path
  );
end;
$fn$;

revoke all on function public.owner_attach_property_book_extract_pdf(bigint, text, text, uuid)
  from public, anon;
grant execute on function public.owner_attach_property_book_extract_pdf(bigint, text, text, uuid)
  to authenticated;

-- Frozen extract fetch (never re-reads live Book for content_html / book_snapshot)
create or replace function public.owner_get_property_book_extract(p_extract_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_book_extracts%rowtype;
begin
  select e.* into v_row
  from public.property_book_extracts as e
  where e.id = p_extract_id;
  if not found then
    raise exception 'owner_get_property_book_extract: not found' using errcode = 'P0002';
  end if;
  if not public.owns_property(v_row.property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_get_property_book_extract: not allowed'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'extract_number', v_row.extract_number,
    'property_id', v_row.property_id,
    'generated_at', v_row.generated_at,
    'locale', v_row.locale,
    'extract_kind', v_row.extract_kind,
    'is_signed', v_row.is_signed,
    'is_informational', v_row.is_informational,
    'content_sha256', v_row.content_sha256,
    'content_html', v_row.content_html,
    'book_snapshot', v_row.book_snapshot,
    'has_pdf', v_row.has_pdf,
    'storage_path', case when v_row.has_pdf then v_row.storage_path else null end,
    'pdf_sha256', v_row.pdf_sha256,
    'certified_request_status', v_row.certified_request_status,
    'linked_group_id', v_row.linked_group_id
  );
end;
$fn$;

revoke all on function public.owner_get_property_book_extract(bigint) from public, anon;
grant execute on function public.owner_get_property_book_extract(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Certified extract admin fulfillment (no fake signature)
-- ---------------------------------------------------------------------------

create or replace function public.admin_fulfill_certified_extract(
  p_extract_id bigint,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_book_extracts%rowtype;
begin
  perform public.admin_assert_book_admin();

  select e.* into v_row
  from public.property_book_extracts as e
  where e.id = p_extract_id
  for update;

  if not found or v_row.extract_kind is distinct from 'certified_request' then
    raise exception 'admin_fulfill_certified_extract: certified request required'
      using errcode = 'P0001';
  end if;
  if v_row.certified_request_status is distinct from 'requested' then
    raise exception 'admin_fulfill_certified_extract: not in requested status'
      using errcode = 'P0001';
  end if;

  -- Honest: still unsigned until legal signing workflow exists
  update public.property_book_extracts as e
     set certified_request_status = 'fulfilled',
         is_signed = false,
         note = case
           when p_note is null then e.note
           else nullif(btrim(p_note), '')
         end
   where e.id = p_extract_id;

  perform public.ownership_change_notify(
    null, v_row.property_id, 'certified_fulfilled',
    array[lower(btrim(v_row.generated_by_email))],
    jsonb_build_object(
      'extract_id', p_extract_id,
      'signed', false,
      'status', 'fulfilled_unsigned_pending_legal_workflow'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'extract_id', p_extract_id,
    'status', 'fulfilled',
    'is_signed', false
  );
end;
$fn$;

revoke all on function public.admin_fulfill_certified_extract(bigint, text)
  from public, anon;
grant execute on function public.admin_fulfill_certified_extract(bigint, text)
  to authenticated;

create or replace function public.admin_reject_certified_extract(
  p_extract_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_book_extracts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.admin_assert_book_admin();
  if v_reason is null then
    raise exception 'admin_reject_certified_extract: reason required'
      using errcode = '22023';
  end if;

  select e.* into v_row
  from public.property_book_extracts as e
  where e.id = p_extract_id
  for update;

  if not found or v_row.extract_kind is distinct from 'certified_request' then
    raise exception 'admin_reject_certified_extract: certified request required'
      using errcode = 'P0001';
  end if;

  update public.property_book_extracts as e
     set certified_request_status = 'rejected',
         note = v_reason
   where e.id = p_extract_id;

  perform public.ownership_change_notify(
    null, v_row.property_id, 'certified_rejected',
    array[lower(btrim(v_row.generated_by_email))],
    jsonb_build_object('extract_id', p_extract_id, 'status', 'rejected')
  );

  return jsonb_build_object('ok', true, 'extract_id', p_extract_id, 'status', 'rejected');
end;
$fn$;

revoke all on function public.admin_reject_certified_extract(bigint, text)
  from public, anon;
grant execute on function public.admin_reject_certified_extract(bigint, text)
  to authenticated;

create or replace function public.admin_list_certified_extract_requests()
returns setof public.property_book_extracts
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.admin_assert_book_admin();
  return query
  select e.*
  from public.property_book_extracts as e
  where e.extract_kind = 'certified_request'
  order by e.generated_at desc
  limit 200;
end;
$fn$;

revoke all on function public.admin_list_certified_extract_requests() from public, anon;
grant execute on function public.admin_list_certified_extract_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Ownership history: cleaner, permission-filtered (no free-text path exposure)
-- ---------------------------------------------------------------------------

create or replace function public.owner_list_ownership_history(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_current jsonb;
  v_transfers jsonb;
  v_corrections jsonb;
  v_reps jsonb;
  v_is_admin boolean := public.has_staff_role('администрация');
begin
  if not public.owns_property(p_property_id) and not v_is_admin then
    raise exception 'owner_list_ownership_history: not allowed'
      using errcode = '42501';
  end if;

  -- Current Book composition (emails stripped for non-admin)
  if v_is_admin then
    v_current := public.ownership_change_book_owners_json(p_property_id);
  else
    select coalesce(jsonb_agg((x - 'email' - 'eik_bulstat')), '[]'::jsonb)
      into v_current
    from jsonb_array_elements(public.ownership_change_book_owners_json(p_property_id)) as t(x);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'change_kind', t.change_kind,
    'change_reason', t.change_reason,
    'legal_effective_date', t.legal_effective_date,
    'book_updated_at', coalesce(t.decided_at, t.created_at),
    'created_at', t.created_at,
    'document_type', t.document_type,
    'document_number', t.document_number,
    'document_date', t.document_date,
    'has_supporting_document', t.supporting_document_path is not null,
    'previous_composition', case
      when v_is_admin then t.baseline_owners
      else (
        select coalesce(jsonb_agg((x - 'email' - 'eik_bulstat')), '[]'::jsonb)
        from jsonb_array_elements(coalesce(t.baseline_owners, '[]'::jsonb)) as q(x)
      )
    end,
    'new_composition', case
      when v_is_admin then t.target_owners
      else (
        select coalesce(jsonb_agg((x - 'email' - 'eik_bulstat')), '[]'::jsonb)
        from jsonb_array_elements(coalesce(t.target_owners, '[]'::jsonb)) as q(x)
      )
    end
  ) order by coalesce(t.decided_at, t.created_at) desc), '[]'::jsonb)
    into v_transfers
  from public.owner_transfers as t
  where t.property_id = p_property_id;

  if v_is_admin then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'created_at', c.created_at,
      'reason', c.reason,
      'has_evidence', c.evidence_document_path is not null,
      'after_owners', c.after_owners
    ) order by c.created_at desc), '[]'::jsonb)
      into v_corrections
    from public.ownership_admin_corrections as c
    where c.property_id = p_property_id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'created_at', c.created_at,
      'reason', c.reason,
      'has_evidence', c.evidence_document_path is not null,
      'after_owners', (
        select coalesce(jsonb_agg((x - 'email' - 'eik_bulstat')), '[]'::jsonb)
        from jsonb_array_elements(c.after_owners) as t(x)
      )
    ) order by c.created_at desc), '[]'::jsonb)
      into v_corrections
    from public.ownership_admin_corrections as c
    where c.property_id = p_property_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'representative_name', r.representative_name,
    'valid_from', r.valid_from,
    'valid_until', r.valid_until
  ) order by r.valid_from desc), '[]'::jsonb)
    into v_reps
  from public.legal_entity_representatives as r
  where r.property_id = p_property_id;

  return jsonb_build_object(
    'current_owners', v_current,
    'transfers', v_transfers,
    'corrections', v_corrections,
    'representatives', v_reps
  );
end;
$fn$;

revoke all on function public.owner_list_ownership_history(bigint) from public, anon;
grant execute on function public.owner_list_ownership_history(bigint) to authenticated;

-- Owner in-app notifications (filtered)
create or replace function public.owner_list_ownership_notifications(p_limit integer default 50)
returns setof public.ownership_change_notifications
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_lim integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_email is null then
    raise exception 'owner_list_ownership_notifications: not authenticated'
      using errcode = '28000';
  end if;
  return query
  select n.*
  from public.ownership_change_notifications as n
  where lower(btrim(n.recipient_email)) = v_email
     or (
       public.has_staff_role('администрация')
       and n.recipient_role = 'admin'
     )
  order by n.created_at desc
  limit v_lim;
end;
$fn$;

revoke all on function public.owner_list_ownership_notifications(integer) from public, anon;
grant execute on function public.owner_list_ownership_notifications(integer) to authenticated;

-- Staff signed URL helper remains client-side via storage; document metadata link for admins
create or replace function public.admin_get_ownership_supporting_document_path(p_transfer_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_path text;
begin
  perform public.admin_assert_book_admin();
  select t.supporting_document_path into v_path
  from public.owner_transfers as t
  where t.id = p_transfer_id;
  return v_path;
end;
$fn$;

revoke all on function public.admin_get_ownership_supporting_document_path(bigint)
  from public, anon;
grant execute on function public.admin_get_ownership_supporting_document_path(bigint)
  to authenticated;

commit;
