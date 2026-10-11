-- PKG-XFER P6.6: owners must upload draft extract PDFs to private building-documents.
-- Previously only can_manage_building_governance() could INSERT storage/docs, so
-- generateAndAttachPropertyBookPdfs always failed RLS for owners.

create or replace function public.is_owner_extract_document_path(p_path text)
returns boolean
language sql
immutable
as $fn$
  select p_path ~* '^documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$';
$fn$;

revoke all on function public.is_owner_extract_document_path(text) from public, anon;
grant execute on function public.is_owner_extract_document_path(text) to authenticated;

create or replace function public.can_upload_owner_extract_pdf(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select auth.uid() is not null
    and public.is_owner()
    and public.is_owner_extract_document_path(p_path);
$fn$;

revoke all on function public.can_upload_owner_extract_pdf(text) from public, anon;
grant execute on function public.can_upload_owner_extract_pdf(text) to authenticated;

create or replace function public.can_insert_owner_extract_building_document(
  p_id uuid,
  p_status text,
  p_category text,
  p_title text,
  p_storage_path text,
  p_mime_type text,
  p_created_by_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select auth.uid() is not null
    and public.is_owner()
    and p_id is not null
    and coalesce(p_status, '') = 'draft'
    and coalesce(p_category, '') = 'other'
    and coalesce(p_title, '') like 'Property Book extract %'
    and public.is_owner_extract_document_path(coalesce(p_storage_path, ''))
    and (
      coalesce(p_mime_type, '') = 'application/pdf'
      or coalesce(p_mime_type, '') ilike '%pdf%'
    )
    and lower(nullif(btrim(coalesce(p_created_by_email, '')), ''))
        is not distinct from lower(nullif(btrim(coalesce(auth.email(), '')), ''));
$fn$;

revoke all on function public.can_insert_owner_extract_building_document(uuid, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.can_insert_owner_extract_building_document(uuid, text, text, text, text, text, text)
  to authenticated;

-- Read own draft extract uploads (API download before attach) + linked extracts
create or replace function public.can_read_building_document(p_document_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_sensitive boolean;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_created text;
  v_title text;
  v_path text;
begin
  if public.can_manage_building_governance() then
    return true;
  end if;

  select d.status,
         public.meeting_file_is_sensitive(d.id),
         lower(nullif(btrim(coalesce(d.created_by_email, '')), '')),
         d.title,
         d.storage_path
    into v_status, v_sensitive, v_created, v_title, v_path
  from public.building_documents as d
  where d.id = p_document_id;

  if not found then
    return false;
  end if;

  -- Owner draft extract PDF they uploaded (attach pipeline)
  if v_email is not null
     and v_created is not distinct from v_email
     and v_status = 'draft'
     and coalesce(v_title, '') like 'Property Book extract %'
     and public.is_owner_extract_document_path(coalesce(v_path, ''))
     and public.is_owner()
  then
    return true;
  end if;

  -- Owner of property that already linked this document to an extract
  if exists (
    select 1
    from public.property_book_extracts as e
    where e.building_document_id = p_document_id
      and public.owns_property(e.property_id)
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.general_meeting_files as f
    join public.general_meeting_participants as p
      on p.proxy_document_id = f.document_id
    where f.document_id = p_document_id
      and f.file_type = 'proxy'
      and public.owns_property(p.property_id)
  ) then
    return true;
  end if;

  if v_sensitive then
    return false;
  end if;

  if public.is_owner() and v_status = 'published' then
    return true;
  end if;

  if public.is_staff() and v_status in ('published', 'archived') then
    return true;
  end if;

  return false;
end;
$fn$;

drop policy if exists building_documents_storage_insert_owner_extract on storage.objects;
create policy building_documents_storage_insert_owner_extract
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'building-documents'
  and public.can_upload_owner_extract_pdf(name)
);

drop policy if exists building_documents_insert_owner_extract on public.building_documents;
create policy building_documents_insert_owner_extract
on public.building_documents
for insert
to authenticated
with check (
  public.can_insert_owner_extract_building_document(
    id, status, category, title, storage_path, mime_type, created_by_email
  )
);
