-- Admin workplace for legal revisions and the acknowledgement register.
-- Publication stays on the existing portal_legal_publish / portal_legal_set_draft_policy
-- functions. Callers are checked here; service_role is not handed to the browser.
-- Effective dates use the calendar date in Europe/Sofia.

alter table public.portal_legal_revisions
  add column if not exists approval_act_ref text,
  add column if not exists approval_act_date date;

alter table public.portal_legal_revisions
  drop constraint if exists portal_legal_revisions_approval_kind_check;
alter table public.portal_legal_revisions
  add constraint portal_legal_revisions_approval_kind_check check (
    (approval_act_ref is null and approval_act_date is null)
    or document_kind = 'house_rules'
  );

alter table public.portal_legal_attachments
  add column if not exists content bytea,
  add column if not exists content_sha256 text;

create table if not exists public.portal_legal_audit (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null,
  actor_user_id uuid not null,
  actor_email text,
  actor_role text not null,
  action text not null,
  revision_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

revoke all on table public.portal_legal_audit from public, anon, authenticated;

create index if not exists portal_legal_audit_revision_idx
  on public.portal_legal_audit (revision_id, created_at desc);

create index if not exists portal_legal_ack_complex_confirmed_idx
  on public.portal_legal_acknowledgements (complex_id, confirmed_at desc);

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
      and NEW.acceptance_required is not distinct from OLD.acceptance_required
      and NEW.offer_acknowledgement is not distinct from OLD.offer_acknowledgement
      and NEW.approval_act_ref is not distinct from OLD.approval_act_ref
      and NEW.approval_act_date is not distinct from OLD.approval_act_date
      and NEW.published_at is not distinct from OLD.published_at
      and NEW.effective_on is not distinct from OLD.effective_on
      and NEW.created_at is not distinct from OLD.created_at
    then
      return NEW;
    end if;

    raise exception 'portal_legal_immutable' using errcode = '42501';
  end if;

  if TG_TABLE_NAME = 'portal_legal_acknowledgements' then
    raise exception 'portal_legal_ack_immutable' using errcode = '42501';
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

create or replace function public.portal_legal_today()
returns date
language sql
stable
as $$
  select (timezone('Europe/Sofia', now()))::date;
$$;

create or replace function public.portal_legal_terms_obligation()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with effective as (
    select *
    from public.portal_legal_revisions
    where document_kind = 'portal_terms'
      and public_access = true
      and status in ('published', 'superseded')
      and (effective_on is null or effective_on <= public.portal_legal_today())
  ),
  current_effective as (
    select *
    from effective
    order by revision_number desc
    limit 1
  )
  select case
    when c.acceptance_required then c.id
    else (
      select e.id
      from effective e
      where e.acceptance_required = true
        and e.revision_number < c.revision_number
      order by e.revision_number desc
      limit 1
    )
  end
  from current_effective c;
$$;

create or replace function public.portal_legal_visitor_revision(p_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.portal_legal_revisions r
  where r.document_kind = p_kind
    and r.public_access = true
    and r.status in ('published', 'superseded')
    and (r.effective_on is null or r.effective_on <= public.portal_legal_today())
  order by r.revision_number desc
  limit 1;
$$;

create or replace function public.portal_legal_offered_revision(p_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.portal_legal_revisions r
  where r.id = public.portal_legal_visitor_revision(p_kind)
    and r.offer_acknowledgement = true;
$$;

create or replace function public.public_portal_legal_current(p_kind text, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.portal_legal_payload(
    public.portal_legal_visitor_revision(p_kind),
    coalesce(nullif(p_locale, ''), 'bg')
  );
$$;

create or replace function public.public_portal_legal_revision(p_revision_id uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.effective_on is not null and r.effective_on > public.portal_legal_today() then null
    else public.portal_legal_payload(r.id, coalesce(nullif(p_locale, ''), 'bg'))
  end
  from public.portal_legal_revisions r
  where r.id = p_revision_id
    and r.public_access = true
    and r.status in ('published', 'superseded');
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
      and (r.effective_on is null or r.effective_on <= public.portal_legal_today())
  ) listed;
$$;

create or replace function public.portal_legal_admin_identity()
returns table (user_id uuid, email text, actor_role text, access text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.portal_legal_uid();
  jwt_email text := lower(btrim(coalesce(
    current_setting('request.jwt.claim.email', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'email',
    ''
  )));
  staff_role text;
  staff_active boolean;
  member_role text;
begin
  if uid is null then
    return;
  end if;

  if to_regclass('public.staff') is not null and jwt_email <> '' then
    execute
      'select role, active from public.staff where lower(btrim(email)) = $1 order by id limit 1'
      into staff_role, staff_active
      using jwt_email;
    if staff_role is not null then
      user_id := uid;
      email := jwt_email;
      actor_role := staff_role;
      access := case
        when staff_active is true and staff_role = 'администрация' then 'publish'
        else 'none'
      end;
      return next;
      return;
    end if;
  end if;

  select m.member_role into member_role
  from public.portal_legal_members m
  where m.user_id = uid;

  if member_role = 'admin' then
    user_id := uid;
    email := nullif(jwt_email, '');
    actor_role := 'admin';
    access := 'publish';
    return next;
  end if;
end;
$$;

create or replace function public.portal_legal_assert_publish()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ident record;
begin
  select * into ident from public.portal_legal_admin_identity();
  if ident.user_id is null or ident.access is distinct from 'publish' then
    raise exception 'portal_legal_forbidden' using errcode = '42501';
  end if;
  if public.portal_legal_complex_id() is null then
    raise exception 'portal_legal_forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.portal_legal_admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ident record;
  obligation uuid;
  result jsonb;
begin
  perform public.portal_legal_assert_publish();
  select * into ident from public.portal_legal_admin_identity();
  obligation := public.portal_legal_terms_obligation();

  select coalesce(jsonb_agg(kind_row order by kind_row->>'document_kind'), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'document_kind', k.kind,
      'visitor_revision_id', public.portal_legal_visitor_revision(k.kind),
      'obligation_revision_id', case when k.kind = 'portal_terms' then obligation else null end,
      'revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'revision_number', r.revision_number,
          'status', r.status,
          'test_edition', r.test_edition,
          'published_at', r.published_at,
          'effective_on', r.effective_on,
          'acceptance_required', r.acceptance_required,
          'offer_acknowledgement', r.offer_acknowledgement,
          'approval_act_ref', r.approval_act_ref,
          'approval_act_date', r.approval_act_date,
          'title', (
            select t.title from public.portal_legal_texts t
            where t.revision_id = r.id and t.locale = 'bg'
          ),
          'visitor_current', r.id = public.portal_legal_visitor_revision(k.kind),
          'owner_obligation', k.kind = 'portal_terms' and r.id = obligation,
          'scheduled', r.status = 'published'
            and r.effective_on is not null
            and r.effective_on > public.portal_legal_today()
        ) order by r.revision_number desc)
        from public.portal_legal_revisions r
        where r.document_kind = k.kind
      ), '[]'::jsonb)
    ) as kind_row
    from (
      select unnest(array[
        'portal_terms', 'privacy', 'cookies', 'house_rules', 'operator_contacts'
      ]) as kind
    ) k
  ) listed;

  return jsonb_build_object(
    'today', public.portal_legal_today(),
    'actor_email', ident.email,
    'actor_role', ident.actor_role,
    'kinds', result
  );
end;
$$;

create or replace function public.portal_legal_admin_revision(p_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.portal_legal_assert_publish();
  select jsonb_build_object(
    'id', r.id,
    'document_kind', r.document_kind,
    'revision_number', r.revision_number,
    'status', r.status,
    'test_edition', r.test_edition,
    'published_at', r.published_at,
    'effective_on', r.effective_on,
    'acceptance_required', r.acceptance_required,
    'offer_acknowledgement', r.offer_acknowledgement,
    'approval_act_ref', r.approval_act_ref,
    'approval_act_date', r.approval_act_date,
    'visitor_current', r.id = public.portal_legal_visitor_revision(r.document_kind),
    'owner_obligation', r.document_kind = 'portal_terms' and r.id = public.portal_legal_terms_obligation(),
    'scheduled', r.status = 'published' and r.effective_on is not null and r.effective_on > public.portal_legal_today(),
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'locale', t.locale,
        'title', t.title,
        'body', t.body_snapshot,
        'body_sha256', t.body_sha256,
        'is_original', t.is_original
      ) order by t.locale)
      from public.portal_legal_texts t
      where t.revision_id = r.id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'file_name', a.file_name,
        'content_type', a.content_type,
        'public_access', a.public_access,
        'content_sha256', a.content_sha256
      ) order by a.file_name)
      from public.portal_legal_attachments a
      where a.revision_id = r.id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', g.action,
        'actor_email', g.actor_email,
        'actor_role', g.actor_role,
        'created_at', g.created_at,
        'detail', g.detail
      ) order by g.created_at desc)
      from public.portal_legal_audit g
      where g.revision_id = r.id
    ), '[]'::jsonb)
  )
  into result
  from public.portal_legal_revisions r
  where r.id = p_revision_id;

  return result;
end;
$$;

create or replace function public.portal_legal_admin_create_draft(
  p_kind text,
  p_effective date,
  p_from_revision uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  next_number integer;
  source public.portal_legal_revisions%rowtype;
begin
  perform public.portal_legal_assert_publish();
  if p_kind not in ('portal_terms', 'privacy', 'cookies', 'house_rules', 'operator_contacts') then
    raise exception 'portal_legal_kind' using errcode = '22023';
  end if;
  if p_effective is null then
    raise exception 'portal_legal_effective_required' using errcode = '23514';
  end if;

  if p_from_revision is not null then
    select * into source from public.portal_legal_revisions where id = p_from_revision;
    if source.id is null or source.document_kind <> p_kind then
      raise exception 'portal_legal_not_found' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(max(revision_number), 0) + 1
  into next_number
  from public.portal_legal_revisions
  where document_kind = p_kind;

  perform public.portal_legal_create_draft(new_id, p_kind, next_number, p_effective, false);

  if source.id is not null then
    insert into public.portal_legal_texts (
      id, revision_id, locale, title, body_snapshot, body_sha256, is_original
    )
    select gen_random_uuid(), new_id, t.locale, t.title, t.body_snapshot, t.body_sha256, t.is_original
    from public.portal_legal_texts t
    where t.revision_id = source.id;

    insert into public.portal_legal_attachments (
      id, revision_id, text_id, storage_path, file_name, content_type, public_access, content, content_sha256
    )
    select gen_random_uuid(), new_id, null, 'portal-legal/' || gen_random_uuid()::text,
      a.file_name, a.content_type, a.public_access, a.content, a.content_sha256
    from public.portal_legal_attachments a
    where a.revision_id = source.id;

    if p_kind = 'house_rules' then
      update public.portal_legal_revisions
      set approval_act_ref = source.approval_act_ref,
          approval_act_date = source.approval_act_date
      where id = new_id
        and status = 'draft';
    end if;
  end if;

  return new_id;
end;
$$;

create or replace function public.portal_legal_admin_save_text(
  p_revision_id uuid,
  p_locale text,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rev public.portal_legal_revisions%rowtype;
  text_id uuid;
  digest_hex text;
begin
  perform public.portal_legal_assert_publish();
  if p_locale not in ('bg', 'ru', 'en') then
    raise exception 'portal_legal_locale' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null or nullif(p_body, '') is null then
    raise exception 'portal_legal_text_required' using errcode = '23514';
  end if;

  select * into rev from public.portal_legal_revisions where id = p_revision_id;
  if rev.id is null then
    raise exception 'portal_legal_not_found' using errcode = 'P0002';
  end if;
  if rev.status <> 'draft' then
    raise exception 'portal_legal_not_draft' using errcode = '42501';
  end if;

  digest_hex := encode(extensions.digest(convert_to(p_body, 'UTF8'), 'sha256'), 'hex');
  select t.id into text_id
  from public.portal_legal_texts t
  where t.revision_id = rev.id and t.locale = p_locale;

  if text_id is null then
    text_id := gen_random_uuid();
    perform public.portal_legal_add_text(text_id, rev.id, p_locale, btrim(p_title), p_body, p_locale = 'bg');
    update public.portal_legal_texts
    set body_sha256 = digest_hex
    where id = text_id;
  else
    update public.portal_legal_texts
    set title = btrim(p_title),
        body_snapshot = p_body,
        body_sha256 = digest_hex,
        is_original = p_locale = 'bg'
    where id = text_id;
  end if;

  return text_id;
end;
$$;

create or replace function public.portal_legal_admin_save_approval(
  p_revision_id uuid,
  p_ref text,
  p_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  updated uuid;
begin
  perform public.portal_legal_assert_publish();
  update public.portal_legal_revisions
  set approval_act_ref = nullif(btrim(p_ref), ''),
      approval_act_date = p_date
  where id = p_revision_id
    and document_kind = 'house_rules'
    and status = 'draft'
  returning id into updated;
  if updated is null then
    raise exception 'portal_legal_not_draft' using errcode = '42501';
  end if;
  return updated;
end;
$$;

create or replace function public.portal_legal_admin_add_attachment(
  p_revision_id uuid,
  p_file_name text,
  p_content_type text,
  p_base64 text,
  p_public boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rev public.portal_legal_revisions%rowtype;
  new_id uuid := gen_random_uuid();
  payload bytea;
  digest_hex text;
  clean_name text;
begin
  perform public.portal_legal_assert_publish();
  select * into rev from public.portal_legal_revisions where id = p_revision_id;
  if rev.id is null or rev.status <> 'draft' then
    raise exception 'portal_legal_not_draft' using errcode = '42501';
  end if;

  begin
    payload := decode(p_base64, 'base64');
  exception
    when others then
      raise exception 'portal_legal_attachment_invalid' using errcode = '22023';
  end;
  if payload is null or octet_length(payload) = 0 or octet_length(payload) > 1500000 then
    raise exception 'portal_legal_attachment_invalid' using errcode = '22023';
  end if;

  clean_name := regexp_replace(coalesce(p_file_name, 'attachment'), '^.*[/\\]', '');
  clean_name := regexp_replace(clean_name, '[[:cntrl:]]', '', 'g');
  if length(clean_name) = 0 or length(clean_name) > 180 then
    raise exception 'portal_legal_attachment_invalid' using errcode = '22023';
  end if;

  digest_hex := encode(extensions.digest(payload, 'sha256'), 'hex');
  insert into public.portal_legal_attachments (
    id, revision_id, text_id, storage_path, file_name, content_type, public_access, content, content_sha256
  ) values (
    new_id,
    rev.id,
    null,
    'portal-legal/' || new_id::text,
    clean_name,
    coalesce(nullif(btrim(p_content_type), ''), 'application/octet-stream'),
    coalesce(p_public, false),
    payload,
    digest_hex
  );
  return new_id;
end;
$$;

create or replace function public.portal_legal_admin_publish(
  p_revision_id uuid,
  p_acceptance_required boolean,
  p_offer_acknowledgement boolean,
  p_approval_ref text,
  p_approval_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rev public.portal_legal_revisions%rowtype;
  ident record;
  accept_flag boolean;
  offer_flag boolean;
begin
  perform public.portal_legal_assert_publish();
  select * into ident from public.portal_legal_admin_identity();
  select * into rev from public.portal_legal_revisions where id = p_revision_id for update;
  if rev.id is null or rev.status <> 'draft' then
    raise exception 'portal_legal_not_draft' using errcode = '42501';
  end if;

  accept_flag := case when rev.document_kind = 'portal_terms' then coalesce(p_acceptance_required, false) else false end;
  offer_flag := case
    when rev.document_kind in ('privacy', 'house_rules') then coalesce(p_offer_acknowledgement, false)
    else false
  end;

  if rev.document_kind = 'house_rules' then
    perform public.portal_legal_admin_save_approval(p_revision_id, p_approval_ref, p_approval_date);
    if nullif(btrim(p_approval_ref), '') is null or p_approval_date is null then
      raise exception 'portal_legal_approval_required' using errcode = '23514';
    end if;
  end if;

  perform public.portal_legal_set_draft_policy(rev.id, accept_flag, offer_flag);
  perform public.portal_legal_publish(rev.id);

  select * into rev from public.portal_legal_revisions where id = p_revision_id;
  insert into public.portal_legal_audit (
    complex_id, actor_user_id, actor_email, actor_role, action, revision_id, detail
  ) values (
    public.portal_legal_complex_id(),
    ident.user_id,
    ident.email,
    ident.actor_role,
    'publish',
    rev.id,
    jsonb_build_object(
      'document_kind', rev.document_kind,
      'revision_number', rev.revision_number,
      'effective_on', rev.effective_on,
      'published_at', rev.published_at,
      'acceptance_required', rev.acceptance_required,
      'offer_acknowledgement', rev.offer_acknowledgement,
      'approval_act_ref', rev.approval_act_ref,
      'approval_act_date', rev.approval_act_date,
      'scheduled', rev.effective_on is not null and rev.effective_on > public.portal_legal_today()
    )
  );

  return rev.id;
end;
$$;

create or replace function public.portal_legal_admin_query(p_query text)
returns text
language sql
immutable
as $$
  select left(
    replace(replace(replace(lower(btrim(coalesce(p_query, ''))), '\', ''), '%', ''), '_', ''),
    120
  );
$$;

create or replace function public.portal_legal_admin_acknowledgements(
  p_query text,
  p_kind text,
  p_revision_id uuid,
  p_action text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle text := public.portal_legal_admin_query(p_query);
  result jsonb;
  has_book boolean := to_regclass('public.property_registry_people') is not null
    and to_regclass('public.properties') is not null;
begin
  perform public.portal_legal_assert_publish();
  if p_kind is not null and p_kind not in ('portal_terms', 'privacy', 'cookies', 'house_rules', 'operator_contacts') then
    raise exception 'portal_legal_kind' using errcode = '22023';
  end if;
  if p_action is not null and p_action not in ('accept_terms', 'ack_privacy', 'ack_house_rules') then
    raise exception 'portal_legal_action' using errcode = '22023';
  end if;

  if has_book then
    execute $q$
      select coalesce(jsonb_agg(to_jsonb(s) order by s.confirmed_at desc), '[]'::jsonb)
      from (
        select
          a.id as acknowledgement_id,
          coalesce(u.email, m.email) as owner_email,
          a.action,
          a.revision_id,
          r.revision_number,
          r.document_kind,
          a.ui_locale,
          a.document_locale,
          a.statement_text,
          a.body_sha256,
          a.confirmed_at,
          coalesce((
            select jsonb_agg(distinct pr.apartment_number)
            from public.property_registry_people pe
            join public.properties pr on pr.id = pe.property_id
            where pe.relation_type = 'owner'
              and pe.deregistered_at is null
              and lower(btrim(coalesce(pe.email, ''))) = lower(btrim(coalesce(u.email, m.email, '')))
          ), '[]'::jsonb) as apartments
        from public.portal_legal_acknowledgements a
        join public.portal_legal_revisions r on r.id = a.revision_id
        left join auth.users u on u.id = a.user_id
        left join public.portal_legal_members m on m.user_id = a.user_id
        where a.complex_id = public.portal_legal_complex_id()
          and ($1::text is null or r.document_kind = $1)
          and ($2::uuid is null or a.revision_id = $2)
          and ($3::text is null or a.action = $3)
          and ($4::date is null or (a.confirmed_at at time zone 'Europe/Sofia')::date >= $4)
          and ($5::date is null or (a.confirmed_at at time zone 'Europe/Sofia')::date <= $5)
          and (
            $6 = ''
            or lower(coalesce(u.email, m.email, '')) like '%' || $6 || '%'
            or exists (
              select 1
              from public.property_registry_people pe
              join public.properties pr on pr.id = pe.property_id
              where pe.relation_type = 'owner'
                and pe.deregistered_at is null
                and lower(btrim(coalesce(pe.email, ''))) = lower(btrim(coalesce(u.email, m.email, '')))
                and (
                  lower(coalesce(pr.apartment_number, '')) like '%' || $6 || '%'
                  or lower(concat_ws(' ', pe.first_name, pe.last_name, pe.entity_name)) like '%' || $6 || '%'
                )
            )
          )
        order by a.confirmed_at desc
        limit 500
      ) s
    $q$
    into result
    using p_kind, p_revision_id, p_action, p_from, p_to, needle;
    return result;
  end if;

  execute $q$
    select coalesce(jsonb_agg(to_jsonb(s) order by s.confirmed_at desc), '[]'::jsonb)
    from (
      select
        a.id as acknowledgement_id,
        coalesce(u.email, m.email) as owner_email,
        a.action,
        a.revision_id,
        r.revision_number,
        r.document_kind,
        a.ui_locale,
        a.document_locale,
        a.statement_text,
        a.body_sha256,
        a.confirmed_at,
        '[]'::jsonb as apartments
      from public.portal_legal_acknowledgements a
      join public.portal_legal_revisions r on r.id = a.revision_id
      left join auth.users u on u.id = a.user_id
      left join public.portal_legal_members m on m.user_id = a.user_id
      where a.complex_id = public.portal_legal_complex_id()
        and ($1::text is null or r.document_kind = $1)
        and ($2::uuid is null or a.revision_id = $2)
        and ($3::text is null or a.action = $3)
        and ($4::date is null or (a.confirmed_at at time zone 'Europe/Sofia')::date >= $4)
        and ($5::date is null or (a.confirmed_at at time zone 'Europe/Sofia')::date <= $5)
        and (
          $6 = ''
          or lower(coalesce(u.email, m.email, '')) like '%' || $6 || '%'
        )
      order by a.confirmed_at desc
      limit 500
    ) s
  $q$
  into result
  using p_kind, p_revision_id, p_action, p_from, p_to, needle;
  return result;
end;
$$;

create or replace function public.portal_legal_admin_terms_coverage(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  obligation uuid;
  needle text := public.portal_legal_admin_query(p_query);
  result jsonb;
begin
  perform public.portal_legal_assert_publish();
  obligation := public.portal_legal_terms_obligation();

  if to_regclass('public.property_registry_people') is not null
     and to_regclass('public.properties') is not null then
    execute $q$
      with book as (
        select
          lower(btrim(r.email)) as email,
          max(nullif(btrim(concat_ws(' ', r.first_name, r.middle_name, r.last_name, r.entity_name)), '')) as display_name,
          coalesce(jsonb_agg(distinct p.apartment_number), '[]'::jsonb) as apartments
        from public.property_registry_people r
        join public.properties p on p.id = r.property_id
        where r.relation_type = 'owner'
          and r.deregistered_at is null
          and nullif(btrim(r.email), '') is not null
        group by 1
      ),
      member_only as (
        select lower(btrim(m.email)) as email,
          null::text as display_name,
          '[]'::jsonb as apartments
        from public.portal_legal_members m
        where m.member_role = 'owner'
          and nullif(btrim(m.email), '') is not null
          and not exists (select 1 from book b where b.email = lower(btrim(m.email)))
      ),
      people as (
        select * from book
        union all
        select * from member_only
      )
      select jsonb_build_object(
        'obligation_id', $1::uuid,
        'rows', coalesce(jsonb_agg(jsonb_build_object(
          'email', pe.email,
          'name', pe.display_name,
          'apartments', pe.apartments,
          'user_id', u.id,
          'accepted', ack.confirmed_at is not null,
          'confirmed_at', ack.confirmed_at,
          'document_locale', ack.document_locale
        ) order by pe.email), '[]'::jsonb)
      )
      from people pe
      left join auth.users u on lower(u.email) = pe.email
      left join lateral (
        select a.confirmed_at, a.document_locale
        from public.portal_legal_acknowledgements a
        where a.user_id = u.id
          and a.complex_id = public.portal_legal_complex_id()
          and a.action = 'accept_terms'
          and a.revision_id = $1::uuid
        limit 1
      ) ack on true
      where $2 = ''
        or pe.email like '%' || $2 || '%'
        or lower(coalesce(pe.display_name, '')) like '%' || $2 || '%'
        or pe.apartments::text ilike '%' || $2 || '%'
    $q$
    into result
    using obligation, needle;
    return result;
  end if;

  execute $q$
    select jsonb_build_object(
      'obligation_id', $1::uuid,
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'email', m.email,
        'name', null,
        'apartments', '[]'::jsonb,
        'user_id', m.user_id,
        'accepted', ack.confirmed_at is not null,
        'confirmed_at', ack.confirmed_at,
        'document_locale', ack.document_locale
      ) order by m.email), '[]'::jsonb)
    )
    from public.portal_legal_members m
    left join lateral (
      select a.confirmed_at, a.document_locale
      from public.portal_legal_acknowledgements a
      where a.user_id = m.user_id
        and a.action = 'accept_terms'
        and a.revision_id = $1::uuid
      limit 1
    ) ack on true
    where m.member_role = 'owner'
      and (
        $2 = ''
        or lower(coalesce(m.email, '')) like '%' || $2 || '%'
      )
  $q$
  into result
  using obligation, needle;
  return result;
end;
$$;

create or replace function public.portal_legal_admin_snapshot(p_acknowledgement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.portal_legal_assert_publish();
  select jsonb_build_object(
    'acknowledgement_id', a.id,
    'owner_email', coalesce(u.email, m.email),
    'action', a.action,
    'revision_id', a.revision_id,
    'revision_number', r.revision_number,
    'document_kind', r.document_kind,
    'text_id', a.text_id,
    'body_sha256', a.body_sha256,
    'ui_locale', a.ui_locale,
    'document_locale', a.document_locale,
    'statement_text', a.statement_text,
    'title', t.title,
    'body', t.body_snapshot,
    'confirmed_at', a.confirmed_at
  )
  into result
  from public.portal_legal_acknowledgements a
  join public.portal_legal_texts t on t.id = a.text_id
  join public.portal_legal_revisions r on r.id = a.revision_id
  left join auth.users u on u.id = a.user_id
  left join public.portal_legal_members m on m.user_id = a.user_id
  where a.id = p_acknowledgement_id
    and a.complex_id = public.portal_legal_complex_id()
    and t.body_sha256 = a.body_sha256;
  return result;
end;
$$;

create or replace function public.portal_legal_admin_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.portal_legal_assert_publish();
  select jsonb_build_object(
    'attachment_id', a.id,
    'file_name', a.file_name,
    'content_type', a.content_type,
    'public_access', a.public_access,
    'content_sha256', a.content_sha256,
    'content_base64', case when a.content is null then null else encode(a.content, 'base64') end
  )
  into result
  from public.portal_legal_attachments a
  join public.portal_legal_revisions r on r.id = a.revision_id
  where a.id = p_attachment_id;
  return result;
end;
$$;

revoke all on function public.portal_legal_today() from public, anon, authenticated;
revoke all on function public.portal_legal_visitor_revision(text) from public, anon, authenticated;
revoke all on function public.portal_legal_admin_identity() from public, anon, authenticated;
revoke all on function public.portal_legal_assert_publish() from public, anon, authenticated;
revoke all on function public.portal_legal_admin_query(text) from public, anon, authenticated;

revoke all on function public.portal_legal_admin_catalog() from public, anon;
revoke all on function public.portal_legal_admin_revision(uuid) from public, anon;
revoke all on function public.portal_legal_admin_create_draft(text, date, uuid) from public, anon;
revoke all on function public.portal_legal_admin_save_text(uuid, text, text, text) from public, anon;
revoke all on function public.portal_legal_admin_save_approval(uuid, text, date) from public, anon;
revoke all on function public.portal_legal_admin_add_attachment(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.portal_legal_admin_publish(uuid, boolean, boolean, text, date) from public, anon;
revoke all on function public.portal_legal_admin_acknowledgements(text, text, uuid, text, date, date) from public, anon;
revoke all on function public.portal_legal_admin_terms_coverage(text) from public, anon;
revoke all on function public.portal_legal_admin_snapshot(uuid) from public, anon;
revoke all on function public.portal_legal_admin_attachment(uuid) from public, anon;

grant execute on function public.portal_legal_admin_catalog() to authenticated;
grant execute on function public.portal_legal_admin_revision(uuid) to authenticated;
grant execute on function public.portal_legal_admin_create_draft(text, date, uuid) to authenticated;
grant execute on function public.portal_legal_admin_save_text(uuid, text, text, text) to authenticated;
grant execute on function public.portal_legal_admin_save_approval(uuid, text, date) to authenticated;
grant execute on function public.portal_legal_admin_add_attachment(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.portal_legal_admin_publish(uuid, boolean, boolean, text, date) to authenticated;
grant execute on function public.portal_legal_admin_acknowledgements(text, text, uuid, text, date, date) to authenticated;
grant execute on function public.portal_legal_admin_terms_coverage(text) to authenticated;
grant execute on function public.portal_legal_admin_snapshot(uuid) to authenticated;
grant execute on function public.portal_legal_admin_attachment(uuid) to authenticated;
