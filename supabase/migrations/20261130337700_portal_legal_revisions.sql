-- Public legal document revisions for the complex portal.
-- A published language snapshot is immutable. A change is a new revision.
-- Anonymous clients can read only revisions explicitly released for public access.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create table if not exists public.portal_legal_revisions (
  id uuid primary key,
  document_kind text not null,
  revision_number integer not null,
  status text not null,
  public_access boolean not null default false,
  test_edition boolean not null default false,
  published_at timestamptz,
  effective_on date,
  created_at timestamptz not null default now(),
  constraint portal_legal_revisions_kind_check check (
    document_kind in ('operator_contacts', 'portal_terms', 'privacy', 'cookies', 'house_rules')
  ),
  constraint portal_legal_revisions_status_check check (
    status in ('draft', 'published', 'superseded')
  ),
  constraint portal_legal_revisions_number_check check (revision_number > 0),
  constraint portal_legal_revisions_kind_number_key unique (document_kind, revision_number),
  constraint portal_legal_revisions_public_status_check check (
    (public_access = true and status in ('published', 'superseded'))
    or (public_access = false and status = 'draft')
  )
);

create table if not exists public.portal_legal_texts (
  id uuid primary key,
  revision_id uuid not null references public.portal_legal_revisions (id) on delete restrict,
  locale text not null,
  title text not null,
  body_snapshot text not null,
  body_sha256 text not null,
  is_original boolean not null default false,
  created_at timestamptz not null default now(),
  constraint portal_legal_texts_locale_check check (locale in ('bg', 'ru', 'en')),
  constraint portal_legal_texts_revision_locale_key unique (revision_id, locale)
);

create table if not exists public.portal_legal_attachments (
  id uuid primary key,
  revision_id uuid not null references public.portal_legal_revisions (id) on delete restrict,
  text_id uuid references public.portal_legal_texts (id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  public_access boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists portal_legal_revisions_public_idx
  on public.portal_legal_revisions (document_kind, revision_number desc)
  where public_access = true;

alter table public.portal_legal_revisions enable row level security;
alter table public.portal_legal_texts enable row level security;
alter table public.portal_legal_attachments enable row level security;

revoke all on table public.portal_legal_revisions from public, anon, authenticated;
revoke all on table public.portal_legal_texts from public, anon, authenticated;
revoke all on table public.portal_legal_attachments from public, anon, authenticated;

create or replace function public.portal_legal_guard()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
  parent_id uuid;
  allow text;
begin
  allow := current_setting('portal_legal.maintenance', true);

  if TG_TABLE_NAME = 'portal_legal_revisions' then
    if TG_OP = 'INSERT' then
      if NEW.status <> 'draft' or NEW.public_access then
        raise exception 'portal_legal_immutable' using errcode = '42501';
      end if;
      return NEW;
    end if;

    if TG_OP = 'DELETE' then
      if OLD.status <> 'draft' then
        raise exception 'portal_legal_immutable' using errcode = '42501';
      end if;
      return OLD;
    end if;

    if TG_OP = 'UPDATE' and OLD.status = 'draft' then
      return NEW;
    end if;

    if TG_OP = 'UPDATE'
      and allow = 'supersede'
      and OLD.status = 'published'
      and NEW.status = 'superseded'
      and NEW.public_access = true
      and NEW.id = OLD.id
      and NEW.document_kind = OLD.document_kind
      and NEW.revision_number = OLD.revision_number
      and NEW.test_edition is not distinct from OLD.test_edition
      and NEW.published_at is not distinct from OLD.published_at
      and NEW.effective_on is not distinct from OLD.effective_on
      and NEW.created_at is not distinct from OLD.created_at
    then
      return NEW;
    end if;

    raise exception 'portal_legal_immutable' using errcode = '42501';
  end if;

  parent_id := case when TG_OP = 'DELETE' then OLD.revision_id else NEW.revision_id end;
  select status into parent_status
  from public.portal_legal_revisions
  where id = parent_id;

  if parent_status is distinct from 'draft' then
    raise exception 'portal_legal_immutable' using errcode = '42501';
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists portal_legal_revisions_guard on public.portal_legal_revisions;
create trigger portal_legal_revisions_guard
  before insert or update or delete on public.portal_legal_revisions
  for each row execute function public.portal_legal_guard();

drop trigger if exists portal_legal_texts_guard on public.portal_legal_texts;
create trigger portal_legal_texts_guard
  before insert or update or delete on public.portal_legal_texts
  for each row execute function public.portal_legal_guard();

drop trigger if exists portal_legal_attachments_guard on public.portal_legal_attachments;
create trigger portal_legal_attachments_guard
  before insert or update or delete on public.portal_legal_attachments
  for each row execute function public.portal_legal_guard();

create or replace function public.portal_legal_create_draft(
  p_id uuid,
  p_kind text,
  p_number integer,
  p_effective date,
  p_test boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portal_legal_revisions (
    id, document_kind, revision_number, status, public_access, test_edition, effective_on
  ) values (
    p_id, p_kind, p_number, 'draft', false, coalesce(p_test, false), p_effective
  );
  return p_id;
end;
$$;

create or replace function public.portal_legal_add_text(
  p_id uuid,
  p_revision_id uuid,
  p_locale text,
  p_title text,
  p_body text,
  p_original boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  digest_hex text;
begin
  digest_hex := encode(extensions.digest(convert_to(p_body, 'UTF8'), 'sha256'), 'hex');
  insert into public.portal_legal_texts (
    id, revision_id, locale, title, body_snapshot, body_sha256, is_original
  ) values (
    p_id, p_revision_id, p_locale, p_title, p_body, digest_hex, coalesce(p_original, false)
  );
  return p_id;
end;
$$;

create or replace function public.portal_legal_add_attachment(
  p_id uuid,
  p_revision_id uuid,
  p_text_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_public boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portal_legal_attachments (
    id, revision_id, text_id, storage_path, file_name, content_type, public_access
  ) values (
    p_id, p_revision_id, p_text_id, p_storage_path, p_file_name, p_content_type, coalesce(p_public, false)
  );
  return p_id;
end;
$$;

create or replace function public.portal_legal_publish(p_revision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.portal_legal_revisions%rowtype;
  has_original boolean;
begin
  select * into rec from public.portal_legal_revisions where id = p_revision_id for update;
  if rec.id is null then
    raise exception 'portal_legal_not_found' using errcode = 'P0002';
  end if;
  if rec.status <> 'draft' then
    raise exception 'portal_legal_not_draft' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.portal_legal_texts
    where revision_id = rec.id and locale = 'bg' and is_original
  ) into has_original;
  if not has_original then
    raise exception 'portal_legal_original_bg_required' using errcode = '23514';
  end if;

  perform set_config('portal_legal.maintenance', 'supersede', true);
  update public.portal_legal_revisions
  set status = 'superseded'
  where document_kind = rec.document_kind
    and status = 'published'
    and id <> rec.id;
  perform set_config('portal_legal.maintenance', '', true);

  update public.portal_legal_revisions
  set status = 'published',
      public_access = true,
      published_at = now()
  where id = rec.id;

  return rec.id;
end;
$$;

create or replace function public.portal_legal_payload(p_revision_id uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with rev as (
    select *
    from public.portal_legal_revisions
    where id = p_revision_id
      and public_access = true
      and status in ('published', 'superseded')
  ),
  requested as (
    select t.*
    from public.portal_legal_texts t
    join rev on rev.id = t.revision_id
    where t.locale = p_locale
  ),
  original as (
    select t.*
    from public.portal_legal_texts t
    join rev on rev.id = t.revision_id
    where t.is_original or t.locale = 'bg'
    order by t.is_original desc
    limit 1
  ),
  chosen as (
    select * from requested
    union all
    select * from original where not exists (select 1 from requested)
    limit 1
  )
  select case
    when not exists (select 1 from rev) or not exists (select 1 from chosen) then null
    else jsonb_build_object(
      'revision_id', rev.id,
      'text_id', chosen.id,
      'document_kind', rev.document_kind,
      'revision_number', rev.revision_number,
      'status', rev.status,
      'test_edition', rev.test_edition,
      'published_at', rev.published_at,
      'effective_on', rev.effective_on,
      'locale', chosen.locale,
      'requested_locale', p_locale,
      'translation_missing', chosen.locale is distinct from p_locale,
      'is_original', chosen.is_original,
      'title', chosen.title,
      'body', chosen.body_snapshot,
      'body_sha256', chosen.body_sha256
    )
  end
  from rev, chosen;
$$;

create or replace function public.public_portal_legal_current(p_kind text, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.portal_legal_payload(r.id, coalesce(nullif(p_locale, ''), 'bg'))
  from public.portal_legal_revisions r
  where r.document_kind = p_kind
    and r.status = 'published'
    and r.public_access = true
  order by r.revision_number desc
  limit 1;
$$;

create or replace function public.public_portal_legal_revision(p_revision_id uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.portal_legal_payload(p_revision_id, coalesce(nullif(p_locale, ''), 'bg'));
$$;

create or replace function public.public_portal_legal_archive(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(item order by revision_number desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'revision_id', r.id,
      'document_kind', r.document_kind,
      'revision_number', r.revision_number,
      'status', r.status,
      'test_edition', r.test_edition,
      'published_at', r.published_at,
      'effective_on', r.effective_on
    ) as item,
    r.revision_number
    from public.portal_legal_revisions r
    where r.document_kind = p_kind
      and r.public_access = true
      and r.status in ('published', 'superseded')
  ) listed;
$$;

create or replace function public.public_portal_legal_attachment(p_attachment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a.public_access
      and r.public_access
      and r.status in ('published', 'superseded')
    then jsonb_build_object(
      'attachment_id', a.id,
      'revision_id', a.revision_id,
      'text_id', a.text_id,
      'file_name', a.file_name,
      'content_type', a.content_type,
      'public_access', true
    )
    else null
  end
  from public.portal_legal_attachments a
  join public.portal_legal_revisions r on r.id = a.revision_id
  where a.id = p_attachment_id;
$$;

revoke all on function public.portal_legal_guard() from public, anon, authenticated;
revoke all on function public.portal_legal_create_draft(uuid, text, integer, date, boolean) from public, anon, authenticated;
revoke all on function public.portal_legal_add_text(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.portal_legal_add_attachment(uuid, uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.portal_legal_publish(uuid) from public, anon, authenticated;
revoke all on function public.portal_legal_payload(uuid, text) from public, anon, authenticated;

revoke all on function public.public_portal_legal_current(text, text) from public;
revoke all on function public.public_portal_legal_revision(uuid, text) from public;
revoke all on function public.public_portal_legal_archive(text) from public;
revoke all on function public.public_portal_legal_attachment(uuid) from public;

grant execute on function public.public_portal_legal_current(text, text) to anon, authenticated;
grant execute on function public.public_portal_legal_revision(uuid, text) to anon, authenticated;
grant execute on function public.public_portal_legal_archive(text) to anon, authenticated;
grant execute on function public.public_portal_legal_attachment(uuid) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.portal_legal_create_draft(uuid, text, integer, date, boolean) to service_role;
    grant execute on function public.portal_legal_add_text(uuid, uuid, text, text, text, boolean) to service_role;
    grant execute on function public.portal_legal_add_attachment(uuid, uuid, uuid, text, text, text, boolean) to service_role;
    grant execute on function public.portal_legal_publish(uuid) to service_role;
  end if;
end;
$$;
