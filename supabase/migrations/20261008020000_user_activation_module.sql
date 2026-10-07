-- User Activation module v1 — PLATFORM CORE (mandatory infrastructure).
-- Reusable adoption/activation management for any complex installation.
-- Additive only. No Platform Support / finance / utilities business-logic changes.
-- Auth metadata exposed only via admin SECURITY DEFINER RPCs (safe columns).
-- Complex admin cannot disable this module (catalog identity + always-on guards).

begin;

-- ---------------------------------------------------------------------------
-- Module catalog (platform-core identity; always enabled)
-- ---------------------------------------------------------------------------

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('user_activation', 'Активация пользователей', 'services', true, 8)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'user_activation', true, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'user_activation'
);

-- Force-enable if a prior local state disabled it; platform-core must stay on.
update public.building_modules
   set enabled = true,
       updated_at = now()
 where module_key = 'user_activation'
   and enabled is distinct from true;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.user_activation_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  auth_user_id uuid null,
  first_login_at timestamptz null,
  last_login_at timestamptz null,
  last_activity_at timestamptz null,
  login_count integer not null default 0
    check (login_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_activation_profiles_email_chk check (btrim(email) <> ''),
  constraint user_activation_profiles_email_uidx unique (email)
);

create index if not exists user_activation_profiles_activity_idx
  on public.user_activation_profiles (last_activity_at desc nulls last);

create table if not exists public.user_activation_reminders (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  property_id bigint null
    references public.properties (id) on delete set null,
  reminder_type text not null
    check (reminder_type in ('invite_resend', 'activation_nudge', 'custom')),
  channel text not null
    check (channel in ('invite_link', 'none', 'email', 'sms', 'push', 'platform')),
  delivery_status text not null
    check (delivery_status in (
      'QUEUED', 'LOCAL_ONLY', 'PROVIDER_NOT_CONFIGURED', 'CREATED', 'FAILED'
    )),
  note text null,
  context jsonb not null default '{}'::jsonb,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint user_activation_reminders_email_chk check (btrim(owner_email) <> '')
);

create index if not exists user_activation_reminders_email_created_idx
  on public.user_activation_reminders (lower(owner_email), created_at desc);

create table if not exists public.user_activation_audit (
  id bigserial primary key,
  action text not null,
  actor_email text null,
  owner_email text null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_activation_audit_action_chk check (length(btrim(action)) > 0)
);

create index if not exists user_activation_audit_created_idx
  on public.user_activation_audit (created_at desc);

alter table public.user_activation_profiles enable row level security;
alter table public.user_activation_reminders enable row level security;
alter table public.user_activation_audit enable row level security;

revoke all on table public.user_activation_profiles from public, anon, authenticated;
revoke all on table public.user_activation_reminders from public, anon, authenticated;
revoke all on table public.user_activation_audit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Constants / helpers
-- ---------------------------------------------------------------------------

create or replace function public.user_activation_inactive_days()
returns integer language sql immutable set search_path = '' as $$ select 30 $$;

create or replace function public.user_activation_online_minutes()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;

create or replace function public.user_activation_invite_stale_days()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function public.user_activation_activity_throttle_minutes()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;

revoke all on function public.user_activation_inactive_days() from public, anon;
revoke all on function public.user_activation_online_minutes() from public, anon;
revoke all on function public.user_activation_invite_stale_days() from public, anon;
revoke all on function public.user_activation_activity_throttle_minutes() from public, anon;

-- Catalog helper retained for introspection; access is role-gated, not toggle-gated.
create or replace function public.user_activation_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.user_activation_module_enabled() from public, anon, authenticated;

create or replace function public.user_activation_assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'user_activation: not authenticated' using errcode = '28000';
  end if;
  -- Platform-core: complex administrator only. Not gated by module toggle.
  if not public.has_staff_role('администрация') then
    raise exception 'user_activation: not allowed' using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.user_activation_assert_admin() from public, anon;

create or replace function public.user_activation_audit_write(
  p_action text,
  p_owner_email text default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.user_activation_audit (action, actor_email, owner_email, detail)
  values (
    btrim(coalesce(p_action, '')),
    nullif(auth.email(), ''),
    nullif(lower(btrim(coalesce(p_owner_email, ''))), ''),
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.user_activation_audit_write(text, text, jsonb) from public, anon, authenticated;

create or replace function public.user_activation_normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

revoke all on function public.user_activation_normalize_email(text) from public, anon;
grant execute on function public.user_activation_normalize_email(text) to authenticated;

create or replace function public.user_activation_derive_state(
  p_has_invite boolean,
  p_registered boolean,
  p_first_login_at timestamptz,
  p_last_activity_at timestamptz,
  p_login_count integer,
  p_now timestamptz default now()
)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_inactive interval := (public.user_activation_inactive_days() || ' days')::interval;
begin
  if not coalesce(p_registered, false) then
    if coalesce(p_has_invite, false) then
      return 'INVITED';
    end if;
    return 'NOT_INVITED';
  end if;

  if p_first_login_at is null then
    return 'REGISTERED';
  end if;

  if p_last_activity_at is null
     or p_last_activity_at < (p_now - v_inactive) then
    return 'DORMANT';
  end if;

  if coalesce(p_login_count, 0) <= 1
     and p_last_activity_at <= p_first_login_at + interval '24 hours' then
    return 'FIRST_LOGIN_DONE';
  end if;

  return 'ACTIVE';
end;
$fn$;

revoke all on function public.user_activation_derive_state(boolean, boolean, timestamptz, timestamptz, integer, timestamptz) from public, anon;
grant execute on function public.user_activation_derive_state(boolean, boolean, timestamptz, timestamptz, integer, timestamptz) to authenticated;

-- Eligible owner identities (unique email) + property associations
create or replace function public.user_activation_owner_base()
returns table (
  email text,
  display_name text,
  properties jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with book as (
    select
      public.user_activation_normalize_email(r.email) as email,
      nullif(btrim(concat_ws(' ', r.first_name, r.middle_name, r.last_name)), '') as person_name,
      nullif(btrim(r.entity_name), '') as entity_name,
      p.id as property_id,
      p.apartment_number,
      p.section_code,
      p.block_code
    from public.property_registry_people as r
    join public.properties as p on p.id = r.property_id
    where r.relation_type = 'owner'
      and r.deregistered_at is null
      and public.user_activation_normalize_email(r.email) is not null
  ),
  legacy as (
    select
      public.user_activation_normalize_email(p.owner_email) as email,
      nullif(btrim(p.owner_name), '') as person_name,
      null::text as entity_name,
      p.id as property_id,
      p.apartment_number,
      p.section_code,
      p.block_code
    from public.properties as p
    where public.user_activation_normalize_email(p.owner_email) is not null
      and not exists (
        select 1
        from public.property_registry_people as r
        where r.property_id = p.id
          and r.relation_type = 'owner'
          and r.deregistered_at is null
          and public.user_activation_normalize_email(r.email) is not null
      )
  ),
  all_rows as (
    select * from book
    union all
    select * from legacy
  )
  select
    a.email,
    coalesce(
      max(nullif(a.person_name, '')),
      max(nullif(a.entity_name, '')),
      a.email
    ) as display_name,
    coalesce(
      jsonb_agg(
        distinct         jsonb_build_object(
          'property_id', a.property_id,
          'apartment_number', a.apartment_number,
          'section', a.section_code,
          'block', a.block_code
        )
      ) filter (where a.property_id is not null),
      '[]'::jsonb
    ) as properties
  from all_rows as a
  group by a.email;
$fn$;

revoke all on function public.user_activation_owner_base() from public, anon;

-- ---------------------------------------------------------------------------
-- Owner activity (throttled) — callable by authenticated owners
-- ---------------------------------------------------------------------------

create or replace function public.user_activation_touch_activity()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := public.user_activation_normalize_email(auth.email());
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_throttle interval := (public.user_activation_activity_throttle_minutes() || ' minutes')::interval;
  v_row public.user_activation_profiles%rowtype;
  v_is_login boolean := false;
begin
  if v_uid is null or v_email is null then
    raise exception 'user_activation: not authenticated' using errcode = '28000';
  end if;

  -- Soft: only track for users who own something or have any invite/profile relevance.
  -- Always allow upsert for authenticated email (owners/guests); cheap and privacy-safe.

  select * into v_row
  from public.user_activation_profiles as p
  where p.email = v_email;

  if not found then
    insert into public.user_activation_profiles (
      email, auth_user_id, first_login_at, last_login_at, last_activity_at, login_count
    ) values (
      v_email, v_uid, v_now, v_now, v_now, 1
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
        'last_activity_at', v_row.last_activity_at
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
     where p.email = v_email
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'throttled', false,
    'login_recorded', v_is_login,
    'first_login_at', v_row.first_login_at,
    'last_login_at', v_row.last_login_at,
    'last_activity_at', v_row.last_activity_at,
    'login_count', v_row.login_count
  );
end;
$fn$;

revoke all on function public.user_activation_touch_activity() from public, anon;
grant execute on function public.user_activation_touch_activity() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_activation_list(
  p_filter text default 'all',
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_filter text := lower(btrim(coalesce(p_filter, 'all')));
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_now timestamptz := now();
  v_inactive interval := (public.user_activation_inactive_days() || ' days')::interval;
  v_online interval := (public.user_activation_online_minutes() || ' minutes')::interval;
  v_stale interval := (public.user_activation_invite_stale_days() || ' days')::interval;
  v_rows jsonb;
begin
  perform public.user_activation_assert_admin();

  with owners as (
    select * from public.user_activation_owner_base()
  ),
  invites as (
    select
      public.user_activation_normalize_email(i.email) as email,
      max(i.created_at) as last_invite_at,
      bool_or(i.status = 'pending' and i.expires_at > v_now) as has_pending_invite,
      bool_or(true) as has_invite
    from public.property_access_invites as i
    where public.user_activation_normalize_email(i.email) is not null
    group by 1
  ),
  auth_safe as (
    select
      public.user_activation_normalize_email(u.email) as email,
      u.id as auth_user_id,
      u.created_at as registered_at,
      u.email_confirmed_at
    from auth.users as u
    where public.user_activation_normalize_email(u.email) is not null
  ),
  reminders as (
    select
      public.user_activation_normalize_email(r.owner_email) as email,
      max(r.created_at) as last_reminder_at
    from public.user_activation_reminders as r
    group by 1
  ),
  enriched as (
    select
      o.email,
      o.display_name,
      o.properties,
      coalesce(inv.has_invite, false) as has_invite,
      inv.last_invite_at,
      coalesce(inv.has_pending_invite, false) as has_pending_invite,
      (a.auth_user_id is not null) as is_registered,
      a.registered_at,
      a.email_confirmed_at,
      pr.first_login_at,
      pr.last_login_at,
      pr.last_activity_at,
      coalesce(pr.login_count, 0) as login_count,
      rem.last_reminder_at,
      public.user_activation_derive_state(
        coalesce(inv.has_invite, false),
        a.auth_user_id is not null,
        pr.first_login_at,
        pr.last_activity_at,
        coalesce(pr.login_count, 0),
        v_now
      ) as activation_state,
      case
        when pr.last_activity_at is not null and pr.last_activity_at >= v_now - v_online
          then true
        else false
      end as recently_active,
      case
        when coalesce(inv.has_invite, false)
             and a.auth_user_id is null
             and inv.last_invite_at is not null
             and inv.last_invite_at < v_now - v_stale then true
        when a.auth_user_id is not null and pr.first_login_at is null then true
        when pr.first_login_at is not null
             and (pr.last_activity_at is null or pr.last_activity_at < v_now - v_inactive) then true
        else false
      end as needs_attention
    from owners as o
    left join invites as inv on inv.email = o.email
    left join auth_safe as a on a.email = o.email
    left join public.user_activation_profiles as pr on pr.email = o.email
    left join reminders as rem on rem.email = o.email
  ),
  filtered as (
    select e.*
    from enriched as e
    where (
      v_filter in ('all', '')
      or (v_filter = 'not_invited' and e.activation_state = 'NOT_INVITED')
      or (v_filter = 'invited' and e.activation_state = 'INVITED')
      or (v_filter = 'registered' and e.activation_state = 'REGISTERED')
      or (v_filter = 'first_login' and e.first_login_at is not null)
      or (v_filter = 'active' and e.activation_state in ('ACTIVE', 'FIRST_LOGIN_DONE'))
      or (v_filter = 'dormant' and e.activation_state = 'DORMANT')
      or (v_filter = 'needs_attention' and e.needs_attention)
      or (v_filter = 'never_logged_in' and e.is_registered and e.first_login_at is null)
    )
    and (
      v_search is null
      or e.email like '%' || v_search || '%'
      or lower(coalesce(e.display_name, '')) like '%' || v_search || '%'
      or exists (
        select 1
        from jsonb_array_elements(e.properties) as prop
        where lower(coalesce(prop->>'apartment_number', '')) like '%' || v_search || '%'
      )
    )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'email', f.email,
      'display_name', f.display_name,
      'properties', f.properties,
      'has_invite', f.has_invite,
      'has_pending_invite', f.has_pending_invite,
      'last_invite_at', f.last_invite_at,
      'is_registered', f.is_registered,
      'registered_at', f.registered_at,
      'email_confirmed_at', f.email_confirmed_at,
      'first_login_at', f.first_login_at,
      'last_login_at', f.last_login_at,
      'last_activity_at', f.last_activity_at,
      'login_count', f.login_count,
      'activation_state', f.activation_state,
      'recently_active', f.recently_active,
      'needs_attention', f.needs_attention,
      'last_reminder_at', f.last_reminder_at
    )
    order by f.display_name, f.email
  ), '[]'::jsonb)
  into v_rows
  from filtered as f;

  return coalesce(v_rows, '[]'::jsonb);
end;
$fn$;

revoke all on function public.admin_user_activation_list(text, text) from public, anon;
grant execute on function public.admin_user_activation_list(text, text) to authenticated;

create or replace function public.admin_user_activation_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := now();
  v_inactive interval := (public.user_activation_inactive_days() || ' days')::interval;
  v_total int;
  v_invited int;
  v_registered int;
  v_first_login int;
  v_active_30 int;
  v_never_login int;
  v_dormant int;
  v_properties_total int;
  v_properties_with_active_owner int;
begin
  perform public.user_activation_assert_admin();

  with owners as (
    select * from public.user_activation_owner_base()
  ),
  invites as (
    select distinct public.user_activation_normalize_email(i.email) as email
    from public.property_access_invites as i
  ),
  auth_safe as (
    select public.user_activation_normalize_email(u.email) as email
    from auth.users as u
  ),
  enriched as (
    select
      o.email,
      (inv.email is not null) as has_invite,
      (a.email is not null) as is_registered,
      pr.first_login_at,
      pr.last_activity_at,
      public.user_activation_derive_state(
        inv.email is not null,
        a.email is not null,
        pr.first_login_at,
        pr.last_activity_at,
        coalesce(pr.login_count, 0),
        v_now
      ) as activation_state
    from owners as o
    left join invites as inv on inv.email = o.email
    left join auth_safe as a on a.email = o.email
    left join public.user_activation_profiles as pr on pr.email = o.email
  )
  select
    count(*)::int,
    count(*) filter (where e.has_invite or e.is_registered)::int,
    count(*) filter (where e.is_registered)::int,
    count(*) filter (where e.first_login_at is not null)::int,
    count(*) filter (
      where e.first_login_at is not null
        and e.last_activity_at is not null
        and e.last_activity_at >= v_now - v_inactive
    )::int,
    count(*) filter (where e.is_registered and e.first_login_at is null)::int,
    count(*) filter (where e.activation_state = 'DORMANT')::int
  into v_total, v_invited, v_registered, v_first_login, v_active_30, v_never_login, v_dormant
  from enriched as e;

  select count(*)::int into v_properties_total from public.properties;

  select count(distinct p.id)::int into v_properties_with_active_owner
  from public.properties as p
  join public.user_activation_owner_base() as o on true
  join lateral jsonb_array_elements(o.properties) as prop on true
  join public.user_activation_profiles as pr
    on pr.email = o.email
   and pr.last_activity_at is not null
   and pr.last_activity_at >= v_now - v_inactive
  where (prop->>'property_id')::bigint = p.id;

  return jsonb_build_object(
    'total_owners', coalesce(v_total, 0),
    'invited', coalesce(v_invited, 0),
    'registered', coalesce(v_registered, 0),
    'first_login_completed', coalesce(v_first_login, 0),
    'active_last_30_days', coalesce(v_active_30, 0),
    'never_logged_in', coalesce(v_never_login, 0),
    'dormant', coalesce(v_dormant, 0),
    'activation_percent', case
      when coalesce(v_total, 0) = 0 then 0
      else round((coalesce(v_first_login, 0)::numeric * 100) / v_total, 1)
    end,
    'properties_total', coalesce(v_properties_total, 0),
    'properties_with_active_owner', coalesce(v_properties_with_active_owner, 0),
    'inactive_days', public.user_activation_inactive_days(),
    'online_minutes', public.user_activation_online_minutes()
  );
end;
$fn$;

revoke all on function public.admin_user_activation_dashboard() from public, anon;
grant execute on function public.admin_user_activation_dashboard() to authenticated;

create or replace function public.admin_user_activation_create_reminder(
  p_owner_email text,
  p_reminder_type text default 'activation_nudge',
  p_property_id bigint default null,
  p_note text default null,
  p_resend_invite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := public.user_activation_normalize_email(p_owner_email);
  v_type text := btrim(coalesce(p_reminder_type, 'activation_nudge'));
  v_channel text := 'none';
  v_status text := 'LOCAL_ONLY';
  v_invite jsonb := null;
  v_id uuid;
  v_prop bigint := p_property_id;
begin
  perform public.user_activation_assert_admin();

  if v_email is null then
    raise exception 'user_activation: email required' using errcode = '22023';
  end if;
  if v_type not in ('invite_resend', 'activation_nudge', 'custom') then
    raise exception 'user_activation: invalid reminder type' using errcode = '22023';
  end if;

  if coalesce(p_resend_invite, false) or v_type = 'invite_resend' then
    if v_prop is null then
      select (prop->>'property_id')::bigint into v_prop
      from public.user_activation_owner_base() as o,
           lateral jsonb_array_elements(o.properties) as prop
      where o.email = v_email
      order by prop->>'apartment_number'
      limit 1;
    end if;
    if v_prop is null then
      raise exception 'user_activation: property required for invite resend'
        using errcode = '22023';
    end if;
    v_invite := public.admin_create_property_invite(v_prop, v_email);
    v_channel := 'invite_link';
    -- Invite token is created in-app; no email provider is wired → honest status.
    v_status := 'LOCAL_ONLY';
    v_type := 'invite_resend';
  else
    v_channel := 'none';
    v_status := 'PROVIDER_NOT_CONFIGURED';
  end if;

  insert into public.user_activation_reminders (
    owner_email, property_id, reminder_type, channel, delivery_status, note, context, created_by_email
  ) values (
    v_email,
    v_prop,
    v_type,
    v_channel,
    v_status,
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object(
      'invite_id', v_invite ->> 'id',
      'expires_at', v_invite ->> 'expires_at'
    ),
    nullif(auth.email(), '')
  )
  returning id into v_id;

  perform public.user_activation_audit_write(
    'REMINDER_CREATED',
    v_email,
    jsonb_build_object(
      'reminder_id', v_id,
      'type', v_type,
      'delivery_status', v_status,
      'channel', v_channel,
      'property_id', v_prop
    )
  );

  return jsonb_build_object(
    'id', v_id,
    'owner_email', v_email,
    'property_id', v_prop,
    'reminder_type', v_type,
    'channel', v_channel,
    'delivery_status', v_status,
    'invite_token', v_invite ->> 'token',
    'invite_expires_at', v_invite ->> 'expires_at'
  );
end;
$fn$;

revoke all on function public.admin_user_activation_create_reminder(text, text, bigint, text, boolean) from public, anon;
grant execute on function public.admin_user_activation_create_reminder(text, text, bigint, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform-core disable guards (extends platform_support protection)
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_core_module_key(p_module_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(p_module_key, '')) in ('platform_support', 'user_activation');
$$;

revoke all on function public.is_platform_core_module_key(text) from public, anon;
grant execute on function public.is_platform_core_module_key(text) to authenticated;

create or replace function public.set_building_module_enabled(
  p_module_key text,
  p_enabled boolean
)
returns table (
  module_key text,
  enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_implemented boolean;
begin
  if auth.uid() is null then
    raise exception 'set_building_module_enabled: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'set_building_module_enabled: not allowed'
      using errcode = '42501';
  end if;

  v_key := btrim(coalesce(p_module_key, ''));
  if v_key = '' then
    raise exception 'set_building_module_enabled: unknown module'
      using errcode = '22023';
  end if;

  if p_enabled is null then
    raise exception 'set_building_module_enabled: enabled required'
      using errcode = '22023';
  end if;

  if public.is_platform_core_module_key(v_key) and p_enabled is not true then
    raise exception 'set_building_module_enabled: % is platform-core and cannot be disabled', v_key
      using errcode = '42501';
  end if;

  select c.implemented
    into v_implemented
  from public.module_catalog as c
  where c.module_key = v_key;

  if not found then
    raise exception 'set_building_module_enabled: unknown module'
      using errcode = '22023';
  end if;

  if v_implemented is not true then
    raise exception 'set_building_module_enabled: module not implemented'
      using errcode = '22023';
  end if;

  update public.building_modules as bm
     set enabled = p_enabled,
         updated_at = now(),
         updated_by = auth.uid()
   where bm.module_key = v_key;

  if not found then
    raise exception 'set_building_module_enabled: module row not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    bm.module_key,
    bm.enabled
  from public.building_modules as bm
  where bm.module_key = v_key;
end;
$fn$;

revoke all on function public.set_building_module_enabled(text, boolean) from public;
revoke execute on function public.set_building_module_enabled(text, boolean) from anon;
grant execute on function public.set_building_module_enabled(text, boolean) to authenticated;

-- Replace single-key trigger with shared platform-core guard.
create or replace function public.platform_core_prevent_disable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if public.is_platform_core_module_key(NEW.module_key)
     and NEW.enabled is distinct from true then
    raise exception '%: platform-core cannot be disabled', NEW.module_key
      using errcode = '42501';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists platform_support_prevent_disable_biu on public.building_modules;
drop trigger if exists platform_core_prevent_disable_biu on public.building_modules;
create trigger platform_core_prevent_disable_biu
  before insert or update of enabled on public.building_modules
  for each row
  execute function public.platform_core_prevent_disable_trg();

-- Keep legacy function body aligned (trigger itself uses platform_core_*).
create or replace function public.platform_support_prevent_disable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if public.is_platform_core_module_key(NEW.module_key)
     and NEW.enabled is distinct from true then
    raise exception '%: platform-core cannot be disabled', NEW.module_key
      using errcode = '42501';
  end if;
  return NEW;
end;
$fn$;

commit;
