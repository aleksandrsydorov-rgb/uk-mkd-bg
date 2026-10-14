-- Phase IS-1: Universal Module Lifecycle + Initial Setup Core (foundation).
-- Adjacent to existing building_modules / module_catalog — does NOT replace UX toggles.
-- Does NOT change building_modules.enabled or activate/suspend production modules.
-- One complex = one DB; installation row prepares future Control multi-install.

begin;

-- ---------------------------------------------------------------------------
-- Installation identity (single row today; Control may add more later)
-- Extends existing Support Module platform_installations when present
-- (id, installation_id, complex_name, deployment_id, …). Does not drop or
-- rewrite Support rows; only adds IS-1 key/display columns if missing.
-- ---------------------------------------------------------------------------

create table if not exists public.platform_installations (
  id uuid primary key default gen_random_uuid(),
  installation_key text not null,
  display_name text not null default 'Local installation',
  created_at timestamptz not null default now(),
  constraint platform_installations_key_chk check (length(btrim(installation_key)) > 0)
);

alter table public.platform_installations
  add column if not exists installation_key text;

alter table public.platform_installations
  add column if not exists display_name text;

-- Backfill singleton / existing Support row before NOT NULL / unique index.
do $do$
declare
  has_complex boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_installations'
      and column_name = 'complex_name'
  ) into has_complex;

  if has_complex then
    execute $sql$
      update public.platform_installations
      set
        installation_key = coalesce(nullif(btrim(installation_key), ''), 'default'),
        display_name = coalesce(
          nullif(btrim(display_name), ''),
          nullif(btrim(complex_name), ''),
          'Default complex installation'
        )
      where installation_key is null
         or btrim(installation_key) = ''
         or display_name is null
         or btrim(display_name) = ''
    $sql$;
  else
    update public.platform_installations
    set
      installation_key = coalesce(nullif(btrim(installation_key), ''), 'default'),
      display_name = coalesce(
        nullif(btrim(display_name), ''),
        'Default complex installation'
      )
    where installation_key is null
       or btrim(installation_key) = ''
       or display_name is null
       or btrim(display_name) = '';
  end if;
end;
$do$;

alter table public.platform_installations
  alter column installation_key set default 'default';

alter table public.platform_installations
  alter column display_name set default 'Local installation';

-- Enforce NOT NULL only after backfill (safe on fresh and existing installs).
do $do$
begin
  alter table public.platform_installations
    alter column installation_key set not null;
exception
  when others then
    raise exception 'IS-1: cannot set installation_key NOT NULL: %', sqlerrm;
end;
$do$;

do $do$
begin
  alter table public.platform_installations
    alter column display_name set not null;
exception
  when others then
    raise exception 'IS-1: cannot set display_name NOT NULL: %', sqlerrm;
end;
$do$;

do $do$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_installations_key_chk'
      and conrelid = 'public.platform_installations'::regclass
  ) then
    alter table public.platform_installations
      add constraint platform_installations_key_chk
      check (length(btrim(installation_key)) > 0);
  end if;
end;
$do$;

create unique index if not exists platform_installations_key_uidx
  on public.platform_installations (lower(btrim(installation_key)));

alter table public.platform_installations enable row level security;
revoke all on table public.platform_installations from public, anon, authenticated;

-- Insert default only when no installation row exists (Support Module installs
-- a singleton; never create a second row against platform_installations_singleton_idx).
insert into public.platform_installations (installation_key, display_name)
select 'default', 'Default complex installation'
where not exists (select 1 from public.platform_installations limit 1);

-- ---------------------------------------------------------------------------
-- Lifecycle (v1.2 states) — per installation + module_key
-- ---------------------------------------------------------------------------

create table if not exists public.module_lifecycle (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.platform_installations (id) on delete cascade,
  module_key text not null,
  state text not null,
  setup_schema_version text null,
  last_transition_at timestamptz not null default now(),
  last_transition_by uuid null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint module_lifecycle_state_chk check (
    state in (
      'DISABLED',
      'SETUP_REQUIRED',
      'SETUP_IN_PROGRESS',
      'READY',
      'ACTIVE',
      'SUSPENDED'
    )
  ),
  constraint module_lifecycle_install_module_uidx unique (installation_id, module_key)
);

create index if not exists module_lifecycle_state_idx
  on public.module_lifecycle (installation_id, state);

alter table public.module_lifecycle enable row level security;
revoke all on table public.module_lifecycle from public, anon, authenticated;

create table if not exists public.module_lifecycle_audit (
  id bigserial primary key,
  installation_id uuid not null references public.platform_installations (id) on delete cascade,
  module_key text not null,
  from_state text null,
  to_state text not null,
  actor_uid uuid null,
  actor_email text null,
  reason text null,
  created_at timestamptz not null default now()
);

alter table public.module_lifecycle_audit enable row level security;
revoke all on table public.module_lifecycle_audit from public, anon, authenticated;

-- Seed lifecycle from catalog without mutating building_modules.enabled:
-- enabled=true → ACTIVE; else DISABLED. Idempotent.
insert into public.module_lifecycle (installation_id, module_key, state, setup_schema_version)
select
  i.id,
  c.module_key,
  case when coalesce(bm.enabled, false) then 'ACTIVE' else 'DISABLED' end,
  '1.0'
from public.platform_installations as i
cross join public.module_catalog as c
left join public.building_modules as bm on bm.module_key = c.module_key
where lower(i.installation_key) = 'default'
on conflict (installation_id, module_key) do nothing;

-- ---------------------------------------------------------------------------
-- Setup progress (resumable drafts) + import batches
-- ---------------------------------------------------------------------------

create table if not exists public.module_setup_progress (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.platform_installations (id) on delete cascade,
  module_key text not null,
  setup_schema_version text not null default '1.0',
  current_step text null,
  draft jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  constraint module_setup_progress_uidx unique (installation_id, module_key)
);

alter table public.module_setup_progress enable row level security;
revoke all on table public.module_setup_progress from public, anon, authenticated;

create table if not exists public.module_import_batches (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.platform_installations (id) on delete cascade,
  module_key text not null,
  schema_version text not null,
  source text not null default 'xlsx',
  status text not null default 'preview',
  file_name text null,
  row_count integer not null default 0,
  create_count integer not null default 0,
  update_count integer not null default 0,
  skip_count integer not null default 0,
  error_count integer not null default 0,
  preview jsonb not null default '{}'::jsonb,
  error_report jsonb not null default '[]'::jsonb,
  committed_at timestamptz null,
  created_by uuid null,
  created_by_email text null,
  confirmed_by uuid null,
  created_at timestamptz not null default now(),
  constraint module_import_batches_source_chk check (source in ('xlsx', 'manual', 'api')),
  constraint module_import_batches_status_chk check (
    status in ('preview', 'committed', 'cancelled', 'failed')
  )
);

create index if not exists module_import_batches_module_idx
  on public.module_import_batches (installation_id, module_key, created_at desc);

alter table public.module_import_batches enable row level security;
revoke all on table public.module_import_batches from public, anon, authenticated;

-- Opening-data metadata (financial adapters fill domain tables separately)
create table if not exists public.module_opening_data_meta (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.platform_installations (id) on delete cascade,
  module_key text not null,
  batch_id uuid null references public.module_import_batches (id) on delete set null,
  effective_transition_date date null,
  original_source text null,
  imported_by uuid null,
  validated_by uuid null,
  approved_by uuid null,
  module_version text null,
  notes text null,
  created_at timestamptz not null default now()
);

alter table public.module_opening_data_meta enable row level security;
revoke all on table public.module_opening_data_meta from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin assert + RPCs (lifecycle read/transition, setup draft, import batch)
-- ---------------------------------------------------------------------------

create or replace function public.admin_assert_module_setup()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'module_setup: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'module_setup: not allowed' using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.admin_assert_module_setup() from public, anon, authenticated;

create or replace function public.module_lifecycle_transition_allowed(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_from is null and p_to = 'DISABLED' then true
    when p_from = p_to then false
    when p_from = 'DISABLED' and p_to in ('SETUP_REQUIRED', 'READY') then true
    when p_from = 'SETUP_REQUIRED' and p_to in ('SETUP_IN_PROGRESS', 'DISABLED') then true
    when p_from = 'SETUP_IN_PROGRESS' and p_to in ('READY', 'SETUP_REQUIRED', 'DISABLED') then true
    when p_from = 'READY' and p_to in ('ACTIVE', 'SETUP_IN_PROGRESS', 'DISABLED') then true
    when p_from = 'ACTIVE' and p_to in ('SUSPENDED', 'DISABLED') then true
    when p_from = 'SUSPENDED' and p_to in ('ACTIVE', 'READY', 'DISABLED') then true
    else false
  end;
$fn$;

revoke all on function public.module_lifecycle_transition_allowed(text, text) from public, anon;
grant execute on function public.module_lifecycle_transition_allowed(text, text) to authenticated;

create or replace function public.admin_list_module_lifecycle()
returns table (
  installation_key text,
  module_key text,
  state text,
  setup_schema_version text,
  catalog_implemented boolean,
  building_enabled boolean,
  last_transition_at timestamptz,
  has_setup_draft boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
begin
  perform public.admin_assert_module_setup();

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  return query
  select
    'default'::text,
    ml.module_key,
    ml.state,
    ml.setup_schema_version,
    coalesce(c.implemented, false),
    coalesce(bm.enabled, false),
    ml.last_transition_at,
    exists (
      select 1
      from public.module_setup_progress as sp
      where sp.installation_id = ml.installation_id
        and sp.module_key = ml.module_key
    )
  from public.module_lifecycle as ml
  left join public.module_catalog as c on c.module_key = ml.module_key
  left join public.building_modules as bm on bm.module_key = ml.module_key
  where ml.installation_id = v_install
  order by ml.module_key;
end;
$fn$;

revoke all on function public.admin_list_module_lifecycle() from public, anon;
grant execute on function public.admin_list_module_lifecycle() to authenticated;

create or replace function public.admin_transition_module_lifecycle(
  p_module_key text,
  p_to_state text,
  p_reason text default null
)
returns table (
  module_key text,
  state text,
  last_transition_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_from text;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_to text := upper(btrim(coalesce(p_to_state, '')));
begin
  perform public.admin_assert_module_setup();

  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  if v_install is null then
    raise exception 'module_setup: installation missing' using errcode = 'P0001';
  end if;

  select ml.state into v_from
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key
  for update;

  if not found then
    insert into public.module_lifecycle (installation_id, module_key, state)
    values (v_install, v_key, 'DISABLED')
    returning public.module_lifecycle.state into v_from;
  end if;

  if not public.module_lifecycle_transition_allowed(v_from, v_to) then
    raise exception 'module_setup: invalid transition % → %', v_from, v_to
      using errcode = '22023';
  end if;

  -- IS-1: lifecycle transitions do NOT mutate building_modules.enabled.
  update public.module_lifecycle as ml
  set
    state = v_to,
    last_transition_at = now(),
    last_transition_by = auth.uid(),
    notes = nullif(btrim(coalesce(p_reason, '')), '')
  where ml.installation_id = v_install
    and ml.module_key = v_key;

  insert into public.module_lifecycle_audit (
    installation_id, module_key, from_state, to_state, actor_uid, actor_email, reason
  ) values (
    v_install, v_key, v_from, v_to, auth.uid(), auth.email(),
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  return query
  select ml.module_key, ml.state, ml.last_transition_at
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key;
end;
$fn$;

revoke all on function public.admin_transition_module_lifecycle(text, text, text) from public, anon;
grant execute on function public.admin_transition_module_lifecycle(text, text, text) to authenticated;

create or replace function public.admin_save_module_setup_progress(
  p_module_key text,
  p_current_step text,
  p_draft jsonb,
  p_validation_errors jsonb default '[]'::jsonb,
  p_setup_schema_version text default '1.0'
)
returns public.module_setup_progress
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_row public.module_setup_progress%rowtype;
begin
  perform public.admin_assert_module_setup();
  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  insert into public.module_setup_progress as sp (
    installation_id, module_key, setup_schema_version, current_step, draft,
    validation_errors, updated_at, updated_by
  ) values (
    v_install, v_key, coalesce(nullif(btrim(p_setup_schema_version), ''), '1.0'),
    nullif(btrim(coalesce(p_current_step, '')), ''),
    coalesce(p_draft, '{}'::jsonb),
    coalesce(p_validation_errors, '[]'::jsonb),
    now(), auth.uid()
  )
  on conflict (installation_id, module_key) do update
  set
    setup_schema_version = excluded.setup_schema_version,
    current_step = excluded.current_step,
    draft = excluded.draft,
    validation_errors = excluded.validation_errors,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_save_module_setup_progress(text, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.admin_save_module_setup_progress(text, text, jsonb, jsonb, text)
  to authenticated;

create or replace function public.admin_get_module_setup_progress(p_module_key text)
returns public.module_setup_progress
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_row public.module_setup_progress%rowtype;
begin
  perform public.admin_assert_module_setup();

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  select sp.* into v_row
  from public.module_setup_progress as sp
  where sp.installation_id = v_install
    and sp.module_key = v_key;

  return v_row;
end;
$fn$;

revoke all on function public.admin_get_module_setup_progress(text) from public, anon;
grant execute on function public.admin_get_module_setup_progress(text) to authenticated;

create or replace function public.admin_create_module_import_batch(
  p_module_key text,
  p_schema_version text,
  p_source text,
  p_file_name text,
  p_preview jsonb,
  p_row_count integer,
  p_create_count integer,
  p_update_count integer,
  p_skip_count integer,
  p_error_count integer,
  p_error_report jsonb default '[]'::jsonb
)
returns public.module_import_batches
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_source text := lower(btrim(coalesce(p_source, 'xlsx')));
  v_row public.module_import_batches%rowtype;
begin
  perform public.admin_assert_module_setup();
  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;
  if v_source not in ('xlsx', 'manual', 'api') then
    raise exception 'module_setup: invalid source' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  insert into public.module_import_batches (
    installation_id, module_key, schema_version, source, status, file_name,
    row_count, create_count, update_count, skip_count, error_count,
    preview, error_report, created_by, created_by_email
  ) values (
    v_install, v_key, coalesce(nullif(btrim(p_schema_version), ''), '1.0'),
    v_source, 'preview', nullif(btrim(coalesce(p_file_name, '')), ''),
    greatest(coalesce(p_row_count, 0), 0),
    greatest(coalesce(p_create_count, 0), 0),
    greatest(coalesce(p_update_count, 0), 0),
    greatest(coalesce(p_skip_count, 0), 0),
    greatest(coalesce(p_error_count, 0), 0),
    coalesce(p_preview, '{}'::jsonb),
    coalesce(p_error_report, '[]'::jsonb),
    auth.uid(), auth.email()
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_create_module_import_batch(
  text, text, text, text, jsonb, integer, integer, integer, integer, integer, jsonb
) from public, anon;
grant execute on function public.admin_create_module_import_batch(
  text, text, text, text, jsonb, integer, integer, integer, integer, integer, jsonb
) to authenticated;

-- Mark preview batch committed AFTER module adapter wrote domain data in app transaction.
-- Does not write business tables itself.
create or replace function public.admin_commit_module_import_batch(p_batch_id uuid)
returns public.module_import_batches
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.module_import_batches%rowtype;
begin
  perform public.admin_assert_module_setup();

  update public.module_import_batches as b
  set
    status = 'committed',
    committed_at = now(),
    confirmed_by = auth.uid()
  where b.id = p_batch_id
    and b.status = 'preview'
  returning * into v_row;

  if not found then
    raise exception 'module_setup: batch not found or not in preview'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_commit_module_import_batch(uuid) from public, anon;
grant execute on function public.admin_commit_module_import_batch(uuid) to authenticated;

create or replace function public.admin_list_module_import_batches(
  p_module_key text default null,
  p_limit integer default 50
)
returns setof public.module_import_batches
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := nullif(lower(btrim(coalesce(p_module_key, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform public.admin_assert_module_setup();

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  return query
  select b.*
  from public.module_import_batches as b
  where b.installation_id = v_install
    and (v_key is null or b.module_key = v_key)
  order by b.created_at desc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_module_import_batches(text, integer) from public, anon;
grant execute on function public.admin_list_module_import_batches(text, integer) to authenticated;

commit;
