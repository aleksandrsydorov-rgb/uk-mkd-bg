-- =============================================================================
-- INV-1 — Inventory foundation (assets, stock, categories, collaborative sessions)
-- =============================================================================
-- Additive only. Does NOT modify historical migrations.
-- Does NOT post to Support Fee / Capital Repair / Internet / uk_expenses.
-- Does NOT auto-activate module. Empty inventory is valid.
-- Movement/session operational RPCs: INV-2+. Schema + auth helpers + RLS here.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Catalog / building module shell (keep implemented=false until INV-7)
-- ---------------------------------------------------------------------------

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('inventory', 'Инвентарь', 'services', false, 60)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      -- Do not force implemented=true here.
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'inventory', false, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'inventory'
);

-- ---------------------------------------------------------------------------
-- 1. Staff inventory capabilities (granular; admin bypasses via role helpers)
-- ---------------------------------------------------------------------------

create table if not exists public.staff_inventory_capabilities (
  staff_id bigint primary key references public.staff (id) on delete cascade,
  can_view boolean not null default false,
  can_edit_assets boolean not null default false,
  can_manage_categories boolean not null default false,
  can_stock_move boolean not null default false,
  can_session_participate boolean not null default false,
  can_session_review boolean not null default false,
  can_approve_sessions boolean not null default false,
  can_write_off boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_email text null
);

comment on table public.staff_inventory_capabilities is
  'INV-1: per-staff inventory grants. Administration role bypasses via helpers.';

alter table public.staff_inventory_capabilities enable row level security;
revoke all on table public.staff_inventory_capabilities from public, anon, authenticated;
grant select on table public.staff_inventory_capabilities to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Auth helpers
-- ---------------------------------------------------------------------------

create or replace function public.inventory_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bm.enabled from public.building_modules as bm where bm.module_key = 'inventory'),
    false
  );
$$;

revoke all on function public.inventory_module_enabled() from public;
revoke execute on function public.inventory_module_enabled() from anon;
grant execute on function public.inventory_module_enabled() to authenticated;

create or replace function public.inventory_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_staff_role('администрация');
$$;

revoke all on function public.inventory_is_admin() from public;
revoke execute on function public.inventory_is_admin() from anon;
grant execute on function public.inventory_is_admin() to authenticated;

create or replace function public.inventory_current_staff_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff as s
  where lower(btrim(s.email)) = lower(btrim(auth.email()))
    and s.active is true
  order by s.id
  limit 1;
$$;

revoke all on function public.inventory_current_staff_id() from public;
revoke execute on function public.inventory_current_staff_id() from anon;
grant execute on function public.inventory_current_staff_id() to authenticated;

create or replace function public.inventory_staff_cap(p_cap text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sid bigint;
  v_row public.staff_inventory_capabilities%rowtype;
begin
  if public.inventory_is_admin() then
    return true;
  end if;
  v_sid := public.inventory_current_staff_id();
  if v_sid is null then
    return false;
  end if;
  select * into v_row from public.staff_inventory_capabilities as c where c.staff_id = v_sid;
  if not found then
    return false;
  end if;
  return case p_cap
    when 'view' then v_row.can_view or v_row.can_edit_assets or v_row.can_session_participate
      or v_row.can_session_review or v_row.can_stock_move or v_row.can_write_off
      or v_row.can_manage_categories or v_row.can_approve_sessions
    when 'edit_assets' then v_row.can_edit_assets
    when 'manage_categories' then v_row.can_manage_categories
    when 'stock_move' then v_row.can_stock_move
    when 'session_participate' then v_row.can_session_participate
    when 'session_review' then v_row.can_session_review
    when 'approve_sessions' then v_row.can_approve_sessions
    when 'write_off' then v_row.can_write_off
    else false
  end;
end;
$fn$;

revoke all on function public.inventory_staff_cap(text) from public;
revoke execute on function public.inventory_staff_cap(text) from anon;
grant execute on function public.inventory_staff_cap(text) to authenticated;

create or replace function public.can_view_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('view');
$$;

create or replace function public.can_edit_inventory_assets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('edit_assets');
$$;

create or replace function public.can_manage_inventory_categories()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('manage_categories');
$$;

create or replace function public.can_register_inventory_stock_moves()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('stock_move');
$$;

create or replace function public.can_participate_inventory_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('session_participate');
$$;

create or replace function public.can_review_inventory_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('session_review');
$$;

create or replace function public.can_approve_inventory_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('approve_sessions');
$$;

create or replace function public.can_write_off_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.inventory_is_admin() or public.inventory_staff_cap('write_off');
$$;

revoke all on function public.can_view_inventory() from public;
revoke all on function public.can_edit_inventory_assets() from public;
revoke all on function public.can_manage_inventory_categories() from public;
revoke all on function public.can_register_inventory_stock_moves() from public;
revoke all on function public.can_participate_inventory_session() from public;
revoke all on function public.can_review_inventory_session() from public;
revoke all on function public.can_approve_inventory_session() from public;
revoke all on function public.can_write_off_inventory() from public;

revoke execute on function public.can_view_inventory() from anon;
revoke execute on function public.can_edit_inventory_assets() from anon;
revoke execute on function public.can_manage_inventory_categories() from anon;
revoke execute on function public.can_register_inventory_stock_moves() from anon;
revoke execute on function public.can_participate_inventory_session() from anon;
revoke execute on function public.can_review_inventory_session() from anon;
revoke execute on function public.can_approve_inventory_session() from anon;
revoke execute on function public.can_write_off_inventory() from anon;

grant execute on function public.can_view_inventory() to authenticated;
grant execute on function public.can_edit_inventory_assets() to authenticated;
grant execute on function public.can_manage_inventory_categories() to authenticated;
grant execute on function public.can_register_inventory_stock_moves() to authenticated;
grant execute on function public.can_participate_inventory_session() to authenticated;
grant execute on function public.can_review_inventory_session() to authenticated;
grant execute on function public.can_approve_inventory_session() to authenticated;
grant execute on function public.can_write_off_inventory() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Categories (hierarchical, localized, cycle-safe)
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid null references public.inventory_categories (id) on delete restrict,
  code text not null,
  name_bg text not null,
  name_ru text not null,
  name_en text not null,
  description text null,
  sort_order integer not null default 0,
  active boolean not null default true,
  archived_at timestamptz null,
  allowed_tracking_type text null
    constraint inventory_categories_tracking_type_chk
      check (
        allowed_tracking_type is null
        or allowed_tracking_type in ('INDIVIDUAL_ASSET', 'QUANTITY_STOCK', 'BOTH')
      ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_categories_code_uidx unique (code),
  constraint inventory_categories_code_nonempty check (length(btrim(code)) > 0),
  constraint inventory_categories_names_nonempty check (
    length(btrim(name_bg)) > 0
    and length(btrim(name_ru)) > 0
    and length(btrim(name_en)) > 0
  ),
  constraint inventory_categories_parent_not_self check (parent_id is distinct from id)
);

create index if not exists inventory_categories_parent_idx
  on public.inventory_categories (parent_id);
create index if not exists inventory_categories_active_sort_idx
  on public.inventory_categories (active, sort_order, code);

comment on table public.inventory_categories is
  'INV-1: hierarchical inventory categories (BG/RU/EN). No asset rows.';

create or replace function public.inventory_category_prevent_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_walk uuid;
  v_guard int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'inventory_categories: parent cannot be self' using errcode = '23514';
  end if;
  v_walk := new.parent_id;
  while v_walk is not null loop
    v_guard := v_guard + 1;
    if v_guard > 64 then
      raise exception 'inventory_categories: hierarchy too deep or cycle' using errcode = '23514';
    end if;
    if v_walk = new.id then
      raise exception 'inventory_categories: cycle detected' using errcode = '23514';
    end if;
    select c.parent_id into v_walk
    from public.inventory_categories as c
    where c.id = v_walk;
  end loop;
  return new;
end;
$fn$;

drop trigger if exists inventory_categories_prevent_cycle on public.inventory_categories;
create trigger inventory_categories_prevent_cycle
  before insert or update of parent_id, id on public.inventory_categories
  for each row execute function public.inventory_category_prevent_cycle();

create or replace function public.inventory_category_block_delete_if_referenced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.inventory_categories as c where c.parent_id = old.id) then
    raise exception 'inventory_categories: has child categories — archive instead of delete'
      using errcode = '23503';
  end if;
  if to_regclass('public.inventory_assets') is not null
     and exists (select 1 from public.inventory_assets as a where a.category_id = old.id) then
    raise exception 'inventory_categories: referenced by assets — archive instead of delete'
      using errcode = '23503';
  end if;
  if to_regclass('public.inventory_stock_items') is not null
     and exists (select 1 from public.inventory_stock_items as s where s.category_id = old.id) then
    raise exception 'inventory_categories: referenced by stock items — archive instead of delete'
      using errcode = '23503';
  end if;
  return old;
end;
$fn$;

drop trigger if exists inventory_categories_block_delete on public.inventory_categories;
create trigger inventory_categories_block_delete
  before delete on public.inventory_categories
  for each row execute function public.inventory_category_block_delete_if_referenced();

alter table public.inventory_categories enable row level security;
revoke all on table public.inventory_categories from public, anon, authenticated;
grant select on table public.inventory_categories to authenticated;

drop policy if exists inventory_categories_select on public.inventory_categories;
create policy inventory_categories_select
  on public.inventory_categories for select to authenticated
  using (public.can_view_inventory() or public.can_manage_inventory_categories());

-- Fresh-install reusable catalog (metadata only — no assets/stock).
insert into public.inventory_categories (
  code, name_bg, name_ru, name_en, sort_order, allowed_tracking_type
) values
  ('tools', 'Инструменти', 'Инструменты', 'Tools', 10, 'INDIVIDUAL_ASSET'),
  ('machinery', 'Машини и техническо оборудване', 'Машины и техническое оборудование', 'Machinery and technical equipment', 20, 'INDIVIDUAL_ASSET'),
  ('cleaning_equipment', 'Оборудване за почистване', 'Уборочное оборудование', 'Cleaning equipment', 30, 'INDIVIDUAL_ASSET'),
  ('furniture', 'Мебели', 'Мебель', 'Furniture', 40, 'INDIVIDUAL_ASSET'),
  ('electronics', 'Електроника', 'Электроника', 'Electronics', 50, 'INDIVIDUAL_ASSET'),
  ('security_safety', 'Охрана и безопасност', 'Охрана и безопасность', 'Security and safety equipment', 60, 'INDIVIDUAL_ASSET'),
  ('pool_territory', 'Басейн и територия', 'Бассейн и территория', 'Pool and territory equipment', 70, 'INDIVIDUAL_ASSET'),
  ('household', 'Домакински инвентар', 'Хозяйственный инвентарь', 'Household inventory', 80, 'BOTH'),
  ('materials_consumables', 'Материали и консумативи', 'Материалы и расходники', 'Materials and consumables', 90, 'QUANTITY_STOCK'),
  ('other', 'Други', 'Прочее', 'Other', 100, 'BOTH')
on conflict (code) do nothing;

-- Example subcategory path: Machinery → Cleaning machinery → Floor cleaning machines
insert into public.inventory_categories (
  code, parent_id, name_bg, name_ru, name_en, sort_order, allowed_tracking_type
)
select
  'machinery_cleaning',
  c.id,
  'Машини за почистване',
  'Уборочная техника',
  'Cleaning machinery',
  10,
  'INDIVIDUAL_ASSET'
from public.inventory_categories as c
where c.code = 'machinery'
on conflict (code) do nothing;

insert into public.inventory_categories (
  code, parent_id, name_bg, name_ru, name_en, sort_order, allowed_tracking_type
)
select
  'machinery_cleaning_floor',
  c.id,
  'Машини за подове',
  'Поломоечные машины',
  'Floor cleaning machines',
  10,
  'INDIVIDUAL_ASSET'
from public.inventory_categories as c
where c.code = 'machinery_cleaning'
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Locations (shared by assets and stock)
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  location_kind text not null
    constraint inventory_locations_kind_chk
      check (location_kind in (
        'common_area', 'technical_room', 'office', 'storage',
        'apartment', 'offsite', 'other'
      )),
  property_id bigint null references public.properties (id) on delete set null,
  active boolean not null default true,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_code_uidx unique (code),
  constraint inventory_locations_code_nonempty check (length(btrim(code)) > 0),
  constraint inventory_locations_name_nonempty check (length(btrim(name)) > 0)
);

create index if not exists inventory_locations_kind_idx
  on public.inventory_locations (location_kind, active);

alter table public.inventory_locations enable row level security;
revoke all on table public.inventory_locations from public, anon, authenticated;
grant select on table public.inventory_locations to authenticated;

drop policy if exists inventory_locations_select on public.inventory_locations;
create policy inventory_locations_select
  on public.inventory_locations for select to authenticated
  using (public.can_view_inventory());

-- ---------------------------------------------------------------------------
-- 5. Individual assets
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_assets (
  id uuid primary key default gen_random_uuid(),
  inventory_number text not null,
  name text not null,
  description text null,
  category_id uuid null references public.inventory_categories (id) on delete restrict,
  tracking_type text not null default 'INDIVIDUAL_ASSET'
    constraint inventory_assets_tracking_chk check (tracking_type = 'INDIVIDUAL_ASSET'),
  ownership_kind text not null
    constraint inventory_assets_ownership_chk
      check (ownership_kind in ('CONDOMINIUM', 'MANAGEMENT_COMPANY', 'THIRD_PARTY')),
  ownership_note text null,
  manufacturer text null,
  model text null,
  serial_number text null,
  location_id uuid null references public.inventory_locations (id) on delete set null,
  location_note text null,
  responsible_staff_id bigint null references public.staff (id) on delete set null,
  acquired_on date null,
  acquisition_method text null
    constraint inventory_assets_acq_method_chk
      check (
        acquisition_method is null
        or acquisition_method in (
          'purchase', 'donation', 'transfer_in', 'opening_import',
          'internal_balance', 'other'
        )
      ),
  acquisition_cost_eur numeric(14, 2) null
    constraint inventory_assets_acq_cost_nonneg check (
      acquisition_cost_eur is null or acquisition_cost_eur >= 0
    ),
  estimated_value_eur numeric(14, 2) null
    constraint inventory_assets_est_value_nonneg check (
      estimated_value_eur is null or estimated_value_eur >= 0
    ),
  condition text not null default 'good'
    constraint inventory_assets_condition_chk
      check (condition in ('new', 'good', 'fair', 'poor', 'unserviceable')),
  operational_status text not null default 'draft'
    constraint inventory_assets_status_chk
      check (operational_status in (
        'draft', 'active', 'assigned', 'maintenance', 'written_off', 'archived'
      )),
  written_off_at timestamptz null,
  write_off_reason text null,
  write_off_by_email text null,
  opening_import boolean not null default false,
  idempotency_key uuid null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  updated_at timestamptz not null default now(),
  updated_by_email text null,
  constraint inventory_assets_number_uidx unique (inventory_number),
  constraint inventory_assets_number_nonempty check (length(btrim(inventory_number)) > 0),
  constraint inventory_assets_name_nonempty check (length(btrim(name)) > 0),
  constraint inventory_assets_idempotency_uidx unique (idempotency_key),
  constraint inventory_assets_third_party_note_chk check (
    ownership_kind <> 'THIRD_PARTY'
    or (ownership_note is not null and length(btrim(ownership_note)) > 0)
  )
);

create index if not exists inventory_assets_category_idx
  on public.inventory_assets (category_id);
create index if not exists inventory_assets_status_idx
  on public.inventory_assets (operational_status, ownership_kind);
create index if not exists inventory_assets_responsible_idx
  on public.inventory_assets (responsible_staff_id)
  where responsible_staff_id is not null;

comment on table public.inventory_assets is
  'INV-1: individually tracked physical assets. Empty on fresh install.';

alter table public.inventory_assets enable row level security;
revoke all on table public.inventory_assets from public, anon, authenticated;
grant select on table public.inventory_assets to authenticated;

drop policy if exists inventory_assets_select on public.inventory_assets;
create policy inventory_assets_select
  on public.inventory_assets for select to authenticated
  using (
    public.inventory_is_admin()
    or public.inventory_staff_cap('edit_assets')
    or public.inventory_staff_cap('view')
    or (
      responsible_staff_id is not null
      and responsible_staff_id = public.inventory_current_staff_id()
    )
  );

-- Optional 0..1 acquisition expense link (informational only).
create table if not exists public.inventory_asset_expense_links (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets (id) on delete cascade,
  uk_expense_id bigint not null references public.uk_expenses (id) on delete restrict,
  link_kind text not null default 'acquisition'
    check (link_kind in ('acquisition', 'maintenance', 'other')),
  note text null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  constraint inventory_asset_expense_links_asset_kind_uidx unique (asset_id, link_kind, uk_expense_id)
);

alter table public.inventory_asset_expense_links enable row level security;
revoke all on table public.inventory_asset_expense_links from public, anon, authenticated;
grant select on table public.inventory_asset_expense_links to authenticated;

drop policy if exists inventory_asset_expense_links_select on public.inventory_asset_expense_links;
create policy inventory_asset_expense_links_select
  on public.inventory_asset_expense_links for select to authenticated
  using (public.can_view_inventory());

create table if not exists public.inventory_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets (id) on delete cascade,
  assigned_to_staff_id bigint not null references public.staff (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by_email text null,
  from_location_id uuid null references public.inventory_locations (id) on delete set null,
  to_location_id uuid null references public.inventory_locations (id) on delete set null,
  released_at timestamptz null,
  release_reason text null,
  note text null,
  constraint inventory_assignments_release_order_chk check (
    released_at is null or released_at >= assigned_at
  )
);

create unique index if not exists inventory_assignments_one_open_per_asset_uidx
  on public.inventory_assignments (asset_id)
  where released_at is null;

create index if not exists inventory_assignments_staff_idx
  on public.inventory_assignments (assigned_to_staff_id, assigned_at desc);

alter table public.inventory_assignments enable row level security;
revoke all on table public.inventory_assignments from public, anon, authenticated;
grant select on table public.inventory_assignments to authenticated;

drop policy if exists inventory_assignments_select on public.inventory_assignments;
create policy inventory_assignments_select
  on public.inventory_assignments for select to authenticated
  using (
    public.can_view_inventory()
    or assigned_to_staff_id = public.inventory_current_staff_id()
  );

create table if not exists public.inventory_maintenance_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets (id) on delete cascade,
  event_kind text not null
    check (event_kind in ('inspection', 'repair', 'service', 'calibration', 'other')),
  performed_on date not null default (timezone('Europe/Sofia', now()))::date,
  performed_by_staff_id bigint null references public.staff (id) on delete set null,
  performed_by_email text null,
  summary text not null,
  cost_eur numeric(14, 2) null
    check (cost_eur is null or cost_eur >= 0),
  work_order_id uuid null,
  uk_expense_id bigint null references public.uk_expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_maintenance_summary_nonempty check (length(btrim(summary)) > 0)
);

-- Optional WO FK when work_orders exists
do $$
begin
  if to_regclass('public.work_orders') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'inventory_maintenance_work_order_fkey'
     ) then
    alter table public.inventory_maintenance_events
      add constraint inventory_maintenance_work_order_fkey
      foreign key (work_order_id) references public.work_orders (id) on delete set null;
  end if;
end $$;

create index if not exists inventory_maintenance_asset_idx
  on public.inventory_maintenance_events (asset_id, performed_on desc);

alter table public.inventory_maintenance_events enable row level security;
revoke all on table public.inventory_maintenance_events from public, anon, authenticated;
grant select on table public.inventory_maintenance_events to authenticated;

drop policy if exists inventory_maintenance_select on public.inventory_maintenance_events;
create policy inventory_maintenance_select
  on public.inventory_maintenance_events for select to authenticated
  using (public.can_view_inventory());

create table if not exists public.inventory_documents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid null references public.inventory_assets (id) on delete cascade,
  stock_item_id uuid null,
  title text not null,
  doc_kind text not null default 'other'
    check (doc_kind in ('invoice', 'warranty', 'photo', 'act', 'other')),
  storage_path text not null,
  mime_type text null,
  uploaded_by_email text null,
  created_at timestamptz not null default now(),
  constraint inventory_documents_title_nonempty check (length(btrim(title)) > 0),
  constraint inventory_documents_path_nonempty check (length(btrim(storage_path)) > 0),
  constraint inventory_documents_target_chk check (
    (asset_id is not null and stock_item_id is null)
    or (asset_id is null and stock_item_id is not null)
  )
);

create unique index if not exists inventory_documents_storage_path_uidx
  on public.inventory_documents (storage_path);

alter table public.inventory_documents enable row level security;
revoke all on table public.inventory_documents from public, anon, authenticated;
grant select on table public.inventory_documents to authenticated;

drop policy if exists inventory_documents_select on public.inventory_documents;
create policy inventory_documents_select
  on public.inventory_documents for select to authenticated
  using (public.can_view_inventory());

create table if not exists public.inventory_asset_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.inventory_assets (id) on delete cascade,
  event_at timestamptz not null default now(),
  actor_uid uuid null,
  actor_email text null,
  event_kind text not null
    check (event_kind in (
      'created', 'updated', 'assigned', 'transferred', 'location_changed',
      'condition_changed', 'status_changed', 'maintenance', 'document_added',
      'write_off', 'ownership_changed', 'opening_import', 'session_posted'
    )),
  payload jsonb not null default '{}'::jsonb,
  note text null
);

create index if not exists inventory_asset_events_asset_idx
  on public.inventory_asset_events (asset_id, event_at desc);

alter table public.inventory_asset_events enable row level security;
revoke all on table public.inventory_asset_events from public, anon, authenticated;
grant select on table public.inventory_asset_events to authenticated;

drop policy if exists inventory_asset_events_select on public.inventory_asset_events;
create policy inventory_asset_events_select
  on public.inventory_asset_events for select to authenticated
  using (public.can_view_inventory());

-- Append-only: block updates/deletes for non-superuser paths via revoke;
-- trigger hardens against authenticated role mistakes if grants widen later.
create or replace function public.inventory_asset_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception 'inventory_asset_events: append-only' using errcode = '55000';
end;
$fn$;

drop trigger if exists inventory_asset_events_no_update on public.inventory_asset_events;
create trigger inventory_asset_events_no_update
  before update or delete on public.inventory_asset_events
  for each row execute function public.inventory_asset_events_immutable();

-- ---------------------------------------------------------------------------
-- 6. Consumable stock (SKU + immutable movements; balance = derived)
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_units (
  code text primary key,
  name_bg text not null,
  name_ru text not null,
  name_en text not null
);

insert into public.inventory_units (code, name_bg, name_ru, name_en) values
  ('pcs', 'бр.', 'шт.', 'pcs'),
  ('l', 'л', 'л', 'L'),
  ('ml', 'мл', 'мл', 'mL'),
  ('kg', 'кг', 'кг', 'kg'),
  ('g', 'г', 'г', 'g'),
  ('m', 'м', 'м', 'm'),
  ('pack', 'пакет', 'упак.', 'pack'),
  ('box', 'кутия', 'коробка', 'box')
on conflict (code) do nothing;

alter table public.inventory_units enable row level security;
revoke all on table public.inventory_units from public, anon, authenticated;
grant select on table public.inventory_units to authenticated;

drop policy if exists inventory_units_select on public.inventory_units;
create policy inventory_units_select
  on public.inventory_units for select to authenticated
  using (true);

create table if not exists public.inventory_stock_items (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null,
  name text not null,
  description text null,
  category_id uuid null references public.inventory_categories (id) on delete restrict,
  tracking_type text not null default 'QUANTITY_STOCK'
    check (tracking_type = 'QUANTITY_STOCK'),
  ownership_kind text not null
    check (ownership_kind in ('CONDOMINIUM', 'MANAGEMENT_COMPANY', 'THIRD_PARTY')),
  ownership_note text null,
  unit_code text not null references public.inventory_units (code) on delete restrict,
  default_location_id uuid null references public.inventory_locations (id) on delete set null,
  min_qty numeric(14, 3) null
    check (min_qty is null or min_qty >= 0),
  active boolean not null default true,
  opening_import boolean not null default false,
  idempotency_key uuid null,
  estimated_unit_value_eur numeric(14, 4) null
    check (estimated_unit_value_eur is null or estimated_unit_value_eur >= 0),
  created_at timestamptz not null default now(),
  created_by_email text null,
  updated_at timestamptz not null default now(),
  updated_by_email text null,
  constraint inventory_stock_items_sku_uidx unique (sku_code),
  constraint inventory_stock_items_sku_nonempty check (length(btrim(sku_code)) > 0),
  constraint inventory_stock_items_name_nonempty check (length(btrim(name)) > 0),
  constraint inventory_stock_items_idem_uidx unique (idempotency_key),
  constraint inventory_stock_items_third_party_note_chk check (
    ownership_kind <> 'THIRD_PARTY'
    or (ownership_note is not null and length(btrim(ownership_note)) > 0)
  )
);

create index if not exists inventory_stock_items_category_idx
  on public.inventory_stock_items (category_id);

comment on table public.inventory_stock_items is
  'INV-1: consumable SKUs. Quantity derived from movements — no mutable balance column.';

alter table public.inventory_stock_items enable row level security;
revoke all on table public.inventory_stock_items from public, anon, authenticated;
grant select on table public.inventory_stock_items to authenticated;

drop policy if exists inventory_stock_items_select on public.inventory_stock_items;
create policy inventory_stock_items_select
  on public.inventory_stock_items for select to authenticated
  using (public.can_view_inventory());

-- Attach documents.stock_item_id FK now that stock items exist
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_documents_stock_item_fkey'
  ) then
    alter table public.inventory_documents
      add constraint inventory_documents_stock_item_fkey
      foreign key (stock_item_id) references public.inventory_stock_items (id) on delete cascade;
  end if;
end $$;

create table if not exists public.inventory_stock_movements (
  id bigint generated always as identity primary key,
  stock_item_id uuid not null references public.inventory_stock_items (id) on delete restrict,
  location_id uuid null references public.inventory_locations (id) on delete set null,
  movement_type text not null
    check (movement_type in (
      'OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'WRITE_OFF'
    )),
  qty_delta numeric(14, 3) not null,
  unit_code text not null references public.inventory_units (code) on delete restrict,
  from_location_id uuid null references public.inventory_locations (id) on delete set null,
  to_location_id uuid null references public.inventory_locations (id) on delete set null,
  reason text null,
  session_item_id uuid null,
  uk_expense_id bigint null references public.uk_expenses (id) on delete set null,
  idempotency_key uuid null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  created_by_staff_id bigint null references public.staff (id) on delete set null,
  constraint inventory_stock_movements_qty_nonzero check (qty_delta <> 0),
  constraint inventory_stock_movements_idem_uidx unique (idempotency_key),
  constraint inventory_stock_movements_transfer_chk check (
    movement_type <> 'TRANSFER'
    or (from_location_id is not null and to_location_id is not null
        and from_location_id is distinct from to_location_id)
  ),
  constraint inventory_stock_movements_sign_chk check (
    (movement_type in ('OPENING', 'RECEIPT') and qty_delta > 0)
    or (movement_type in ('ISSUE', 'WRITE_OFF') and qty_delta < 0)
    or (movement_type in ('ADJUSTMENT', 'TRANSFER'))
  )
);

create index if not exists inventory_stock_movements_item_idx
  on public.inventory_stock_movements (stock_item_id, created_at);

comment on table public.inventory_stock_movements is
  'INV-1: immutable stock journal. Operational insert RPCs in INV-2.';

alter table public.inventory_stock_movements enable row level security;
revoke all on table public.inventory_stock_movements from public, anon, authenticated;
grant select on table public.inventory_stock_movements to authenticated;

drop policy if exists inventory_stock_movements_select on public.inventory_stock_movements;
create policy inventory_stock_movements_select
  on public.inventory_stock_movements for select to authenticated
  using (public.can_view_inventory());

create or replace function public.inventory_stock_movements_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception 'inventory_stock_movements: append-only' using errcode = '55000';
end;
$fn$;

drop trigger if exists inventory_stock_movements_no_update on public.inventory_stock_movements;
create trigger inventory_stock_movements_no_update
  before update or delete on public.inventory_stock_movements
  for each row execute function public.inventory_stock_movements_immutable();

-- Nonnegative invariant: reject insert that would drive on-hand qty below zero.
create or replace function public.inventory_stock_on_hand(p_stock_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.qty_delta), 0)
  from public.inventory_stock_movements as m
  where m.stock_item_id = p_stock_item_id
    and m.movement_type <> 'TRANSFER';
$$;

revoke all on function public.inventory_stock_on_hand(uuid) from public;
revoke execute on function public.inventory_stock_on_hand(uuid) from anon;
grant execute on function public.inventory_stock_on_hand(uuid) to authenticated;

create or replace function public.inventory_stock_movements_nonneg_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_after numeric;
  v_unit text;
begin
  -- Serialize per SKU so concurrent inserts cannot both pass a stale on-hand check.
  select s.unit_code into v_unit
  from public.inventory_stock_items as s
  where s.id = new.stock_item_id
  for update;
  if v_unit is null then
    raise exception 'inventory_stock_movements: unknown stock_item_id' using errcode = '23503';
  end if;
  if new.unit_code is distinct from v_unit then
    raise exception 'inventory_stock_movements: unit_code must match stock item unit (%)', v_unit
      using errcode = '23514';
  end if;
  if new.movement_type = 'TRANSFER' then
    -- Pairing semantics for transfer qty handled in INV-2 RPC (two rows or signed pair).
    return new;
  end if;
  v_after := public.inventory_stock_on_hand(new.stock_item_id) + new.qty_delta;
  if v_after < 0 then
    raise exception 'inventory_stock_movements: negative stock not allowed (would be %)', v_after
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists inventory_stock_movements_nonneg on public.inventory_stock_movements;
create trigger inventory_stock_movements_nonneg
  before insert on public.inventory_stock_movements
  for each row execute function public.inventory_stock_movements_nonneg_trg();

create or replace view public.inventory_stock_balances as
select
  s.id as stock_item_id,
  s.sku_code,
  s.name,
  s.unit_code,
  s.ownership_kind,
  public.inventory_stock_on_hand(s.id) as qty_on_hand,
  s.min_qty,
  s.default_location_id,
  s.active
from public.inventory_stock_items as s;

revoke all on table public.inventory_stock_balances from public, anon;
grant select on table public.inventory_stock_balances to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Collaborative inventory sessions
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'CLOSED')),
  started_at timestamptz null,
  target_end_at timestamptz null,
  scope_note text null,
  zone_location_id uuid null references public.inventory_locations (id) on delete set null,
  category_id uuid null references public.inventory_categories (id) on delete set null,
  row_version integer not null default 1,
  approved_at timestamptz null,
  approved_by_email text null,
  approval_note text null,
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  updated_at timestamptz not null default now(),
  updated_by_email text null,
  constraint inventory_sessions_title_nonempty check (length(btrim(title)) > 0)
);

create index if not exists inventory_sessions_status_idx
  on public.inventory_sessions (status, updated_at desc);

comment on table public.inventory_sessions is
  'INV-1: multi-day collaborative inventory. Posting RPCs in INV-2.';

alter table public.inventory_sessions enable row level security;
revoke all on table public.inventory_sessions from public, anon, authenticated;
grant select on table public.inventory_sessions to authenticated;

create table if not exists public.inventory_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions (id) on delete cascade,
  staff_id bigint not null references public.staff (id) on delete cascade,
  role_in_session text not null default 'counter'
    check (role_in_session in ('counter', 'reviewer', 'lead')),
  assigned_zone_location_id uuid null references public.inventory_locations (id) on delete set null,
  assigned_category_id uuid null references public.inventory_categories (id) on delete set null,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  constraint inventory_session_participants_uidx unique (session_id, staff_id)
);

create index if not exists inventory_session_participants_staff_idx
  on public.inventory_session_participants (staff_id, session_id);

alter table public.inventory_session_participants enable row level security;
revoke all on table public.inventory_session_participants from public, anon, authenticated;
grant select on table public.inventory_session_participants to authenticated;

create table if not exists public.inventory_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions (id) on delete cascade,
  tracking_type text not null
    check (tracking_type in ('INDIVIDUAL_ASSET', 'QUANTITY_STOCK')),
  -- Link to existing register row when recounting known items
  asset_id uuid null references public.inventory_assets (id) on delete set null,
  stock_item_id uuid null references public.inventory_stock_items (id) on delete set null,
  -- Draft identity for new findings
  draft_inventory_number text null,
  draft_sku_code text null,
  draft_name text not null,
  draft_category_id uuid null references public.inventory_categories (id) on delete set null,
  draft_ownership_kind text null
    check (
      draft_ownership_kind is null
      or draft_ownership_kind in ('CONDOMINIUM', 'MANAGEMENT_COMPANY', 'THIRD_PARTY')
    ),
  draft_location_id uuid null references public.inventory_locations (id) on delete set null,
  draft_condition text null,
  expected_qty numeric(14, 3) null,
  counted_qty numeric(14, 3) null,
  unit_code text null references public.inventory_units (code) on delete restrict,
  discrepancy_note text null,
  finding_status text not null default 'draft'
    check (finding_status in (
      'draft', 'submitted', 'accepted', 'rejected', 'posted', 'duplicate'
    )),
  entered_by_staff_id bigint null references public.staff (id) on delete set null,
  entered_by_email text null,
  row_version integer not null default 1,
  posted_asset_id uuid null references public.inventory_assets (id) on delete set null,
  posted_stock_item_id uuid null references public.inventory_stock_items (id) on delete set null,
  posted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_session_items_name_nonempty check (length(btrim(draft_name)) > 0),
  constraint inventory_session_items_target_chk check (
    (tracking_type = 'INDIVIDUAL_ASSET' and stock_item_id is null)
    or (tracking_type = 'QUANTITY_STOCK' and asset_id is null)
  )
);

create index if not exists inventory_session_items_session_idx
  on public.inventory_session_items (session_id, finding_status);

create unique index if not exists inventory_session_items_asset_once_uidx
  on public.inventory_session_items (session_id, asset_id)
  where asset_id is not null and finding_status <> 'rejected';

create unique index if not exists inventory_session_items_stock_once_uidx
  on public.inventory_session_items (session_id, stock_item_id)
  where stock_item_id is not null and finding_status <> 'rejected';

create unique index if not exists inventory_session_items_draft_number_uidx
  on public.inventory_session_items (session_id, draft_inventory_number)
  where draft_inventory_number is not null and finding_status <> 'rejected';

alter table public.inventory_session_items enable row level security;
revoke all on table public.inventory_session_items from public, anon, authenticated;
grant select on table public.inventory_session_items to authenticated;

-- Optimistic concurrency helper column already on sessions/items (row_version).
-- INV-2 RPCs will require matching row_version on update.

create table if not exists public.inventory_session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.inventory_sessions (id) on delete cascade,
  event_at timestamptz not null default now(),
  actor_uid uuid null,
  actor_email text null,
  event_kind text not null
    check (event_kind in (
      'created', 'started', 'participant_added', 'participant_removed',
      'item_draft_saved', 'item_submitted', 'submitted_for_review',
      'item_accepted', 'item_rejected', 'approved', 'posted', 'closed', 'reopened'
    )),
  payload jsonb not null default '{}'::jsonb,
  note text null
);

create index if not exists inventory_session_events_session_idx
  on public.inventory_session_events (session_id, event_at desc);

alter table public.inventory_session_events enable row level security;
revoke all on table public.inventory_session_events from public, anon, authenticated;
grant select on table public.inventory_session_events to authenticated;

create or replace function public.inventory_session_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception 'inventory_session_events: append-only' using errcode = '55000';
end;
$fn$;

drop trigger if exists inventory_session_events_no_update on public.inventory_session_events;
create trigger inventory_session_events_no_update
  before update or delete on public.inventory_session_events
  for each row execute function public.inventory_session_events_immutable();

-- Session visibility: admin / review / or participant
drop policy if exists inventory_sessions_select on public.inventory_sessions;
create policy inventory_sessions_select
  on public.inventory_sessions for select to authenticated
  using (
    public.can_approve_inventory_session()
    or public.can_review_inventory_session()
    or public.can_view_inventory()
    or exists (
      select 1
      from public.inventory_session_participants as p
      where p.session_id = inventory_sessions.id
        and p.staff_id = public.inventory_current_staff_id()
        and p.active is true
    )
  );

drop policy if exists inventory_session_participants_select on public.inventory_session_participants;
create policy inventory_session_participants_select
  on public.inventory_session_participants for select to authenticated
  using (
    public.can_approve_inventory_session()
    or public.can_review_inventory_session()
    or staff_id = public.inventory_current_staff_id()
    or public.can_view_inventory()
  );

drop policy if exists inventory_session_items_select on public.inventory_session_items;
create policy inventory_session_items_select
  on public.inventory_session_items for select to authenticated
  using (
    public.can_approve_inventory_session()
    or public.can_review_inventory_session()
    or public.can_view_inventory()
    or exists (
      select 1
      from public.inventory_session_participants as p
      where p.session_id = inventory_session_items.session_id
        and p.staff_id = public.inventory_current_staff_id()
        and p.active is true
    )
  );

drop policy if exists inventory_session_events_select on public.inventory_session_events;
create policy inventory_session_events_select
  on public.inventory_session_events for select to authenticated
  using (
    public.can_approve_inventory_session()
    or public.can_review_inventory_session()
    or public.can_view_inventory()
    or exists (
      select 1
      from public.inventory_session_participants as p
      where p.session_id = inventory_session_events.session_id
        and p.staff_id = public.inventory_current_staff_id()
        and p.active is true
    )
  );

-- Capabilities self-read for current staff; admin sees all
drop policy if exists staff_inventory_capabilities_select on public.staff_inventory_capabilities;
create policy staff_inventory_capabilities_select
  on public.staff_inventory_capabilities for select to authenticated
  using (
    public.inventory_is_admin()
    or staff_id = public.inventory_current_staff_id()
  );

-- ---------------------------------------------------------------------------
-- 8. Module lifecycle note (no auto-activation)
-- ---------------------------------------------------------------------------

-- If lifecycle table exists, ensure a DISABLED/SETUP_REQUIRED row can be created
-- by later INV-6 adapter. Do not force ACTIVE/READY here.
do $$
begin
  if to_regclass('public.module_lifecycle') is not null
     and to_regclass('public.platform_installations') is not null then
    insert into public.module_lifecycle (
      installation_id, module_key, state, setup_schema_version
    )
    select i.id, 'inventory', 'DISABLED', '1.0'
    from public.platform_installations as i
    where lower(i.installation_key) = 'default'
    on conflict (installation_id, module_key) do nothing;
  end if;
end $$;

commit;
