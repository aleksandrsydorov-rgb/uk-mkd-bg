-- SH-2C1 confidentiality: support-fee base amount, private attachment buckets,
-- and general-meeting file types. Does not change fee math, meeting lifecycle,
-- voting, quorum, attendance, or eligibility.

begin;

-- ---------------------------------------------------------------------------
-- M1. support_fee_base_amount: same calculation, caller must be allowed.
-- ---------------------------------------------------------------------------

create or replace function public.support_fee_base_amount(p_property_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_area numeric;
  v_rate numeric;
begin
  if not (
    public.owns_property(p_property_id)
    or public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'support_fee_base_amount: not allowed'
      using errcode = '42501';
  end if;

  select coalesce(p.area_sqm, 0)::numeric
    into v_area
  from public.properties as p
  where p.id = p_property_id;

  if not found then
    return 0;
  end if;

  select bs.support_rate_eur_per_sqm_year
    into v_rate
  from public.building_settings as bs
  where bs.id = 1;

  if v_rate is null or v_rate <= 0 then
    v_rate := 8;
  end if;

  return round(coalesce(v_area, 0) * v_rate, 2);
end;
$fn$;

revoke all on function public.support_fee_base_amount(bigint) from public;
revoke execute on function public.support_fee_base_amount(bigint) from anon;
grant execute on function public.support_fee_base_amount(bigint) to authenticated;

-- Engineer directory keeps the properties row shape. Area is a fee input and
-- is not used by the water/electricity apartment selector.
create or replace function public.list_staff_property_directory()
returns setof public.properties
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_finance boolean := public.has_staff_role('администрация') or public.has_staff_role('бухгалтер');
  v_engineer boolean := public.has_staff_role('инженер');
begin
  if not (v_finance or v_engineer) then
    return;
  end if;

  return query
  select
    p.id,
    p.created_at,
    p.apartment_number,
    p.floor,
    case when v_finance then p.area_sqm else null::double precision end,
    p.status,
    case when v_finance then p.owner_name else null end,
    null::text,
    null::text,
    case when v_finance then p.debt else null end,
    case when v_finance then p.overpayment else null end,
    p.electricity_meter_number,
    p.occupancy_status,
    null::text,
    case when v_finance then p.owner_type else null end,
    case when v_finance then p.company_name else null end,
    null::text,
    null::text,
    null::text,
    null::text,
    null::date,
    case when v_finance then p.purpose else null end,
    case when v_finance then p.ideal_parts_percent else null::numeric(12,6) end,
    case when v_finance then p.ideal_parts_source else null end,
    case when v_finance then p.ideal_parts_note else null end,
    case when v_finance then p.ideal_parts_meeting_ref else null end,
    null::text
  from public.properties as p
  order by p.apartment_number, p.id;
end;
$fn$;

revoke all on function public.list_staff_property_directory() from public;
revoke execute on function public.list_staff_property_directory() from anon;
grant execute on function public.list_staff_property_directory() to authenticated;

-- Modes stay on the table. The annual support rate is not selectable by
-- authenticated; finance roles and owners receive it from this function.
revoke select on table public.building_settings from anon, public, authenticated;
grant select (
  id,
  updated_at,
  updated_by,
  electricity_mode,
  water_mode
) on table public.building_settings to authenticated;

create or replace function public.read_building_settings()
returns table (
  id integer,
  electricity_mode text,
  water_mode text,
  updated_at timestamptz,
  updated_by text,
  support_rate_eur_per_sqm_year numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return query
  select
    bs.id,
    bs.electricity_mode,
    bs.water_mode,
    bs.updated_at,
    bs.updated_by,
    case
      when public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
        or public.is_owner()
      then bs.support_rate_eur_per_sqm_year
      else null::numeric
    end
  from public.building_settings as bs
  where bs.id = 1;
end;
$fn$;

revoke all on function public.read_building_settings() from public;
revoke execute on function public.read_building_settings() from anon;
grant execute on function public.read_building_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- M2. Private buckets. Download requires a canonical row, not a path guess.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('request-photos', 'request-photos', false),
  ('chat-files', 'chat-files', false),
  ('uk-expense-receipts', 'uk-expense-receipts', false),
  ('poll-images', 'poll-images', false)
on conflict (id) do update
  set public = false,
      name = excluded.name;

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
    where to_jsonb(m) ->> 'photo_url' = p_name
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

revoke all on function public.private_object_name_ok(text, text) from public;
revoke all on function public.can_upload_request_photo(text) from public;
revoke all on function public.can_read_request_photo(text) from public;
revoke all on function public.can_upload_chat_file(text) from public;
revoke all on function public.can_read_chat_file(text) from public;
revoke all on function public.uk_expense_is_published(text) from public;
revoke all on function public.can_upload_expense_receipt(text) from public;
revoke all on function public.can_read_expense_receipt(text) from public;
revoke all on function public.can_upload_poll_image(text) from public;
revoke all on function public.can_read_poll_image(text) from public;

revoke execute on function public.private_object_name_ok(text, text) from anon;
revoke execute on function public.can_upload_request_photo(text) from anon;
revoke execute on function public.can_read_request_photo(text) from anon;
revoke execute on function public.can_upload_chat_file(text) from anon;
revoke execute on function public.can_read_chat_file(text) from anon;
revoke execute on function public.uk_expense_is_published(text) from anon;
revoke execute on function public.can_upload_expense_receipt(text) from anon;
revoke execute on function public.can_read_expense_receipt(text) from anon;
revoke execute on function public.can_upload_poll_image(text) from anon;
revoke execute on function public.can_read_poll_image(text) from anon;

grant execute on function public.private_object_name_ok(text, text) to authenticated;
grant execute on function public.can_upload_request_photo(text) to authenticated;
grant execute on function public.can_read_request_photo(text) to authenticated;
grant execute on function public.can_upload_chat_file(text) to authenticated;
grant execute on function public.can_read_chat_file(text) to authenticated;
grant execute on function public.uk_expense_is_published(text) to authenticated;
grant execute on function public.can_upload_expense_receipt(text) to authenticated;
grant execute on function public.can_read_expense_receipt(text) to authenticated;
grant execute on function public.can_upload_poll_image(text) to authenticated;
grant execute on function public.can_read_poll_image(text) to authenticated;

drop policy if exists request_photos_select on storage.objects;
drop policy if exists request_photos_insert on storage.objects;
drop policy if exists request_photos_delete on storage.objects;
create policy request_photos_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'request-photos'
  and public.can_read_request_photo(name)
);
create policy request_photos_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'request-photos'
  and public.can_upload_request_photo(name)
);
create policy request_photos_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'request-photos'
  and public.has_staff_role('администрация')
);

drop policy if exists chat_files_select on storage.objects;
drop policy if exists chat_files_insert on storage.objects;
drop policy if exists chat_files_delete on storage.objects;
create policy chat_files_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-files'
  and public.can_read_chat_file(name)
);
create policy chat_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-files'
  and public.can_upload_chat_file(name)
);
create policy chat_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-files'
  and public.has_staff_role('администрация')
);

drop policy if exists uk_expense_receipts_select on storage.objects;
drop policy if exists uk_expense_receipts_insert on storage.objects;
drop policy if exists uk_expense_receipts_delete on storage.objects;
create policy uk_expense_receipts_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'uk-expense-receipts'
  and public.can_read_expense_receipt(name)
);
create policy uk_expense_receipts_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'uk-expense-receipts'
  and public.can_upload_expense_receipt(name)
);
create policy uk_expense_receipts_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'uk-expense-receipts'
  and public.has_staff_role('администрация')
);

drop policy if exists poll_images_select on storage.objects;
drop policy if exists poll_images_insert on storage.objects;
drop policy if exists poll_images_delete on storage.objects;
create policy poll_images_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'poll-images'
  and public.can_read_poll_image(name)
);
create policy poll_images_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'poll-images'
  and public.can_upload_poll_image(name)
);
create policy poll_images_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'poll-images'
  and public.has_staff_role('администрация')
);

-- ---------------------------------------------------------------------------
-- M3. Shared meeting files stay shared. Proxy and absentee do not.
-- ---------------------------------------------------------------------------

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

revoke all on function public.meeting_file_is_sensitive(uuid) from public;
revoke all on function public.can_read_building_document(uuid) from public;
revoke all on function public.can_read_building_document_path(text) from public;
revoke execute on function public.meeting_file_is_sensitive(uuid) from anon;
revoke execute on function public.can_read_building_document(uuid) from anon;
revoke execute on function public.can_read_building_document_path(text) from anon;
grant execute on function public.meeting_file_is_sensitive(uuid) to authenticated;
grant execute on function public.can_read_building_document(uuid) to authenticated;
grant execute on function public.can_read_building_document_path(text) to authenticated;

drop policy if exists building_documents_select on public.building_documents;
create policy building_documents_select
on public.building_documents
for select
to authenticated
using (public.can_read_building_document(id));

drop policy if exists general_meeting_files_select on public.general_meeting_files;
create policy general_meeting_files_select
on public.general_meeting_files
for select
to authenticated
using (
  public.can_manage_building_governance()
  or (
    file_type = 'proxy'
    and exists (
      select 1
      from public.general_meeting_participants as p
      where p.proxy_document_id = general_meeting_files.document_id
        and public.owns_property(p.property_id)
    )
  )
  or (
    file_type not in ('proxy', 'absentee_declaration')
    and exists (
      select 1
      from public.general_meetings as m
      where m.id = meeting_id
        and m.status <> 'draft'
        and (public.is_owner() or public.is_staff())
    )
  )
);

drop policy if exists building_documents_storage_select on storage.objects;
create policy building_documents_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'building-documents'
  and public.can_read_building_document_path(name)
);

commit;
