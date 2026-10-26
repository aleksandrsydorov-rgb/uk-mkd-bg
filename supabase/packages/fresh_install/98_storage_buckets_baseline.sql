-- =============================================================================
-- Fresh-install: private Storage buckets + path-scoped helpers + RLS
-- =============================================================================
-- Buckets: request-photos, chat-files, uk-expense-receipts, poll-images,
--          building-documents, inventory-documents (all private).
-- Owner access is ONLY via property/document helpers — never "row exists" alone,
-- never blanket is_owner() on whole buckets.
-- Chronological SH-2C1 / INV-3 may replace helpers/policies with CREATE OR REPLACE
-- / DROP POLICY IF EXISTS (compatible).
-- =============================================================================

begin;

do $guard$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception
      'fresh_install storage baseline requires Supabase storage schema (storage.buckets / storage.objects)'
      using errcode = '42P01';
  end if;
  if to_regprocedure('public.owns_property(bigint)') is null
     or to_regprocedure('public.has_staff_role(text)') is null
     or to_regprocedure('public.is_owner()') is null
     or to_regprocedure('public.is_staff()') is null then
    raise exception
      'fresh_install storage baseline requires owns_property / staff helpers (apply 05 + 45 first)'
      using errcode = '42883';
  end if;
  if to_regclass('public.building_documents') is null
     or to_regclass('public.requests') is null
     or to_regclass('public.chat_messages') is null then
    raise exception
      'fresh_install storage baseline requires building_documents / requests / chat (apply 58 first)'
      using errcode = '42P01';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Buckets + limits
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'request-photos', 'request-photos', false, 10485760,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'image/bmp'
    ]
  ),
  (
    'poll-images', 'poll-images', false, 10485760,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'image/bmp'
    ]
  ),
  (
    'uk-expense-receipts', 'uk-expense-receipts', false, 10485760,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'image/bmp'
    ]
  ),
  (
    'chat-files', 'chat-files', false, 10485760,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'image/bmp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ]
  ),
  (
    'building-documents', 'building-documents', false, 20971520,
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ]
  ),
  (
    'inventory-documents', 'inventory-documents', false, 20971520,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'image/bmp',
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
-- Path / document helpers (package-owned; SH-2C1 may replace later)
-- ---------------------------------------------------------------------------

create or replace function public.private_object_name_ok(p_name text, p_prefix text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_name is not null
    and position('..' in p_name) = 0
    and p_name ~ (
      '^' || p_prefix || '/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
    );
$fn$;

create or replace function public.can_upload_request_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
begin
  if not public.private_object_name_ok(p_name, 'requests') then
    return false;
  end if;
  v_property_id := split_part(p_name, '/', 2)::bigint;
  if not exists (select 1 from public.properties as p where p.id = v_property_id) then
    return false;
  end if;
  return public.has_staff_role('администрация')
    or public.owns_property(v_property_id);
end;
$fn$;

create or replace function public.can_read_request_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.requests as r
    where r.photo_url = p_name
      and r.property_id is not null
      and p_name like 'requests/' || r.property_id::text || '/%'
      and (
        public.has_staff_role('администрация')
        or public.owns_property(r.property_id)
      )
  );
$fn$;

create or replace function public.can_upload_chat_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
begin
  if not public.private_object_name_ok(p_name, 'properties') then
    return false;
  end if;
  v_property_id := split_part(p_name, '/', 2)::bigint;
  if not exists (select 1 from public.properties as p where p.id = v_property_id) then
    return false;
  end if;
  return public.has_staff_role('администрация')
    or public.owns_property(v_property_id);
end;
$fn$;

create or replace function public.can_read_chat_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_messages as m
    where m.photo_url = p_name
      and p_name like 'properties/' || m.property_id::text || '/%'
      and (
        public.has_staff_role('администрация')
        or public.owns_property(m.property_id)
      )
  );
$fn$;

create or replace function public.uk_expense_is_published(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select lower(btrim(coalesce(p_status, ''))) in ('опубликован', 'approved', 'published')
    or btrim(coalesce(p_status, '')) = '';
$fn$;

-- Thin package stub; later staff-salary migration may replace.
create or replace function public.can_approve_uk_expenses()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер');
$fn$;

create or replace function public.can_upload_expense_receipt(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_expense_id bigint;
begin
  if not public.private_object_name_ok(p_name, 'expenses') then
    return false;
  end if;
  v_expense_id := split_part(p_name, '/', 2)::bigint;
  return exists (
    select 1
    from public.uk_expenses as e
    where e.id = v_expense_id
      and public.is_staff()
      and (
        public.can_approve_uk_expenses()
        or not public.uk_expense_is_published(e.status)
      )
  );
end;
$fn$;

create or replace function public.can_read_expense_receipt(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  -- Expenses are complex-wide published artifacts; staff always; owners only when published.
  select exists (
    select 1
    from public.uk_expenses as e
    where p_name = any (e.photo_urls)
      and p_name like 'expenses/' || e.id::text || '/%'
      and (
        public.is_staff()
        or (
          public.is_owner()
          and public.uk_expense_is_published(e.status)
        )
      )
  );
$fn$;

create or replace function public.can_upload_poll_image(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_poll_id bigint;
begin
  if not public.private_object_name_ok(p_name, 'polls') then
    return false;
  end if;
  v_poll_id := split_part(p_name, '/', 2)::bigint;
  return public.has_staff_role('администрация')
    and exists (select 1 from public.polls as p where p.id = v_poll_id);
end;
$fn$;

create or replace function public.can_read_poll_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.polls as p
    where p.photo_url = p_name
      and p_name like 'polls/' || p.id::text || '/%'
      and (public.is_owner() or public.is_staff())
  );
$fn$;

create or replace function public.meeting_file_is_sensitive(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.general_meeting_files as f
    where f.document_id = p_document_id
      and f.file_type in ('proxy', 'absentee_declaration')
  );
$fn$;

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
begin
  if public.can_manage_building_governance() then
    return true;
  end if;

  select d.status, public.meeting_file_is_sensitive(d.id)
    into v_status, v_sensitive
  from public.building_documents as d
  where d.id = p_document_id;

  if not found then
    return false;
  end if;

  -- Proxy: only the owner of the linked property (not "any owner").
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

  -- Published house docs: any complex owner (shared). Draft never.
  if public.is_owner() and v_status = 'published' then
    return true;
  end if;

  if public.is_staff() and v_status in ('published', 'archived') then
    return true;
  end if;

  return false;
end;
$fn$;

create or replace function public.can_read_building_document_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.building_documents as d
    where d.storage_path = p_path
      and public.can_read_building_document(d.id)
  );
$fn$;

revoke all on function public.private_object_name_ok(text, text) from public;
revoke all on function public.can_upload_request_photo(text) from public;
revoke all on function public.can_read_request_photo(text) from public;
revoke all on function public.can_upload_chat_file(text) from public;
revoke all on function public.can_read_chat_file(text) from public;
revoke all on function public.uk_expense_is_published(text) from public;
revoke all on function public.can_approve_uk_expenses() from public;
revoke all on function public.can_upload_expense_receipt(text) from public;
revoke all on function public.can_read_expense_receipt(text) from public;
revoke all on function public.can_upload_poll_image(text) from public;
revoke all on function public.can_read_poll_image(text) from public;
revoke all on function public.meeting_file_is_sensitive(uuid) from public;
revoke all on function public.can_read_building_document(uuid) from public;
revoke all on function public.can_read_building_document_path(text) from public;

revoke execute on function public.private_object_name_ok(text, text) from anon;
revoke execute on function public.can_upload_request_photo(text) from anon;
revoke execute on function public.can_read_request_photo(text) from anon;
revoke execute on function public.can_upload_chat_file(text) from anon;
revoke execute on function public.can_read_chat_file(text) from anon;
revoke execute on function public.uk_expense_is_published(text) from anon;
revoke execute on function public.can_approve_uk_expenses() from anon;
revoke execute on function public.can_upload_expense_receipt(text) from anon;
revoke execute on function public.can_read_expense_receipt(text) from anon;
revoke execute on function public.can_upload_poll_image(text) from anon;
revoke execute on function public.can_read_poll_image(text) from anon;
revoke execute on function public.meeting_file_is_sensitive(uuid) from anon;
revoke execute on function public.can_read_building_document(uuid) from anon;
revoke execute on function public.can_read_building_document_path(text) from anon;

grant execute on function public.private_object_name_ok(text, text) to authenticated;
grant execute on function public.can_upload_request_photo(text) to authenticated;
grant execute on function public.can_read_request_photo(text) to authenticated;
grant execute on function public.can_upload_chat_file(text) to authenticated;
grant execute on function public.can_read_chat_file(text) to authenticated;
grant execute on function public.uk_expense_is_published(text) to authenticated;
grant execute on function public.can_approve_uk_expenses() to authenticated;
grant execute on function public.can_upload_expense_receipt(text) to authenticated;
grant execute on function public.can_read_expense_receipt(text) to authenticated;
grant execute on function public.can_upload_poll_image(text) to authenticated;
grant execute on function public.can_read_poll_image(text) to authenticated;
grant execute on function public.meeting_file_is_sensitive(uuid) to authenticated;
grant execute on function public.can_read_building_document(uuid) to authenticated;
grant execute on function public.can_read_building_document_path(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies — always helper-gated (replace weak baselines)
-- ---------------------------------------------------------------------------

drop policy if exists request_photos_select on storage.objects;
drop policy if exists request_photos_insert on storage.objects;
drop policy if exists request_photos_delete on storage.objects;
create policy request_photos_select
on storage.objects for select to authenticated
using (bucket_id = 'request-photos' and public.can_read_request_photo(name));
create policy request_photos_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'request-photos' and public.can_upload_request_photo(name));
create policy request_photos_delete
on storage.objects for delete to authenticated
using (bucket_id = 'request-photos' and public.has_staff_role('администрация'));

drop policy if exists chat_files_select on storage.objects;
drop policy if exists chat_files_insert on storage.objects;
drop policy if exists chat_files_delete on storage.objects;
create policy chat_files_select
on storage.objects for select to authenticated
using (bucket_id = 'chat-files' and public.can_read_chat_file(name));
create policy chat_files_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'chat-files' and public.can_upload_chat_file(name));
create policy chat_files_delete
on storage.objects for delete to authenticated
using (bucket_id = 'chat-files' and public.has_staff_role('администрация'));

drop policy if exists uk_expense_receipts_select on storage.objects;
drop policy if exists uk_expense_receipts_insert on storage.objects;
drop policy if exists uk_expense_receipts_delete on storage.objects;
create policy uk_expense_receipts_select
on storage.objects for select to authenticated
using (bucket_id = 'uk-expense-receipts' and public.can_read_expense_receipt(name));
create policy uk_expense_receipts_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'uk-expense-receipts' and public.can_upload_expense_receipt(name));
create policy uk_expense_receipts_delete
on storage.objects for delete to authenticated
using (bucket_id = 'uk-expense-receipts' and public.has_staff_role('администрация'));

drop policy if exists poll_images_select on storage.objects;
drop policy if exists poll_images_insert on storage.objects;
drop policy if exists poll_images_delete on storage.objects;
create policy poll_images_select
on storage.objects for select to authenticated
using (bucket_id = 'poll-images' and public.can_read_poll_image(name));
create policy poll_images_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'poll-images' and public.can_upload_poll_image(name));
create policy poll_images_delete
on storage.objects for delete to authenticated
using (bucket_id = 'poll-images' and public.has_staff_role('администрация'));

drop policy if exists building_documents_storage_select on storage.objects;
drop policy if exists building_documents_storage_insert on storage.objects;
drop policy if exists building_documents_storage_update on storage.objects;
drop policy if exists building_documents_storage_delete on storage.objects;
create policy building_documents_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'building-documents'
  and public.can_read_building_document_path(name)
);
create policy building_documents_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
);
create policy building_documents_storage_update
on storage.objects for update to authenticated
using (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
)
with check (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
);
create policy building_documents_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'building-documents'
  and public.can_manage_building_governance()
);

-- Inventory: admin-only until INV-3 helpers exist; if they exist, use them.
drop policy if exists inventory_documents_storage_select on storage.objects;
drop policy if exists inventory_documents_storage_insert on storage.objects;
drop policy if exists inventory_documents_storage_update on storage.objects;
drop policy if exists inventory_documents_storage_delete on storage.objects;

do $inv$
begin
  if to_regprocedure('public.can_read_inventory_document(text)') is not null
     and to_regprocedure('public.can_upload_inventory_document(text)') is not null
     and to_regprocedure('public.inventory_is_admin()') is not null then
    execute $p$
      create policy inventory_documents_storage_select
      on storage.objects for select to authenticated
      using (bucket_id = 'inventory-documents' and public.can_read_inventory_document(name))
    $p$;
    execute $p$
      create policy inventory_documents_storage_insert
      on storage.objects for insert to authenticated
      with check (bucket_id = 'inventory-documents' and public.can_upload_inventory_document(name))
    $p$;
    execute $p$
      create policy inventory_documents_storage_update
      on storage.objects for update to authenticated
      using (false) with check (false)
    $p$;
    execute $p$
      create policy inventory_documents_storage_delete
      on storage.objects for delete to authenticated
      using (bucket_id = 'inventory-documents' and public.inventory_is_admin())
    $p$;
  else
    -- Fail closed: no owner read of inventory until INV-3 helpers are installed.
    execute $p$
      create policy inventory_documents_storage_select
      on storage.objects for select to authenticated
      using (bucket_id = 'inventory-documents' and public.has_staff_role('администрация'))
    $p$;
    execute $p$
      create policy inventory_documents_storage_insert
      on storage.objects for insert to authenticated
      with check (bucket_id = 'inventory-documents' and public.has_staff_role('администрация'))
    $p$;
    execute $p$
      create policy inventory_documents_storage_update
      on storage.objects for update to authenticated
      using (false) with check (false)
    $p$;
    execute $p$
      create policy inventory_documents_storage_delete
      on storage.objects for delete to authenticated
      using (bucket_id = 'inventory-documents' and public.has_staff_role('администрация'))
    $p$;
  end if;
end;
$inv$;

-- Align table SELECT with the same helper (not open grant alone).
drop policy if exists building_documents_select on public.building_documents;
create policy building_documents_select
on public.building_documents
for select
to authenticated
using (public.can_read_building_document(id));

commit;
