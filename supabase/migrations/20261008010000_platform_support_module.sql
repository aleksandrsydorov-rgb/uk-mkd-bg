-- Platform Support — PLATFORM CORE (client installation side).
-- Registered in Module Core for identity/catalog only; NOT an optional business toggle.
-- Local persistence behind PlatformControlService adapter; Master Control replaces later.
-- Pre-Master: messages/invoices stay local; no live ALSYD delivery claimed by UI.
-- No invented billing/payment history. No Amadeus-specific business logic.

begin;

-- ---------------------------------------------------------------------------
-- Module catalog (platform-core identity; always enabled)
-- ---------------------------------------------------------------------------

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('platform_support', 'Платформа и поддержка', 'services', true, 5)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'platform_support', true, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'platform_support'
);

-- Force-enable if a prior local state disabled it; platform-core must stay on.
update public.building_modules
   set enabled = true,
       updated_at = now()
 where module_key = 'platform_support'
   and enabled is distinct from true;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.platform_installations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null unique default gen_random_uuid(),
  complex_name text not null default '',
  deployment_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_installations_singleton check (id = id)
);

-- Enforce at most one installation row for this single-tenant client DB.
create unique index if not exists platform_installations_singleton_idx
  on public.platform_installations ((true));

create table if not exists public.platform_account_state (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null unique
    references public.platform_installations (installation_id) on delete cascade,
  status text not null default 'ACTIVE'
    constraint platform_account_state_status_chk
      check (status in ('ACTIVE', 'PAYMENT_DUE', 'WARNING', 'SUSPENDED_NONPAYMENT')),
  fixed_service_price numeric(12, 2) null,
  currency text not null default 'EUR',
  next_payment_date date null,
  amount_due numeric(12, 2) null,
  debt_amount numeric(12, 2) null,
  updated_at timestamptz not null default now(),
  constraint platform_account_state_currency_chk check (length(btrim(currency)) = 3)
);

create table if not exists public.platform_support_threads (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null
    references public.platform_installations (installation_id) on delete cascade,
  subject text not null default 'Platform support',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_support_threads_subject_chk check (length(btrim(subject)) > 0)
);

create unique index if not exists platform_support_threads_installation_uidx
  on public.platform_support_threads (installation_id);

create table if not exists public.platform_support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null
    references public.platform_support_threads (id) on delete cascade,
  sender_role text not null
    constraint platform_support_messages_role_chk
      check (sender_role in ('complex_admin', 'platform_operator')),
  body text not null,
  tech_context jsonb not null default '{}'::jsonb,
  attachment_url text null,
  attachment_name text null,
  read_by_complex_admin boolean not null default false,
  read_by_platform_operator boolean not null default false,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint platform_support_messages_body_chk check (length(btrim(body)) > 0),
  constraint platform_support_messages_body_len_chk check (char_length(body) <= 8000)
);

create index if not exists platform_support_messages_thread_created_idx
  on public.platform_support_messages (thread_id, created_at);

create index if not exists platform_support_messages_unread_admin_idx
  on public.platform_support_messages (thread_id)
  where sender_role = 'platform_operator' and read_by_complex_admin = false;

create table if not exists public.platform_billing_invoices (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null
    references public.platform_installations (installation_id) on delete cascade,
  invoice_number text not null,
  billing_period_start date null,
  billing_period_end date null,
  issue_date date not null,
  due_date date null,
  amount numeric(12, 2) not null,
  currency text not null default 'EUR',
  status text not null
    constraint platform_billing_invoices_status_chk
      check (status in ('ISSUED', 'PAID', 'OVERDUE', 'CANCELLED')),
  paid_at timestamptz null,
  payment_reference text null,
  document_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_billing_invoices_number_uidx unique (installation_id, invoice_number),
  constraint platform_billing_invoices_amount_chk check (amount >= 0),
  constraint platform_billing_invoices_currency_chk check (length(btrim(currency)) = 3)
);

create index if not exists platform_billing_invoices_install_issue_idx
  on public.platform_billing_invoices (installation_id, issue_date desc);

create table if not exists public.platform_support_audit (
  id bigserial primary key,
  installation_id uuid null,
  action text not null,
  actor_email text null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_support_audit_action_chk check (length(btrim(action)) > 0)
);

create index if not exists platform_support_audit_created_idx
  on public.platform_support_audit (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: deny direct table access; RPCs are the boundary
-- ---------------------------------------------------------------------------

alter table public.platform_installations enable row level security;
alter table public.platform_account_state enable row level security;
alter table public.platform_support_threads enable row level security;
alter table public.platform_support_messages enable row level security;
alter table public.platform_billing_invoices enable row level security;
alter table public.platform_support_audit enable row level security;

revoke all on table public.platform_installations from public, anon, authenticated;
revoke all on table public.platform_account_state from public, anon, authenticated;
revoke all on table public.platform_support_threads from public, anon, authenticated;
revoke all on table public.platform_support_messages from public, anon, authenticated;
revoke all on table public.platform_billing_invoices from public, anon, authenticated;
revoke all on table public.platform_support_audit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Catalog helper retained for introspection; access is role-gated, not toggle-gated.
create or replace function public.platform_support_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.platform_support_module_enabled() from public;
revoke all on function public.platform_support_module_enabled() from anon;
revoke all on function public.platform_support_module_enabled() from authenticated;

create or replace function public.platform_support_assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'platform_support: not authenticated'
      using errcode = '28000';
  end if;
  -- Platform-core: complex administrator only. Not gated by module toggle.
  -- Remains available under SUSPENDED_NONPAYMENT account status.
  if not public.has_staff_role('администрация') then
    raise exception 'platform_support: not allowed'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.platform_support_assert_admin() from public, anon;

-- Prevent disabling platform-core via the normal module toggle RPC.
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

  -- Platform-core modules cannot be disabled (or toggled off) by complex admin.
  if v_key = 'platform_support' and p_enabled is not true then
    raise exception 'set_building_module_enabled: platform_support is platform-core and cannot be disabled'
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

create or replace function public.platform_support_prevent_disable_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if NEW.module_key = 'platform_support' and NEW.enabled is distinct from true then
    raise exception 'platform_support: platform-core cannot be disabled'
      using errcode = '42501';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists platform_support_prevent_disable_biu on public.building_modules;
create trigger platform_support_prevent_disable_biu
  before insert or update of enabled on public.building_modules
  for each row
  execute function public.platform_support_prevent_disable_trg();

create or replace function public.platform_support_audit_write(
  p_installation_id uuid,
  p_action text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.platform_support_audit (installation_id, action, actor_email, detail)
  values (
    p_installation_id,
    btrim(coalesce(p_action, '')),
    nullif(auth.email(), ''),
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.platform_support_audit_write(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.platform_support_sanitize_tech_context(p_ctx jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_blocked text[] := array[
    'service_role', 'service_role_key', 'supabase_service_role',
    'access_token', 'refresh_token', 'password', 'secret', 'secrets',
    'api_key', 'private_key', 'authorization', 'cookie', 'cookies',
    'env', 'process_env', 'database_url', 'connection_string'
  ];
begin
  if p_ctx is null or jsonb_typeof(p_ctx) <> 'object' then
    return '{}'::jsonb;
  end if;

  for v_key, v_val in select * from jsonb_each(p_ctx)
  loop
    if lower(v_key) = any (v_blocked) then
      continue;
    end if;
    if lower(v_key) like '%secret%' or lower(v_key) like '%token%'
       or lower(v_key) like '%password%' or lower(v_key) like '%private%' then
      continue;
    end if;
    if jsonb_typeof(v_val) in ('object', 'array') then
      continue;
    end if;
    if jsonb_typeof(v_val) = 'string' and char_length(v_val #>> '{}') > 500 then
      continue;
    end if;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;

  return v_out;
end;
$fn$;

revoke all on function public.platform_support_sanitize_tech_context(jsonb) from public, anon;
grant execute on function public.platform_support_sanitize_tech_context(jsonb) to authenticated;

create or replace function public.platform_support_ensure_bootstrap(
  p_complex_name text default null,
  p_deployment_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_name text := nullif(btrim(coalesce(p_complex_name, '')), '');
  v_deploy text := nullif(btrim(coalesce(p_deployment_id, '')), '');
begin
  perform public.platform_support_assert_admin();

  select i.installation_id into v_installation_id
  from public.platform_installations as i
  order by i.created_at
  limit 1;

  if v_installation_id is null then
    insert into public.platform_installations (complex_name, deployment_id)
    values (coalesce(v_name, ''), v_deploy)
    returning installation_id into v_installation_id;

    insert into public.platform_account_state (installation_id, status, currency)
    values (v_installation_id, 'ACTIVE', 'EUR');

    insert into public.platform_support_threads (installation_id, subject)
    values (v_installation_id, 'Platform support');
  else
    update public.platform_installations as i
       set complex_name = case
             when coalesce(i.complex_name, '') = '' and v_name is not null then v_name
             else i.complex_name
           end,
           deployment_id = coalesce(v_deploy, i.deployment_id),
           updated_at = now()
     where i.installation_id = v_installation_id;

    insert into public.platform_account_state (installation_id, status, currency)
    select v_installation_id, 'ACTIVE', 'EUR'
    where not exists (
      select 1 from public.platform_account_state as a
      where a.installation_id = v_installation_id
    );

    insert into public.platform_support_threads (installation_id, subject)
    select v_installation_id, 'Platform support'
    where not exists (
      select 1 from public.platform_support_threads as t
      where t.installation_id = v_installation_id
    );
  end if;

  return v_installation_id;
end;
$fn$;

revoke all on function public.platform_support_ensure_bootstrap(text, text) from public, anon;
grant execute on function public.platform_support_ensure_bootstrap(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.platform_support_get_account(
  p_complex_name text default null,
  p_deployment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_row record;
begin
  v_installation_id := public.platform_support_ensure_bootstrap(p_complex_name, p_deployment_id);

  select
    i.installation_id,
    i.complex_name,
    i.deployment_id,
    a.status,
    a.fixed_service_price,
    a.currency,
    a.next_payment_date,
    a.amount_due,
    a.debt_amount,
    a.updated_at
  into v_row
  from public.platform_installations as i
  join public.platform_account_state as a on a.installation_id = i.installation_id
  where i.installation_id = v_installation_id;

  return jsonb_build_object(
    'installation_id', v_row.installation_id,
    'complex_name', v_row.complex_name,
    'deployment_id', v_row.deployment_id,
    'status', v_row.status,
    'fixed_service_price', v_row.fixed_service_price,
    'currency', v_row.currency,
    'next_payment_date', v_row.next_payment_date,
    'amount_due', v_row.amount_due,
    'debt_amount', v_row.debt_amount,
    'updated_at', v_row.updated_at
  );
end;
$fn$;

revoke all on function public.platform_support_get_account(text, text) from public, anon;
grant execute on function public.platform_support_get_account(text, text) to authenticated;

create or replace function public.platform_support_list_invoices(
  p_complex_name text default null,
  p_deployment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_rows jsonb;
begin
  v_installation_id := public.platform_support_ensure_bootstrap(p_complex_name, p_deployment_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', inv.id,
      'invoice_number', inv.invoice_number,
      'billing_period_start', inv.billing_period_start,
      'billing_period_end', inv.billing_period_end,
      'issue_date', inv.issue_date,
      'due_date', inv.due_date,
      'amount', inv.amount,
      'currency', inv.currency,
      'status', inv.status,
      'paid_at', inv.paid_at,
      'payment_reference', inv.payment_reference,
      'document_url', inv.document_url
    )
    order by inv.issue_date desc, inv.invoice_number desc
  ), '[]'::jsonb)
  into v_rows
  from public.platform_billing_invoices as inv
  where inv.installation_id = v_installation_id;

  return v_rows;
end;
$fn$;

revoke all on function public.platform_support_list_invoices(text, text) from public, anon;
grant execute on function public.platform_support_list_invoices(text, text) to authenticated;

create or replace function public.platform_support_get_conversation(
  p_complex_name text default null,
  p_deployment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_thread_id uuid;
  v_subject text;
  v_messages jsonb;
  v_unread int;
begin
  v_installation_id := public.platform_support_ensure_bootstrap(p_complex_name, p_deployment_id);

  select t.id, t.subject into v_thread_id, v_subject
  from public.platform_support_threads as t
  where t.installation_id = v_installation_id
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'thread_id', m.thread_id,
      'sender_role', m.sender_role,
      'body', m.body,
      'tech_context', m.tech_context,
      'attachment_url', m.attachment_url,
      'attachment_name', m.attachment_name,
      'read_by_complex_admin', m.read_by_complex_admin,
      'read_by_platform_operator', m.read_by_platform_operator,
      'created_by_email', m.created_by_email,
      'created_at', m.created_at
    )
    order by m.created_at asc
  ), '[]'::jsonb)
  into v_messages
  from public.platform_support_messages as m
  where m.thread_id = v_thread_id;

  select count(*)::int into v_unread
  from public.platform_support_messages as m
  where m.thread_id = v_thread_id
    and m.sender_role = 'platform_operator'
    and m.read_by_complex_admin = false;

  return jsonb_build_object(
    'thread_id', v_thread_id,
    'installation_id', v_installation_id,
    'subject', v_subject,
    'unread_count', coalesce(v_unread, 0),
    'messages', coalesce(v_messages, '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.platform_support_get_conversation(text, text) from public, anon;
grant execute on function public.platform_support_get_conversation(text, text) to authenticated;

create or replace function public.platform_support_send_message(
  p_body text,
  p_tech_context jsonb default '{}'::jsonb,
  p_complex_name text default null,
  p_deployment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_thread_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_ctx jsonb;
  v_row public.platform_support_messages%rowtype;
begin
  v_installation_id := public.platform_support_ensure_bootstrap(p_complex_name, p_deployment_id);

  if v_body = '' then
    raise exception 'platform_support: empty message'
      using errcode = '23514';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'platform_support: message too long'
      using errcode = '23514';
  end if;

  v_ctx := public.platform_support_sanitize_tech_context(p_tech_context);

  select t.id into v_thread_id
  from public.platform_support_threads as t
  where t.installation_id = v_installation_id
  limit 1;

  insert into public.platform_support_messages (
    thread_id,
    sender_role,
    body,
    tech_context,
    read_by_complex_admin,
    read_by_platform_operator,
    created_by_email
  )
  values (
    v_thread_id,
    'complex_admin',
    v_body,
    v_ctx,
    true,
    false,
    nullif(auth.email(), '')
  )
  returning * into v_row;

  update public.platform_support_threads
     set updated_at = now()
   where id = v_thread_id;

  perform public.platform_support_audit_write(
    v_installation_id,
    'SUPPORT_MESSAGE_QUEUED_LOCAL',
    jsonb_build_object(
      'message_id', v_row.id,
      'thread_id', v_thread_id,
      'sender_role', 'complex_admin',
      'delivery', 'awaiting_master'
    )
  );

  return jsonb_build_object(
    'id', v_row.id,
    'thread_id', v_row.thread_id,
    'sender_role', v_row.sender_role,
    'body', v_row.body,
    'tech_context', v_row.tech_context,
    'attachment_url', v_row.attachment_url,
    'attachment_name', v_row.attachment_name,
    'read_by_complex_admin', v_row.read_by_complex_admin,
    'read_by_platform_operator', v_row.read_by_platform_operator,
    'created_by_email', v_row.created_by_email,
    'created_at', v_row.created_at
  );
end;
$fn$;

revoke all on function public.platform_support_send_message(text, jsonb, text, text) from public, anon;
grant execute on function public.platform_support_send_message(text, jsonb, text, text) to authenticated;

create or replace function public.platform_support_mark_read(
  p_complex_name text default null,
  p_deployment_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_thread_id uuid;
  v_count int;
begin
  v_installation_id := public.platform_support_ensure_bootstrap(p_complex_name, p_deployment_id);

  select t.id into v_thread_id
  from public.platform_support_threads as t
  where t.installation_id = v_installation_id
  limit 1;

  update public.platform_support_messages as m
     set read_by_complex_admin = true
   where m.thread_id = v_thread_id
     and m.sender_role = 'platform_operator'
     and m.read_by_complex_admin = false;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.platform_support_audit_write(
      v_installation_id,
      'SUPPORT_MESSAGES_READ',
      jsonb_build_object('thread_id', v_thread_id, 'count', v_count)
    );
  end if;

  return coalesce(v_count, 0);
end;
$fn$;

revoke all on function public.platform_support_mark_read(text, text) from public, anon;
grant execute on function public.platform_support_mark_read(text, text) to authenticated;

create or replace function public.platform_support_unread_count(
  p_complex_name text default null,
  p_deployment_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_installation_id uuid;
  v_count int;
begin
  v_installation_id := public.platform_support_ensure_bootstrap(p_complex_name, p_deployment_id);

  select count(*)::int into v_count
  from public.platform_support_messages as m
  join public.platform_support_threads as t on t.id = m.thread_id
  where t.installation_id = v_installation_id
    and m.sender_role = 'platform_operator'
    and m.read_by_complex_admin = false;

  return coalesce(v_count, 0);
end;
$fn$;

revoke all on function public.platform_support_unread_count(text, text) from public, anon;
grant execute on function public.platform_support_unread_count(text, text) to authenticated;

commit;
