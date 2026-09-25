-- Tariff Core v1 Package 1: schema + governance RPCs.
-- Does NOT cut over Water/Electricity/Support billing consumers.
-- Does NOT change legacy tariff tables or charge calculations.
-- Financial calendar: Europe/Sofia.

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.tariff_sofia_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Sofia')::date;
$$;

revoke all on function public.tariff_sofia_today() from public;
revoke all on function public.tariff_sofia_today() from anon;
grant execute on function public.tariff_sofia_today() to authenticated;

create or replace function public.tariff_text_array_unique(p_arr text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_arr is not null
    and cardinality(p_arr) >= 1
    and cardinality(p_arr) = (
      select count(distinct btrim(x))
      from unnest(p_arr) as x
      where btrim(coalesce(x, '')) <> ''
    );
$$;

revoke all on function public.tariff_text_array_unique(text[]) from public;
revoke all on function public.tariff_text_array_unique(text[]) from anon;
grant execute on function public.tariff_text_array_unique(text[]) to authenticated;

create or replace function public.tariff_can_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер');
$$;

revoke all on function public.tariff_can_view() from public;
revoke all on function public.tariff_can_view() from anon;
grant execute on function public.tariff_can_view() to authenticated;

create or replace function public.tariff_can_publish(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case btrim(coalesce(p_module_key, ''))
    when 'support_fee' then public.has_staff_role('администрация')
    when 'water' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    when 'electricity' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    else false
  end;
$$;

revoke all on function public.tariff_can_publish(text) from public;
revoke all on function public.tariff_can_publish(text) from anon;
grant execute on function public.tariff_can_publish(text) to authenticated;

-- Package 3 extension point: Support policy / assessment binding.
-- Always false until later migration replaces this body.
create or replace function public.tariff_version_bound_to_support_usage(p_version_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  -- Intentionally empty for Package 1 (no policy FK columns yet).
  -- Package 3 must extend: published/closed policy binding, assessments, financial ops.
  if p_version_id is null then
    return false;
  end if;
  return false;
end;
$fn$;

comment on function public.tariff_version_bound_to_support_usage(uuid) is
  'Package 1 stub. Package 3 extends with Support policy/assessment usage checks.';

revoke all on function public.tariff_version_bound_to_support_usage(uuid) from public;
revoke all on function public.tariff_version_bound_to_support_usage(uuid) from anon;
-- Internal: no grant to authenticated (called from SECURITY DEFINER cancel RPC only).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.tariff_catalog (
  id uuid primary key default gen_random_uuid(),
  tariff_key text not null,
  module_key text not null
    references public.module_catalog (module_key)
    on delete restrict,
  default_name text not null,
  unit_code text not null
    constraint tariff_catalog_unit_code_check
      check (unit_code in ('m2', 'm3', 'kwh', 'item')),
  currency text not null default 'EUR'
    constraint tariff_catalog_currency_check check (currency = 'EUR'),
  calculation_type text not null
    constraint tariff_catalog_calculation_type_check
      check (calculation_type in ('per_unit', 'fixed')),
  billing_period text null
    constraint tariff_catalog_billing_period_check
      check (billing_period is null or billing_period in ('month', 'year')),
  application_basis text not null
    constraint tariff_catalog_application_basis_check
      check (application_basis in ('calendar_date', 'billing_year')),
  governance_type text not null
    constraint tariff_catalog_governance_type_check
      check (governance_type in ('internal_decision', 'external_supplier')),
  component_keys text[] not null
    constraint tariff_catalog_component_keys_check
      check (public.tariff_text_array_unique(component_keys)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null,
  constraint tariff_catalog_tariff_key_key unique (tariff_key)
);

comment on table public.tariff_catalog is
  'Tariff Core catalog. Definitions only — not a billing engine.';

create index if not exists tariff_catalog_module_key_idx
  on public.tariff_catalog (module_key);

create table if not exists public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null
    references public.tariff_catalog (id)
    on delete restrict,
  valid_from date not null,
  status text not null
    constraint tariff_versions_status_check
      check (status in ('published', 'cancelled')),
  basis_type text not null
    constraint tariff_versions_basis_type_check
      check (basis_type in (
        'general_meeting',
        'external_decision',
        'supplier_notice',
        'invoice',
        'other',
        'legacy_import'
      )),
  basis_reference text null,
  basis_date date null,
  basis_note text not null
    constraint tariff_versions_basis_note_nonempty
      check (length(btrim(basis_note)) > 0),
  decision_id uuid null
    references public.general_meeting_decisions (id)
    on delete restrict,
  published_at timestamptz not null default now(),
  published_by uuid null,
  legacy_author text null,
  idempotency_key uuid not null,
  payload_fingerprint text not null,
  cancelled_at timestamptz null,
  cancelled_by uuid null,
  cancellation_reason text null,
  cancellation_idempotency_key uuid null,
  constraint tariff_versions_idempotency_key_key unique (idempotency_key),
  constraint tariff_versions_cancellation_idempotency_key_key unique (cancellation_idempotency_key),
  constraint tariff_versions_published_no_cancel_fields check (
    status <> 'published'
    or (
      cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null
      and cancellation_idempotency_key is null
    )
  ),
  constraint tariff_versions_cancelled_fields check (
    status <> 'cancelled'
    or (
      cancelled_at is not null
      and cancelled_by is not null
      and cancellation_reason is not null
      and length(btrim(cancellation_reason)) > 0
      and cancellation_idempotency_key is not null
    )
  )
);

comment on table public.tariff_versions is
  'Published/cancelled tariff versions. valid_from = financial application date; published_at = platform visibility.';

create unique index if not exists tariff_versions_one_published_per_valid_from_uidx
  on public.tariff_versions (tariff_id, valid_from)
  where status = 'published';

create index if not exists tariff_versions_history_idx
  on public.tariff_versions (tariff_id, valid_from desc, id desc);

create index if not exists tariff_versions_decision_id_idx
  on public.tariff_versions (decision_id);

create table if not exists public.tariff_rate_items (
  version_id uuid not null
    references public.tariff_versions (id)
    on delete restrict,
  component_key text not null,
  rate numeric(12, 4) not null
    constraint tariff_rate_items_rate_nonneg check (rate >= 0),
  primary key (version_id, component_key)
);

comment on table public.tariff_rate_items is
  'Atomic rate components per tariff version. Exact set must match catalog.component_keys.';

-- Legacy → Core mapping (backfill / future cutover). No dual-write in Package 1.
create table if not exists public.tariff_legacy_links (
  id uuid primary key default gen_random_uuid(),
  tariff_key text not null
    references public.tariff_catalog (tariff_key)
    on delete restrict,
  legacy_source text not null
    constraint tariff_legacy_links_source_check
      check (legacy_source in ('water_tariffs', 'electricity_tariffs', 'building_settings')),
  legacy_row_id uuid null,
  legacy_key text null,
  version_id uuid null
    references public.tariff_versions (id)
    on delete restrict,
  note text null,
  created_at timestamptz not null default now(),
  constraint tariff_legacy_links_row_or_key check (
    (legacy_row_id is not null and legacy_key is null)
    or (legacy_row_id is null and legacy_key is not null)
  )
);

create unique index if not exists tariff_legacy_links_row_uidx
  on public.tariff_legacy_links (legacy_source, legacy_row_id)
  where legacy_row_id is not null;

create unique index if not exists tariff_legacy_links_key_uidx
  on public.tariff_legacy_links (legacy_source, legacy_key)
  where legacy_key is not null;

create unique index if not exists tariff_legacy_links_version_uidx
  on public.tariff_legacy_links (version_id)
  where version_id is not null;

-- RLS: no direct client mutation
alter table public.tariff_catalog enable row level security;
alter table public.tariff_versions enable row level security;
alter table public.tariff_rate_items enable row level security;
alter table public.tariff_legacy_links enable row level security;

revoke all on table public.tariff_catalog from public, anon, authenticated;
revoke all on table public.tariff_versions from public, anon, authenticated;
revoke all on table public.tariff_rate_items from public, anon, authenticated;
revoke all on table public.tariff_legacy_links from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Immutability triggers
-- ---------------------------------------------------------------------------

create or replace function public.tariff_versions_immutability_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'tariff_versions: delete not allowed' using errcode = '42501';
  end if;

  if old.status = 'cancelled' then
    raise exception 'tariff_versions: cancelled rows are immutable' using errcode = '42501';
  end if;

  if old.status = 'published' and new.status = 'published' then
    if new.tariff_id is distinct from old.tariff_id
       or new.valid_from is distinct from old.valid_from
       or new.basis_type is distinct from old.basis_type
       or new.basis_reference is distinct from old.basis_reference
       or new.basis_date is distinct from old.basis_date
       or new.basis_note is distinct from old.basis_note
       or new.decision_id is distinct from old.decision_id
       or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by
       or new.legacy_author is distinct from old.legacy_author
       or new.idempotency_key is distinct from old.idempotency_key
       or new.payload_fingerprint is distinct from old.payload_fingerprint
       or new.cancelled_at is distinct from old.cancelled_at
       or new.cancelled_by is distinct from old.cancelled_by
       or new.cancellation_reason is distinct from old.cancellation_reason
       or new.cancellation_idempotency_key is distinct from old.cancellation_idempotency_key
       or new.status is distinct from old.status
    then
      raise exception 'tariff_versions: published metadata is immutable' using errcode = '42501';
    end if;
  end if;

  if old.status = 'published' and new.status = 'cancelled' then
    -- Only cancellation fields may change; all other columns must match OLD.
    if new.tariff_id is distinct from old.tariff_id
       or new.valid_from is distinct from old.valid_from
       or new.basis_type is distinct from old.basis_type
       or new.basis_reference is distinct from old.basis_reference
       or new.basis_date is distinct from old.basis_date
       or new.basis_note is distinct from old.basis_note
       or new.decision_id is distinct from old.decision_id
       or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by
       or new.legacy_author is distinct from old.legacy_author
       or new.idempotency_key is distinct from old.idempotency_key
       or new.payload_fingerprint is distinct from old.payload_fingerprint
    then
      raise exception 'tariff_versions: cancellation may not alter immutable fields'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status is distinct from new.status
     and not (old.status = 'published' and new.status = 'cancelled') then
    raise exception 'tariff_versions: invalid status transition' using errcode = '22023';
  end if;

  return new;
end;
$fn$;

drop trigger if exists tariff_versions_immutability on public.tariff_versions;
create trigger tariff_versions_immutability
  before update or delete on public.tariff_versions
  for each row execute function public.tariff_versions_immutability_trg();

create or replace function public.tariff_rate_items_immutability_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  select tv.status into v_status
  from public.tariff_versions as tv
  where tv.id = coalesce(new.version_id, old.version_id);

  if v_status is not null then
    raise exception 'tariff_rate_items: rates are immutable after version insert'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$fn$;

-- Rate items may only be inserted once with the version (atomic publish).
-- Block UPDATE/DELETE always; INSERT allowed only when version exists and is being created in same txn.
-- Simpler: block UPDATE/DELETE always.
create or replace function public.tariff_rate_items_immutability_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'tariff_rate_items: update/delete not allowed' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists tariff_rate_items_immutability on public.tariff_rate_items;
create trigger tariff_rate_items_immutability
  before update or delete on public.tariff_rate_items
  for each row execute function public.tariff_rate_items_immutability_trg();

-- Support valid_from must be Jan 1
create or replace function public.tariff_versions_support_jan1_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_basis text;
  v_module text;
begin
  select c.application_basis, c.module_key
    into v_basis, v_module
  from public.tariff_catalog as c
  where c.id = new.tariff_id;

  if v_basis = 'billing_year' or v_module = 'support_fee' then
    if extract(month from new.valid_from)::int <> 1
       or extract(day from new.valid_from)::int <> 1 then
      raise exception 'tariff_versions: Support valid_from must be January 1'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists tariff_versions_support_jan1 on public.tariff_versions;
create trigger tariff_versions_support_jan1
  before insert or update on public.tariff_versions
  for each row execute function public.tariff_versions_support_jan1_trg();

-- Catalog semantic lock once any version exists
create or replace function public.tariff_catalog_lock_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'tariff_catalog: delete not allowed' using errcode = '42501';
  end if;

  if exists (select 1 from public.tariff_versions as tv where tv.tariff_id = old.id) then
    if new.tariff_key is distinct from old.tariff_key
       or new.module_key is distinct from old.module_key
       or new.unit_code is distinct from old.unit_code
       or new.currency is distinct from old.currency
       or new.calculation_type is distinct from old.calculation_type
       or new.billing_period is distinct from old.billing_period
       or new.application_basis is distinct from old.application_basis
       or new.governance_type is distinct from old.governance_type
       or new.component_keys is distinct from old.component_keys
    then
      raise exception 'tariff_catalog: semantic metadata locked after first version'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists tariff_catalog_lock on public.tariff_catalog;
create trigger tariff_catalog_lock
  before update or delete on public.tariff_catalog
  for each row execute function public.tariff_catalog_lock_trg();

-- ---------------------------------------------------------------------------
-- Seed catalog
-- ---------------------------------------------------------------------------

insert into public.tariff_catalog (
  tariff_key, module_key, default_name, unit_code, currency,
  calculation_type, billing_period, application_basis, governance_type, component_keys, active
) values
  (
    'support_fee', 'support_fee', 'Такса поддержки', 'm2', 'EUR',
    'per_unit', 'year', 'billing_year', 'internal_decision', array['base']::text[], true
  ),
  (
    'water', 'water', 'Вода', 'm3', 'EUR',
    'per_unit', null, 'calendar_date', 'external_supplier', array['base']::text[], true
  ),
  (
    'electricity', 'electricity', 'Электроэнергия', 'kwh', 'EUR',
    'per_unit', null, 'calendar_date', 'external_supplier', array['day','night']::text[], true
  )
on conflict (tariff_key) do nothing;

-- ---------------------------------------------------------------------------
-- Internal resolvers (not granted to clients)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_tariff_version_by_date(
  p_tariff_id uuid,
  p_on_date date
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_tariff_id is null or p_on_date is null then
    raise exception 'resolve_tariff_version_by_date: arguments required' using errcode = '22023';
  end if;

  select tv.id into v_id
  from public.tariff_versions as tv
  where tv.tariff_id = p_tariff_id
    and tv.status = 'published'
    and tv.valid_from <= p_on_date
  order by tv.valid_from desc, tv.id desc
  limit 1;

  if v_id is null then
    raise exception 'resolve_tariff_version_by_date: no matching version'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.resolve_tariff_version_by_date(uuid, date) from public;
revoke all on function public.resolve_tariff_version_by_date(uuid, date) from anon;
revoke all on function public.resolve_tariff_version_by_date(uuid, date) from authenticated;

create or replace function public.resolve_support_tariff_version_by_year(
  p_tariff_id uuid,
  p_billing_year integer
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_from date;
begin
  if p_tariff_id is null or p_billing_year is null then
    raise exception 'resolve_support_tariff_version_by_year: arguments required'
      using errcode = '22023';
  end if;
  if p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_support_tariff_version_by_year: invalid year' using errcode = '22023';
  end if;
  v_from := make_date(p_billing_year, 1, 1);
  return public.resolve_tariff_version_by_date(p_tariff_id, v_from);
end;
$fn$;

revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from public;
revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from anon;
revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from authenticated;

create or replace function public.tariff_rates_json(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(ri.component_key, ri.rate order by ri.component_key),
    '{}'::jsonb
  )
  from public.tariff_rate_items as ri
  where ri.version_id = p_version_id;
$$;

revoke all on function public.tariff_rates_json(uuid) from public;
revoke all on function public.tariff_rates_json(uuid) from anon;
revoke all on function public.tariff_rates_json(uuid) from authenticated;
-- Internal helper only: called from SECURITY DEFINER list/publish RPCs.

-- ---------------------------------------------------------------------------
-- list_tariffs
-- ---------------------------------------------------------------------------

create or replace function public.list_tariffs(
  p_module_key text default null,
  p_active_only boolean default true,
  p_limit integer default 50
)
returns table (
  tariff_id uuid,
  tariff_key text,
  module_key text,
  default_name text,
  unit_code text,
  currency text,
  calculation_type text,
  billing_period text,
  application_basis text,
  governance_type text,
  component_keys text[],
  active boolean,
  current_version_id uuid,
  current_valid_from date,
  current_rates jsonb,
  current_basis_type text,
  current_basis_note text,
  current_basis_date date,
  current_published_at timestamptz,
  current_legacy_author text,
  nearest_future_version_id uuid,
  nearest_future_valid_from date,
  nearest_future_rates jsonb,
  nearest_future_basis_type text,
  nearest_future_basis_note text,
  nearest_future_basis_date date,
  nearest_future_published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_today date := public.tariff_sofia_today();
  v_year_start date := make_date(extract(year from public.tariff_sofia_today())::int, 1, 1);
begin
  if auth.uid() is null then
    raise exception 'list_tariffs: not authenticated' using errcode = '28000';
  end if;
  if not public.tariff_can_view() then
    raise exception 'list_tariffs: not allowed' using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  return query
  select
    c.id,
    c.tariff_key,
    c.module_key,
    c.default_name,
    c.unit_code,
    c.currency,
    c.calculation_type,
    c.billing_period,
    c.application_basis,
    c.governance_type,
    c.component_keys,
    c.active,
    cur.id,
    cur.valid_from,
    case when cur.id is null then null else public.tariff_rates_json(cur.id) end,
    cur.basis_type,
    cur.basis_note,
    cur.basis_date,
    cur.published_at,
    cur.legacy_author,
    fut.id,
    fut.valid_from,
    case when fut.id is null then null else public.tariff_rates_json(fut.id) end,
    fut.basis_type,
    fut.basis_note,
    fut.basis_date,
    fut.published_at
  from public.tariff_catalog as c
  left join lateral (
    select tv.*
    from public.tariff_versions as tv
    where tv.tariff_id = c.id
      and tv.status = 'published'
      and tv.valid_from <= case
        when c.application_basis = 'billing_year' then v_year_start
        else v_today
      end
    order by tv.valid_from desc, tv.id desc
    limit 1
  ) as cur on true
  left join lateral (
    select tv.*
    from public.tariff_versions as tv
    where tv.tariff_id = c.id
      and tv.status = 'published'
      and tv.valid_from > case
        when c.application_basis = 'billing_year' then v_year_start
        else v_today
      end
    order by tv.valid_from asc, tv.id asc
    limit 1
  ) as fut on true
  where (p_module_key is null or c.module_key = btrim(p_module_key))
    and (not coalesce(p_active_only, true) or c.active is true)
  order by c.module_key, c.tariff_key
  limit v_limit;
end;
$fn$;

revoke all on function public.list_tariffs(text, boolean, integer) from public;
revoke execute on function public.list_tariffs(text, boolean, integer) from anon;
grant execute on function public.list_tariffs(text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- list_tariff_history
-- ---------------------------------------------------------------------------

create or replace function public.list_tariff_history(
  p_tariff_id uuid,
  p_status text default null,
  p_valid_from_from date default null,
  p_valid_from_to date default null,
  p_cursor_valid_from date default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns table (
  version_id uuid,
  tariff_id uuid,
  valid_from date,
  status text,
  rates jsonb,
  basis_type text,
  basis_reference text,
  basis_date date,
  basis_note text,
  decision_id uuid,
  published_at timestamptz,
  published_by uuid,
  legacy_author text,
  cancelled_at timestamptz,
  cancellation_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'list_tariff_history: not authenticated' using errcode = '28000';
  end if;
  if not public.tariff_can_view() then
    raise exception 'list_tariff_history: not allowed' using errcode = '42501';
  end if;
  if p_tariff_id is null then
    raise exception 'list_tariff_history: tariff required' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  return query
  select
    tv.id,
    tv.tariff_id,
    tv.valid_from,
    tv.status,
    public.tariff_rates_json(tv.id),
    tv.basis_type,
    tv.basis_reference,
    tv.basis_date,
    tv.basis_note,
    tv.decision_id,
    tv.published_at,
    tv.published_by,
    tv.legacy_author,
    tv.cancelled_at,
    tv.cancellation_reason
  from public.tariff_versions as tv
  where tv.tariff_id = p_tariff_id
    and (p_status is null or tv.status = btrim(p_status))
    and (p_valid_from_from is null or tv.valid_from >= p_valid_from_from)
    and (p_valid_from_to is null or tv.valid_from <= p_valid_from_to)
    and (
      p_cursor_valid_from is null
      or p_cursor_id is null
      or (tv.valid_from, tv.id) < (p_cursor_valid_from, p_cursor_id)
    )
  order by tv.valid_from desc, tv.id desc
  limit v_limit;
end;
$fn$;

revoke all on function public.list_tariff_history(uuid, text, date, date, date, uuid, integer) from public;
revoke execute on function public.list_tariff_history(uuid, text, date, date, date, uuid, integer) from anon;
grant execute on function public.list_tariff_history(uuid, text, date, date, date, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- publish_tariff_version (atomic)
-- ---------------------------------------------------------------------------

create or replace function public.publish_tariff_version(
  p_tariff_id uuid,
  p_rates jsonb,
  p_basis_type text,
  p_basis_note text,
  p_idempotency_key uuid,
  p_application_year integer default null,
  p_valid_from date default null,
  p_basis_reference text default null,
  p_basis_date date default null,
  p_decision_id uuid default null
)
returns table (
  version_id uuid,
  tariff_id uuid,
  valid_from date,
  status text,
  rates jsonb,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cat public.tariff_catalog;
  v_today date := public.tariff_sofia_today();
  v_valid_from date;
  v_basis_type text;
  v_note text;
  v_fingerprint text;
  v_existing public.tariff_versions;
  v_version_id uuid;
  v_key text;
  v_rate numeric;
  v_keys text[];
  v_module_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'publish_tariff_version: not authenticated' using errcode = '28000';
  end if;
  if p_tariff_id is null or p_idempotency_key is null then
    raise exception 'publish_tariff_version: tariff and idempotency key required'
      using errcode = '22023';
  end if;

  select c.* into v_cat from public.tariff_catalog as c where c.id = p_tariff_id for update;
  if not found then
    raise exception 'publish_tariff_version: tariff not found' using errcode = 'P0002';
  end if;
  if v_cat.active is not true then
    raise exception 'publish_tariff_version: tariff inactive' using errcode = '22023';
  end if;

  if not public.tariff_can_publish(v_cat.module_key) then
    raise exception 'publish_tariff_version: not allowed' using errcode = '42501';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = v_cat.module_key;
  if v_module_enabled is not true then
    raise exception 'publish_tariff_version: module disabled' using errcode = '42501';
  end if;

  v_basis_type := btrim(coalesce(p_basis_type, ''));
  v_note := btrim(coalesce(p_basis_note, ''));
  if v_note = '' then
    raise exception 'publish_tariff_version: basis_note required' using errcode = '22023';
  end if;

  -- Application date / year
  if v_cat.application_basis = 'billing_year' then
    if p_application_year is null then
      raise exception 'publish_tariff_version: application year required' using errcode = '22023';
    end if;
    if p_application_year < extract(year from v_today)::int + 1 then
      raise exception 'publish_tariff_version: Support application year must be next year or later'
        using errcode = '22023';
    end if;
    v_valid_from := make_date(p_application_year, 1, 1);
    if v_basis_type not in ('general_meeting', 'external_decision') then
      raise exception 'publish_tariff_version: invalid Support basis_type' using errcode = '22023';
    end if;
    if v_basis_type = 'general_meeting' and p_decision_id is null then
      raise exception 'publish_tariff_version: decision_id required for general_meeting'
        using errcode = '22023';
    end if;
    if v_basis_type = 'external_decision'
       and nullif(btrim(coalesce(p_basis_reference, '')), '') is null then
      raise exception 'publish_tariff_version: basis_reference required for external_decision'
        using errcode = '22023';
    end if;
    if p_basis_date is null then
      raise exception 'publish_tariff_version: basis_date required for Support' using errcode = '22023';
    end if;
  else
    if p_valid_from is null then
      raise exception 'publish_tariff_version: valid_from required' using errcode = '22023';
    end if;
    if p_valid_from < v_today then
      raise exception 'publish_tariff_version: past valid_from not allowed' using errcode = '22023';
    end if;
    v_valid_from := p_valid_from;
    if v_basis_type not in ('supplier_notice', 'invoice', 'other') then
      raise exception 'publish_tariff_version: invalid utility basis_type' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_basis_reference, '')), '') is null then
      raise exception 'publish_tariff_version: basis_reference required' using errcode = '22023';
    end if;
  end if;

  -- Exact component set
  if p_rates is null or jsonb_typeof(p_rates) <> 'object' then
    raise exception 'publish_tariff_version: rates object required' using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_keys
  from jsonb_object_keys(p_rates) as k;

  if v_keys is distinct from (
    select array_agg(x order by x) from unnest(v_cat.component_keys) as x
  ) then
    raise exception 'publish_tariff_version: component keys must match catalog exactly'
      using errcode = '22023';
  end if;

  foreach v_key in array v_cat.component_keys loop
    begin
      v_rate := (p_rates ->> v_key)::numeric;
    exception when others then
      raise exception 'publish_tariff_version: invalid rate for %', v_key using errcode = '22023';
    end;
    if v_rate is null or v_rate < 0 then
      raise exception 'publish_tariff_version: rate must be >= 0' using errcode = '22023';
    end if;
    if v_cat.module_key = 'support_fee' and v_rate <= 0 then
      raise exception 'publish_tariff_version: Support rate must be > 0' using errcode = '22023';
    end if;
  end loop;

  v_fingerprint := md5(
    v_cat.id::text || '|' ||
    v_valid_from::text || '|' ||
    v_basis_type || '|' ||
    coalesce(p_basis_reference, '') || '|' ||
    coalesce(p_basis_date::text, '') || '|' ||
    v_note || '|' ||
    coalesce(p_decision_id::text, '') || '|' ||
    p_rates::text
  );

  select tv.* into v_existing
  from public.tariff_versions as tv
  where tv.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.payload_fingerprint is distinct from v_fingerprint then
      raise exception 'publish_tariff_version: idempotency key conflict' using errcode = '23505';
    end if;
    return query
    select
      v_existing.id,
      v_existing.tariff_id,
      v_existing.valid_from,
      v_existing.status,
      public.tariff_rates_json(v_existing.id),
      v_existing.published_at;
    return;
  end if;

  if exists (
    select 1 from public.tariff_versions as tv
    where tv.tariff_id = v_cat.id
      and tv.valid_from = v_valid_from
      and tv.status = 'published'
  ) then
    raise exception 'publish_tariff_version: published version already exists for date'
      using errcode = '23505';
  end if;

  if p_decision_id is not null
     and not exists (
       select 1 from public.general_meeting_decisions as d where d.id = p_decision_id
     ) then
    raise exception 'publish_tariff_version: decision not found' using errcode = 'P0002';
  end if;

  insert into public.tariff_versions (
    tariff_id, valid_from, status, basis_type, basis_reference, basis_date, basis_note,
    decision_id, published_at, published_by, idempotency_key, payload_fingerprint
  ) values (
    v_cat.id, v_valid_from, 'published', v_basis_type,
    nullif(btrim(coalesce(p_basis_reference, '')), ''),
    p_basis_date, v_note, p_decision_id, now(), auth.uid(),
    p_idempotency_key, v_fingerprint
  )
  returning id into v_version_id;

  insert into public.tariff_rate_items (version_id, component_key, rate)
  select v_version_id, k, (p_rates ->> k)::numeric
  from unnest(v_cat.component_keys) as k;

  -- Does not create assessments or ledger entries.
  return query
  select
    v_version_id,
    v_cat.id,
    v_valid_from,
    'published'::text,
    public.tariff_rates_json(v_version_id),
    now();
exception
  when unique_violation then
    raise exception 'publish_tariff_version: conflict' using errcode = '23505';
end;
$fn$;

revoke all on function public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid) from public;
revoke execute on function public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid) from anon;
grant execute on function public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_future_tariff_version
-- Package 1: Support future years fully enforced.
-- Water/Electricity: gated until adapter cutover (Package 2) to avoid Core vs legacy drift.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_future_tariff_version(
  p_version_id uuid,
  p_reason text,
  p_cancellation_idempotency_key uuid
)
returns table (
  version_id uuid,
  status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tv public.tariff_versions;
  v_cat public.tariff_catalog;
  v_today date := public.tariff_sofia_today();
  v_reason text;
  v_existing public.tariff_versions;
begin
  if auth.uid() is null then
    raise exception 'cancel_future_tariff_version: not authenticated' using errcode = '28000';
  end if;
  if p_version_id is null or p_cancellation_idempotency_key is null then
    raise exception 'cancel_future_tariff_version: version and idempotency key required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'cancel_future_tariff_version: reason required' using errcode = '22023';
  end if;

  select tv.* into v_existing
  from public.tariff_versions as tv
  where tv.cancellation_idempotency_key = p_cancellation_idempotency_key;
  if found then
    if v_existing.id is distinct from p_version_id
       or btrim(coalesce(v_existing.cancellation_reason, '')) is distinct from v_reason then
      raise exception 'cancel_future_tariff_version: idempotency key conflict' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.cancelled_at;
    return;
  end if;

  select tv.* into v_tv from public.tariff_versions as tv where tv.id = p_version_id for update;
  if not found then
    raise exception 'cancel_future_tariff_version: not found' using errcode = 'P0002';
  end if;

  select c.* into v_cat from public.tariff_catalog as c where c.id = v_tv.tariff_id;

  if not public.tariff_can_publish(v_cat.module_key) then
    raise exception 'cancel_future_tariff_version: not allowed' using errcode = '42501';
  end if;

  -- Package 1 gate: utility cancellation deferred until Package 2 adapter cutover.
  if v_cat.module_key in ('water', 'electricity') then
    raise exception 'cancel_future_tariff_version: utility cancellation deferred until tariff adapter cutover'
      using errcode = '42501';
  end if;

  if v_tv.status = 'cancelled' then
    return query select v_tv.id, v_tv.status, v_tv.cancelled_at;
    return;
  end if;

  if v_tv.status <> 'published' then
    raise exception 'cancel_future_tariff_version: only published versions' using errcode = '22023';
  end if;

  -- Support: application year must not have started (valid_from > Sofia today).
  if v_tv.valid_from <= v_today then
    raise exception 'cancel_future_tariff_version: effective or past versions cannot be cancelled'
      using errcode = '22023';
  end if;

  if public.tariff_version_bound_to_support_usage(v_tv.id) then
    raise exception 'cancel_future_tariff_version: version bound to Support usage'
      using errcode = '42501';
  end if;

  update public.tariff_versions as tv
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancellation_reason = v_reason,
         cancellation_idempotency_key = p_cancellation_idempotency_key
   where tv.id = v_tv.id;

  return query
  select tv.id, tv.status, tv.cancelled_at
  from public.tariff_versions as tv
  where tv.id = v_tv.id;
end;
$fn$;

revoke all on function public.cancel_future_tariff_version(uuid, text, uuid) from public;
revoke execute on function public.cancel_future_tariff_version(uuid, text, uuid) from anon;
grant execute on function public.cancel_future_tariff_version(uuid, text, uuid) to authenticated;

commit;
