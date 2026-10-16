-- =============================================================================
-- IS-9b — Safe first-administrator bootstrap (no credentials embedded)
-- =============================================================================
-- Installation owner must:
--   1) Create/invite the Auth user out-of-band (Supabase Auth — not this package).
--   2) Set approval_token_hash = encode(digest(<plaintext_token>, 'sha256'), 'hex')
--      via a controlled SQL session (service role / install owner).
--   3) Authenticated candidate calls install_bootstrap_claim_first_admin(token, name).
--
-- No passwords. No public unrestricted registration. No automatic privileged users.
-- Fails if an администрация staff row already exists.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.install_bootstrap_state (
  id smallint primary key default 1 check (id = 1),
  approval_token_hash text null,
  approval_note text null,
  approved_at timestamptz null,
  first_admin_staff_id bigint null,
  first_admin_email text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.install_bootstrap_state is
  'Controlled first-admin bootstrap. Token hash set by installation owner; never store plaintext.';

insert into public.install_bootstrap_state (id)
values (1)
on conflict (id) do nothing;

alter table public.install_bootstrap_state enable row level security;

revoke all on table public.install_bootstrap_state from public, anon, authenticated;
-- No SELECT grant to authenticated — state is install-ops only (service_role / SQL editor).

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
begin
  -- Callable only by service_role (installation owner session), never by anon/authenticated clients.
  if auth.role() is distinct from 'service_role' then
    raise exception 'install_bootstrap_set_approval: service_role required'
      using errcode = '42501';
  end if;

  if v_token is null or char_length(v_token) < 32 then
    raise exception 'install_bootstrap_set_approval: token must be at least 32 characters'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.staff as s
    where s.role = 'администрация' and s.active is true
  ) then
    raise exception 'install_bootstrap_set_approval: administrator already exists'
      using errcode = 'P0001';
  end if;

  update public.install_bootstrap_state as b
  set approval_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
      approval_note = nullif(btrim(coalesce(p_note, '')), ''),
      approved_at = now(),
      updated_at = now()
  where b.id = 1;
end;
$fn$;

revoke all on function public.install_bootstrap_set_approval(text, text) from public, anon, authenticated;

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

  select b.approval_token_hash, b.completed_at
    into v_hash, v_completed
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

  if encode(digest(v_token, 'sha256'), 'hex') is distinct from v_hash then
    raise exception 'install_bootstrap_claim_first_admin: invalid approval token'
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
      updated_at = now()
  where b.id = 1;

  return v_staff_id;
end;
$fn$;

revoke all on function public.install_bootstrap_claim_first_admin(text, text) from public, anon;
grant execute on function public.install_bootstrap_claim_first_admin(text, text) to authenticated;
