-- app_registration_completed_at must not be set merely because the owner is
-- access_ready or authenticated. Explicit mark_registration_complete (onboarding /
-- portal acceptance) and the historical first_login backfill remain the sources.

begin;

create or replace function public.user_activation_touch_activity()
returns jsonb
language plpgsql
security definer
set search_path to public, auth
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_throttle interval := interval '5 minutes';
  v_row public.user_activation_profiles%rowtype;
  v_is_login boolean := false;
begin
  if v_uid is null or v_email is null then
    raise exception 'user_activation: not authenticated' using errcode = '28000';
  end if;

  select * into v_row
  from public.user_activation_profiles as p
  where lower(p.email) = v_email;

  if not found then
    insert into public.user_activation_profiles (
      email, auth_user_id, first_login_at, last_login_at, last_activity_at, login_count,
      app_registration_completed_at
    ) values (
      v_email, v_uid, v_now, v_now, v_now, 1,
      null
    )
    returning * into v_row;
    v_is_login := true;
  else
    if v_row.last_activity_at is not null
       and v_row.last_activity_at > v_now - v_throttle then
      return jsonb_build_object(
        'ok', true,
        'throttled', true,
        'first_login_at', v_row.first_login_at,
        'last_activity_at', v_row.last_activity_at,
        'app_registration_completed_at', v_row.app_registration_completed_at
      );
    end if;

    if v_row.first_login_at is null then
      v_is_login := true;
    elsif v_row.last_login_at is null
       or v_row.last_login_at < v_now - interval '12 hours' then
      v_is_login := true;
    end if;

    update public.user_activation_profiles as p
       set auth_user_id = coalesce(p.auth_user_id, v_uid),
           first_login_at = coalesce(p.first_login_at, v_now),
           last_login_at = case when v_is_login then v_now else p.last_login_at end,
           last_activity_at = v_now,
           login_count = case when v_is_login then p.login_count + 1 else p.login_count end,
           updated_at = v_now
     where lower(p.email) = v_email
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'throttled', false,
    'login_recorded', v_is_login,
    'first_login_at', v_row.first_login_at,
    'last_login_at', v_row.last_login_at,
    'last_activity_at', v_row.last_activity_at,
    'login_count', v_row.login_count,
    'app_registration_completed_at', v_row.app_registration_completed_at
  );
end;
$fn$;

revoke all on function public.user_activation_touch_activity() from public, anon;
grant execute on function public.user_activation_touch_activity()
  to authenticated, service_role;

commit;
