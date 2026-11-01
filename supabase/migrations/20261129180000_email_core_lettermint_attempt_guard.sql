-- =============================================================================
-- Email Core: record a send attempt before the provider call, and hold a row
-- for operator review when a later automatic retry would fall outside the
-- 24-hour provider idempotency window.
-- The clock is the first send attempt (first_attempt_at, else the earliest
-- attempt started_at). Row creation time is not used.
-- A row with no send attempt stays claimable.
-- Does NOT enable sending. Does NOT insert secrets.
-- =============================================================================

begin;

alter table public.email_outbox
  add column if not exists first_attempt_at timestamptz null;

alter table public.email_delivery_attempts
  drop constraint if exists email_delivery_attempts_result_check;

alter table public.email_delivery_attempts
  add constraint email_delivery_attempts_result_check
  check (result in (
    'skipped_phase_a', 'accepted', 'rejected', 'error', 'rate_limited',
    'awaiting_worker', 'started', 'timeout'
  ));

-- True when an earlier attempt may have been accepted and its result was not stored,
-- and an automatic retry is no longer inside the provider window.
create or replace function public.email_core_attempt_needs_review(p_outbox_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  o public.email_outbox%rowtype;
  v_attempt_rows int := 0;
  v_earliest timestamptz;
  v_uncertain boolean := false;
  v_clock timestamptz;
begin
  select * into o from public.email_outbox where id = p_outbox_id;
  if not found then
    return false;
  end if;

  if o.provider_message_id is not null and btrim(o.provider_message_id) <> '' then
    return false;
  end if;

  select
    count(*)::int,
    min(a.started_at),
    coalesce(bool_or(a.result in ('started', 'timeout') or a.finished_at is null), false)
  into v_attempt_rows, v_earliest, v_uncertain
  from public.email_delivery_attempts as a
  where a.outbox_id = o.id;

  -- No send has been started. Age of the outbox row does not matter.
  if o.attempts <= 0 and v_attempt_rows = 0 and o.first_attempt_at is null then
    return false;
  end if;

  -- Claim incremented attempts, then the worker stopped before any attempt row existed.
  if o.attempts >= 1 and v_attempt_rows = 0 then
    v_uncertain := true;
  end if;

  if not v_uncertain then
    return false;
  end if;

  v_clock := coalesce(o.first_attempt_at, v_earliest);
  if v_clock is null then
    return true;
  end if;

  return v_clock <= now() - interval '24 hours';
end;
$fn$;

revoke all on function public.email_core_attempt_needs_review(bigint)
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

  update public.email_outbox as o
  set
    status = 'blocked_not_ready',
    last_error_code = 'idempotency_window_review',
    next_attempt_at = null,
    updated_at = now()
  where o.status in ('queued', 'held')
    and public.email_core_attempt_needs_review(o.id);

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
      first_attempt_at = coalesce(o.first_attempt_at, now()),
      updated_at = now()
    from candidates as c
    where o.id = c.id
    returning o.id
  )
  select coalesce(array_agg(id), array[]::bigint[]) into v_ids from claimed;

  -- Durable before this function returns, and therefore before the worker calls the provider.
  insert into public.email_delivery_attempts (
    outbox_id, attempt_no, started_at, finished_at, result
  )
  select o.id, o.attempts, now(), null, 'started'
  from public.email_outbox as o
  where o.id = any (v_ids);

  return coalesce(
    (
      select jsonb_agg(
        to_jsonb(o) || jsonb_build_object(
          'uncertain_attempt', (
            exists (
              select 1
              from public.email_delivery_attempts as a
              where a.outbox_id = o.id
                and a.attempt_no < o.attempts
                and (a.result in ('started', 'timeout') or a.finished_at is null)
            )
            or (
              o.attempts > 1
              and not exists (
                select 1
                from public.email_delivery_attempts as a
                where a.outbox_id = o.id
                  and a.attempt_no < o.attempts
              )
            )
          )
        )
        order by o.id
      )
      from public.email_outbox as o
      where o.id = any (v_ids)
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.email_core_claim_outbox_batch(integer)
  from public, anon, authenticated;

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
  v_requeued int := 0;
  v_reviewed int := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_reclaim_stale_sending: service_role only' using errcode = '42501';
  end if;

  with parked as (
    update public.email_outbox as o
    set
      status = 'blocked_not_ready',
      last_error_code = 'idempotency_window_review',
      next_attempt_at = null,
      updated_at = now()
    where o.status = 'sending'
      and o.updated_at < now() - make_interval(mins => v_minutes)
      and public.email_core_attempt_needs_review(o.id)
    returning o.id
  )
  select count(*)::int into v_reviewed from parked;

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
  select count(*)::int into v_requeued from updated;

  return jsonb_build_object('ok', true, 'reclaimed', v_requeued, 'reviewed', v_reviewed);
end;
$fn$;

revoke all on function public.email_core_reclaim_stale_sending(integer)
  from public, anon, authenticated;

create or replace function public.email_core_hold_idempotency_review(p_outbox_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_held boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_hold_idempotency_review: service_role only' using errcode = '42501';
  end if;

  if public.email_core_attempt_needs_review(p_outbox_id) then
    update public.email_outbox
    set
      status = 'blocked_not_ready',
      last_error_code = 'idempotency_window_review',
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id
      and status in ('sending', 'queued', 'held')
      and provider_message_id is null;
    v_held := found;
  end if;

  return jsonb_build_object('ok', true, 'held', v_held);
end;
$fn$;

revoke all on function public.email_core_hold_idempotency_review(bigint)
  from public, anon, authenticated;

-- Finish the attempt opened by claim. A timeout or network error stays uncertain.
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
  v_uncertain boolean := false;
  v_review boolean := false;
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
  v_uncertain := v_err in ('timeout', 'network_error');
  -- Decide before the upsert so a missing attempt row is still visible.
  v_review := v_uncertain and public.email_core_attempt_needs_review(p_outbox_id);
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
      when v_uncertain then 'timeout'
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
  elsif v_review then
    update public.email_outbox
    set
      status = 'blocked_not_ready',
      last_error_code = 'idempotency_window_review',
      next_attempt_at = null,
      updated_at = now()
    where id = p_outbox_id;
    perform public.email_core_sync_xfer_notification_from_outbox(
      p_outbox_id, true, false, 'idempotency_window_review'
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

commit;
