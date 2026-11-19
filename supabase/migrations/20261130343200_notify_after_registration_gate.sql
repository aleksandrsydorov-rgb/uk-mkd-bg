-- Gate ordinary notifications until in-app first registration completes.
-- Invites / user_activation / email_test / security paths stay allowed.
-- Pre-registration outbox rows are not sent after registration (stale cancel).

begin;

alter table public.user_activation_profiles
  add column if not exists app_registration_completed_at timestamptz null;

comment on column public.user_activation_profiles.app_registration_completed_at is
  'Set when the user finishes in-app first registration. Ordinary app notifications require this.';

create index if not exists user_activation_profiles_registration_completed_idx
  on public.user_activation_profiles (app_registration_completed_at)
  where app_registration_completed_at is not null;

-- Existing active users: keep receiving mail (first_login is a trustworthy prior signal).
update public.user_activation_profiles p
   set app_registration_completed_at = coalesce(p.app_registration_completed_at, p.first_login_at, p.created_at),
       updated_at = now()
 where p.app_registration_completed_at is null
   and p.first_login_at is not null;

-- Access-ready owners with auth.users but no profile row yet.
insert into public.user_activation_profiles (
  email, auth_user_id, first_login_at, app_registration_completed_at, login_count
)
select lower(btrim(o.email)),
       u.id,
       coalesce(u.last_sign_in_at, u.created_at),
       coalesce(u.last_sign_in_at, u.created_at),
       1
  from public.property_registry_people o
  join auth.users u on lower(u.email) = lower(btrim(o.email))
 where o.relation_type = 'owner'
   and o.deregistered_at is null
   and o.email is not null
   and btrim(o.email) <> ''
   and public.property_book_owner_row_access_ready(o)
   and not exists (
     select 1 from public.user_activation_profiles p
      where lower(p.email) = lower(btrim(o.email))
   )
on conflict (email) do update
  set app_registration_completed_at = coalesce(
        public.user_activation_profiles.app_registration_completed_at,
        excluded.app_registration_completed_at
      ),
      auth_user_id = coalesce(public.user_activation_profiles.auth_user_id, excluded.auth_user_id),
      updated_at = now();

create or replace function public.email_core_recipient_registration_ready(p_to_email text)
returns boolean
language plpgsql
stable
security definer
set search_path to public
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_to_email, '')), ''));
begin
  if v_email is null then
    return false;
  end if;

  if exists (
    select 1 from public.user_activation_profiles p
     where lower(p.email) = v_email
       and p.app_registration_completed_at is not null
  ) then
    return true;
  end if;

  -- Active staff always eligible for operational mail.
  if exists (
    select 1 from public.staff s
     where lower(btrim(coalesce(s.email, ''))) = v_email
       and coalesce(s.active, true)
  ) then
    return true;
  end if;

  return false;
end;
$fn$;

revoke all on function public.email_core_recipient_registration_ready(text) from public, anon;
grant execute on function public.email_core_recipient_registration_ready(text)
  to authenticated, service_role;

create or replace function public.email_core_mark_registration_complete(p_email text default null)
returns jsonb
language plpgsql
security definer
set search_path to public, auth
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, auth.email(), '')), ''));
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_email is null then
    raise exception 'email_core_mark_registration_complete: email required' using errcode = '22023';
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
    )
  );
end;
$fn$;

revoke all on function public.email_core_mark_registration_complete(text) from public, anon;
grant execute on function public.email_core_mark_registration_complete(text)
  to authenticated, service_role;

-- Modules that may send before registration (invite / auth / admin test).
create or replace function public.email_core_module_allowed_before_registration(p_module_key text)
returns boolean
language sql
immutable
as $fn$
  select lower(coalesce(p_module_key, '')) in (
    'pb1_invite',
    'user_activation',
    'email_test',
    'auth'
  );
$fn$;

create or replace function public.email_outbox_registration_gate()
returns trigger
language plpgsql
security definer
set search_path to public
as $tg$
begin
  if public.email_core_module_allowed_before_registration(new.module_key) then
    return new;
  end if;

  if public.email_core_recipient_registration_ready(new.to_email) then
    -- Still block rows created before registration (event time ≈ created_at).
    if exists (
      select 1 from public.user_activation_profiles p
       where lower(p.email) = lower(btrim(new.to_email))
         and p.app_registration_completed_at is not null
         and new.created_at < p.app_registration_completed_at
    ) then
      new.status := 'cancelled';
      new.last_error_code := 'blocked_pre_registration_event';
      new.updated_at := now();
    end if;
    return new;
  end if;

  new.status := 'cancelled';
  new.last_error_code := 'blocked_not_registered';
  new.updated_at := now();
  return new;
end;
$tg$;

drop trigger if exists email_outbox_registration_gate_trg on public.email_outbox;
create trigger email_outbox_registration_gate_trg
  before insert on public.email_outbox
  for each row
  execute function public.email_outbox_registration_gate();

-- Extend touch_activity: when owner is access_ready, stamp registration complete.
-- Keep original throttle / login counting semantics.
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
  v_cabinet_ready boolean := false;
begin
  if v_uid is null or v_email is null then
    raise exception 'user_activation: not authenticated' using errcode = '28000';
  end if;

  select exists (
    select 1
      from public.property_registry_people o
     where o.relation_type = 'owner'
       and o.deregistered_at is null
       and lower(btrim(coalesce(o.email, ''))) = v_email
       and public.property_book_owner_row_access_ready(o)
  ) into v_cabinet_ready;

  select * into v_row
  from public.user_activation_profiles as p
  where lower(p.email) = v_email;

  if not found then
    insert into public.user_activation_profiles (
      email, auth_user_id, first_login_at, last_login_at, last_activity_at, login_count,
      app_registration_completed_at
    ) values (
      v_email, v_uid, v_now, v_now, v_now, 1,
      case when v_cabinet_ready then v_now else null end
    )
    returning * into v_row;
    v_is_login := true;
  else
    if v_row.last_activity_at is not null
       and v_row.last_activity_at > v_now - v_throttle then
      -- Still allow registration stamp without bumping activity counters.
      if v_cabinet_ready and v_row.app_registration_completed_at is null then
        update public.user_activation_profiles as p
           set app_registration_completed_at = v_now,
               updated_at = v_now
         where lower(p.email) = v_email
        returning * into v_row;
      end if;
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
           app_registration_completed_at = case
             when p.app_registration_completed_at is not null then p.app_registration_completed_at
             when v_cabinet_ready then v_now
             else null
           end,
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
grant execute on function public.user_activation_touch_activity() to authenticated;

commit;
