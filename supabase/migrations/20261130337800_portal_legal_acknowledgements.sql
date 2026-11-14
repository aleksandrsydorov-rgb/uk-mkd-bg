-- Owner acceptance of portal terms and optional document acknowledgements.
-- A published revision stays immutable. Acceptance is required only when that
-- revision says so and has taken effect. Installations with no such revision
-- keep the existing cabinet behaviour.

alter table public.portal_legal_revisions
  add column if not exists acceptance_required boolean not null default false,
  add column if not exists offer_acknowledgement boolean not null default false;

alter table public.portal_legal_revisions
  drop constraint if exists portal_legal_revisions_acceptance_kind_check;
alter table public.portal_legal_revisions
  add constraint portal_legal_revisions_acceptance_kind_check check (
    acceptance_required = false or document_kind = 'portal_terms'
  );

alter table public.portal_legal_revisions
  drop constraint if exists portal_legal_revisions_offer_kind_check;
alter table public.portal_legal_revisions
  add constraint portal_legal_revisions_offer_kind_check check (
    offer_acknowledgement = false or document_kind in ('privacy', 'house_rules')
  );

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

create table if not exists public.portal_legal_complex (
  id uuid primary key,
  name text not null
);

insert into public.portal_legal_complex (id, name)
values ('c1111111-1111-4111-8111-111111111111', 'Амадеус XI')
on conflict (id) do nothing;

create table if not exists public.portal_legal_members (
  user_id uuid primary key,
  complex_id uuid not null references public.portal_legal_complex (id),
  member_role text not null,
  email text,
  constraint portal_legal_members_role_check check (member_role in ('owner', 'staff', 'admin'))
);

create table if not exists public.portal_legal_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  complex_id uuid not null references public.portal_legal_complex (id),
  action text not null,
  revision_id uuid not null references public.portal_legal_revisions (id),
  text_id uuid not null references public.portal_legal_texts (id),
  body_sha256 text not null,
  ui_locale text not null,
  document_locale text not null,
  statement_text text not null,
  confirmed_at timestamptz not null default now(),
  constraint portal_legal_ack_action_check check (
    action in ('accept_terms', 'ack_privacy', 'ack_house_rules')
  ),
  constraint portal_legal_ack_locale_check check (
    ui_locale in ('bg', 'ru', 'en') and document_locale in ('bg', 'ru', 'en')
  ),
  constraint portal_legal_ack_once unique (user_id, complex_id, action, revision_id)
);

create index if not exists portal_legal_ack_user_idx
  on public.portal_legal_acknowledgements (user_id, confirmed_at desc);

alter table public.portal_legal_acknowledgements enable row level security;
alter table public.portal_legal_members enable row level security;
alter table public.portal_legal_complex enable row level security;

revoke all on table public.portal_legal_acknowledgements from public, anon, authenticated;
revoke all on table public.portal_legal_members from public, anon, authenticated;
revoke all on table public.portal_legal_complex from public, anon, authenticated;

drop trigger if exists portal_legal_acknowledgements_guard on public.portal_legal_acknowledgements;
create trigger portal_legal_acknowledgements_guard
  before update or delete on public.portal_legal_acknowledgements
  for each row execute function public.portal_legal_guard();

create or replace function public.portal_legal_uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  );
$$;

create or replace function public.portal_legal_complex_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found uuid;
begin
  if to_regclass('public.platform_installations') is not null then
    execute 'select id from public.platform_installations order by created_at limit 1' into found;
    if found is not null then
      return found;
    end if;
  end if;
  return 'c1111111-1111-4111-8111-111111111111'::uuid;
end;
$$;

create or replace function public.portal_legal_actor()
returns table (user_id uuid, complex_id uuid, member_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.portal_legal_uid();
  email text := lower(btrim(coalesce(
    current_setting('request.jwt.claim.email', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'email',
    ''
  )));
  cid uuid := public.portal_legal_complex_id();
  role text;
begin
  if uid is null then
    return;
  end if;

  select m.member_role into role
  from public.portal_legal_members m
  where m.user_id = uid;
  if role is not null then
    user_id := uid;
    complex_id := cid;
    member_role := role;
    return next;
    return;
  end if;

  if to_regclass('public.staff') is not null and email <> '' then
    execute
      'select 1 from public.staff where active is true and lower(btrim(email)) = $1 limit 1'
      into role
      using email;
    if role is not null then
      user_id := uid;
      complex_id := cid;
      member_role := 'staff';
      return next;
      return;
    end if;
  end if;

  if to_regprocedure('public.list_my_owned_properties()') is not null then
    begin
      execute 'select 1 from public.list_my_owned_properties() limit 1' into role;
      if role is not null then
        user_id := uid;
        complex_id := cid;
        member_role := 'owner';
        return next;
        return;
      end if;
    exception
      when others then
        null;
    end;
  end if;

  return;
end;
$$;

create or replace function public.portal_legal_set_draft_policy(
  p_revision_id uuid,
  p_acceptance_required boolean,
  p_offer_acknowledgement boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  updated uuid;
begin
  update public.portal_legal_revisions
  set acceptance_required = coalesce(p_acceptance_required, false),
      offer_acknowledgement = coalesce(p_offer_acknowledgement, false)
  where id = p_revision_id
    and status = 'draft'
  returning id into updated;
  if updated is null then
    raise exception 'portal_legal_not_draft' using errcode = '42501';
  end if;
  return updated;
end;
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
      and (effective_on is null or effective_on <= current_date)
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

create or replace function public.portal_legal_statement(p_action text, p_locale text)
returns text
language sql
immutable
as $$
  select case p_action
    when 'accept_terms' then case p_locale
      when 'ru' then 'Принимаю Условия использования портала.'
      when 'en' then 'I accept the portal terms of use.'
      else 'Приемам Условията за ползване на портала.'
    end
    when 'ack_privacy' then case p_locale
      when 'ru' then 'Я ознакомился с уведомлением о защите персональных данных.'
      when 'en' then 'I have read the personal data notice.'
      else 'Запознах се с Уведомлението за защита на личните данни.'
    end
    when 'ack_house_rules' then case p_locale
      when 'ru' then 'Я ознакомился с правилами внутреннего распорядка.'
      when 'en' then 'I have read the internal rules.'
      else 'Запознах се с Правилника за вътрешния ред.'
    end
    else null
  end;
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
  where r.document_kind = p_kind
    and r.status = 'published'
    and r.public_access = true
    and r.offer_acknowledgement = true
    and (r.effective_on is null or r.effective_on <= current_date)
  order by r.revision_number desc
  limit 1;
$$;

create or replace function public.portal_legal_acceptance_status(p_locale text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor record;
  obligation uuid;
  accepted boolean := false;
  prior boolean := false;
  locale text := case when p_locale in ('bg', 'ru', 'en') then p_locale else 'bg' end;
  terms jsonb;
  privacy jsonb;
  rules jsonb;
  privacy_id uuid;
  rules_id uuid;
begin
  select * into actor from public.portal_legal_actor();
  if actor.user_id is null then
    return jsonb_build_object(
      'must_accept', false,
      'is_update', false,
      'role', 'unknown',
      'complex_id', null
    );
  end if;

  obligation := public.portal_legal_terms_obligation();
  if obligation is not null then
    select exists (
      select 1 from public.portal_legal_acknowledgements a
      where a.user_id = actor.user_id
        and a.complex_id = actor.complex_id
        and a.action = 'accept_terms'
        and a.revision_id = obligation
    ) into accepted;
  end if;
  select exists (
    select 1 from public.portal_legal_acknowledgements a
    where a.user_id = actor.user_id
      and a.complex_id = actor.complex_id
      and a.action = 'accept_terms'
  ) into prior;

  if actor.member_role = 'owner' and obligation is not null then
    terms := public.portal_legal_payload(obligation, locale);
  end if;

  privacy_id := public.portal_legal_offered_revision('privacy');
  rules_id := public.portal_legal_offered_revision('house_rules');
  if actor.member_role = 'owner' and privacy_id is not null then
    privacy := public.portal_legal_payload(privacy_id, locale);
  end if;
  if actor.member_role = 'owner' and rules_id is not null then
    rules := public.portal_legal_payload(rules_id, locale);
  end if;

  return jsonb_build_object(
    'must_accept', actor.member_role = 'owner' and obligation is not null and not accepted,
    'is_update', prior,
    'role', actor.member_role,
    'complex_id', actor.complex_id,
    'obligation_id', obligation,
    'terms', terms,
    'privacy', privacy,
    'house_rules', rules,
    'statements', jsonb_build_object(
      'accept_terms', public.portal_legal_statement('accept_terms', locale),
      'ack_privacy', public.portal_legal_statement('ack_privacy', locale),
      'ack_house_rules', public.portal_legal_statement('ack_house_rules', locale)
    )
  );
end;
$$;

create or replace function public.portal_legal_record_acknowledgements(
  p_locale text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  v_ui_locale text := case when p_locale in ('bg', 'ru', 'en') then p_locale else 'bg' end;
  obligation uuid;
  item jsonb;
  v_action text;
  v_revision_id uuid;
  v_text_id uuid;
  seen_terms boolean := false;
  rec_count integer := 0;
begin
  select * into actor from public.portal_legal_actor();
  if actor.user_id is null or actor.member_role <> 'owner' then
    raise exception 'portal_legal_not_owner' using errcode = '42501';
  end if;

  perform 1
  from public.portal_legal_revisions
  where document_kind = 'portal_terms' and status = 'published'
  for update;

  obligation := public.portal_legal_terms_obligation();

  if obligation is not null and not exists (
    select 1 from public.portal_legal_acknowledgements a
    where a.user_id = actor.user_id
      and a.complex_id = actor.complex_id
      and a.action = 'accept_terms'
      and a.revision_id = obligation
  ) then
    if not exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) el
      where el->>'action' = 'accept_terms'
        and el->>'revision_id' = obligation::text
    ) then
      return jsonb_build_object('ok', false, 'stale', true, 'status', public.portal_legal_acceptance_status(v_ui_locale));
    end if;
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_action := item->>'action';
    v_revision_id := (item->>'revision_id')::uuid;
    v_text_id := (item->>'text_id')::uuid;
    if v_action = 'accept_terms' then
      if v_revision_id is distinct from obligation then
        return jsonb_build_object('ok', false, 'stale', true, 'status', public.portal_legal_acceptance_status(v_ui_locale));
      end if;
    elsif v_action = 'ack_privacy' then
      if v_revision_id is distinct from public.portal_legal_offered_revision('privacy') then
        return jsonb_build_object('ok', false, 'stale', true, 'status', public.portal_legal_acceptance_status(v_ui_locale));
      end if;
    elsif v_action = 'ack_house_rules' then
      if v_revision_id is distinct from public.portal_legal_offered_revision('house_rules') then
        return jsonb_build_object('ok', false, 'stale', true, 'status', public.portal_legal_acceptance_status(v_ui_locale));
      end if;
    else
      raise exception 'portal_legal_bad_action' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.portal_legal_texts t
      join public.portal_legal_revisions r on r.id = t.revision_id
      where t.id = v_text_id
        and t.revision_id = v_revision_id
        and r.public_access = true
        and r.status in ('published', 'superseded')
    ) then
      raise exception 'portal_legal_text_mismatch' using errcode = '42501';
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_action := item->>'action';
    v_revision_id := (item->>'revision_id')::uuid;
    v_text_id := (item->>'text_id')::uuid;
    if v_action = 'accept_terms' then
      seen_terms := true;
    end if;

    insert into public.portal_legal_acknowledgements (
      user_id, complex_id, action, revision_id, text_id, body_sha256,
      ui_locale, document_locale, statement_text
    )
    select
      actor.user_id,
      actor.complex_id,
      v_action,
      t.revision_id,
      t.id,
      t.body_sha256,
      v_ui_locale,
      t.locale,
      public.portal_legal_statement(v_action, v_ui_locale)
    from public.portal_legal_texts t
    where t.id = v_text_id
    on conflict (user_id, complex_id, action, revision_id) do nothing;

    rec_count := rec_count + 1;
  end loop;

  if obligation is not null and not seen_terms and not exists (
    select 1 from public.portal_legal_acknowledgements a
    where a.user_id = actor.user_id
      and a.complex_id = actor.complex_id
      and a.action = 'accept_terms'
      and a.revision_id = obligation
  ) then
    raise exception 'portal_legal_terms_required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'stale', false,
    'recorded', rec_count,
    'status', public.portal_legal_acceptance_status(v_ui_locale)
  );
end;
$$;

create or replace function public.portal_legal_my_history()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(h) order by h.confirmed_at desc), '[]'::jsonb)
  from (
    select
      a.id as acknowledgement_id,
      a.action,
      a.revision_id,
      a.text_id,
      a.body_sha256,
      a.ui_locale,
      a.document_locale,
      a.statement_text,
      a.confirmed_at,
      r.revision_number,
      r.document_kind,
      r.test_edition,
      t.title
    from public.portal_legal_acknowledgements a
    join public.portal_legal_revisions r on r.id = a.revision_id
    join public.portal_legal_texts t on t.id = a.text_id
    where a.user_id = public.portal_legal_uid()
      and a.complex_id = public.portal_legal_complex_id()
  ) h;
$$;

create or replace function public.portal_legal_my_snapshot(p_acknowledgement_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'acknowledgement_id', a.id,
    'revision_id', a.revision_id,
    'text_id', a.text_id,
    'body_sha256', a.body_sha256,
    'document_locale', a.document_locale,
    'title', t.title,
    'body', t.body_snapshot,
    'confirmed_at', a.confirmed_at
  )
  from public.portal_legal_acknowledgements a
  join public.portal_legal_texts t on t.id = a.text_id
  where a.id = p_acknowledgement_id
    and a.user_id = public.portal_legal_uid()
    and a.complex_id = public.portal_legal_complex_id()
    and t.body_sha256 = a.body_sha256;
$$;

create or replace function public.portal_legal_pre_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  path text := coalesce(current_setting('request.path', true), '');
  jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  actor record;
  obligation uuid;
begin
  if jwt_role in ('', 'anon', 'service_role') then
    return;
  end if;
  if path like '%public_portal_legal%'
    or path like '%portal_legal_acceptance_status%'
    or path like '%portal_legal_record_acknowledgements%'
    or path like '%portal_legal_my_history%'
    or path like '%portal_legal_my_snapshot%'
    or path like '%accept_property_invite%'
  then
    return;
  end if;

  select * into actor from public.portal_legal_actor();
  if actor.user_id is null or actor.member_role is distinct from 'owner' then
    return;
  end if;

  obligation := public.portal_legal_terms_obligation();
  if obligation is null then
    return;
  end if;
  if exists (
    select 1 from public.portal_legal_acknowledgements a
    where a.user_id = actor.user_id
      and a.complex_id = actor.complex_id
      and a.action = 'accept_terms'
      and a.revision_id = obligation
  ) then
    return;
  end if;

  raise exception 'portal_legal_acceptance_required' using errcode = '42501';
end;
$$;

revoke all on function public.portal_legal_uid() from public, anon, authenticated;
revoke all on function public.portal_legal_complex_id() from public, anon, authenticated;
revoke all on function public.portal_legal_actor() from public, anon, authenticated;
revoke all on function public.portal_legal_set_draft_policy(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.portal_legal_terms_obligation() from public, anon, authenticated;
revoke all on function public.portal_legal_statement(text, text) from public;
revoke all on function public.portal_legal_offered_revision(text) from public, anon, authenticated;
revoke all on function public.portal_legal_acceptance_status(text) from public;
revoke all on function public.portal_legal_record_acknowledgements(text, jsonb) from public;
revoke all on function public.portal_legal_my_history() from public;
revoke all on function public.portal_legal_my_snapshot(uuid) from public;
revoke all on function public.portal_legal_pre_request() from public;

grant execute on function public.portal_legal_acceptance_status(text) to authenticated;
grant execute on function public.portal_legal_record_acknowledgements(text, jsonb) to authenticated;
grant execute on function public.portal_legal_my_history() to authenticated;
grant execute on function public.portal_legal_my_snapshot(uuid) to authenticated;
grant execute on function public.portal_legal_pre_request() to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant execute on function public.portal_legal_pre_request() to authenticator;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.portal_legal_set_draft_policy(uuid, boolean, boolean) to service_role;
  end if;
end;
$$;
