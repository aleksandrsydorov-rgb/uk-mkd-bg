-- Complex-scoped email template overrides (RU/BG/EN).
-- Applied at send/render time; does not rewrite queued outbox rows.
-- Supabase Auth templates are out of scope.

begin;

create table if not exists public.complex_email_template_overrides (
  template_key text not null,
  locale text not null,
  subject text not null,
  greeting text not null,
  body text not null,
  cta text not null,
  footer text not null,
  updated_at timestamptz not null default now(),
  updated_by_email text,
  constraint complex_email_template_overrides_pk primary key (template_key, locale),
  constraint complex_email_template_overrides_locale_chk
    check (locale in ('bg', 'ru', 'en')),
  constraint complex_email_template_overrides_template_key_chk
    check (template_key ~ '^[a-z0-9_]{2,80}$')
);

comment on table public.complex_email_template_overrides is
  'Admin overrides for Email Core transactional templates. One row per template_key+locale. Missing row = builtin default.';

alter table public.complex_email_template_overrides enable row level security;

drop policy if exists complex_email_template_overrides_admin_all
  on public.complex_email_template_overrides;
create policy complex_email_template_overrides_admin_all
  on public.complex_email_template_overrides
  for all
  to authenticated
  using (public.has_staff_role('администрация'))
  with check (public.has_staff_role('администрация'));

revoke all on table public.complex_email_template_overrides from public, anon;
grant select, insert, update, delete on table public.complex_email_template_overrides
  to authenticated;
grant select on table public.complex_email_template_overrides to service_role;

-- List which templates have overrides (any locale).
create or replace function public.admin_list_email_template_override_keys()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_email_template_override_keys: not allowed' using errcode = '42501';
  end if;
  return coalesce(
    (
      select jsonb_agg(s.k order by s.k)
      from (
        select distinct o.template_key as k
        from public.complex_email_template_overrides as o
      ) as s
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.admin_list_email_template_override_keys()
  from public, anon;
grant execute on function public.admin_list_email_template_override_keys()
  to authenticated;

create or replace function public.admin_get_email_template_override(
  p_template_key text,
  p_locale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_template_key, '')));
  v_loc text := lower(btrim(coalesce(p_locale, '')));
  r public.complex_email_template_overrides%rowtype;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_get_email_template_override: not allowed' using errcode = '42501';
  end if;
  if v_key = '' or v_loc not in ('bg', 'ru', 'en') then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;

  select * into r
  from public.complex_email_template_overrides as o
  where o.template_key = v_key and o.locale = v_loc;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'is_custom', false,
      'template_key', v_key,
      'locale', v_loc,
      'override', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_custom', true,
    'template_key', v_key,
    'locale', v_loc,
    'override', jsonb_build_object(
      'subject', r.subject,
      'greeting', r.greeting,
      'body', r.body,
      'cta', r.cta,
      'footer', r.footer
    ),
    'updated_at', r.updated_at,
    'updated_by_email', r.updated_by_email
  );
end;
$fn$;

revoke all on function public.admin_get_email_template_override(text, text)
  from public, anon;
grant execute on function public.admin_get_email_template_override(text, text)
  to authenticated;

create or replace function public.admin_save_email_template_override(
  p_template_key text,
  p_locale text,
  p_subject text,
  p_greeting text,
  p_body text,
  p_cta text,
  p_footer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_template_key, '')));
  v_loc text := lower(btrim(coalesce(p_locale, '')));
  v_actor text := nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_save_email_template_override: not allowed' using errcode = '42501';
  end if;
  if v_key !~ '^[a-z0-9_]{2,80}$' or v_loc not in ('bg', 'ru', 'en') then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;
  if length(coalesce(p_subject, '')) > 500
     or length(coalesce(p_greeting, '')) > 2000
     or length(coalesce(p_body, '')) > 8000
     or length(coalesce(p_cta, '')) > 200
     or length(coalesce(p_footer, '')) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  insert into public.complex_email_template_overrides as o (
    template_key, locale, subject, greeting, body, cta, footer,
    updated_at, updated_by_email
  ) values (
    v_key, v_loc,
    coalesce(p_subject, ''),
    coalesce(p_greeting, ''),
    coalesce(p_body, ''),
    coalesce(p_cta, ''),
    coalesce(p_footer, ''),
    now(),
    v_actor
  )
  on conflict on constraint complex_email_template_overrides_pk
  do update set
    subject = excluded.subject,
    greeting = excluded.greeting,
    body = excluded.body,
    cta = excluded.cta,
    footer = excluded.footer,
    updated_at = now(),
    updated_by_email = excluded.updated_by_email;

  return jsonb_build_object(
    'ok', true,
    'is_custom', true,
    'template_key', v_key,
    'locale', v_loc,
    'updated_by_email', v_actor
  );
end;
$fn$;

revoke all on function public.admin_save_email_template_override(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_save_email_template_override(text, text, text, text, text, text, text)
  to authenticated;

create or replace function public.admin_restore_email_template_override(
  p_template_key text,
  p_locale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_template_key, '')));
  v_loc text := lower(btrim(coalesce(p_locale, '')));
  v_deleted int := 0;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_restore_email_template_override: not allowed' using errcode = '42501';
  end if;
  if v_key = '' or v_loc not in ('bg', 'ru', 'en') then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;

  delete from public.complex_email_template_overrides as o
  where o.template_key = v_key and o.locale = v_loc;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'restored_builtin', true,
    'deleted', v_deleted > 0,
    'template_key', v_key,
    'locale', v_loc
  );
end;
$fn$;

revoke all on function public.admin_restore_email_template_override(text, text)
  from public, anon;
grant execute on function public.admin_restore_email_template_override(text, text)
  to authenticated;

-- Worker/service read (single locale).
create or replace function public.email_core_get_template_override(
  p_template_key text,
  p_locale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_template_key, '')));
  v_loc text := lower(btrim(coalesce(p_locale, '')));
  r public.complex_email_template_overrides%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_get_template_override: service_role only' using errcode = '42501';
  end if;
  if v_key = '' or v_loc not in ('bg', 'ru', 'en') then
    return null;
  end if;

  select * into r
  from public.complex_email_template_overrides as o
  where o.template_key = v_key and o.locale = v_loc;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'subject', r.subject,
    'greeting', r.greeting,
    'body', r.body,
    'cta', r.cta,
    'footer', r.footer
  );
end;
$fn$;

revoke all on function public.email_core_get_template_override(text, text)
  from public, anon, authenticated;
grant execute on function public.email_core_get_template_override(text, text)
  to service_role;

commit;
