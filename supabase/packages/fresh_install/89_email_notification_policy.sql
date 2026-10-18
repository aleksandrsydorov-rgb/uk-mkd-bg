-- EML-3 fresh-install companion — notification policy prefs / digest / audit
-- Depends on 88_email_core_baseline.sql. email_enabled unchanged (OFF).
-- No secrets. No recipient seeds. No Rental.
-- =============================================================================
-- EML-3 — Notification policy prefs, audit, digest buffer (Email Core extension)
-- Defaults: optional events enabled; email_enabled unchanged (OFF).
-- No secrets. No recipient seed. No Rental. No debt gate changes.
-- Do NOT apply to cloud without explicit operator approval.
-- =============================================================================
-- begin (stripped)
-- ---------------------------------------------------------------------------
-- Complex-wide module toggles
-- ---------------------------------------------------------------------------
create table if not exists public.email_notification_module_settings (
  module_key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_email text null
);

alter table public.email_notification_module_settings enable row level security;
revoke all on table public.email_notification_module_settings from public, anon, authenticated;

drop policy if exists email_notification_module_settings_admin_select
  on public.email_notification_module_settings;
create policy email_notification_module_settings_admin_select
on public.email_notification_module_settings
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Complex-wide per-event toggles
-- ---------------------------------------------------------------------------
create table if not exists public.email_notification_event_settings (
  event_key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_email text null
);

alter table public.email_notification_event_settings enable row level security;
revoke all on table public.email_notification_event_settings from public, anon, authenticated;

drop policy if exists email_notification_event_settings_admin_select
  on public.email_notification_event_settings;
create policy email_notification_event_settings_admin_select
on public.email_notification_event_settings
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Personal prefs (one row per auth user)
-- ---------------------------------------------------------------------------
create table if not exists public.email_user_notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mode text not null default 'ALL'
    check (mode in ('ALL', 'IMPORTANT_ONLY', 'DAILY_DIGEST', 'CUSTOM', 'INFORMATIONAL_OFF')),
  role_hint text null
    check (role_hint is null or role_hint in ('admin', 'staff', 'owner')),
  updated_at timestamptz not null default now()
);

alter table public.email_user_notification_prefs enable row level security;
revoke all on table public.email_user_notification_prefs from public, anon, authenticated;

drop policy if exists email_user_notification_prefs_self_select
  on public.email_user_notification_prefs;
create policy email_user_notification_prefs_self_select
on public.email_user_notification_prefs
for select to authenticated
using (user_id = auth.uid() or public.has_staff_role('администрация'));

create table if not exists public.email_user_notification_event_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

alter table public.email_user_notification_event_prefs enable row level security;
revoke all on table public.email_user_notification_event_prefs from public, anon, authenticated;

drop policy if exists email_user_notification_event_prefs_self_select
  on public.email_user_notification_event_prefs;
create policy email_user_notification_event_prefs_self_select
on public.email_user_notification_event_prefs
for select to authenticated
using (user_id = auth.uid() or public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create table if not exists public.email_notification_policy_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid null,
  actor_email text null,
  action text not null,
  scope text not null,
  target_key text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_notification_policy_audit_created_idx
  on public.email_notification_policy_audit (created_at desc);

alter table public.email_notification_policy_audit enable row level security;
revoke all on table public.email_notification_policy_audit from public, anon, authenticated;

drop policy if exists email_notification_policy_audit_admin_select
  on public.email_notification_policy_audit;
create policy email_notification_policy_audit_admin_select
on public.email_notification_policy_audit
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Digest buffer (canonical queue companion — flushed by email worker/cron)
-- ---------------------------------------------------------------------------
create table if not exists public.email_digest_buffer (
  id bigint generated always as identity primary key,
  recipient_email_hash text not null,
  recipient_email text not null,
  user_id uuid null,
  event_key text not null,
  module_key text not null,
  template_key text not null,
  locale text not null default 'bg'
    check (locale in ('bg', 'ru', 'en')),
  payload jsonb not null default '{}'::jsonb,
  local_day date not null,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'flushed', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint email_digest_buffer_idempotency_uq unique (idempotency_key)
);

create index if not exists email_digest_buffer_flush_idx
  on public.email_digest_buffer (status, local_day, recipient_email_hash);

alter table public.email_digest_buffer enable row level security;
revoke all on table public.email_digest_buffer from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recipient throttle counters (optional high-frequency)
-- ---------------------------------------------------------------------------
create table if not exists public.email_recipient_throttle (
  recipient_email_hash text not null,
  event_key text not null,
  window_start timestamptz not null,
  hit_count int not null default 0 check (hit_count >= 0),
  primary key (recipient_email_hash, event_key, window_start)
);

alter table public.email_recipient_throttle enable row level security;
revoke all on table public.email_recipient_throttle from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Outbox: optional event_key + policy_decision for send-time recheck
-- ---------------------------------------------------------------------------
alter table public.email_outbox
  add column if not exists event_key text null;

alter table public.email_outbox
  add column if not exists policy_decision text null;

create index if not exists email_outbox_event_key_idx
  on public.email_outbox (event_key)
  where event_key is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.email_core_local_day(p_ts timestamptz default now())
returns date
language sql
stable
as $$
  select (p_ts at time zone 'Europe/Sofia')::date;
$$;

revoke all on function public.email_core_local_day(timestamptz) from public, anon;
grant execute on function public.email_core_local_day(timestamptz) to authenticated;
grant execute on function public.email_core_local_day(timestamptz) to service_role;

create or replace function public.email_core_write_policy_audit(
  p_action text,
  p_scope text,
  p_target_key text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.email_notification_policy_audit (
    actor_user_id, actor_email, action, scope, target_key, payload
  ) values (
    auth.uid(),
    nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''),
    p_action,
    p_scope,
    p_target_key,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.email_core_write_policy_audit(text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_write_policy_audit(text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_write_policy_audit(text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Admin: complex module/event settings
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_notification_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_notification_policy: not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'modules', coalesce((
      select jsonb_object_agg(m.module_key, m.enabled)
      from public.email_notification_module_settings as m
    ), '{}'::jsonb),
    'events', coalesce((
      select jsonb_object_agg(e.event_key, e.enabled)
      from public.email_notification_event_settings as e
    ), '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.admin_list_notification_policy() from public, anon;
grant execute on function public.admin_list_notification_policy() to authenticated;

create or replace function public.admin_set_notification_module(
  p_module_key text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := nullif(btrim(coalesce(p_module_key, '')), '');
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_set_notification_module: not allowed' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'admin_set_notification_module: module_key required';
  end if;

  insert into public.email_notification_module_settings as s (module_key, enabled, updated_by_email)
  values (v_key, coalesce(p_enabled, true), nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
  on conflict (module_key) do update
    set enabled = excluded.enabled,
        updated_at = now(),
        updated_by_email = excluded.updated_by_email;

  perform public.email_core_write_policy_audit(
    case when coalesce(p_enabled, true) then 'enable_module' else 'disable_module' end,
    'complex_module',
    v_key,
    jsonb_build_object('enabled', coalesce(p_enabled, true))
  );

  return public.admin_list_notification_policy();
end;
$fn$;

revoke all on function public.admin_set_notification_module(text, boolean) from public, anon;
grant execute on function public.admin_set_notification_module(text, boolean) to authenticated;

create or replace function public.admin_set_notification_event(
  p_event_key text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := nullif(btrim(coalesce(p_event_key, '')), '');
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_set_notification_event: not allowed' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'admin_set_notification_event: event_key required';
  end if;

  -- Security-mandatory keys cannot be disabled at complex level.
  if v_key in (
    'pb1_invite_create',
    'pb1_invite_resend',
    'ownership_change_access_revoked',
    'ownership_change_invite_available'
  ) and coalesce(p_enabled, true) is not true then
    raise exception 'admin_set_notification_event: security mandatory cannot be disabled'
      using errcode = '22023';
  end if;

  insert into public.email_notification_event_settings as s (event_key, enabled, updated_by_email)
  values (v_key, coalesce(p_enabled, true), nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
  on conflict (event_key) do update
    set enabled = excluded.enabled,
        updated_at = now(),
        updated_by_email = excluded.updated_by_email;

  perform public.email_core_write_policy_audit(
    case when coalesce(p_enabled, true) then 'enable_event' else 'disable_event' end,
    'complex_event',
    v_key,
    jsonb_build_object('enabled', coalesce(p_enabled, true))
  );

  return public.admin_list_notification_policy();
end;
$fn$;

revoke all on function public.admin_set_notification_event(text, boolean) from public, anon;
grant execute on function public.admin_set_notification_event(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Personal prefs RPCs (self)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_notification_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_mode text := 'ALL';
  v_role text := null;
begin
  if v_uid is null then
    raise exception 'get_my_notification_prefs: not authenticated' using errcode = '28000';
  end if;

  select p.mode, p.role_hint into v_mode, v_role
  from public.email_user_notification_prefs as p
  where p.user_id = v_uid;

  if not found then
    v_mode := 'ALL';
  end if;

  return jsonb_build_object(
    'mode', v_mode,
    'role_hint', v_role,
    'event_overrides', coalesce((
      select jsonb_object_agg(e.event_key, e.enabled)
      from public.email_user_notification_event_prefs as e
      where e.user_id = v_uid
    ), '{}'::jsonb),
    'complex', jsonb_build_object(
      'modules', coalesce((
        select jsonb_object_agg(m.module_key, m.enabled)
        from public.email_notification_module_settings as m
      ), '{}'::jsonb),
      'events', coalesce((
        select jsonb_object_agg(e.event_key, e.enabled)
        from public.email_notification_event_settings as e
      ), '{}'::jsonb)
    )
  );
end;
$fn$;

revoke all on function public.get_my_notification_prefs() from public, anon;
grant execute on function public.get_my_notification_prefs() to authenticated;

create or replace function public.set_my_notification_prefs(
  p_mode text,
  p_role_hint text default null,
  p_event_overrides jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
        role_hint = coalesce(excluded.role_hint, public.email_user_notification_prefs.role_hint),
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
        -- Ignore attempts to disable security mandatory in personal prefs
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
grant execute on function public.set_my_notification_prefs(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Complex policy snapshot for worker / enqueue (service_role + authenticated read via RPC)
-- ---------------------------------------------------------------------------
create or replace function public.email_core_notification_policy_snapshot(
  p_user_id uuid default null,
  p_to_email text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_mode text := 'ALL';
  v_hash text;
begin
  if auth.role() is distinct from 'service_role'
     and not public.has_staff_role('администрация')
     and (v_uid is null or v_uid is distinct from auth.uid()) then
    raise exception 'email_core_notification_policy_snapshot: not allowed' using errcode = '42501';
  end if;

  if v_uid is not null then
    select p.mode into v_mode
    from public.email_user_notification_prefs as p
    where p.user_id = v_uid;
    if not found then
      v_mode := 'ALL';
    end if;
  end if;

  v_hash := case
    when p_to_email is null then null
    else public.email_core_email_hash(p_to_email)
  end;

  return jsonb_build_object(
    'modules', coalesce((
      select jsonb_object_agg(m.module_key, m.enabled)
      from public.email_notification_module_settings as m
    ), '{}'::jsonb),
    'events', coalesce((
      select jsonb_object_agg(e.event_key, e.enabled)
      from public.email_notification_event_settings as e
    ), '{}'::jsonb),
    'personal_mode', v_mode,
    'personal_overrides', case
      when v_uid is null then '{}'::jsonb
      else coalesce((
        select jsonb_object_agg(e.event_key, e.enabled)
        from public.email_user_notification_event_prefs as e
        where e.user_id = v_uid
      ), '{}'::jsonb)
    end,
    'recipient_hash', v_hash
  );
end;
$fn$;

revoke all on function public.email_core_notification_policy_snapshot(uuid, text)
  from public, anon;
grant execute on function public.email_core_notification_policy_snapshot(uuid, text)
  to authenticated;
grant execute on function public.email_core_notification_policy_snapshot(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Digest buffer insert + flush to outbox (service_role worker)
-- ---------------------------------------------------------------------------
create or replace function public.email_core_digest_buffer_upsert(
  p_to_email text,
  p_user_id uuid,
  p_event_key text,
  p_module_key text,
  p_template_key text,
  p_locale text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to text := public.email_core_normalize_email(p_to_email);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_id bigint;
begin
  if auth.role() is distinct from 'service_role'
     and not public.has_staff_role('администрация') then
    raise exception 'email_core_digest_buffer_upsert: not allowed' using errcode = '42501';
  end if;
  if v_to is null or v_key is null then
    raise exception 'email_core_digest_buffer_upsert: invalid args';
  end if;

  insert into public.email_digest_buffer as b (
    recipient_email_hash, recipient_email, user_id, event_key, module_key,
    template_key, locale, payload, local_day, idempotency_key
  ) values (
    public.email_core_email_hash(v_to),
    v_to,
    p_user_id,
    p_event_key,
    p_module_key,
    p_template_key,
    case when p_locale in ('bg', 'ru', 'en') then p_locale else 'bg' end,
    coalesce(p_payload, '{}'::jsonb),
    public.email_core_local_day(now()),
    v_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'pending');
  end if;

  perform public.email_core_write_policy_audit(
    'digest_buffered',
    'digest',
    p_event_key,
    jsonb_build_object('idempotency_key', v_key, 'module_key', p_module_key)
  );

  return jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'status', 'pending');
end;
$fn$;

revoke all on function public.email_core_digest_buffer_upsert(
  text, uuid, text, text, text, text, jsonb, text
) from public, anon;
grant execute on function public.email_core_digest_buffer_upsert(
  text, uuid, text, text, text, text, jsonb, text
) to authenticated;
grant execute on function public.email_core_digest_buffer_upsert(
  text, uuid, text, text, text, text, jsonb, text
) to service_role;

create or replace function public.email_core_digest_flush_ready(
  p_before_day date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_day date := coalesce(p_before_day, public.email_core_local_day(now()) - 1);
  v_n int := 0;
  r record;
  v_outbox bigint;
  v_subject text;
  v_items jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_digest_flush_ready: service_role only' using errcode = '42501';
  end if;

  for r in
    select
      b.recipient_email,
      b.recipient_email_hash,
      b.user_id,
      b.locale,
      min(b.id) as first_id
    from public.email_digest_buffer as b
    where b.status = 'pending'
      and b.local_day <= v_day
    group by b.recipient_email, b.recipient_email_hash, b.user_id, b.locale
  loop
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'event_key', x.event_key,
        'module_key', x.module_key,
        'template_key', x.template_key,
        'payload', x.payload
      )
      order by x.id
    ), '[]'::jsonb)
    into v_items
    from public.email_digest_buffer as x
    where x.status = 'pending'
      and x.local_day <= v_day
      and x.recipient_email_hash = r.recipient_email_hash
      and x.locale = r.locale;

    v_subject := 'Daily digest';

    insert into public.email_outbox (
      idempotency_key, module_key, template_key, locale, to_email, to_email_hash,
      subject, payload, status, event_key, policy_decision, created_by_email
    ) values (
      'digest:' || r.recipient_email_hash || ':' || v_day::text || ':' || r.locale,
      'system',
      'email_digest_daily',
      r.locale,
      r.recipient_email,
      r.recipient_email_hash,
      v_subject,
      jsonb_build_object(
        'digest_day', v_day,
        'items', v_items,
        'event_kind', 'daily_digest'
      ),
      case when public.email_core_is_ready() then 'queued' else 'blocked_not_ready' end,
      'email_digest_daily',
      'digest_flush',
      'email_core_digest_flush'
    )
    on conflict (idempotency_key) do nothing
    returning id into v_outbox;

    update public.email_digest_buffer as b
    set status = 'flushed'
    where b.status = 'pending'
      and b.local_day <= v_day
      and b.recipient_email_hash = r.recipient_email_hash
      and b.locale = r.locale;

    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'flushed_recipients', v_n, 'before_day', v_day);
end;
$fn$;

revoke all on function public.email_core_digest_flush_ready(date) from public, anon;
grant execute on function public.email_core_digest_flush_ready(date) to service_role;

-- ---------------------------------------------------------------------------
-- Throttle: return true when over limit (optional informational)
-- ---------------------------------------------------------------------------
create or replace function public.email_core_recipient_throttle_hit(
  p_to_email text,
  p_event_key text,
  p_limit integer default 5,
  p_window_minutes integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to text := public.email_core_normalize_email(p_to_email);
  v_hash text;
  v_window timestamptz;
  v_count int;
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 100));
  v_mins int := greatest(5, least(coalesce(p_window_minutes, 60), 1440));
begin
  if v_to is null then
    return false;
  end if;
  v_hash := public.email_core_email_hash(v_to);
  v_window := date_trunc('hour', now())
    + make_interval(mins => (extract(minute from now())::int / v_mins) * v_mins);

  insert into public.email_recipient_throttle as t (
    recipient_email_hash, event_key, window_start, hit_count
  ) values (v_hash, p_event_key, v_window, 1)
  on conflict (recipient_email_hash, event_key, window_start) do update
    set hit_count = public.email_recipient_throttle.hit_count + 1
  returning hit_count into v_count;

  return v_count > v_limit;
end;
$fn$;

revoke all on function public.email_core_recipient_throttle_hit(text, text, integer, integer)
  from public, anon;
grant execute on function public.email_core_recipient_throttle_hit(text, text, integer, integer)
  to authenticated;
grant execute on function public.email_core_recipient_throttle_hit(text, text, integer, integer)
  to service_role;

create or replace function public.email_core_set_outbox_event_meta(
  p_outbox_id bigint,
  p_event_key text,
  p_policy_decision text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.email_outbox as o
  set
    event_key = nullif(btrim(coalesce(p_event_key, '')), ''),
    policy_decision = nullif(btrim(coalesce(p_policy_decision, '')), ''),
    updated_at = now()
  where o.id = p_outbox_id;
end;
$fn$;

revoke all on function public.email_core_set_outbox_event_meta(bigint, text, text)
  from public, anon;
grant execute on function public.email_core_set_outbox_event_meta(bigint, text, text)
  to authenticated;
grant execute on function public.email_core_set_outbox_event_meta(bigint, text, text)
  to service_role;

-- Mark cancelled optional outbox when policy blocks at dispatch
create or replace function public.email_core_cancel_outbox_policy(
  p_outbox_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email_core_cancel_outbox_policy: service_role only' using errcode = '42501';
  end if;

  update public.email_outbox as o
  set
    status = 'cancelled',
    last_error_code = left(coalesce(p_reason, 'policy_suppressed'), 120),
    policy_decision = left(coalesce(p_reason, 'policy_suppressed'), 120),
    updated_at = now()
  where o.id = p_outbox_id
    and o.status in ('queued', 'held', 'blocked_not_ready', 'sending');

  perform public.email_core_write_policy_audit(
    'dispatch_suppressed',
    'outbox',
    p_outbox_id::text,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('ok', true, 'outbox_id', p_outbox_id, 'reason', p_reason);
end;
$fn$;

revoke all on function public.email_core_cancel_outbox_policy(bigint, text) from public, anon;
grant execute on function public.email_core_cancel_outbox_policy(bigint, text) to service_role;

-- Explicitly leave email sending + debt gate unchanged
-- (no updates to complex_email_settings.email_enabled / debt flags)
-- commit (stripped)
