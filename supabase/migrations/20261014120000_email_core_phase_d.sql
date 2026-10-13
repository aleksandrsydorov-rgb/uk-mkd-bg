-- =============================================================================
-- Email Core Phase D — stale reclaim, permanent failures, diagnostics, PB1 cancel
-- Does NOT enable sending. Does NOT insert secrets.
-- Do NOT apply without separate operator approval.
-- =============================================================================

begin;

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

commit;
