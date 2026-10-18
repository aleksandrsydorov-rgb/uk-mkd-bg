-- R1-FIRST-BOOT: invite tracking, concurrent lock, audit, email-bound claim.
-- Extends install_bootstrap_state; does not replace the approval/claim protocol.

alter table public.install_bootstrap_state
  add column if not exists pending_admin_email text null,
  add column if not exists invite_auth_user_id uuid null,
  add column if not exists last_invite_at timestamptz null,
  add column if not exists provision_lock_until timestamptz null;

create table if not exists public.install_bootstrap_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.install_bootstrap_events is
  'Append-only audit for first-admin bootstrap (installer CLI / service_role).';

alter table public.install_bootstrap_events enable row level security;
revoke all on table public.install_bootstrap_events from public, anon, authenticated;

create or replace function public.install_bootstrap_audit(
  p_event_type text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_audit: service_role required'
      using errcode = '42501';
  end if;
  insert into public.install_bootstrap_events (event_type, detail)
  values (
    nullif(btrim(coalesce(p_event_type, '')), ''),
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.install_bootstrap_audit(text, jsonb) from public, anon, authenticated;
grant execute on function public.install_bootstrap_audit(text, jsonb) to service_role;

create or replace function public.install_bootstrap_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.install_bootstrap_state%rowtype;
  v_admin_n int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_status: service_role required'
      using errcode = '42501';
  end if;

  select * into v_row from public.install_bootstrap_state where id = 1;
  select count(*)::int into v_admin_n
  from public.staff s
  where s.role = 'администрация' and coalesce(s.active, true) is true;

  return jsonb_build_object(
    'bootstrap_completed', v_row.completed_at is not null,
    'completed_at', v_row.completed_at,
    'pending_admin_email', v_row.pending_admin_email,
    'invite_auth_user_id', v_row.invite_auth_user_id,
    'last_invite_at', v_row.last_invite_at,
    'approval_ready', v_row.approval_token_hash is not null,
    'approved_at', v_row.approved_at,
    'first_admin_email', v_row.first_admin_email,
    'first_admin_staff_id', v_row.first_admin_staff_id,
    'active_admin_count', v_admin_n,
    'provision_locked',
      v_row.provision_lock_until is not null and v_row.provision_lock_until > now(),
    'closed', v_row.completed_at is not null or v_admin_n > 0
  );
end;
$fn$;

revoke all on function public.install_bootstrap_status() from public, anon, authenticated;
grant execute on function public.install_bootstrap_status() to service_role;

create or replace function public.install_bootstrap_set_approval(
  p_approval_token text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_approval_token, '')), '');
  v_completed timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_set_approval: service_role required'
      using errcode = '42501';
  end if;

  -- Transaction-scoped advisory lock serializes concurrent installer provision attempts.
  perform pg_advisory_xact_lock(87201401);

  if v_token is null or char_length(v_token) < 32 then
    raise exception 'install_bootstrap_set_approval: token must be at least 32 characters'
      using errcode = '22023';
  end if;

  select b.completed_at
    into v_completed
  from public.install_bootstrap_state as b
  where b.id = 1
  for update;

  if v_completed is not null then
    raise exception 'install_bootstrap_set_approval: bootstrap already completed'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.staff as s
    where s.role = 'администрация' and s.active is true
  ) then
    raise exception 'install_bootstrap_set_approval: administrator already exists'
      using errcode = 'P0001';
  end if;

  update public.install_bootstrap_state as b
  set approval_token_hash = encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
      approval_note = nullif(btrim(coalesce(p_note, '')), ''),
      approved_at = now(),
      updated_at = now()
  where b.id = 1;

  insert into public.install_bootstrap_events (event_type, detail)
  values (
    'approval_set',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''))
  );
end;
$fn$;

revoke all on function public.install_bootstrap_set_approval(text, text) from public, anon, authenticated;
grant execute on function public.install_bootstrap_set_approval(text, text) to service_role;

create or replace function public.install_bootstrap_acquire_provision(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_row public.install_bootstrap_state%rowtype;
  v_admin_n int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_acquire_provision: service_role required'
      using errcode = '42501';
  end if;

  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'install_bootstrap_acquire_provision: valid email required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(87201401);

  select count(*)::int into v_admin_n
  from public.staff s
  where s.role = 'администрация' and coalesce(s.active, true) is true;

  if v_admin_n > 0 then
    raise exception 'install_bootstrap_acquire_provision: administrator already exists'
      using errcode = 'P0001';
  end if;

  select * into v_row from public.install_bootstrap_state where id = 1 for update;

  if v_row.completed_at is not null then
    raise exception 'install_bootstrap_acquire_provision: bootstrap already completed'
      using errcode = 'P0001';
  end if;

  -- Concurrent protect: another email holds an unexpired lock.
  if v_row.provision_lock_until is not null
     and v_row.provision_lock_until > now()
     and v_row.pending_admin_email is not null
     and v_row.pending_admin_email is distinct from v_email then
    raise exception 'install_bootstrap_acquire_provision: concurrent provisioning in progress'
      using errcode = 'P0001';
  end if;

  if v_row.pending_admin_email is not null
     and v_row.pending_admin_email is distinct from v_email then
    raise exception 'install_bootstrap_acquire_provision: pending email mismatch'
      using errcode = 'P0001';
  end if;

  update public.install_bootstrap_state as b
  set pending_admin_email = v_email,
      provision_lock_until = now() + interval '180 seconds',
      updated_at = now()
  where b.id = 1;

  insert into public.install_bootstrap_events (event_type, detail)
  values (
    'provision_acquired',
    jsonb_build_object('email', v_email, 'idempotent', v_row.pending_admin_email is not null)
  );

  return jsonb_build_object(
    'email', v_email,
    'approval_ready', v_row.approval_token_hash is not null,
    'idempotent', v_row.pending_admin_email is not distinct from v_email
      and v_row.pending_admin_email is not null
  );
end;
$fn$;

revoke all on function public.install_bootstrap_acquire_provision(text) from public, anon, authenticated;
grant execute on function public.install_bootstrap_acquire_provision(text) to service_role;

create or replace function public.install_bootstrap_record_invite(
  p_email text,
  p_auth_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_completed timestamptz;
  v_pending text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_record_invite: service_role required'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(87201401);

  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'install_bootstrap_record_invite: valid email required'
      using errcode = '22023';
  end if;

  select b.completed_at, b.pending_admin_email
    into v_completed, v_pending
  from public.install_bootstrap_state as b
  where b.id = 1
  for update;

  if v_completed is not null then
    raise exception 'install_bootstrap_record_invite: bootstrap already completed'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.staff as s
    where s.role = 'администрация' and coalesce(s.active, true) is true
  ) then
    raise exception 'install_bootstrap_record_invite: administrator already exists'
      using errcode = 'P0001';
  end if;

  if v_pending is not null and v_pending is distinct from v_email then
    raise exception 'install_bootstrap_record_invite: pending email mismatch (use status/resend)'
      using errcode = 'P0001';
  end if;

  update public.install_bootstrap_state as b
  set pending_admin_email = v_email,
      invite_auth_user_id = coalesce(p_auth_user_id, b.invite_auth_user_id),
      last_invite_at = now(),
      provision_lock_until = null,
      updated_at = now()
  where b.id = 1;

  insert into public.install_bootstrap_events (event_type, detail)
  values (
    'invite_recorded',
    jsonb_build_object(
      'email', v_email,
      'auth_user_id', p_auth_user_id
    )
  );
end;
$fn$;

revoke all on function public.install_bootstrap_record_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.install_bootstrap_record_invite(text, uuid) to service_role;

create or replace function public.install_bootstrap_claim_first_admin(
  p_approval_token text,
  p_display_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_token text := nullif(btrim(coalesce(p_approval_token, '')), '');
  v_hash text;
  v_pending text;
  v_staff_id bigint;
  v_completed timestamptz;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'install_bootstrap_claim_first_admin: authenticated session with email required'
      using errcode = '28000';
  end if;

  if v_name is null then
    raise exception 'install_bootstrap_claim_first_admin: display name required'
      using errcode = '22023';
  end if;

  if v_token is null then
    raise exception 'install_bootstrap_claim_first_admin: approval token required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(87201401);

  select b.approval_token_hash, b.completed_at, b.pending_admin_email
    into v_hash, v_completed, v_pending
  from public.install_bootstrap_state as b
  where b.id = 1
  for update;

  if v_completed is not null then
    raise exception 'install_bootstrap_claim_first_admin: bootstrap already completed'
      using errcode = 'P0001';
  end if;

  if v_hash is null then
    raise exception 'install_bootstrap_claim_first_admin: installation owner has not approved bootstrap'
      using errcode = '42501';
  end if;

  if encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex') is distinct from v_hash then
    raise exception 'install_bootstrap_claim_first_admin: invalid approval token'
      using errcode = '42501';
  end if;

  if v_pending is not null and v_pending is distinct from v_email then
    raise exception 'install_bootstrap_claim_first_admin: email does not match invited administrator'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.staff as s
    where s.role = 'администрация' and coalesce(s.active, true) is true
  ) then
    raise exception 'install_bootstrap_claim_first_admin: administrator already exists'
      using errcode = 'P0001';
  end if;

  insert into public.staff (name, email, role, active)
  values (v_name, v_email, 'администрация', true)
  returning id into v_staff_id;

  update public.install_bootstrap_state as b
  set first_admin_staff_id = v_staff_id,
      first_admin_email = v_email,
      completed_at = now(),
      approval_token_hash = null,
      provision_lock_until = null,
      updated_at = now()
  where b.id = 1;

  insert into public.install_bootstrap_events (event_type, detail)
  values (
    'claim_completed',
    jsonb_build_object(
      'email', v_email,
      'staff_id', v_staff_id
    )
  );

  return v_staff_id;
end;
$fn$;

revoke all on function public.install_bootstrap_claim_first_admin(text, text) from public, anon;
grant execute on function public.install_bootstrap_claim_first_admin(text, text) to authenticated;
grant execute on function public.install_bootstrap_claim_first_admin(text, text) to service_role;
