-- Fix claim collision with enqueue's awaiting_worker attempt_no=1, and allow
-- claiming specific outbox ids (admin connection probe must not pick arbitrary queue).

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

  -- Enqueue already inserts attempt_no=1 as awaiting_worker. Upsert on conflict.
  insert into public.email_delivery_attempts (
    outbox_id, attempt_no, started_at, finished_at, result, error_code
  )
  select o.id, o.attempts, now(), null, 'started', null
  from public.email_outbox as o
  where o.id = any (v_ids)
  on conflict on constraint email_delivery_attempts_uq
  do update set
    started_at = excluded.started_at,
    finished_at = null,
    result = 'started',
    error_code = null;

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
grant execute on function public.email_core_claim_outbox_batch(integer)
  to service_role;

create or replace function public.email_core_claim_outbox_ids(p_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ids bigint[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_claim_outbox_ids: service_role only' using errcode = '42501';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  if not public.email_core_is_ready() then
    return '[]'::jsonb;
  end if;

  with candidates as (
    select o.id
    from public.email_outbox as o
    where o.id = any (p_ids)
      and o.status in ('queued', 'held')
      and (o.next_attempt_at is null or o.next_attempt_at <= now())
      and o.attempts < 8
      and not public.email_core_attempt_needs_review(o.id)
    order by o.id
    for update skip locked
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

  insert into public.email_delivery_attempts (
    outbox_id, attempt_no, started_at, finished_at, result, error_code
  )
  select o.id, o.attempts, now(), null, 'started', null
  from public.email_outbox as o
  where o.id = any (v_ids)
  on conflict on constraint email_delivery_attempts_uq
  do update set
    started_at = excluded.started_at,
    finished_at = null,
    result = 'started',
    error_code = null;

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

revoke all on function public.email_core_claim_outbox_ids(bigint[])
  from public, anon, authenticated;
grant execute on function public.email_core_claim_outbox_ids(bigint[])
  to service_role;
