-- =============================================================================
-- Email Core Phase B — outbox claim / complete / delivery events (service_role)
-- Does NOT enable sending. Does NOT insert secrets.
-- Do NOT apply to shared Supabase without explicit approval.
-- =============================================================================

begin;

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

commit;
