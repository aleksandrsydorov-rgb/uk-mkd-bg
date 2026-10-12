-- =============================================================================
-- Email Core Phase A — configurable per-installation mail foundation
-- One installation DB = one complex = one email configuration.
-- Defaults: email_enabled=false. No provider secrets in tables. No live send.
-- Do NOT apply to shared/prod without explicit approval.
-- =============================================================================

begin;

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

commit;
