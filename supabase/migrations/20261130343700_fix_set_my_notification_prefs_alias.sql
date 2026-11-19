-- Fix set_my_notification_prefs ON CONFLICT alias (search_path='') so owners can disable notifications.

begin;

create or replace function public.set_my_notification_prefs(
  p_mode text,
  p_role_hint text default null,
  p_event_overrides jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_mode text := upper(btrim(coalesce(p_mode, 'ALL')));
  v_role text := nullif(btrim(coalesce(p_role_hint, '')), '');
  r record;
begin
  if v_uid is null then
    raise exception 'set_my_notification_prefs: not authenticated' using errcode = '28000';
  end if;
  if v_mode not in ('ALL', 'IMPORTANT_ONLY', 'DAILY_DIGEST', 'CUSTOM', 'INFORMATIONAL_OFF') then
    raise exception 'set_my_notification_prefs: invalid mode' using errcode = '22023';
  end if;
  if v_role is not null and v_role not in ('admin', 'staff', 'owner') then
    raise exception 'set_my_notification_prefs: invalid role_hint' using errcode = '22023';
  end if;

  insert into public.email_user_notification_prefs as p (user_id, mode, role_hint)
  values (v_uid, v_mode, v_role)
  on conflict (user_id) do update
    set mode = excluded.mode,
        role_hint = coalesce(excluded.role_hint, p.role_hint),
        updated_at = now();

  if p_event_overrides is not null and jsonb_typeof(p_event_overrides) = 'object' then
    for r in
      select key as event_key, (value #>> '{}')::boolean as enabled
      from jsonb_each(p_event_overrides)
    loop
      if r.event_key in (
        'pb1_invite_create',
        'pb1_invite_resend',
        'ownership_change_access_revoked',
        'ownership_change_invite_available'
      ) and r.enabled is not true then
        continue;
      end if;
      insert into public.email_user_notification_event_prefs as e (user_id, event_key, enabled)
      values (v_uid, r.event_key, coalesce(r.enabled, true))
      on conflict (user_id, event_key) do update
        set enabled = excluded.enabled,
            updated_at = now();
    end loop;
  end if;

  perform public.email_core_write_policy_audit(
    'set_personal_prefs',
    'personal',
    v_uid::text,
    jsonb_build_object('mode', v_mode, 'role_hint', v_role)
  );

  return public.get_my_notification_prefs();
end;
$fn$;

revoke all on function public.set_my_notification_prefs(text, text, jsonb) from public, anon;
grant execute on function public.set_my_notification_prefs(text, text, jsonb)
  to authenticated, service_role;

commit;
