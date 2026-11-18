-- =============================================================================
-- Email Core — Lettermint via complex settings (UI token, no rebuild).
-- Extends mail_provider CHECK; encrypted token ciphertext; ready rules;
-- sending_enabled_at boundary (no silent mass promote of blocked_not_ready).
-- Does NOT touch Auth SMTP. Does NOT log secrets.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Schema: provider + ciphertext + enable boundary
-- ---------------------------------------------------------------------------

alter table public.complex_email_settings
  drop constraint if exists complex_email_settings_mail_provider_check;

alter table public.complex_email_settings
  add constraint complex_email_settings_mail_provider_check
  check (mail_provider in ('resend', 'lettermint'));

alter table public.complex_email_settings
  add column if not exists provider_token_ciphertext text;

alter table public.complex_email_settings
  add column if not exists provider_token_present boolean not null default false;

alter table public.complex_email_settings
  add column if not exists sending_enabled_at timestamptz;

alter table public.complex_email_settings
  add column if not exists send_probe_accepted_at timestamptz;

alter table public.complex_email_settings
  add column if not exists connection_status text not null default 'not_configured';

alter table public.complex_email_settings
  drop constraint if exists complex_email_settings_connection_status_chk;

alter table public.complex_email_settings
  add constraint complex_email_settings_connection_status_chk
  check (connection_status in (
    'not_configured',
    'enabled_untested',
    'accepted',
    'disabled',
    'error'
  ));

comment on column public.complex_email_settings.provider_token_ciphertext is
  'AES-GCM ciphertext of Lettermint Project API token (server-only). Never expose via admin_get.';
comment on column public.complex_email_settings.sending_enabled_at is
  'Boundary: outbox rows created at/after this instant may queue when ready. Older blocked_not_ready stay historical.';

-- Webhook delivery idempotency (provider event id)
alter table public.email_delivery_events
  add column if not exists provider_event_id text;

create unique index if not exists email_delivery_events_provider_event_id_uq
  on public.email_delivery_events (provider_event_id)
  where provider_event_id is not null;

-- ---------------------------------------------------------------------------
-- Ready: Lettermint = enabled + sender + token present (no fake verified DNS row).
-- Resend keeps verified domain + verified sender allowlist.
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
  if public.email_core_normalize_email(s.sender_email) is null then
    return false;
  end if;

  if s.mail_provider = 'lettermint' then
    return coalesce(s.provider_token_present, false)
      and s.provider_token_ciphertext is not null
      and length(btrim(s.provider_token_ciphertext)) > 0;
  end if;

  -- resend (legacy): verified domain + allowlisted sender
  if s.domain_status is distinct from 'verified' or s.verified_domain is null then
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
  'DB ready: Lettermint needs enabled+sender+token; Resend needs verified domain/sender. Host EMAIL_SENDING_ENABLED is app-layer.';

-- ---------------------------------------------------------------------------
-- Admin read (never returns ciphertext)
-- ---------------------------------------------------------------------------

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
    raise exception 'admin_get_email_settings: missing settings';
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
    'delivery_status', s.delivery_status,
    'sending_ready', public.email_core_is_ready(),
    'phase', 'D',
    'secrets_in_database', false,
    'has_provider_token', coalesce(s.provider_token_present, false),
    'connection_status', s.connection_status,
    'sending_enabled_at', s.sending_enabled_at,
    'send_probe_accepted_at', s.send_probe_accepted_at,
    'updated_at', s.updated_at,
    'updated_by_email', s.updated_by_email,
    'verified_senders', public.admin_list_verified_email_senders()
  );
end;
$fn$;

revoke all on function public.admin_get_email_settings() from public, anon;
grant execute on function public.admin_get_email_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role: persist Lettermint connection (called from Next after encrypt)
-- ---------------------------------------------------------------------------

create or replace function public.email_core_service_save_lettermint_connection(
  p_sender_email text,
  p_sender_name text,
  p_enable boolean,
  p_token_ciphertext text default null,
  p_replace_token boolean default false,
  p_actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
  v_sender text;
  v_name text;
  v_has_token boolean;
  v_boundary timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_service_save_lettermint_connection: service_role only'
      using errcode = '42501';
  end if;

  select * into s from public.complex_email_settings where id = 1 for update;
  if not found then
    raise exception 'email_core_service_save_lettermint_connection: missing settings';
  end if;

  v_sender := public.email_core_normalize_email(p_sender_email);
  if v_sender is null or position('@' in v_sender) < 2 then
    raise exception 'email_core_service_save_lettermint_connection: invalid sender_email'
      using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_sender_name, '')), '');
  if v_name is null then
    v_name := coalesce(nullif(btrim(s.sender_name), ''), 'AMADEUS 11');
  end if;
  if char_length(v_name) > 120 then
    raise exception 'email_core_service_save_lettermint_connection: sender_name too long'
      using errcode = '22023';
  end if;

  if p_replace_token then
    if p_token_ciphertext is null or length(btrim(p_token_ciphertext)) < 8 then
      raise exception 'email_core_service_save_lettermint_connection: token ciphertext required'
        using errcode = '22023';
    end if;
    s.provider_token_ciphertext := btrim(p_token_ciphertext);
    s.provider_token_present := true;
  end if;

  v_has_token := coalesce(s.provider_token_present, false)
    and s.provider_token_ciphertext is not null
    and length(btrim(s.provider_token_ciphertext)) > 0;

  if p_enable and not v_has_token then
    raise exception 'email_core_service_save_lettermint_connection: token required to enable'
      using errcode = '22023';
  end if;

  v_boundary := s.sending_enabled_at;
  if p_enable and (v_boundary is null or not s.email_enabled) then
    v_boundary := now();
  end if;
  if not p_enable then
    v_boundary := s.sending_enabled_at; -- keep historical boundary; do not erase history
  end if;

  update public.complex_email_settings as t
  set
    mail_provider = 'lettermint',
    sender_email = v_sender,
    sender_name = v_name,
    reply_to_email = coalesce(t.reply_to_email, v_sender),
    provider_token_ciphertext = s.provider_token_ciphertext,
    provider_token_present = v_has_token,
    email_enabled = p_enable,
    sending_enabled_at = case when p_enable then v_boundary else t.sending_enabled_at end,
    connection_status = case
      when not p_enable then 'disabled'
      when t.send_probe_accepted_at is not null then 'accepted'
      else 'enabled_untested'
    end,
    -- Do not fake DNS verified; Lettermint readiness uses token+sender.
    domain_status = case
      when t.domain_status = 'verified' then t.domain_status
      else 'none'
    end,
    updated_at = now(),
    updated_by_email = nullif(btrim(coalesce(p_actor_email, '')), '')
  where t.id = 1;

  perform public.email_core_sync_xfer_provider_flag();

  -- Intentionally NO mass UPDATE of blocked_not_ready → queued.
  -- New enqueues after email_core_is_ready() become queued; older blocked rows stay historical.

  return jsonb_build_object(
    'ok', true,
    'mail_provider', 'lettermint',
    'email_enabled', p_enable,
    'has_provider_token', v_has_token,
    'sending_enabled_at', v_boundary,
    'connection_status', case
      when not p_enable then 'disabled'
      else 'enabled_untested'
    end
  );
end;
$fn$;

revoke all on function public.email_core_service_save_lettermint_connection(text, text, boolean, text, boolean, text)
  from public, anon, authenticated;

-- Mark probe accepted after controlled test ACCEPTED (service_role)
create or replace function public.email_core_service_mark_send_probe_accepted()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_service_mark_send_probe_accepted: service_role only'
      using errcode = '42501';
  end if;
  update public.complex_email_settings
  set
    send_probe_accepted_at = coalesce(send_probe_accepted_at, now()),
    connection_status = case
      when email_enabled then 'accepted'
      else connection_status
    end,
    updated_at = now()
  where id = 1;
end;
$fn$;

revoke all on function public.email_core_service_mark_send_probe_accepted()
  from public, anon, authenticated;

-- Worker context + secret fetch
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
    'has_provider_token', coalesce(s.provider_token_present, false),
    'sending_enabled_at', s.sending_enabled_at,
    'connection_status', s.connection_status,
    'db_ready', public.email_core_is_ready()
  );
end;
$fn$;

revoke all on function public.email_core_worker_get_context()
  from public, anon, authenticated;

create or replace function public.email_core_worker_get_provider_token_ciphertext()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_worker_get_provider_token_ciphertext: service_role only'
      using errcode = '42501';
  end if;
  select * into s from public.complex_email_settings where id = 1;
  if not found then
    return null;
  end if;
  if s.mail_provider is distinct from 'lettermint' then
    return null;
  end if;
  return s.provider_token_ciphertext;
end;
$fn$;

revoke all on function public.email_core_worker_get_provider_token_ciphertext()
  from public, anon, authenticated;

-- Delivery event: optional provider_event_id for webhook dedupe
create or replace function public.email_core_record_delivery_event(
  p_provider_message_id text,
  p_event_type text,
  p_payload_redacted jsonb default null,
  p_outbox_id bigint default null,
  p_provider_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_outbox_id bigint := p_outbox_id;
  v_event text := lower(btrim(coalesce(p_event_type, '')));
  v_provider_event text := nullif(btrim(coalesce(p_provider_event_id, '')), '');
  v_existing bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_record_delivery_event: service_role only' using errcode = '42501';
  end if;
  if v_event = '' then
    raise exception 'email_core_record_delivery_event: event_type required';
  end if;

  if v_provider_event is not null then
    select e.id into v_existing
    from public.email_delivery_events as e
    where e.provider_event_id = v_provider_event
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'event_id', v_existing);
    end if;
  end if;

  if v_outbox_id is null and p_provider_message_id is not null then
    select o.id into v_outbox_id
    from public.email_outbox as o
    where o.provider_message_id = p_provider_message_id
    order by o.id desc
    limit 1;
  end if;

  insert into public.email_delivery_events (
    outbox_id,
    provider_message_id,
    event_type,
    payload_redacted,
    provider_event_id
  ) values (
    v_outbox_id,
    nullif(btrim(coalesce(p_provider_message_id, '')), ''),
    v_event,
    p_payload_redacted,
    v_provider_event
  )
  returning id into v_existing;

  return jsonb_build_object('ok', true, 'duplicate', false, 'event_id', v_existing, 'outbox_id', v_outbox_id);
end;
$fn$;

-- Keep old 4-arg signature callable via default null for p_provider_event_id —
-- recreated above with 5 args. Grant service_role only.
revoke all on function public.email_core_record_delivery_event(text, text, jsonb, bigint, text)
  from public, anon, authenticated;

-- Complex name helper for UI/API
create or replace function public.admin_get_complex_display_name()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_name text;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_get_complex_display_name: not allowed' using errcode = '42501';
  end if;
  select nullif(btrim(coalesce(i.complex_name, i.display_name, '')), '')
    into v_name
  from public.platform_installations as i
  order by i.created_at nulls last
  limit 1;
  return coalesce(v_name, 'AMADEUS 11');
end;
$fn$;

revoke all on function public.admin_get_complex_display_name() from public, anon;
grant execute on function public.admin_get_complex_display_name() to authenticated;

commit;
