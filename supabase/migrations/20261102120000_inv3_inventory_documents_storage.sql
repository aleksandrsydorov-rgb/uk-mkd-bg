-- =============================================================================
-- INV-3 — Inventory documents, photos & private storage
-- =============================================================================
-- Additive. Does NOT modify INV-1/INV-2 history beyond ALTER on inventory_documents.
-- Does NOT auto-enable module. Does NOT create financial postings.
-- Private bucket only; signed URLs after auth (client-side createSignedUrl).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Expand inventory_documents metadata (soft archive, multi-target, audit)
-- ---------------------------------------------------------------------------

alter table public.inventory_documents
  add column if not exists session_item_id uuid null
    references public.inventory_session_items (id) on delete restrict,
  add column if not exists maintenance_event_id uuid null
    references public.inventory_maintenance_events (id) on delete restrict,
  add column if not exists original_filename text null,
  add column if not exists byte_size bigint null
    check (byte_size is null or byte_size >= 0),
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by_email text null,
  add column if not exists superseded_by_id uuid null
    references public.inventory_documents (id) on delete set null,
  add column if not exists uploaded_by_staff_id bigint null
    references public.staff (id) on delete set null,
  add column if not exists uploaded_by_uid uuid null,
  add column if not exists row_version integer not null default 1,
  add column if not exists note text null;

-- Widen doc_kind
alter table public.inventory_documents
  drop constraint if exists inventory_documents_doc_kind_check;

alter table public.inventory_documents
  add constraint inventory_documents_doc_kind_chk
  check (doc_kind in (
    'photo',
    'finding_photo',
    'purchase',
    'manual',
    'warranty',
    'assignment_act',
    'transfer_act',
    'maintenance',
    'write_off_act',
    'invoice',
    'act',
    'other'
  ));

-- Exactly one attachment target
alter table public.inventory_documents
  drop constraint if exists inventory_documents_target_chk;

alter table public.inventory_documents
  add constraint inventory_documents_target_chk check (
    (
      (asset_id is not null)::int
      + (stock_item_id is not null)::int
      + (session_item_id is not null)::int
      + (maintenance_event_id is not null)::int
    ) = 1
  );

create index if not exists inventory_documents_asset_idx
  on public.inventory_documents (asset_id)
  where asset_id is not null and archived_at is null;

create index if not exists inventory_documents_session_item_idx
  on public.inventory_documents (session_item_id)
  where session_item_id is not null and archived_at is null;

create index if not exists inventory_documents_stock_idx
  on public.inventory_documents (stock_item_id)
  where stock_item_id is not null and archived_at is null;

create index if not exists inventory_documents_maintenance_idx
  on public.inventory_documents (maintenance_event_id)
  where maintenance_event_id is not null and archived_at is null;

comment on table public.inventory_documents is
  'INV-3: inventory document metadata. Objects live in private inventory-documents bucket.';

-- ---------------------------------------------------------------------------
-- 2. Private storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-documents',
  'inventory-documents',
  false,
  20971520, -- 20 MiB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      name = excluded.name,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Path / MIME / size helpers
-- ---------------------------------------------------------------------------

create or replace function public.inventory_install_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select lower(btrim(i.installation_key))
      from public.platform_installations as i
      where lower(i.installation_key) = 'default'
      order by i.created_at
      limit 1
    ),
    'default'
  );
$$;

revoke all on function public.inventory_install_key() from public;
revoke execute on function public.inventory_install_key() from anon;
grant execute on function public.inventory_install_key() to authenticated;

-- Path: inventory/{install_key}/{scope}/{target_uuid}/{file_uuid}.{ext}
create or replace function public.inventory_object_name_ok(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_name is not null
    and position('..' in p_name) = 0
    and p_name ~ (
      '^inventory/[a-z0-9_-]+/(asset|stock|session-item|maintenance)/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'
      || '(jpg|jpeg|png|webp|gif|heic|heif|bmp|pdf|doc|docx|xls|xlsx|txt)$'
    );
$fn$;

revoke all on function public.inventory_object_name_ok(text) from public;
revoke execute on function public.inventory_object_name_ok(text) from anon;
grant execute on function public.inventory_object_name_ok(text) to authenticated;

create or replace function public.inventory_document_mime_allowed(p_mime text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_mime, ''))) in (
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/bmp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  );
$$;

revoke all on function public.inventory_document_mime_allowed(text) from public;
grant execute on function public.inventory_document_mime_allowed(text) to authenticated;

create or replace function public.inventory_document_max_bytes()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select 20971520::bigint;
$$;

revoke all on function public.inventory_document_max_bytes() from public;
grant execute on function public.inventory_document_max_bytes() to authenticated;

create or replace function public.inventory_safe_filename(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v is null then
    return null;
  end if;
  v := regexp_replace(v, '[\\/]+', '_', 'g');
  v := regexp_replace(v, '[^\w.\- ()\[\]]+', '_', 'g');
  v := left(v, 180);
  if v in ('.', '..') or v = '' then
    return 'file';
  end if;
  return v;
end;
$fn$;

revoke all on function public.inventory_safe_filename(text) from public;
grant execute on function public.inventory_safe_filename(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Authorization: who may attach / read
-- ---------------------------------------------------------------------------

create or replace function public.inventory_can_attach_to_asset(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin()
    or public.inventory_staff_cap('edit_assets')
    or exists (
      select 1 from public.inventory_assets as a
      where a.id = p_asset_id
        and a.responsible_staff_id = public.inventory_current_staff_id()
    );
$$;

create or replace function public.inventory_can_attach_to_stock(p_stock_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin()
    or public.inventory_staff_cap('stock_move')
    or public.inventory_staff_cap('edit_assets');
$$;

create or replace function public.inventory_can_attach_to_session_item(p_session_item_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_session_id uuid;
  v_status text;
begin
  if public.inventory_is_admin()
     or public.can_review_inventory_session()
     or public.can_approve_inventory_session() then
    return true;
  end if;
  select i.session_id, s.status
    into v_session_id, v_status
  from public.inventory_session_items as i
  join public.inventory_sessions as s on s.id = i.session_id
  where i.id = p_session_item_id;
  if v_session_id is null then
    return false;
  end if;
  if v_status not in ('IN_PROGRESS', 'REVIEW', 'DRAFT') then
    return false;
  end if;
  return exists (
    select 1
    from public.inventory_session_participants as p
    where p.session_id = v_session_id
      and p.staff_id = public.inventory_current_staff_id()
      and p.active is true
  );
end;
$fn$;

create or replace function public.inventory_can_attach_to_maintenance(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin()
    or public.inventory_staff_cap('edit_assets')
    or exists (
      select 1
      from public.inventory_maintenance_events as m
      join public.inventory_assets as a on a.id = m.asset_id
      where m.id = p_event_id
        and a.responsible_staff_id = public.inventory_current_staff_id()
    );
$$;

create or replace function public.inventory_can_read_document_row(p_doc_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v public.inventory_documents%rowtype;
begin
  -- Owners have no inventory document access by default.
  if public.inventory_is_admin()
     or public.can_view_inventory()
     or public.can_review_inventory_session()
     or public.can_approve_inventory_session() then
    return true;
  end if;
  select * into v from public.inventory_documents as d where d.id = p_doc_id;
  if not found then
    return false;
  end if;
  if v.asset_id is not null then
    return public.inventory_can_attach_to_asset(v.asset_id)
      or exists (
        select 1 from public.inventory_assets as a
        where a.id = v.asset_id
          and a.responsible_staff_id = public.inventory_current_staff_id()
      );
  end if;
  if v.stock_item_id is not null then
    return public.inventory_staff_cap('stock_move')
      or public.inventory_staff_cap('edit_assets')
      or public.inventory_staff_cap('view');
  end if;
  if v.session_item_id is not null then
    return public.inventory_can_attach_to_session_item(v.session_item_id)
      or exists (
        select 1
        from public.inventory_session_items as i
        join public.inventory_session_participants as p
          on p.session_id = i.session_id and p.active is true
        where i.id = v.session_item_id
          and p.staff_id = public.inventory_current_staff_id()
      );
  end if;
  if v.maintenance_event_id is not null then
    return public.inventory_can_attach_to_maintenance(v.maintenance_event_id);
  end if;
  return false;
end;
$fn$;

revoke all on function public.inventory_can_attach_to_asset(uuid) from public, anon;
revoke all on function public.inventory_can_attach_to_stock(uuid) from public, anon;
revoke all on function public.inventory_can_attach_to_session_item(uuid) from public, anon;
revoke all on function public.inventory_can_attach_to_maintenance(uuid) from public, anon;
revoke all on function public.inventory_can_read_document_row(uuid) from public, anon;
grant execute on function public.inventory_can_attach_to_asset(uuid) to authenticated;
grant execute on function public.inventory_can_attach_to_stock(uuid) to authenticated;
grant execute on function public.inventory_can_attach_to_session_item(uuid) to authenticated;
grant execute on function public.inventory_can_attach_to_maintenance(uuid) to authenticated;
grant execute on function public.inventory_can_read_document_row(uuid) to authenticated;

create or replace function public.can_upload_inventory_document(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_install text;
  v_scope text;
  v_target uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  if not public.inventory_object_name_ok(p_name) then
    return false;
  end if;
  v_install := split_part(p_name, '/', 2);
  if v_install is distinct from public.inventory_install_key() then
    return false;
  end if;
  v_scope := split_part(p_name, '/', 3);
  begin
    v_target := split_part(p_name, '/', 4)::uuid;
  exception when others then
    return false;
  end;
  if v_scope = 'asset' then
    return exists (select 1 from public.inventory_assets as a where a.id = v_target)
      and public.inventory_can_attach_to_asset(v_target);
  elsif v_scope = 'stock' then
    return exists (select 1 from public.inventory_stock_items as s where s.id = v_target)
      and public.inventory_can_attach_to_stock(v_target);
  elsif v_scope = 'session-item' then
    return exists (select 1 from public.inventory_session_items as i where i.id = v_target)
      and public.inventory_can_attach_to_session_item(v_target);
  elsif v_scope = 'maintenance' then
    return exists (select 1 from public.inventory_maintenance_events as m where m.id = v_target)
      and public.inventory_can_attach_to_maintenance(v_target);
  end if;
  return false;
end;
$fn$;

create or replace function public.can_read_inventory_document(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.inventory_documents as d
    where d.storage_path = p_name
      and d.archived_at is null
      and public.inventory_can_read_document_row(d.id)
  );
$$;

revoke all on function public.can_upload_inventory_document(text) from public, anon;
revoke all on function public.can_read_inventory_document(text) from public, anon;
grant execute on function public.can_upload_inventory_document(text) to authenticated;
grant execute on function public.can_read_inventory_document(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Storage policies (private bucket; no public URLs)
-- ---------------------------------------------------------------------------

drop policy if exists inventory_documents_storage_select on storage.objects;
drop policy if exists inventory_documents_storage_insert on storage.objects;
drop policy if exists inventory_documents_storage_update on storage.objects;
drop policy if exists inventory_documents_storage_delete on storage.objects;

create policy inventory_documents_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'inventory-documents'
  and public.can_read_inventory_document(name)
);

create policy inventory_documents_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'inventory-documents'
  and public.can_upload_inventory_document(name)
);

-- No in-place overwrite of existing objects via client UPDATE
create policy inventory_documents_storage_update
on storage.objects
for update
to authenticated
using (false)
with check (false);

-- Hard delete reserved for admin cleanup only (metadata archive is preferred)
create policy inventory_documents_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'inventory-documents'
  and public.inventory_is_admin()
);

-- ---------------------------------------------------------------------------
-- 6. RLS on inventory_documents (replace view policy)
-- ---------------------------------------------------------------------------

drop policy if exists inventory_documents_select on public.inventory_documents;
create policy inventory_documents_select
  on public.inventory_documents for select to authenticated
  using (public.inventory_can_read_document_row(id));

-- No direct INSERT/UPDATE/DELETE grants for authenticated (RPC only)
revoke insert, update, delete on table public.inventory_documents from authenticated;

-- ---------------------------------------------------------------------------
-- 7. Path builder + register / archive / supersede RPCs
-- ---------------------------------------------------------------------------

create or replace function public.inventory_build_document_path(
  p_scope text,
  p_target_id uuid,
  p_file_id uuid,
  p_extension text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_ext text := lower(nullif(btrim(coalesce(p_extension, '')), ''));
  v_path text;
begin
  if p_scope not in ('asset', 'stock', 'session-item', 'maintenance') then
    raise exception 'inventory: invalid document scope' using errcode = '22023';
  end if;
  if p_target_id is null or p_file_id is null then
    raise exception 'inventory: target and file id required' using errcode = '22023';
  end if;
  if v_ext is null or v_ext !~ '^(jpg|jpeg|png|webp|gif|heic|heif|bmp|pdf|doc|docx|xls|xlsx|txt)$' then
    raise exception 'inventory: invalid file extension' using errcode = '22023';
  end if;
  v_path := format(
    'inventory/%s/%s/%s/%s.%s',
    public.inventory_install_key(),
    p_scope,
    p_target_id::text,
    p_file_id::text,
    v_ext
  );
  if not public.inventory_object_name_ok(v_path) then
    raise exception 'inventory: path rejected' using errcode = '22023';
  end if;
  return v_path;
end;
$fn$;

revoke all on function public.inventory_build_document_path(text, uuid, uuid, text)
  from public, anon;
grant execute on function public.inventory_build_document_path(text, uuid, uuid, text)
  to authenticated;

create or replace function public.inventory_register_document(
  p_storage_path text,
  p_title text,
  p_doc_kind text,
  p_mime_type text,
  p_byte_size bigint default null,
  p_original_filename text default null,
  p_asset_id uuid default null,
  p_stock_item_id uuid default null,
  p_session_item_id uuid default null,
  p_maintenance_event_id uuid default null,
  p_session_item_row_version integer default null,
  p_note text default null
)
returns public.inventory_documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_documents%rowtype;
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_scope text;
  v_target uuid;
  v_install text;
  v_targets int;
  v_item public.inventory_session_items%rowtype;
begin
  perform public.inventory_assert_authenticated();

  if v_path is null or not public.inventory_object_name_ok(v_path) then
    raise exception 'inventory: invalid storage path' using errcode = '22023';
  end if;
  if not public.inventory_document_mime_allowed(p_mime_type) then
    raise exception 'inventory: unsupported mime type' using errcode = '22023';
  end if;
  if p_byte_size is not null and p_byte_size > public.inventory_document_max_bytes() then
    raise exception 'inventory: file too large (max % bytes)', public.inventory_document_max_bytes()
      using errcode = '22023';
  end if;
  if p_doc_kind not in (
    'photo', 'finding_photo', 'purchase', 'manual', 'warranty',
    'assignment_act', 'transfer_act', 'maintenance', 'write_off_act',
    'invoice', 'act', 'other'
  ) then
    raise exception 'inventory: invalid doc_kind' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'inventory: title required' using errcode = '22023';
  end if;

  v_install := split_part(v_path, '/', 2);
  v_scope := split_part(v_path, '/', 3);
  v_target := split_part(v_path, '/', 4)::uuid;
  if v_install is distinct from public.inventory_install_key() then
    raise exception 'inventory: installation path mismatch' using errcode = '42501';
  end if;

  v_targets :=
    (p_asset_id is not null)::int
    + (p_stock_item_id is not null)::int
    + (p_session_item_id is not null)::int
    + (p_maintenance_event_id is not null)::int;
  if v_targets <> 1 then
    raise exception 'inventory: exactly one document target required' using errcode = '22023';
  end if;

  -- Path target must match metadata target (prevents cross-object attachment)
  if v_scope = 'asset' then
    if p_asset_id is distinct from v_target then
      raise exception 'inventory: path/asset mismatch' using errcode = '22023';
    end if;
    if not public.inventory_can_attach_to_asset(p_asset_id) then
      raise exception 'inventory: not allowed to attach to asset' using errcode = '42501';
    end if;
  elsif v_scope = 'stock' then
    if p_stock_item_id is distinct from v_target then
      raise exception 'inventory: path/stock mismatch' using errcode = '22023';
    end if;
    if not public.inventory_can_attach_to_stock(p_stock_item_id) then
      raise exception 'inventory: not allowed to attach to stock' using errcode = '42501';
    end if;
  elsif v_scope = 'session-item' then
    if p_session_item_id is distinct from v_target then
      raise exception 'inventory: path/session-item mismatch' using errcode = '22023';
    end if;
    if not public.inventory_can_attach_to_session_item(p_session_item_id) then
      raise exception 'inventory: not allowed to attach to finding' using errcode = '42501';
    end if;
    select * into v_item from public.inventory_session_items as i
    where i.id = p_session_item_id for update;
    if v_item.finding_status in ('posted', 'rejected', 'duplicate') then
      raise exception 'inventory: cannot attach to finding status %', v_item.finding_status
        using errcode = '55000';
    end if;
    if p_session_item_row_version is not null then
      if v_item.row_version is distinct from p_session_item_row_version then
        raise exception 'inventory: stale item row_version' using errcode = '40001';
      end if;
      update public.inventory_session_items as i
      set row_version = i.row_version + 1, updated_at = now()
      where i.id = p_session_item_id
        and i.row_version = p_session_item_row_version;
      if not found then
        raise exception 'inventory: stale item row_version' using errcode = '40001';
      end if;
    end if;
  elsif v_scope = 'maintenance' then
    if p_maintenance_event_id is distinct from v_target then
      raise exception 'inventory: path/maintenance mismatch' using errcode = '22023';
    end if;
    if not public.inventory_can_attach_to_maintenance(p_maintenance_event_id) then
      raise exception 'inventory: not allowed to attach to maintenance' using errcode = '42501';
    end if;
  else
    raise exception 'inventory: invalid path scope' using errcode = '22023';
  end if;

  if exists (select 1 from public.inventory_documents as d where d.storage_path = v_path) then
    select * into v_row from public.inventory_documents as d where d.storage_path = v_path;
    return v_row; -- idempotent re-register same path
  end if;

  -- Object must exist in private bucket (ownership / upload verification)
  if not exists (
    select 1 from storage.objects as o
    where o.bucket_id = 'inventory-documents' and o.name = v_path
  ) then
    raise exception 'inventory: storage object missing for path' using errcode = 'P0002';
  end if;

  insert into public.inventory_documents (
    asset_id, stock_item_id, session_item_id, maintenance_event_id,
    title, doc_kind, storage_path, mime_type, byte_size, original_filename,
    uploaded_by_email, uploaded_by_staff_id, uploaded_by_uid, note
  ) values (
    p_asset_id, p_stock_item_id, p_session_item_id, p_maintenance_event_id,
    btrim(p_title), p_doc_kind, v_path, lower(btrim(p_mime_type)), p_byte_size,
    public.inventory_safe_filename(p_original_filename),
    public.inventory_actor_email(), public.inventory_current_staff_id(), auth.uid(),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_row;

  if p_asset_id is not null then
    perform public.inventory_log_asset_event(
      p_asset_id, 'document_added',
      jsonb_build_object('document_id', v_row.id, 'doc_kind', p_doc_kind, 'path', v_path),
      p_title
    );
  end if;
  if p_session_item_id is not null then
    perform public.inventory_log_session_event(
      (select session_id from public.inventory_session_items where id = p_session_item_id),
      'item_draft_saved',
      jsonb_build_object(
        'document_id', v_row.id,
        'session_item_id', p_session_item_id,
        'doc_kind', p_doc_kind
      ),
      'finding_photo'
    );
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.inventory_register_document(
  text, text, text, text, bigint, text, uuid, uuid, uuid, uuid, integer, text
) from public, anon;
grant execute on function public.inventory_register_document(
  text, text, text, text, bigint, text, uuid, uuid, uuid, uuid, integer, text
) to authenticated;

create or replace function public.inventory_archive_document(
  p_document_id uuid,
  p_row_version integer default null,
  p_note text default null
)
returns public.inventory_documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_documents%rowtype;
begin
  perform public.inventory_assert_authenticated();
  select * into v_row from public.inventory_documents as d
  where d.id = p_document_id for update;
  if not found then
    raise exception 'inventory: document not found' using errcode = 'P0002';
  end if;
  if v_row.archived_at is not null then
    return v_row; -- idempotent
  end if;
  -- Admin or original uploader with attach rights; prefer admin / edit
  if not (
    public.inventory_is_admin()
    or public.inventory_staff_cap('edit_assets')
    or (
      v_row.uploaded_by_staff_id is not null
      and v_row.uploaded_by_staff_id = public.inventory_current_staff_id()
      and public.inventory_can_read_document_row(v_row.id)
    )
  ) then
    raise exception 'inventory: archive not allowed' using errcode = '42501';
  end if;
  if p_row_version is not null and v_row.row_version is distinct from p_row_version then
    raise exception 'inventory: stale document row_version' using errcode = '40001';
  end if;
  update public.inventory_documents as d
  set
    archived_at = now(),
    archived_by_email = public.inventory_actor_email(),
    row_version = d.row_version + 1,
    note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), d.note)
  where d.id = p_document_id
  returning * into v_row;
  if v_row.asset_id is not null then
    perform public.inventory_log_asset_event(
      v_row.asset_id, 'document_added',
      jsonb_build_object('document_id', v_row.id, 'action', 'archived'), p_note
    );
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_archive_document(uuid, integer, text) from public, anon;
grant execute on function public.inventory_archive_document(uuid, integer, text) to authenticated;

create or replace function public.inventory_supersede_document(
  p_old_document_id uuid,
  p_storage_path text,
  p_title text,
  p_doc_kind text,
  p_mime_type text,
  p_byte_size bigint default null,
  p_original_filename text default null,
  p_note text default null
)
returns public.inventory_documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old public.inventory_documents%rowtype;
  v_new public.inventory_documents%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not public.inventory_is_admin() and not public.inventory_staff_cap('edit_assets') then
    raise exception 'inventory: supersede requires edit rights' using errcode = '42501';
  end if;
  select * into v_old from public.inventory_documents as d
  where d.id = p_old_document_id for update;
  if not found then
    raise exception 'inventory: document not found' using errcode = 'P0002';
  end if;
  v_new := public.inventory_register_document(
    p_storage_path, p_title, p_doc_kind, p_mime_type, p_byte_size, p_original_filename,
    v_old.asset_id, v_old.stock_item_id, v_old.session_item_id, v_old.maintenance_event_id,
    null, p_note
  );
  update public.inventory_documents as d
  set
    archived_at = coalesce(d.archived_at, now()),
    archived_by_email = coalesce(d.archived_by_email, public.inventory_actor_email()),
    superseded_by_id = v_new.id,
    row_version = d.row_version + 1
  where d.id = v_old.id;
  return v_new;
end;
$fn$;

revoke all on function public.inventory_supersede_document(
  uuid, text, text, text, text, bigint, text, text
) from public, anon;
grant execute on function public.inventory_supersede_document(
  uuid, text, text, text, text, bigint, text, text
) to authenticated;

-- List helper (authorized rows only via RLS + security invoker default)
create or replace function public.inventory_list_documents_for_asset(p_asset_id uuid)
returns setof public.inventory_documents
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
  from public.inventory_documents as d
  where d.asset_id = p_asset_id
    and d.archived_at is null
    and public.inventory_can_read_document_row(d.id)
  order by d.created_at desc;
$$;

create or replace function public.inventory_list_documents_for_session_item(p_session_item_id uuid)
returns setof public.inventory_documents
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
  from public.inventory_documents as d
  where d.session_item_id = p_session_item_id
    and d.archived_at is null
    and public.inventory_can_read_document_row(d.id)
  order by d.created_at desc;
$$;

revoke all on function public.inventory_list_documents_for_asset(uuid) from public, anon;
revoke all on function public.inventory_list_documents_for_session_item(uuid) from public, anon;
grant execute on function public.inventory_list_documents_for_asset(uuid) to authenticated;
grant execute on function public.inventory_list_documents_for_session_item(uuid) to authenticated;

-- Ensure module not flipped by this migration
update public.module_catalog
set implemented = false
where module_key = 'inventory' and implemented is distinct from false;

commit;
