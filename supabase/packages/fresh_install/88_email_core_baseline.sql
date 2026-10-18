-- =============================================================================
-- EML-2 fresh-install — Email Core baseline (Phases A + B + D + E1 email authz)
-- Canonical outbox, dual-gate defaults (email_enabled=false), RLS, admin/worker RPCs.
-- No credentials, no recipients, empty queue. Safe without RESEND_API_KEY.
-- Depends on: 05_auth_staff_helpers (has_staff_role), 45_property_book_auth (owns_property).
-- XFER bridge is soft (ownership_change_* may arrive via later chronological migrations).
-- Do NOT enable sending. Do NOT seed verified senders or API keys.
-- =============================================================================

-- >>> BEGIN PACKAGED FROM 20261012120000_email_core_phase_a.sql
-- =============================================================================
-- Email Core Phase A — configurable per-installation mail foundation
-- One installation DB = one complex = one email configuration.
-- Defaults: email_enabled=false. No provider secrets in tables. No live send.
-- Do NOT apply to shared/prod without explicit approval.
-- =============================================================================
-- begin (stripped for package)
-- ---------------------------------------------------------------------------
-- Settings (singleton)
-- ---------------------------------------------------------------------------

create table if not exists public.complex_email_settings (
  id smallint primary key default 1 check (id = 1),
  mail_provider text not null default 'resend'
    check (mail_provider in ('resend')),
  sender_name text not null default '',
  sender_email text null,
  reply_to_email text null,
  verified_domain text null,
  provider_domain_id text null,
  domain_status text not null default 'none'
    check (domain_status in ('none', 'pending', 'verified', 'failed')),
  email_enabled boolean not null default false,
  template_locale text not null default 'bg'
    check (template_locale in ('bg', 'ru', 'en')),
  platform_disabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_email text null
);

comment on table public.complex_email_settings is
  'Per-installation Email Core public config. Secrets never stored here.';

insert into public.complex_email_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.complex_email_settings enable row level security;
revoke all on table public.complex_email_settings from public, anon, authenticated;

drop policy if exists complex_email_settings_admin_select on public.complex_email_settings;
create policy complex_email_settings_admin_select
on public.complex_email_settings
for select to authenticated
using (public.has_staff_role('администрация'));

-- No direct INSERT/UPDATE/DELETE for authenticated — RPCs only.

-- ---------------------------------------------------------------------------
-- Verified senders (ops / ALSYD / service_role seed — not free-form admin create)
-- ---------------------------------------------------------------------------

create table if not exists public.email_verified_senders (
  id bigint generated always as identity primary key,
  email text not null,
  domain text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'revoked')),
  provider_sender_id text null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by text not null default 'system',
  constraint email_verified_senders_email_uq unique (email)
);

comment on table public.email_verified_senders is
  'Allowlisted From addresses. Admin may only select verified rows; cannot invent domains.';

create index if not exists email_verified_senders_status_idx
  on public.email_verified_senders (status)
  where status = 'verified';

alter table public.email_verified_senders enable row level security;
revoke all on table public.email_verified_senders from public, anon, authenticated;

drop policy if exists email_verified_senders_admin_select on public.email_verified_senders;
create policy email_verified_senders_admin_select
on public.email_verified_senders
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Outbox (idempotent queue) — Phase A holds rows; worker/send is Phase B
-- ---------------------------------------------------------------------------

create table if not exists public.email_outbox (
  id bigint generated always as identity primary key,
  idempotency_key text not null,
  module_key text not null
    check (module_key in (
      'pb1_invite', 'user_activation', 'pkg_xfer', 'meeting', 'email_test', 'system'
    )),
  template_key text not null,
  locale text not null default 'bg'
    check (locale in ('bg', 'ru', 'en')),
  to_email text not null,
  to_email_hash text not null,
  subject text null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'held'
    check (status in (
      'held', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'blocked_not_ready'
    )),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz null,
  last_error_code text null,
  provider_message_id text null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  updated_at timestamptz not null default now(),
  constraint email_outbox_idempotency_uq unique (idempotency_key)
);

create index if not exists email_outbox_status_next_idx
  on public.email_outbox (status, next_attempt_at nulls first, id);

create index if not exists email_outbox_module_created_idx
  on public.email_outbox (module_key, created_at desc);

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from public, anon, authenticated;

-- Admins see diagnostics via RPC (masked). No broad SELECT grant on raw to_email.
-- Owner self-read of own rows (hash match) — optional Phase A: deny; diagnostics staff-only.

-- ---------------------------------------------------------------------------
-- Delivery attempts
-- ---------------------------------------------------------------------------

create table if not exists public.email_delivery_attempts (
  id bigint generated always as identity primary key,
  outbox_id bigint not null references public.email_outbox (id) on delete cascade,
  attempt_no int not null check (attempt_no >= 1),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  result text not null default 'skipped_phase_a'
    check (result in (
      'skipped_phase_a', 'accepted', 'rejected', 'error', 'rate_limited'
    )),
  error_code text null,
  provider_response_class text null,
  constraint email_delivery_attempts_uq unique (outbox_id, attempt_no)
);

alter table public.email_delivery_attempts enable row level security;
revoke all on table public.email_delivery_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Provider webhook / delivery events
-- ---------------------------------------------------------------------------

create table if not exists public.email_delivery_events (
  id bigint generated always as identity primary key,
  outbox_id bigint null references public.email_outbox (id) on delete set null,
  provider_message_id text null,
  event_type text not null,
  event_at timestamptz not null default now(),
  payload_redacted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_delivery_events_outbox_idx
  on public.email_delivery_events (outbox_id, event_at desc);

alter table public.email_delivery_events enable row level security;
revoke all on table public.email_delivery_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.email_core_normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

revoke all on function public.email_core_normalize_email(text) from public, anon;
grant execute on function public.email_core_normalize_email(text) to authenticated;

create or replace function public.email_core_email_hash(p_email text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text := public.email_core_normalize_email(p_email);
begin
  if v is null then
    return null;
  end if;
  -- Prefer pgcrypto digest when available; md5 fallback keeps Phase A portable.
  begin
    return encode(extensions.digest(v, 'sha256'), 'hex');
  exception
    when others then
      return md5(v);
  end;
end;
$fn$;

revoke all on function public.email_core_email_hash(text) from public, anon;
grant execute on function public.email_core_email_hash(text) to authenticated;

create or replace function public.email_core_mask_email(p_email text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text := public.email_core_normalize_email(p_email);
  local_part text;
  domain_part text;
  at_pos int;
begin
  if v is null then
    return null;
  end if;
  at_pos := position('@' in v);
  if at_pos < 2 then
    return '***';
  end if;
  local_part := left(v, at_pos - 1);
  domain_part := substr(v, at_pos + 1);
  if length(local_part) <= 1 then
    return '*@' || domain_part;
  end if;
  return left(local_part, 1) || '***@' || domain_part;
end;
$fn$;

revoke all on function public.email_core_mask_email(text) from public, anon;
grant execute on function public.email_core_mask_email(text) to authenticated;

create or replace function public.email_core_domain_of(p_email text)
returns text
language sql
immutable
as $$
  select nullif(split_part(public.email_core_normalize_email(p_email), '@', 2), '');
$$;

revoke all on function public.email_core_domain_of(text) from public, anon;
grant execute on function public.email_core_domain_of(text) to authenticated;

-- Config-level status (secrets live only in host env — never mark ready from SQL alone)
create or replace function public.email_core_config_delivery_status()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
  v_sender_ok boolean := false;
begin
  select * into s from public.complex_email_settings where id = 1;
  if not found then
    return 'not_configured';
  end if;
  if s.platform_disabled then
    return 'disabled_by_platform';
  end if;
  if s.domain_status = 'pending' or (s.verified_domain is not null and s.domain_status <> 'verified') then
    return 'domain_pending';
  end if;

  select exists (
    select 1
    from public.email_verified_senders as vs
    where vs.status = 'verified'
      and public.email_core_normalize_email(vs.email) = public.email_core_normalize_email(s.sender_email)
  ) into v_sender_ok;

  if not v_sender_ok or s.domain_status <> 'verified' or s.verified_domain is null then
    return 'not_configured';
  end if;

  -- Phase A: even with perfect config, SQL never claims provider ready (no secret in DB).
  if not s.email_enabled then
    return 'paused';
  end if;
  return 'paused';
end;
$fn$;

revoke all on function public.email_core_config_delivery_status() from public, anon;
grant execute on function public.email_core_config_delivery_status() to authenticated;

-- Ready for outbound enqueue/send path (Phase A always false: email_enabled default + no worker)
create or replace function public.email_core_is_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

comment on function public.email_core_is_ready() is
  'Phase A: always false (no live send). Phase B will require email_enabled + verified sender + server secret.';

revoke all on function public.email_core_is_ready() from public, anon;
grant execute on function public.email_core_is_ready() to authenticated;

create or replace function public.email_core_module_fallback_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.email_core_is_ready() then 'QUEUED'
    else 'PROVIDER_NOT_CONFIGURED'
  end;
$$;

revoke all on function public.email_core_module_fallback_status() from public, anon;
grant execute on function public.email_core_module_fallback_status() to authenticated;

create or replace function public.email_core_sync_xfer_provider_flag()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.ownership_change_settings as s
  set
    email_provider_configured = public.email_core_is_ready(),
    updated_at = now()
  where s.id = 1;
exception
  when undefined_table then
    null;
end;
$fn$;

revoke all on function public.email_core_sync_xfer_provider_flag() from public, anon;

-- Keep XFER flag aligned (false in Phase A)
do $sync$
begin
  if to_regclass('public.ownership_change_settings') is not null then
    perform public.email_core_sync_xfer_provider_flag();
  end if;
end;
$sync$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_verified_email_senders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_verified_email_senders: not allowed' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', vs.id,
          'email', vs.email,
          'domain', vs.domain,
          'status', vs.status,
          'verified_at', vs.verified_at
        )
        order by vs.email
      )
      from public.email_verified_senders as vs
      where vs.status in ('verified', 'pending')
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.admin_list_verified_email_senders() from public, anon;
grant execute on function public.admin_list_verified_email_senders() to authenticated;

create or replace function public.admin_get_email_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_get_email_settings: not allowed' using errcode = '42501';
  end if;

  select * into s from public.complex_email_settings where id = 1;
  if not found then
    raise exception 'admin_get_email_settings: missing settings row';
  end if;

  return jsonb_build_object(
    'mail_provider', s.mail_provider,
    'sender_name', s.sender_name,
    'sender_email', s.sender_email,
    'reply_to_email', s.reply_to_email,
    'verified_domain', s.verified_domain,
    'provider_domain_id', s.provider_domain_id,
    'domain_status', s.domain_status,
    'email_enabled', s.email_enabled,
    'template_locale', s.template_locale,
    'platform_disabled', s.platform_disabled,
    'delivery_status', public.email_core_config_delivery_status(),
    'sending_ready', public.email_core_is_ready(),
    'phase', 'A',
    'secrets_in_database', false,
    'updated_at', s.updated_at,
    'updated_by_email', s.updated_by_email,
    'verified_senders', public.admin_list_verified_email_senders()
  );
end;
$fn$;

revoke all on function public.admin_get_email_settings() from public, anon;
grant execute on function public.admin_get_email_settings() to authenticated;

create or replace function public.admin_update_email_settings(
  p_sender_name text default null,
  p_sender_email text default null,
  p_reply_to_email text default null,
  p_template_locale text default null,
  p_email_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
  v_sender text;
  v_reply text;
  v_locale text;
  v_enable boolean;
  v_sender_ok boolean := false;
  v_domain_ok boolean := false;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_update_email_settings: not allowed' using errcode = '42501';
  end if;

  select * into s from public.complex_email_settings where id = 1 for update;
  if not found then
    raise exception 'admin_update_email_settings: missing settings row';
  end if;

  v_sender := coalesce(
    public.email_core_normalize_email(p_sender_email),
    public.email_core_normalize_email(s.sender_email)
  );
  v_reply := case
    when p_reply_to_email is null then s.reply_to_email
    when btrim(p_reply_to_email) = '' then null
    else public.email_core_normalize_email(p_reply_to_email)
  end;
  v_locale := coalesce(nullif(btrim(coalesce(p_template_locale, '')), ''), s.template_locale);
  if v_locale not in ('bg', 'ru', 'en') then
    raise exception 'admin_update_email_settings: invalid template_locale';
  end if;

  v_enable := coalesce(p_email_enabled, s.email_enabled);

  if v_sender is not null then
    select exists (
      select 1
      from public.email_verified_senders as vs
      where vs.status = 'verified'
        and public.email_core_normalize_email(vs.email) = v_sender
    ) into v_sender_ok;
    if not v_sender_ok then
      raise exception 'admin_update_email_settings: sender_email must be a verified sender'
        using errcode = '22023';
    end if;
  end if;

  v_domain_ok := (s.domain_status = 'verified' and s.verified_domain is not null);

  -- Cannot enable sending without verified domain + verified sender
  if v_enable then
    if not v_domain_ok then
      raise exception 'admin_update_email_settings: cannot enable email until domain is verified'
        using errcode = '22023';
    end if;
    if v_sender is null or not v_sender_ok then
      raise exception 'admin_update_email_settings: cannot enable email without verified sender'
        using errcode = '22023';
    end if;
    -- Phase A hard stop: refuse enabling live send path
    raise exception 'admin_update_email_settings: Phase A refuses email_enabled=true (no live send)'
      using errcode = '22023';
  end if;

  if v_reply is not null and position('@' in v_reply) < 2 then
    raise exception 'admin_update_email_settings: invalid reply_to_email';
  end if;

  update public.complex_email_settings as t
  set
    sender_name = coalesce(p_sender_name, t.sender_name),
    sender_email = v_sender,
    reply_to_email = v_reply,
    template_locale = v_locale,
    email_enabled = false,
    updated_at = now(),
    updated_by_email = nullif(btrim(coalesce(auth.email(), '')), '')
  where t.id = 1;

  perform public.email_core_sync_xfer_provider_flag();

  return public.admin_get_email_settings();
end;
$fn$;

revoke all on function public.admin_update_email_settings(text, text, text, text, boolean)
  from public, anon;
grant execute on function public.admin_update_email_settings(text, text, text, text, boolean)
  to authenticated;

create or replace function public.admin_list_email_diagnostics(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_email_diagnostics: not allowed' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_json order by created_at desc)
      from (
        select
          jsonb_build_object(
            'id', o.id,
            'module_key', o.module_key,
            'template_key', o.template_key,
            'locale', o.locale,
            'to_masked', public.email_core_mask_email(o.to_email),
            'status', o.status,
            'attempts', o.attempts,
            'last_error_code', o.last_error_code,
            'created_at', o.created_at,
            'updated_at', o.updated_at
          ) as row_json,
          o.created_at
        from public.email_outbox as o
        order by o.created_at desc
        limit v_lim
      ) as q
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.admin_list_email_diagnostics(integer) from public, anon;
grant execute on function public.admin_list_email_diagnostics(integer) to authenticated;

-- Ops / service_role only: seed verified sender + domain metadata (no API keys)
create or replace function public.email_core_ops_upsert_verified_sender(
  p_email text,
  p_status text default 'verified',
  p_provider_sender_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := public.email_core_normalize_email(p_email);
  v_domain text;
  v_id bigint;
begin
  -- Intentionally not granted to authenticated/anon. service_role bypasses grants for bootstrap.
  if auth.role() is distinct from 'service_role' and not public.has_staff_role('администрация') then
    raise exception 'email_core_ops_upsert_verified_sender: not allowed' using errcode = '42501';
  end if;
  -- Staff admin path still blocked: only service_role may mutate verified list in Phase A
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_ops_upsert_verified_sender: service_role only' using errcode = '42501';
  end if;

  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'email_core_ops_upsert_verified_sender: invalid email';
  end if;
  if p_status not in ('pending', 'verified', 'revoked') then
    raise exception 'email_core_ops_upsert_verified_sender: invalid status';
  end if;

  v_domain := public.email_core_domain_of(v_email);

  insert into public.email_verified_senders as vs (
    email, domain, status, provider_sender_id, verified_at, created_by
  ) values (
    v_email,
    v_domain,
    p_status,
    p_provider_sender_id,
    case when p_status = 'verified' then now() else null end,
    'service_role'
  )
  on conflict (email) do update set
    domain = excluded.domain,
    status = excluded.status,
    provider_sender_id = coalesce(excluded.provider_sender_id, vs.provider_sender_id),
    verified_at = case
      when excluded.status = 'verified' then coalesce(vs.verified_at, now())
      else null
    end
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'email', v_email, 'domain', v_domain, 'status', p_status);
end;
$fn$;

revoke all on function public.email_core_ops_upsert_verified_sender(text, text, text)
  from public, anon, authenticated;

create or replace function public.email_core_ops_set_domain_metadata(
  p_verified_domain text,
  p_provider_domain_id text,
  p_domain_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_ops_set_domain_metadata: service_role only' using errcode = '42501';
  end if;
  if p_domain_status not in ('none', 'pending', 'verified', 'failed') then
    raise exception 'email_core_ops_set_domain_metadata: invalid domain_status';
  end if;

  update public.complex_email_settings as s
  set
    verified_domain = nullif(lower(btrim(coalesce(p_verified_domain, ''))), ''),
    provider_domain_id = nullif(btrim(coalesce(p_provider_domain_id, '')), ''),
    domain_status = p_domain_status,
    -- Never auto-enable
    email_enabled = false,
    updated_at = now(),
    updated_by_email = 'service_role'
  where s.id = 1;

  perform public.email_core_sync_xfer_provider_flag();

  return jsonb_build_object(
    'ok', true,
    'verified_domain', (select verified_domain from public.complex_email_settings where id = 1),
    'provider_domain_id', (select provider_domain_id from public.complex_email_settings where id = 1),
    'domain_status', (select domain_status from public.complex_email_settings where id = 1),
    'email_enabled', false
  );
end;
$fn$;

revoke all on function public.email_core_ops_set_domain_metadata(text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue (modules) — Phase A: hold / blocked_not_ready; never sends
-- ---------------------------------------------------------------------------

create or replace function public.email_core_enqueue(
  p_idempotency_key text,
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_locale text default null,
  p_subject text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to text := public.email_core_normalize_email(p_to_email);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_locale text;
  v_status text;
  v_id bigint;
  v_existing public.email_outbox%rowtype;
  s public.complex_email_settings%rowtype;
begin
  if v_key is null then
    raise exception 'email_core_enqueue: idempotency_key required';
  end if;
  if p_module_key not in ('pb1_invite', 'user_activation', 'pkg_xfer', 'meeting', 'email_test', 'system') then
    raise exception 'email_core_enqueue: invalid module_key';
  end if;
  if v_to is null or position('@' in v_to) < 2 then
    raise exception 'email_core_enqueue: invalid to_email';
  end if;

  select * into s from public.complex_email_settings where id = 1;
  v_locale := coalesce(
    nullif(btrim(coalesce(p_locale, '')), ''),
    s.template_locale,
    'bg'
  );
  if v_locale not in ('bg', 'ru', 'en') then
    v_locale := 'bg';
  end if;

  select * into v_existing
  from public.email_outbox as o
  where o.idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'outbox_id', v_existing.id,
      'status', v_existing.status,
      'fallback_status', public.email_core_module_fallback_status(),
      'queued', false,
      'sent', false
    );
  end if;

  -- Phase A: never ready → blocked_not_ready (preserves honesty for consumers)
  if public.email_core_is_ready() then
    v_status := 'held';
  else
    v_status := 'blocked_not_ready';
  end if;

  insert into public.email_outbox (
    idempotency_key, module_key, template_key, locale, to_email, to_email_hash,
    subject, payload, status, attempts, created_by_email
  ) values (
    v_key,
    p_module_key,
    coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), 'untitled'),
    v_locale,
    v_to,
    public.email_core_email_hash(v_to),
    p_subject,
    coalesce(p_payload, '{}'::jsonb),
    v_status,
    0,
    nullif(btrim(coalesce(auth.email(), '')), '')
  )
  returning id into v_id;

  insert into public.email_delivery_attempts (outbox_id, attempt_no, result, error_code)
  values (v_id, 1, 'skipped_phase_a', 'phase_a_no_send');

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'outbox_id', v_id,
    'status', v_status,
    'fallback_status', public.email_core_module_fallback_status(),
    'queued', false,
    'sent', false
  );
end;
$fn$;

revoke all on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  to authenticated;

-- Bridge XFER notify to Email Core readiness (preserves Stage-4 privacy + honesty labels)
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
  v_provider := public.email_core_is_ready();

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

    begin
      perform public.email_core_enqueue(
        'pkg_xfer:' || coalesce(p_transfer_id::text, '0') || ':' || coalesce(p_event_kind, 'evt')
          || ':' || public.email_core_email_hash(v_email),
        'pkg_xfer',
        'ownership_change_' || coalesce(p_event_kind, 'event'),
        v_email,
        null,
        null,
        jsonb_build_object(
          'transfer_id', p_transfer_id,
          'property_id', p_property_id,
          'event_kind', p_event_kind,
          'recipient_role', p_recipient_role
        )
      );
    exception
      when others then
        null;
    end;
  end loop;
end;
$fn$;

revoke all on function public.ownership_change_notify(bigint, bigint, text, text[], jsonb, text)
  from public, anon;
-- commit (stripped for package)

-- <<< END PACKAGED FROM 20261012120000_email_core_phase_a.sql

-- >>> BEGIN PACKAGED FROM 20261013130000_email_core_phase_b.sql
-- =============================================================================
-- Email Core Phase B — outbox claim / complete / delivery events (service_role)
-- Does NOT enable sending. Does NOT insert secrets.
-- Do NOT apply to shared Supabase without explicit approval.
-- =============================================================================
-- begin (stripped for package)
-- ---------------------------------------------------------------------------
-- Config readiness (DB-only). Host EMAIL_SENDING_ENABLED remains app-layer gate.
-- ---------------------------------------------------------------------------

create or replace function public.email_core_is_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
  v_sender_ok boolean := false;
begin
  select * into s from public.complex_email_settings where id = 1;
  if not found then
    return false;
  end if;
  if s.platform_disabled then
    return false;
  end if;
  if not s.email_enabled then
    return false;
  end if;
  if s.domain_status is distinct from 'verified' or s.verified_domain is null then
    return false;
  end if;
  if public.email_core_normalize_email(s.sender_email) is null then
    return false;
  end if;

  select exists (
    select 1
    from public.email_verified_senders as vs
    where vs.status = 'verified'
      and public.email_core_normalize_email(vs.email) = public.email_core_normalize_email(s.sender_email)
  ) into v_sender_ok;

  return v_sender_ok;
end;
$fn$;

comment on function public.email_core_is_ready() is
  'Phase B: true only when DB config complete (enabled + verified domain/sender). Host EMAIL_SENDING_ENABLED is enforced by the worker, not SQL.';

-- Allow admin to enable when domain+sender verified (still no host send without EMAIL_SENDING_ENABLED)
create or replace function public.admin_update_email_settings(
  p_sender_name text default null,
  p_sender_email text default null,
  p_reply_to_email text default null,
  p_template_locale text default null,
  p_email_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
  v_sender text;
  v_reply text;
  v_locale text;
  v_enable boolean;
  v_sender_ok boolean := false;
  v_domain_ok boolean := false;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_update_email_settings: not allowed' using errcode = '42501';
  end if;

  select * into s from public.complex_email_settings where id = 1 for update;
  if not found then
    raise exception 'admin_update_email_settings: missing settings row';
  end if;

  v_sender := coalesce(
    public.email_core_normalize_email(p_sender_email),
    public.email_core_normalize_email(s.sender_email)
  );
  v_reply := case
    when p_reply_to_email is null then s.reply_to_email
    when btrim(p_reply_to_email) = '' then null
    else public.email_core_normalize_email(p_reply_to_email)
  end;
  v_locale := coalesce(nullif(btrim(coalesce(p_template_locale, '')), ''), s.template_locale);
  if v_locale not in ('bg', 'ru', 'en') then
    raise exception 'admin_update_email_settings: invalid template_locale';
  end if;

  v_enable := coalesce(p_email_enabled, s.email_enabled);

  if v_sender is not null then
    select exists (
      select 1
      from public.email_verified_senders as vs
      where vs.status = 'verified'
        and public.email_core_normalize_email(vs.email) = v_sender
    ) into v_sender_ok;
    if not v_sender_ok then
      raise exception 'admin_update_email_settings: sender_email must be a verified sender'
        using errcode = '22023';
    end if;
  end if;

  v_domain_ok := (s.domain_status = 'verified' and s.verified_domain is not null);

  if v_enable then
    if not v_domain_ok then
      raise exception 'admin_update_email_settings: cannot enable email until domain is verified'
        using errcode = '22023';
    end if;
    if v_sender is null or not v_sender_ok then
      raise exception 'admin_update_email_settings: cannot enable email without verified sender'
        using errcode = '22023';
    end if;
  end if;

  if v_reply is not null and position('@' in v_reply) < 2 then
    raise exception 'admin_update_email_settings: invalid reply_to_email';
  end if;

  update public.complex_email_settings as t
  set
    sender_name = coalesce(p_sender_name, t.sender_name),
    sender_email = v_sender,
    reply_to_email = v_reply,
    template_locale = v_locale,
    email_enabled = v_enable,
    updated_at = now(),
    updated_by_email = nullif(btrim(coalesce(auth.email(), '')), '')
  where t.id = 1;

  perform public.email_core_sync_xfer_provider_flag();

  return public.admin_get_email_settings();
end;
$fn$;

revoke all on function public.admin_update_email_settings(text, text, text, text, boolean)
  from public, anon;
grant execute on function public.admin_update_email_settings(text, text, text, text, boolean)
  to authenticated;

-- Enqueue: queued when ready, else blocked_not_ready (no send)
create or replace function public.email_core_enqueue(
  p_idempotency_key text,
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_locale text default null,
  p_subject text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to text := public.email_core_normalize_email(p_to_email);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_locale text;
  v_status text;
  v_id bigint;
  v_existing public.email_outbox%rowtype;
  s public.complex_email_settings%rowtype;
begin
  if v_key is null then
    raise exception 'email_core_enqueue: idempotency_key required';
  end if;
  if p_module_key not in ('pb1_invite', 'user_activation', 'pkg_xfer', 'meeting', 'email_test', 'system') then
    raise exception 'email_core_enqueue: invalid module_key';
  end if;
  if v_to is null or position('@' in v_to) < 2 then
    raise exception 'email_core_enqueue: invalid to_email';
  end if;

  select * into s from public.complex_email_settings where id = 1;
  v_locale := coalesce(
    nullif(btrim(coalesce(p_locale, '')), ''),
    s.template_locale,
    'bg'
  );
  if v_locale not in ('bg', 'ru', 'en') then
    v_locale := 'bg';
  end if;

  select * into v_existing
  from public.email_outbox as o
  where o.idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'outbox_id', v_existing.id,
      'status', v_existing.status,
      'fallback_status', public.email_core_module_fallback_status(),
      'queued', v_existing.status in ('queued', 'held', 'sending'),
      'sent', v_existing.status = 'sent'
    );
  end if;

  if public.email_core_is_ready() then
    v_status := 'queued';
  else
    v_status := 'blocked_not_ready';
  end if;

  insert into public.email_outbox (
    idempotency_key, module_key, template_key, locale, to_email, to_email_hash,
    subject, payload, status, attempts, next_attempt_at, created_by_email
  ) values (
    v_key,
    p_module_key,
    coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), 'untitled'),
    v_locale,
    v_to,
    public.email_core_email_hash(v_to),
    p_subject,
    coalesce(p_payload, '{}'::jsonb),
    v_status,
    0,
    case when v_status = 'queued' then now() else null end,
    nullif(btrim(coalesce(auth.email(), '')), '')
  )
  returning id into v_id;

  insert into public.email_delivery_attempts (outbox_id, attempt_no, result, error_code)
  values (
    v_id,
    1,
    'awaiting_worker',
    case when v_status = 'queued' then 'awaiting_worker' else 'not_ready' end
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'outbox_id', v_id,
    'status', v_status,
    'fallback_status', public.email_core_module_fallback_status(),
    'queued', v_status = 'queued',
    'sent', false
  );
end;
$fn$;

revoke all on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  to authenticated;

-- Expand attempt result enum-ish via drop/re-add check if needed
alter table public.email_delivery_attempts
  drop constraint if exists email_delivery_attempts_result_check;

alter table public.email_delivery_attempts
  add constraint email_delivery_attempts_result_check
  check (result in (
    'skipped_phase_a', 'accepted', 'rejected', 'error', 'rate_limited', 'awaiting_worker'
  ));

-- ---------------------------------------------------------------------------
-- Worker RPCs (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.email_core_worker_get_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_worker_get_context: service_role only' using errcode = '42501';
  end if;

  select * into s from public.complex_email_settings where id = 1;
  if not found then
    raise exception 'email_core_worker_get_context: missing settings';
  end if;

  return jsonb_build_object(
    'mail_provider', s.mail_provider,
    'sender_name', s.sender_name,
    'sender_email', s.sender_email,
    'reply_to_email', s.reply_to_email,
    'verified_domain', s.verified_domain,
    'domain_status', s.domain_status,
    'email_enabled', s.email_enabled,
    'template_locale', s.template_locale,
    'platform_disabled', s.platform_disabled,
    'db_ready', public.email_core_is_ready()
  );
end;
$fn$;

revoke all on function public.email_core_worker_get_context()
  from public, anon, authenticated;

create or replace function public.email_core_claim_outbox_batch(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 10), 25));
  v_ids bigint[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_claim_outbox_batch: service_role only' using errcode = '42501';
  end if;

  if not public.email_core_is_ready() then
    return '[]'::jsonb;
  end if;

  with candidates as (
    select o.id
    from public.email_outbox as o
    where o.status in ('queued', 'held')
      and (o.next_attempt_at is null or o.next_attempt_at <= now())
      and o.attempts < 8
    order by o.id
    for update skip locked
    limit v_lim
  ),
  claimed as (
    update public.email_outbox as o
    set
      status = 'sending',
      attempts = o.attempts + 1,
      updated_at = now()
    from candidates as c
    where o.id = c.id
    returning o.id
  )
  select coalesce(array_agg(id), array[]::bigint[]) into v_ids from claimed;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(o) order by o.id)
      from public.email_outbox as o
      where o.id = any (v_ids)
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.email_core_claim_outbox_batch(integer)
  from public, anon, authenticated;

create or replace function public.email_core_complete_outbox_send(
  p_outbox_id bigint,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_provider_response_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.email_outbox%rowtype;
  v_attempt int;
  v_backoff_seconds int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_complete_outbox_send: service_role only' using errcode = '42501';
  end if;

  select * into o from public.email_outbox where id = p_outbox_id for update;
  if not found then
    raise exception 'email_core_complete_outbox_send: not found';
  end if;

  v_attempt := greatest(o.attempts, 1);

  insert into public.email_delivery_attempts (
    outbox_id, attempt_no, finished_at, result, error_code, provider_response_class
  ) values (
    p_outbox_id,
    v_attempt,
    now(),
    case
      when p_ok then 'accepted'
      when p_error_code = 'rate_limited' then 'rate_limited'
      else 'error'
    end,
    p_error_code,
    p_provider_response_class
  )
  on conflict (outbox_id, attempt_no) do update set
    finished_at = excluded.finished_at,
    result = excluded.result,
    error_code = excluded.error_code,
    provider_response_class = excluded.provider_response_class;

  if p_ok then
    update public.email_outbox
    set
      status = 'sent',
      provider_message_id = coalesce(nullif(btrim(coalesce(p_provider_message_id, '')), ''), provider_message_id),
      last_error_code = null,
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id;
  else
    v_backoff_seconds := least(3600, (2 ^ least(v_attempt, 10)) * 30);
    if v_attempt >= 8 then
      update public.email_outbox
      set
        status = 'failed',
        last_error_code = coalesce(p_error_code, 'send_failed'),
        next_attempt_at = null,
        updated_at = now()
      where id = p_outbox_id;
    else
      update public.email_outbox
      set
        status = 'queued',
        last_error_code = coalesce(p_error_code, 'send_failed'),
        next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
        updated_at = now()
      where id = p_outbox_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'outbox_id', p_outbox_id,
    'status', (select status from public.email_outbox where id = p_outbox_id)
  );
end;
$fn$;

revoke all on function public.email_core_complete_outbox_send(bigint, boolean, text, text, text)
  from public, anon, authenticated;

create or replace function public.email_core_record_delivery_event(
  p_provider_message_id text,
  p_event_type text,
  p_payload_redacted jsonb default '{}'::jsonb,
  p_outbox_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_outbox_id bigint := p_outbox_id;
  v_id bigint;
  v_type text := lower(btrim(coalesce(p_event_type, '')));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_record_delivery_event: service_role only' using errcode = '42501';
  end if;

  if v_type = '' then
    raise exception 'email_core_record_delivery_event: event_type required';
  end if;

  if v_outbox_id is null and nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null then
    select o.id into v_outbox_id
    from public.email_outbox as o
    where o.provider_message_id = btrim(p_provider_message_id)
    order by o.id desc
    limit 1;
  end if;

  insert into public.email_delivery_events (
    outbox_id, provider_message_id, event_type, payload_redacted
  ) values (
    v_outbox_id,
    nullif(btrim(coalesce(p_provider_message_id, '')), ''),
    v_type,
    coalesce(p_payload_redacted, '{}'::jsonb)
  )
  returning id into v_id;

  if v_outbox_id is not null and v_type in ('bounced', 'bounce', 'complained', 'complaint', 'failed') then
    update public.email_outbox
    set
      last_error_code = v_type,
      updated_at = now()
    where id = v_outbox_id
      and status = 'sent';
  end if;

  return jsonb_build_object('ok', true, 'event_id', v_id, 'outbox_id', v_outbox_id);
end;
$fn$;

revoke all on function public.email_core_record_delivery_event(text, text, jsonb, bigint)
  from public, anon, authenticated;

-- Keep XFER flag in sync (still false while email_enabled=false)
select public.email_core_sync_xfer_provider_flag();
-- commit (stripped for package)

-- <<< END PACKAGED FROM 20261013130000_email_core_phase_b.sql

-- >>> BEGIN PACKAGED FROM 20261014120000_email_core_phase_d.sql
-- =============================================================================
-- Email Core Phase D — stale reclaim, permanent failures, diagnostics, PB1 cancel
-- Does NOT enable sending. Does NOT insert secrets.
-- Do NOT apply without separate operator approval.
-- =============================================================================
-- begin (stripped for package)
-- ---------------------------------------------------------------------------
-- Reclaim rows stuck in `sending` after worker crash / function timeout
-- ---------------------------------------------------------------------------

create or replace function public.email_core_reclaim_stale_sending(
  p_older_than_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_minutes int := greatest(1, least(coalesce(p_older_than_minutes, 15), 120));
  v_n int := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_reclaim_stale_sending: service_role only' using errcode = '42501';
  end if;

  with updated as (
    update public.email_outbox as o
    set
      status = 'queued',
      last_error_code = coalesce(o.last_error_code, 'stale_sending_reclaimed'),
      next_attempt_at = now(),
      updated_at = now()
    where o.status = 'sending'
      and o.updated_at < now() - make_interval(mins => v_minutes)
    returning o.id
  )
  select count(*)::int into v_n from updated;

  return jsonb_build_object('ok', true, 'reclaimed', v_n);
end;
$fn$;

revoke all on function public.email_core_reclaim_stale_sending(integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Complete send: permanent provider failures terminate immediately
-- ---------------------------------------------------------------------------

create or replace function public.email_core_complete_outbox_send(
  p_outbox_id bigint,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_provider_response_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.email_outbox%rowtype;
  v_attempt int;
  v_backoff_seconds int;
  v_err text := lower(btrim(coalesce(p_error_code, '')));
  v_permanent boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_complete_outbox_send: service_role only' using errcode = '42501';
  end if;

  select * into o from public.email_outbox where id = p_outbox_id for update;
  if not found then
    raise exception 'email_core_complete_outbox_send: not found';
  end if;

  v_attempt := greatest(o.attempts, 1);
  v_permanent :=
    v_err like 'permanent:%'
    or v_err in (
      'invalid_recipient', 'invalid_invite_link', 'bounced', 'bounce',
      'complained', 'complaint', 'unsubscribed', 'suppressed',
      'validation_error', 'invalid_from_address', 'domain_not_verified'
    )
    or (
      coalesce(p_provider_response_class, '') = 'rejected'
      and (
        v_err like '%invalid%'
        or v_err like '%forbidden%'
        or v_err like '%blocked%'
      )
    );

  insert into public.email_delivery_attempts (
    outbox_id, attempt_no, finished_at, result, error_code, provider_response_class
  ) values (
    p_outbox_id,
    v_attempt,
    now(),
    case
      when p_ok then 'accepted'
      when p_error_code = 'rate_limited' then 'rate_limited'
      else 'error'
    end,
    p_error_code,
    p_provider_response_class
  )
  on conflict (outbox_id, attempt_no) do update set
    finished_at = excluded.finished_at,
    result = excluded.result,
    error_code = excluded.error_code,
    provider_response_class = excluded.provider_response_class;

  if p_ok then
    update public.email_outbox
    set
      status = 'sent',
      provider_message_id = coalesce(nullif(btrim(coalesce(p_provider_message_id, '')), ''), provider_message_id),
      last_error_code = null,
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id;
  elsif v_permanent or v_attempt >= 8 then
    update public.email_outbox
    set
      status = 'failed',
      last_error_code = coalesce(p_error_code, 'send_failed'),
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id;
  else
    v_backoff_seconds := least(3600, (2 ^ least(v_attempt, 10)) * 30);
    update public.email_outbox
    set
      status = 'queued',
      last_error_code = coalesce(p_error_code, 'send_failed'),
      next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
      updated_at = now()
    where id = p_outbox_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'outbox_id', p_outbox_id,
    'status', (select status from public.email_outbox where id = p_outbox_id),
    'permanent', v_permanent
  );
end;
$fn$;

revoke all on function public.email_core_complete_outbox_send(bigint, boolean, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cancel PB1 outbox rows when invitation is revoked / superseded
-- ---------------------------------------------------------------------------

create or replace function public.email_core_cancel_pb1_invite_outbox(p_invite_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_invite_id, '')), '');
  v_n int := 0;
begin
  if auth.role() is distinct from 'authenticated' and auth.role() is distinct from 'service_role' then
    raise exception 'email_core_cancel_pb1_invite_outbox: not allowed' using errcode = '42501';
  end if;

  if auth.role() = 'authenticated' and not public.has_staff_role('администрация') then
    raise exception 'email_core_cancel_pb1_invite_outbox: not allowed' using errcode = '42501';
  end if;

  if v_id is null then
    return jsonb_build_object('ok', true, 'cancelled', 0);
  end if;

  with updated as (
    update public.email_outbox as o
    set
      status = 'cancelled',
      last_error_code = 'invite_revoked_or_superseded',
      next_attempt_at = null,
      updated_at = now()
    where o.module_key = 'pb1_invite'
      and o.status in ('queued', 'held', 'blocked_not_ready', 'sending')
      and (
        o.idempotency_key like ('pb1_invite:' || v_id || ':%')
        or coalesce(o.payload->>'invite_id', '') = v_id
      )
    returning o.id
  )
  select count(*)::int into v_n from updated;

  return jsonb_build_object('ok', true, 'cancelled', v_n);
end;
$fn$;

revoke all on function public.email_core_cancel_pb1_invite_outbox(text)
  from public, anon;
grant execute on function public.email_core_cancel_pb1_invite_outbox(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Richer diagnostics (masked) + queue summary for Admin UI
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_email_diagnostics(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_email_diagnostics: not allowed' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_json order by created_at desc)
      from (
        select
          jsonb_build_object(
            'id', o.id,
            'module_key', o.module_key,
            'template_key', o.template_key,
            'locale', o.locale,
            'to_masked', public.email_core_mask_email(o.to_email),
            'status', o.status,
            'attempts', o.attempts,
            'last_error_code', o.last_error_code,
            'next_attempt_at', o.next_attempt_at,
            'provider_message_id_present', o.provider_message_id is not null,
            'latest_event_type', (
              select e.event_type
              from public.email_delivery_events as e
              where e.outbox_id = o.id
              order by e.event_at desc, e.id desc
              limit 1
            ),
            'retry_eligible', (
              o.status in ('queued', 'held')
              and o.attempts < 8
              and coalesce(o.last_error_code, '') not like 'permanent:%'
              and coalesce(o.last_error_code, '') not in (
                'invalid_recipient', 'invalid_invite_link', 'bounced', 'bounce',
                'complained', 'complaint', 'invite_revoked_or_superseded'
              )
            ),
            'created_at', o.created_at,
            'updated_at', o.updated_at
          ) as row_json,
          o.created_at
        from public.email_outbox as o
        order by o.created_at desc
        limit v_lim
      ) as q
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.admin_list_email_diagnostics(integer) from public, anon;
grant execute on function public.admin_list_email_diagnostics(integer) to authenticated;

create or replace function public.admin_email_queue_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_email_queue_summary: not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'queued', (select count(*)::int from public.email_outbox where status = 'queued'),
    'held', (select count(*)::int from public.email_outbox where status = 'held'),
    'sending', (select count(*)::int from public.email_outbox where status = 'sending'),
    'sent', (select count(*)::int from public.email_outbox where status = 'sent'),
    'failed', (select count(*)::int from public.email_outbox where status = 'failed'),
    'cancelled', (select count(*)::int from public.email_outbox where status = 'cancelled'),
    'blocked_not_ready', (select count(*)::int from public.email_outbox where status = 'blocked_not_ready'),
    'claimable', (
      select count(*)::int from public.email_outbox
      where status in ('queued', 'held')
        and (next_attempt_at is null or next_attempt_at <= now())
        and attempts < 8
    )
  );
end;
$fn$;

revoke all on function public.admin_email_queue_summary() from public, anon;
grant execute on function public.admin_email_queue_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Sync PKG-XFER notification email_attempted / email_delivered from outbox
-- ---------------------------------------------------------------------------

create or replace function public.email_core_sync_xfer_notification_from_outbox(
  p_outbox_id bigint,
  p_attempted boolean,
  p_delivered boolean,
  p_skip_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.email_outbox%rowtype;
  v_transfer_id bigint;
  v_event text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_sync_xfer_notification_from_outbox: service_role only'
      using errcode = '42501';
  end if;

  if to_regclass('public.ownership_change_notifications') is null then
    return;
  end if;

  select * into o from public.email_outbox where id = p_outbox_id;
  if not found or o.module_key is distinct from 'pkg_xfer' then
    return;
  end if;

  begin
    v_transfer_id := nullif(o.payload->>'transfer_id', '')::bigint;
  exception
    when others then
      v_transfer_id := null;
  end;
  v_event := nullif(btrim(coalesce(o.payload->>'event_kind', '')), '');
  if v_transfer_id is null or v_event is null then
    return;
  end if;

  update public.ownership_change_notifications as n
  set
    email_attempted = coalesce(p_attempted, n.email_attempted),
    email_delivered = coalesce(p_delivered, false),
    email_skip_reason = case
      when coalesce(p_delivered, false) then null
      else coalesce(nullif(btrim(coalesce(p_skip_reason, '')), ''), n.email_skip_reason)
    end
  where n.transfer_id = v_transfer_id
    and n.event_kind = v_event
    and lower(n.recipient_email) = lower(o.to_email);
end;
$fn$;

revoke all on function public.email_core_sync_xfer_notification_from_outbox(bigint, boolean, boolean, text)
  from public, anon, authenticated;

-- Hook complete_outbox_send → XFER sync (redefine with sync call)
create or replace function public.email_core_complete_outbox_send(
  p_outbox_id bigint,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_provider_response_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.email_outbox%rowtype;
  v_attempt int;
  v_backoff_seconds int;
  v_err text := lower(btrim(coalesce(p_error_code, '')));
  v_permanent boolean := false;
  v_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_complete_outbox_send: service_role only' using errcode = '42501';
  end if;

  select * into o from public.email_outbox where id = p_outbox_id for update;
  if not found then
    raise exception 'email_core_complete_outbox_send: not found';
  end if;

  v_attempt := greatest(o.attempts, 1);
  v_permanent :=
    v_err like 'permanent:%'
    or v_err in (
      'invalid_recipient', 'invalid_invite_link', 'bounced', 'bounce',
      'complained', 'complaint', 'unsubscribed', 'suppressed',
      'validation_error', 'invalid_from_address', 'domain_not_verified'
    )
    or (
      coalesce(p_provider_response_class, '') = 'rejected'
      and (
        v_err like '%invalid%'
        or v_err like '%forbidden%'
        or v_err like '%blocked%'
      )
    );

  insert into public.email_delivery_attempts (
    outbox_id, attempt_no, finished_at, result, error_code, provider_response_class
  ) values (
    p_outbox_id,
    v_attempt,
    now(),
    case
      when p_ok then 'accepted'
      when p_error_code = 'rate_limited' then 'rate_limited'
      else 'error'
    end,
    p_error_code,
    p_provider_response_class
  )
  on conflict (outbox_id, attempt_no) do update set
    finished_at = excluded.finished_at,
    result = excluded.result,
    error_code = excluded.error_code,
    provider_response_class = excluded.provider_response_class;

  if p_ok then
    update public.email_outbox
    set
      status = 'sent',
      provider_message_id = coalesce(nullif(btrim(coalesce(p_provider_message_id, '')), ''), provider_message_id),
      last_error_code = null,
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id;
    perform public.email_core_sync_xfer_notification_from_outbox(
      p_outbox_id, true, true, null
    );
  elsif v_permanent or v_attempt >= 8 then
    update public.email_outbox
    set
      status = 'failed',
      last_error_code = coalesce(p_error_code, 'send_failed'),
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id;
    perform public.email_core_sync_xfer_notification_from_outbox(
      p_outbox_id, true, false, coalesce(p_error_code, 'send_failed')
    );
  else
    v_backoff_seconds := least(3600, (2 ^ least(v_attempt, 10)) * 30);
    update public.email_outbox
    set
      status = 'queued',
      last_error_code = coalesce(p_error_code, 'send_failed'),
      next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
      updated_at = now()
    where id = p_outbox_id;
    perform public.email_core_sync_xfer_notification_from_outbox(
      p_outbox_id, true, false, coalesce(p_error_code, 'send_failed')
    );
  end if;

  select status into v_status from public.email_outbox where id = p_outbox_id;

  return jsonb_build_object(
    'ok', true,
    'outbox_id', p_outbox_id,
    'status', v_status,
    'permanent', v_permanent
  );
end;
$fn$;

revoke all on function public.email_core_complete_outbox_send(bigint, boolean, text, text, text)
  from public, anon, authenticated;

-- Module-aware SQL fallback (PB1 → COPY_LINK when not ready)
create or replace function public.email_core_module_fallback_status(p_module_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.email_core_is_ready() then 'QUEUED'
    when coalesce(p_module_key, '') = 'pb1_invite' then 'COPY_LINK'
    when coalesce(p_module_key, '') = 'meeting' then 'in_app_only'
    else 'PROVIDER_NOT_CONFIGURED'
  end;
$$;

revoke all on function public.email_core_module_fallback_status(text) from public, anon;
grant execute on function public.email_core_module_fallback_status(text) to authenticated;

-- Keep zero-arg wrapper for older callers
create or replace function public.email_core_module_fallback_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.email_core_module_fallback_status(null::text);
$$;

revoke all on function public.email_core_module_fallback_status() from public, anon;
grant execute on function public.email_core_module_fallback_status() to authenticated;

-- Webhook bounce/complaint: annotate + sync XFER delivered flag
create or replace function public.email_core_record_delivery_event(
  p_provider_message_id text,
  p_event_type text,
  p_payload_redacted jsonb default '{}'::jsonb,
  p_outbox_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_outbox_id bigint := p_outbox_id;
  v_id bigint;
  v_type text := lower(btrim(coalesce(p_event_type, '')));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_record_delivery_event: service_role only' using errcode = '42501';
  end if;

  if v_type = '' then
    raise exception 'email_core_record_delivery_event: event_type required';
  end if;

  if v_outbox_id is null and nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null then
    select o.id into v_outbox_id
    from public.email_outbox as o
    where o.provider_message_id = btrim(p_provider_message_id)
    order by o.id desc
    limit 1;
  end if;

  insert into public.email_delivery_events (
    outbox_id, provider_message_id, event_type, payload_redacted
  ) values (
    v_outbox_id,
    nullif(btrim(coalesce(p_provider_message_id, '')), ''),
    v_type,
    coalesce(p_payload_redacted, '{}'::jsonb)
  )
  returning id into v_id;

  if v_outbox_id is not null and v_type in ('bounced', 'bounce', 'complained', 'complaint', 'failed') then
    update public.email_outbox
    set
      last_error_code = v_type,
      updated_at = now()
    where id = v_outbox_id
      and status = 'sent';
    perform public.email_core_sync_xfer_notification_from_outbox(
      v_outbox_id, true, false, v_type
    );
  elsif v_outbox_id is not null and v_type in ('delivered', 'opened') then
    perform public.email_core_sync_xfer_notification_from_outbox(
      v_outbox_id, true, true, null
    );
  end if;

  return jsonb_build_object('ok', true, 'event_id', v_id, 'outbox_id', v_outbox_id);
end;
$fn$;

revoke all on function public.email_core_record_delivery_event(text, text, jsonb, bigint)
  from public, anon, authenticated;
-- commit (stripped for package)

-- <<< END PACKAGED FROM 20261014120000_email_core_phase_d.sql

-- >>> BEGIN PACKAGED FROM 20261015120000_phase_e1_security_hardening.sql
-- Phase E1 — SEC-P1-1 / SEC-P1-2 security hardening
-- Do not enable email sending. Do not flip ordinary_debt_gate.
-- Authz only: Property Book active-owners PII + email_core_enqueue caller checks.
-- begin (stripped for package)
-- ---------------------------------------------------------------------------
-- SEC-P1-1: property_book_active_owners — scoped PII
-- Allow: service_role, book admin (администрация), Book owners/co-owners (owns_property).
-- Deny: anon, guests (no owns_property), unrelated authenticated users.
-- Nested SECURITY DEFINER admin/validate callers keep working via session auth.uid().
-- ---------------------------------------------------------------------------

create or replace function public.property_book_active_owners(p_property_id bigint)
returns setof public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is not distinct from 'service_role' then
    null; -- ops / workers
  elsif public.has_staff_role('администрация') then
    null; -- UK administrators
  elsif auth.uid() is not null and public.owns_property(p_property_id) then
    null; -- active Book owner / co-owner on this property
  else
    raise exception 'property_book_active_owners: forbidden'
      using errcode = '42501';
  end if;

  return query
  select r.*
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id;
end;
$fn$;

revoke all on function public.property_book_active_owners(bigint) from public;
revoke all on function public.property_book_active_owners(bigint) from anon;
grant execute on function public.property_book_active_owners(bigint) to authenticated;
grant execute on function public.property_book_active_owners(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- SEC-P1-2: email_core_enqueue — caller + module/template authorization
-- ---------------------------------------------------------------------------

create or replace function public.email_core_assert_can_enqueue(
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_module text := nullif(btrim(coalesce(p_module_key, '')), '');
  v_tpl text := lower(nullif(btrim(coalesce(p_template_key, '')), ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_property_id bigint := null;
  v_transfer_id bigint := null;
  v_is_admin boolean := false;
  v_raw text;
  v_to text := public.email_core_normalize_email(p_to_email);
  v_system_ok boolean := false;
begin
  if v_module is null then
    raise exception 'email_core_enqueue: invalid module_key'
      using errcode = '22023';
  end if;

  if auth.role() is not distinct from 'service_role' then
    return;
  end if;

  if auth.uid() is null then
    raise exception 'email_core_enqueue: not authenticated'
      using errcode = '28000';
  end if;

  v_is_admin := public.has_staff_role('администрация');

  -- Template prefix must match module (blocks module/template spoofing).
  if v_tpl is null then
    raise exception 'email_core_enqueue: template_key required'
      using errcode = '22023';
  end if;

  if v_module = 'pb1_invite' and v_tpl not like 'pb1_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'user_activation' and v_tpl not like 'ua_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'pkg_xfer' and v_tpl not like 'ownership_change_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'meeting' and v_tpl not like 'meeting_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'email_test' and v_tpl not like 'email_test%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;

  -- EML-4: allowlisted system templates (meters/finance/tickets/etc). Sending still OFF.
  if v_module = 'system' then
    v_system_ok :=
      v_tpl like 'meters_%'
      or v_tpl like 'uk_%'
      or v_tpl like 'internet_%'
      or v_tpl like 'ticket_%'
      or v_tpl like 'residence_%'
      or v_tpl like 'cleaning_%'
      or v_tpl like 'support_fee_%'
      or v_tpl like 'capital_repair_%'
      or v_tpl like 'inventory_%'
      or v_tpl like 'email_digest%';
    if not v_system_ok then
      raise exception 'email_core_enqueue: template_key mismatch'
        using errcode = '22023';
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    if v_is_admin then
      return;
    end if;

    if v_property_id is not null
       and v_to is not null
       and public.owns_property(v_property_id) then
      if public.property_book_active_owner_by_email(v_property_id, v_to) then
        return;
      end if;
      -- EML-5: owner may notify complex admins about ticket/chat activity only.
      if v_tpl like 'ticket_%' then
        if exists (
          select 1
          from public.staff as s
          where s.role = 'администрация'
            and coalesce(s.active, true)
            and public.email_core_normalize_email(s.email) = v_to
        ) then
          return;
        end if;
      end if;
    end if;

    raise exception 'email_core_enqueue: forbidden'
      using errcode = '42501';
  end if;

  if v_module in ('pb1_invite', 'user_activation', 'email_test', 'meeting') then
    if not v_is_admin then
      raise exception 'email_core_enqueue: forbidden'
        using errcode = '42501';
    end if;
    return;
  end if;

  if v_module = 'pkg_xfer' then
    if v_is_admin then
      return;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'transfer_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_transfer_id := v_raw::bigint;
    end if;

    if v_property_id is null and v_transfer_id is not null then
      select t.property_id
        into v_property_id
      from public.owner_transfers as t
      where t.id = v_transfer_id;
    end if;

    if v_property_id is not null and public.owns_property(v_property_id) then
      return;
    end if;

    raise exception 'email_core_enqueue: forbidden'
      using errcode = '42501';
  end if;

  raise exception 'email_core_enqueue: invalid module_key'
    using errcode = '22023';
end;
$fn$;

revoke all on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to service_role;

create or replace function public.email_core_enqueue(
  p_idempotency_key text,
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_locale text default null,
  p_subject text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to text := public.email_core_normalize_email(p_to_email);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_locale text;
  v_status text;
  v_id bigint;
  v_existing public.email_outbox%rowtype;
  s public.complex_email_settings%rowtype;
begin
  if v_key is null then
    raise exception 'email_core_enqueue: idempotency_key required';
  end if;
  if p_module_key not in ('pb1_invite', 'user_activation', 'pkg_xfer', 'meeting', 'email_test', 'system') then
    raise exception 'email_core_enqueue: invalid module_key';
  end if;
  if v_to is null or position('@' in v_to) < 2 then
    raise exception 'email_core_enqueue: invalid to_email';
  end if;

  -- Authorize before duplicate probe / insert (no outbox oracle for strangers).
  perform public.email_core_assert_can_enqueue(
    p_module_key,
    p_template_key,
    p_to_email,
    coalesce(p_payload, '{}'::jsonb)
  );

  select * into s from public.complex_email_settings where id = 1;
  v_locale := coalesce(
    nullif(btrim(coalesce(p_locale, '')), ''),
    s.template_locale,
    'bg'
  );
  if v_locale not in ('bg', 'ru', 'en') then
    v_locale := 'bg';
  end if;

  select * into v_existing
  from public.email_outbox as o
  where o.idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'outbox_id', v_existing.id,
      'status', v_existing.status,
      'fallback_status', public.email_core_module_fallback_status(),
      'queued', v_existing.status in ('queued', 'held', 'sending'),
      'sent', v_existing.status = 'sent'
    );
  end if;

  if public.email_core_is_ready() then
    v_status := 'queued';
  else
    v_status := 'blocked_not_ready';
  end if;

  insert into public.email_outbox (
    idempotency_key, module_key, template_key, locale, to_email, to_email_hash,
    subject, payload, status, attempts, next_attempt_at, created_by_email
  ) values (
    v_key,
    p_module_key,
    coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), 'untitled'),
    v_locale,
    v_to,
    public.email_core_email_hash(v_to),
    p_subject,
    coalesce(p_payload, '{}'::jsonb),
    v_status,
    0,
    case when v_status = 'queued' then now() else null end,
    nullif(btrim(coalesce(auth.email(), '')), '')
  )
  returning id into v_id;

  insert into public.email_delivery_attempts (outbox_id, attempt_no, result, error_code)
  values (
    v_id,
    1,
    'awaiting_worker',
    case when v_status = 'queued' then 'awaiting_worker' else 'not_ready' end
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'outbox_id', v_id,
    'status', v_status,
    'fallback_status', public.email_core_module_fallback_status(),
    'queued', v_status = 'queued',
    'sent', false
  );
end;
$fn$;

revoke all on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  to service_role;

-- Explicitly leave email + debt gates unchanged (no writes to settings tables).
-- commit (stripped for package)

-- <<< END PACKAGED FROM 20261015120000_phase_e1_security_hardening.sql

-- EML-2 package post-assert: sending stays OFF on singleton row
do $assert$
begin
  if exists (
    select 1 from public.complex_email_settings
    where id = 1 and email_enabled is distinct from false
  ) then
    raise exception 'email_core fresh_install: email_enabled must default false';
  end if;
end;
$assert$;
