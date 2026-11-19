-- 1) Only the signed-in user (or service_role) may stamp their own registration complete.
-- 2) event_occurred_at is immutable after insert so retries cannot invent a newer event time.
-- 3) Rows cancelled for registration gates cannot be revived to queued/sending/held.

begin;

create or replace function public.email_core_mark_registration_complete(p_email text default null)
returns jsonb
language plpgsql
security definer
set search_path to public, auth
as $fn$
declare
  v_auth_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_requested text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_email text;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_is_service boolean := auth.role() is not distinct from 'service_role';
  v_cabinet_ready boolean := false;
  v_existing timestamptz;
begin
  if v_is_service then
    v_email := coalesce(v_requested, v_auth_email);
  else
    if v_uid is null or v_auth_email is null then
      raise exception 'email_core_mark_registration_complete: not authenticated'
        using errcode = '28000';
    end if;
    -- Callers may pass null; never allow stamping a different account.
    if v_requested is not null and v_requested is distinct from v_auth_email then
      raise exception 'email_core_mark_registration_complete: forbidden'
        using errcode = '42501';
    end if;
    v_email := v_auth_email;
  end if;

  if v_email is null then
    raise exception 'email_core_mark_registration_complete: email required'
      using errcode = '22023';
  end if;

  select p.app_registration_completed_at
    into v_existing
  from public.user_activation_profiles as p
  where lower(p.email) = v_email;

  -- Idempotent: keep original completion timestamp.
  if v_existing is not null then
    return jsonb_build_object(
      'ok', true,
      'email', v_email,
      'app_registration_completed_at', v_existing,
      'already_complete', true
    );
  end if;

  if not v_is_service then
    -- Staff may mark themselves (operational mail). Owners need access-ready cabinet.
    if not exists (
      select 1 from public.staff s
       where lower(btrim(coalesce(s.email, ''))) = v_email
         and coalesce(s.active, true)
    ) then
      select exists (
        select 1
          from public.property_registry_people o
         where o.relation_type = 'owner'
           and o.deregistered_at is null
           and lower(btrim(coalesce(o.email, ''))) = v_email
           and public.property_book_owner_row_access_ready(o)
      ) into v_cabinet_ready;

      if not v_cabinet_ready then
        raise exception 'email_core_mark_registration_complete: registration not finished'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.user_activation_profiles as p (
    email, auth_user_id, first_login_at, app_registration_completed_at, login_count, updated_at
  ) values (
    v_email, v_uid, v_now, v_now, 1, v_now
  )
  on conflict (email) do update
    set auth_user_id = coalesce(p.auth_user_id, excluded.auth_user_id),
        first_login_at = coalesce(p.first_login_at, excluded.first_login_at),
        app_registration_completed_at = coalesce(p.app_registration_completed_at, excluded.app_registration_completed_at),
        updated_at = v_now;

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'app_registration_completed_at', (
      select app_registration_completed_at from public.user_activation_profiles where lower(email) = v_email
    ),
    'already_complete', false
  );
end;
$fn$;

revoke all on function public.email_core_mark_registration_complete(text) from public, anon;
grant execute on function public.email_core_mark_registration_complete(text)
  to authenticated, service_role;

create or replace function public.email_outbox_protect_event_time_and_reg_blocks()
returns trigger
language plpgsql
security definer
set search_path to public
as $tg$
begin
  -- Preserve original source-event time across retries / status flips.
  if tg_op = 'UPDATE' then
    if old.event_occurred_at is not null then
      new.event_occurred_at := old.event_occurred_at;
    elsif new.event_occurred_at is null then
      new.event_occurred_at := public.email_core_payload_event_occurred_at(
        new.payload,
        coalesce(old.created_at, new.created_at)
      );
    end if;

    -- Do not revive registration-gated cancellations.
    if old.status = 'cancelled'
       and old.last_error_code in ('blocked_not_registered', 'blocked_pre_registration_event')
       and new.status is distinct from 'cancelled' then
      new.status := 'cancelled';
      new.last_error_code := old.last_error_code;
      new.next_attempt_at := null;
    end if;
  end if;

  return new;
end;
$tg$;

drop trigger if exists email_outbox_protect_event_time_trg on public.email_outbox;
create trigger email_outbox_protect_event_time_trg
  before update on public.email_outbox
  for each row
  execute function public.email_outbox_protect_event_time_and_reg_blocks();

commit;
