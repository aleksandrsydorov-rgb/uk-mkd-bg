-- =============================================================================
-- User Activation SMOKE — BEGIN/ROLLBACK (no lasting writes)
-- =============================================================================

begin;

do $$
declare
  v_state text;
  v_disabled_blocked boolean := false;
  v_email text := 'smoke.activation@example.com';
begin
  if to_regclass('public.user_activation_profiles') is null then
    raise exception 'smoke: user_activation_profiles missing';
  end if;

  v_state := public.user_activation_derive_state(false, false, null, null, 0, now());
  if v_state <> 'NOT_INVITED' then
    raise exception 'smoke: expected NOT_INVITED got %', v_state;
  end if;

  v_state := public.user_activation_derive_state(true, false, null, null, 0, now());
  if v_state <> 'INVITED' then
    raise exception 'smoke: expected INVITED got %', v_state;
  end if;

  v_state := public.user_activation_derive_state(true, true, null, null, 0, now());
  if v_state <> 'REGISTERED' then
    raise exception 'smoke: expected REGISTERED got %', v_state;
  end if;

  insert into public.user_activation_profiles (
    email, first_login_at, last_login_at, last_activity_at, login_count
  ) values (
    v_email, now() - interval '40 days', now() - interval '40 days', now() - interval '40 days', 2
  );

  insert into public.user_activation_reminders (
    owner_email, reminder_type, channel, delivery_status, note
  ) values (
    v_email, 'activation_nudge', 'none', 'PROVIDER_NOT_CONFIGURED', 'smoke'
  );

  begin
    update public.building_modules
       set enabled = false
     where module_key = 'user_activation';
  exception
    when others then
      v_disabled_blocked := true;
  end;

  if not v_disabled_blocked then
    raise exception 'smoke: user_activation disable was not blocked';
  end if;

  if exists (
    select 1 from public.building_modules
    where module_key = 'user_activation' and enabled is distinct from true
  ) then
    raise exception 'smoke: user_activation left disabled';
  end if;

  if not public.is_platform_core_module_key('user_activation') then
    raise exception 'smoke: user_activation not marked platform-core';
  end if;

  raise notice 'user_activation smoke OK';
end;
$$;

rollback;
