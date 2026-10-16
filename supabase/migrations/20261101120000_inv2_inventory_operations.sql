-- =============================================================================
-- INV-2 — Inventory canonical operations (SECURITY DEFINER RPCs)
-- =============================================================================
-- Additive. Does NOT modify INV-1 or earlier migrations.
-- Does NOT auto-enable module / does NOT flip implemented=true.
-- Does NOT insert into uk_expenses, Support Fee, Capital Repair, Internet, cash.
-- Posting = operational register only (internal_balance / OPENING / ADJUSTMENT).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0a. Admin detection (direct staff.role — resilient to has_staff_role encoding)
-- ---------------------------------------------------------------------------

create or replace function public.inventory_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where lower(btrim(s.email)) = lower(btrim(coalesce(auth.email(), '')))
      and s.active is true
      and s.role = 'администрация'
  );
$$;

revoke all on function public.inventory_is_admin() from public;
revoke execute on function public.inventory_is_admin() from anon;
grant execute on function public.inventory_is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 0. Optional FKs / indexes for posting traceability
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_stock_movements_session_item_fkey'
  ) then
    alter table public.inventory_stock_movements
      add constraint inventory_stock_movements_session_item_fkey
      foreign key (session_item_id) references public.inventory_session_items (id)
      on delete set null;
  end if;
end $$;

create unique index if not exists inventory_stock_movements_session_item_once_uidx
  on public.inventory_stock_movements (session_item_id)
  where session_item_id is not null
    and movement_type in ('OPENING', 'ADJUSTMENT');

-- ---------------------------------------------------------------------------
-- 1. Shared auth / actor / logging helpers
-- ---------------------------------------------------------------------------

create or replace function public.inventory_actor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(nullif(btrim(coalesce(auth.email(), '')), ''));
$$;

revoke all on function public.inventory_actor_email() from public;
revoke execute on function public.inventory_actor_email() from anon;
grant execute on function public.inventory_actor_email() to authenticated;

create or replace function public.inventory_assert_authenticated()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'inventory: not authenticated' using errcode = '28000';
  end if;
  if public.inventory_actor_email() is null then
    raise exception 'inventory: email required' using errcode = '28000';
  end if;
end;
$fn$;

revoke all on function public.inventory_assert_authenticated() from public, anon;

-- Admin may operate for setup/tests without flipping building_modules.enabled.
-- Non-admin requires module enabled + capability. Never auto-enables module.
create or replace function public.inventory_assert_cap(p_cap text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.inventory_assert_authenticated();
  if public.inventory_is_admin() then
    return;
  end if;
  if not public.inventory_module_enabled() then
    raise exception 'inventory: module disabled' using errcode = '42501';
  end if;
  if not public.inventory_staff_cap(p_cap) then
    raise exception 'inventory: capability required (%)', p_cap using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.inventory_assert_cap(text) from public, anon;

create or replace function public.inventory_assert_session_participant(p_session_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sid bigint;
begin
  perform public.inventory_assert_authenticated();
  if public.inventory_is_admin()
     or public.can_review_inventory_session()
     or public.can_approve_inventory_session() then
    return;
  end if;
  v_sid := public.inventory_current_staff_id();
  if v_sid is null
     or not exists (
       select 1
       from public.inventory_session_participants as p
       where p.session_id = p_session_id
         and p.staff_id = v_sid
         and p.active is true
     ) then
    raise exception 'inventory: not a session participant' using errcode = '42501';
  end if;
  -- Assigned participants may enter findings during setup without module.enabled.
  -- Final approval remains admin-gated separately.
end;
$fn$;

revoke all on function public.inventory_assert_session_participant(uuid) from public, anon;

create or replace function public.inventory_log_asset_event(
  p_asset_id uuid,
  p_event_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.inventory_asset_events (
    asset_id, actor_uid, actor_email, event_kind, payload, note
  ) values (
    p_asset_id, auth.uid(), public.inventory_actor_email(), p_event_kind,
    coalesce(p_payload, '{}'::jsonb), nullif(btrim(coalesce(p_note, '')), '')
  );
end;
$fn$;

revoke all on function public.inventory_log_asset_event(uuid, text, jsonb, text) from public, anon;

create or replace function public.inventory_log_session_event(
  p_session_id uuid,
  p_event_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.inventory_session_events (
    session_id, actor_uid, actor_email, event_kind, payload, note
  ) values (
    p_session_id, auth.uid(), public.inventory_actor_email(), p_event_kind,
    coalesce(p_payload, '{}'::jsonb), nullif(btrim(coalesce(p_note, '')), '')
  );
end;
$fn$;

revoke all on function public.inventory_log_session_event(uuid, text, jsonb, text) from public, anon;

create or replace function public.inventory_bump_session(
  p_session_id uuid,
  p_row_version integer,
  p_new_status text default null
)
returns public.inventory_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_sessions%rowtype;
begin
  update public.inventory_sessions as s
  set
    row_version = s.row_version + 1,
    status = coalesce(p_new_status, s.status),
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where s.id = p_session_id
    and s.row_version = p_row_version
  returning * into v_row;
  if not found then
    raise exception 'inventory: stale session row_version' using errcode = '40001';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_bump_session(uuid, integer, text) from public, anon;

-- Admin-only capability grants (does not enable module)
create or replace function public.inventory_set_staff_capabilities(
  p_staff_id bigint,
  p_can_view boolean default false,
  p_can_edit_assets boolean default false,
  p_can_manage_categories boolean default false,
  p_can_stock_move boolean default false,
  p_can_session_participate boolean default false,
  p_can_session_review boolean default false,
  p_can_approve_sessions boolean default false,
  p_can_write_off boolean default false
)
returns public.staff_inventory_capabilities
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.staff_inventory_capabilities%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not public.inventory_is_admin() then
    raise exception 'inventory: admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff as s where s.id = p_staff_id) then
    raise exception 'inventory: staff not found' using errcode = 'P0002';
  end if;
  insert into public.staff_inventory_capabilities as c (
    staff_id, can_view, can_edit_assets, can_manage_categories, can_stock_move,
    can_session_participate, can_session_review, can_approve_sessions, can_write_off,
    updated_at, updated_by_email
  ) values (
    p_staff_id, p_can_view, p_can_edit_assets, p_can_manage_categories, p_can_stock_move,
    p_can_session_participate, p_can_session_review, p_can_approve_sessions, p_can_write_off,
    now(), public.inventory_actor_email()
  )
  on conflict (staff_id) do update set
    can_view = excluded.can_view,
    can_edit_assets = excluded.can_edit_assets,
    can_manage_categories = excluded.can_manage_categories,
    can_stock_move = excluded.can_stock_move,
    can_session_participate = excluded.can_session_participate,
    can_session_review = excluded.can_session_review,
    can_approve_sessions = excluded.can_approve_sessions,
    can_write_off = excluded.can_write_off,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_set_staff_capabilities(
  bigint, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) from public, anon;
grant execute on function public.inventory_set_staff_capabilities(
  bigint, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Category & location operations
-- ---------------------------------------------------------------------------

create or replace function public.inventory_upsert_category(
  p_code text,
  p_name_bg text,
  p_name_ru text,
  p_name_en text,
  p_parent_id uuid default null,
  p_description text default null,
  p_sort_order integer default 0,
  p_allowed_tracking_type text default null,
  p_id uuid default null
)
returns public.inventory_categories
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_categories%rowtype;
  v_code text := lower(nullif(btrim(coalesce(p_code, '')), ''));
begin
  perform public.inventory_assert_cap('manage_categories');
  if v_code is null then
    raise exception 'inventory: category code required' using errcode = '22023';
  end if;
  if p_allowed_tracking_type is not null
     and p_allowed_tracking_type not in ('INDIVIDUAL_ASSET', 'QUANTITY_STOCK', 'BOTH') then
    raise exception 'inventory: invalid tracking type' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.inventory_categories (
      code, parent_id, name_bg, name_ru, name_en, description, sort_order,
      allowed_tracking_type, active, updated_at
    ) values (
      v_code, p_parent_id,
      btrim(p_name_bg), btrim(p_name_ru), btrim(p_name_en),
      nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_sort_order, 0), p_allowed_tracking_type, true, now()
    )
    returning * into v_row;
  else
    update public.inventory_categories as c
    set
      code = v_code,
      parent_id = p_parent_id,
      name_bg = btrim(p_name_bg),
      name_ru = btrim(p_name_ru),
      name_en = btrim(p_name_en),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      sort_order = coalesce(p_sort_order, c.sort_order),
      allowed_tracking_type = p_allowed_tracking_type,
      updated_at = now()
    where c.id = p_id
      and c.archived_at is null
    returning * into v_row;
    if not found then
      raise exception 'inventory: category not found or archived' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_upsert_category(
  text, text, text, text, uuid, text, integer, text, uuid
) from public, anon;
grant execute on function public.inventory_upsert_category(
  text, text, text, text, uuid, text, integer, text, uuid
) to authenticated;

create or replace function public.inventory_archive_category(p_id uuid)
returns public.inventory_categories
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_categories%rowtype;
begin
  perform public.inventory_assert_cap('manage_categories');
  if exists (
    select 1 from public.inventory_assets as a
    where a.category_id = p_id and a.operational_status not in ('written_off', 'archived')
  ) or exists (
    select 1 from public.inventory_stock_items as s
    where s.category_id = p_id and s.active is true
  ) then
    raise exception 'inventory: category has active references' using errcode = '23503';
  end if;
  update public.inventory_categories as c
  set active = false, archived_at = coalesce(c.archived_at, now()), updated_at = now()
  where c.id = p_id
  returning * into v_row;
  if not found then
    raise exception 'inventory: category not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_archive_category(uuid) from public, anon;
grant execute on function public.inventory_archive_category(uuid) to authenticated;

create or replace function public.inventory_upsert_location(
  p_code text,
  p_name text,
  p_location_kind text,
  p_property_id bigint default null,
  p_note text default null,
  p_id uuid default null
)
returns public.inventory_locations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_locations%rowtype;
  v_code text := lower(nullif(btrim(coalesce(p_code, '')), ''));
begin
  perform public.inventory_assert_cap('manage_categories');
  if v_code is null or nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'inventory: location code/name required' using errcode = '22023';
  end if;
  if p_location_kind not in (
    'common_area', 'technical_room', 'office', 'storage', 'apartment', 'offsite', 'other'
  ) then
    raise exception 'inventory: invalid location_kind' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.inventory_locations (
      code, name, location_kind, property_id, note, active, updated_at
    ) values (
      v_code, btrim(p_name), p_location_kind, p_property_id,
      nullif(btrim(coalesce(p_note, '')), ''), true, now()
    )
    returning * into v_row;
  else
    update public.inventory_locations as l
    set
      code = v_code,
      name = btrim(p_name),
      location_kind = p_location_kind,
      property_id = p_property_id,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
    where l.id = p_id and l.active is true
    returning * into v_row;
    if not found then
      raise exception 'inventory: location not found or archived' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_upsert_location(
  text, text, text, bigint, text, uuid
) from public, anon;
grant execute on function public.inventory_upsert_location(
  text, text, text, bigint, text, uuid
) to authenticated;

create or replace function public.inventory_archive_location(p_id uuid)
returns public.inventory_locations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_locations%rowtype;
begin
  perform public.inventory_assert_cap('manage_categories');
  update public.inventory_locations as l
  set active = false, updated_at = now()
  where l.id = p_id
  returning * into v_row;
  if not found then
    raise exception 'inventory: location not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_archive_location(uuid) from public, anon;
grant execute on function public.inventory_archive_location(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Asset operations
-- ---------------------------------------------------------------------------

create or replace function public.inventory_create_draft_asset(
  p_inventory_number text,
  p_name text,
  p_ownership_kind text,
  p_category_id uuid default null,
  p_ownership_note text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_serial_number text default null,
  p_location_id uuid default null,
  p_location_note text default null,
  p_condition text default 'good',
  p_acquisition_method text default null,
  p_estimated_value_eur numeric default null,
  p_idempotency_key uuid default null,
  p_description text default null
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
  v_num text := nullif(btrim(coalesce(p_inventory_number, '')), '');
begin
  perform public.inventory_assert_cap('edit_assets');
  if p_idempotency_key is not null then
    select * into v_row from public.inventory_assets as a where a.idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;
  if v_num is null or nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'inventory: number and name required' using errcode = '22023';
  end if;
  if p_ownership_kind not in ('CONDOMINIUM', 'MANAGEMENT_COMPANY', 'THIRD_PARTY') then
    raise exception 'inventory: invalid ownership_kind' using errcode = '22023';
  end if;
  insert into public.inventory_assets (
    inventory_number, name, description, category_id, ownership_kind, ownership_note,
    manufacturer, model, serial_number, location_id, location_note, condition,
    operational_status, acquisition_method, estimated_value_eur, opening_import,
    idempotency_key, created_by_email, updated_by_email
  ) values (
    v_num, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    p_category_id, p_ownership_kind, nullif(btrim(coalesce(p_ownership_note, '')), ''),
    nullif(btrim(coalesce(p_manufacturer, '')), ''),
    nullif(btrim(coalesce(p_model, '')), ''),
    nullif(btrim(coalesce(p_serial_number, '')), ''),
    p_location_id, nullif(btrim(coalesce(p_location_note, '')), ''),
    coalesce(nullif(btrim(coalesce(p_condition, '')), ''), 'good'),
    'draft', p_acquisition_method, p_estimated_value_eur,
    coalesce(p_acquisition_method in ('opening_import', 'internal_balance'), false),
    p_idempotency_key, public.inventory_actor_email(), public.inventory_actor_email()
  )
  returning * into v_row;
  perform public.inventory_log_asset_event(
    v_row.id, 'created', jsonb_build_object('status', 'draft'), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_create_draft_asset(
  text, text, text, uuid, text, text, text, text, uuid, text, text, text, numeric, uuid, text
) from public, anon;
grant execute on function public.inventory_create_draft_asset(
  text, text, text, uuid, text, text, text, text, uuid, text, text, text, numeric, uuid, text
) to authenticated;

create or replace function public.inventory_update_asset(
  p_asset_id uuid,
  p_name text default null,
  p_description text default null,
  p_category_id uuid default null,
  p_ownership_kind text default null,
  p_ownership_note text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_serial_number text default null,
  p_location_id uuid default null,
  p_location_note text default null,
  p_estimated_value_eur numeric default null
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
  v_before public.inventory_assets%rowtype;
begin
  perform public.inventory_assert_cap('edit_assets');
  select * into v_before from public.inventory_assets as a where a.id = p_asset_id for update;
  if not found then
    raise exception 'inventory: asset not found' using errcode = 'P0002';
  end if;
  if v_before.operational_status in ('written_off', 'archived') then
    raise exception 'inventory: asset not editable in status %', v_before.operational_status
      using errcode = '55000';
  end if;
  update public.inventory_assets as a
  set
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), a.name),
    description = case when p_description is null then a.description
                       else nullif(btrim(p_description), '') end,
    category_id = coalesce(p_category_id, a.category_id),
    ownership_kind = coalesce(p_ownership_kind, a.ownership_kind),
    ownership_note = case when p_ownership_note is null then a.ownership_note
                          else nullif(btrim(p_ownership_note), '') end,
    manufacturer = case when p_manufacturer is null then a.manufacturer
                        else nullif(btrim(p_manufacturer), '') end,
    model = case when p_model is null then a.model else nullif(btrim(p_model), '') end,
    serial_number = case when p_serial_number is null then a.serial_number
                         else nullif(btrim(p_serial_number), '') end,
    location_id = coalesce(p_location_id, a.location_id),
    location_note = case when p_location_note is null then a.location_note
                         else nullif(btrim(p_location_note), '') end,
    estimated_value_eur = coalesce(p_estimated_value_eur, a.estimated_value_eur),
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
  returning * into v_row;
  perform public.inventory_log_asset_event(
    v_row.id, 'updated', jsonb_build_object('before_status', v_before.operational_status), null
  );
  if v_before.ownership_kind is distinct from v_row.ownership_kind then
    perform public.inventory_log_asset_event(
      v_row.id, 'ownership_changed',
      jsonb_build_object('from', v_before.ownership_kind, 'to', v_row.ownership_kind), null
    );
  end if;
  if v_before.location_id is distinct from v_row.location_id then
    perform public.inventory_log_asset_event(
      v_row.id, 'location_changed',
      jsonb_build_object('from', v_before.location_id, 'to', v_row.location_id), null
    );
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_update_asset(
  uuid, text, text, uuid, text, text, text, text, text, uuid, text, numeric
) from public, anon;
grant execute on function public.inventory_update_asset(
  uuid, text, text, uuid, text, text, text, text, text, uuid, text, numeric
) to authenticated;

create or replace function public.inventory_set_asset_number(
  p_asset_id uuid,
  p_inventory_number text
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
  v_num text := nullif(btrim(coalesce(p_inventory_number, '')), '');
begin
  perform public.inventory_assert_cap('edit_assets');
  if v_num is null then
    raise exception 'inventory: inventory_number required' using errcode = '22023';
  end if;
  update public.inventory_assets as a
  set
    inventory_number = v_num,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
    and a.operational_status = 'draft'
  returning * into v_row;
  if not found then
    raise exception 'inventory: only draft assets can renumber' using errcode = '55000';
  end if;
  perform public.inventory_log_asset_event(
    v_row.id, 'updated', jsonb_build_object('inventory_number', v_num), 'number_assigned'
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_set_asset_number(uuid, text) from public, anon;
grant execute on function public.inventory_set_asset_number(uuid, text) to authenticated;

create or replace function public.inventory_activate_asset(
  p_asset_id uuid,
  p_idempotency_key uuid default null
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
begin
  perform public.inventory_assert_cap('edit_assets');
  if p_idempotency_key is not null then
    select * into v_row from public.inventory_assets as a
    where a.id = p_asset_id and a.operational_status in ('active', 'assigned')
      and a.idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;
  update public.inventory_assets as a
  set
    operational_status = 'active',
    idempotency_key = coalesce(a.idempotency_key, p_idempotency_key),
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
    and a.operational_status = 'draft'
  returning * into v_row;
  if not found then
    select * into v_row from public.inventory_assets as a where a.id = p_asset_id;
    if found and v_row.operational_status in ('active', 'assigned') then
      return v_row; -- idempotent re-activate
    end if;
    raise exception 'inventory: activate requires draft status' using errcode = '55000';
  end if;
  perform public.inventory_log_asset_event(
    v_row.id, 'status_changed',
    jsonb_build_object('from', 'draft', 'to', 'active'), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_activate_asset(uuid, uuid) from public, anon;
grant execute on function public.inventory_activate_asset(uuid, uuid) to authenticated;

create or replace function public.inventory_assign_asset(
  p_asset_id uuid,
  p_staff_id bigint,
  p_to_location_id uuid default null,
  p_note text default null
)
returns public.inventory_assignments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_asset public.inventory_assets%rowtype;
  v_asg public.inventory_assignments%rowtype;
  v_from_loc uuid;
begin
  perform public.inventory_assert_cap('edit_assets');
  select * into v_asset from public.inventory_assets as a where a.id = p_asset_id for update;
  if not found then
    raise exception 'inventory: asset not found' using errcode = 'P0002';
  end if;
  if v_asset.operational_status not in ('active', 'assigned', 'maintenance') then
    raise exception 'inventory: cannot assign from status %', v_asset.operational_status
      using errcode = '55000';
  end if;
  if not exists (select 1 from public.staff as s where s.id = p_staff_id and s.active is true) then
    raise exception 'inventory: staff not found' using errcode = 'P0002';
  end if;
  v_from_loc := v_asset.location_id;
  update public.inventory_assignments
  set released_at = now(), release_reason = 'reassigned'
  where asset_id = p_asset_id and released_at is null;
  insert into public.inventory_assignments (
    asset_id, assigned_to_staff_id, assigned_by_email,
    from_location_id, to_location_id, note
  ) values (
    p_asset_id, p_staff_id, public.inventory_actor_email(),
    v_from_loc, p_to_location_id, nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_asg;
  update public.inventory_assets as a
  set
    responsible_staff_id = p_staff_id,
    location_id = coalesce(p_to_location_id, a.location_id),
    operational_status = 'assigned',
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id;
  perform public.inventory_log_asset_event(
    p_asset_id, 'assigned',
    jsonb_build_object('staff_id', p_staff_id, 'assignment_id', v_asg.id), p_note
  );
  return v_asg;
end;
$fn$;

revoke all on function public.inventory_assign_asset(uuid, bigint, uuid, text) from public, anon;
grant execute on function public.inventory_assign_asset(uuid, bigint, uuid, text) to authenticated;

create or replace function public.inventory_transfer_asset(
  p_asset_id uuid,
  p_to_staff_id bigint default null,
  p_to_location_id uuid default null,
  p_note text default null
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_asset public.inventory_assets%rowtype;
  v_from_staff bigint;
  v_from_loc uuid;
begin
  perform public.inventory_assert_cap('edit_assets');
  if p_to_staff_id is null and p_to_location_id is null then
    raise exception 'inventory: transfer target required' using errcode = '22023';
  end if;
  select * into v_asset from public.inventory_assets as a where a.id = p_asset_id for update;
  if not found then
    raise exception 'inventory: asset not found' using errcode = 'P0002';
  end if;
  if v_asset.operational_status not in ('active', 'assigned', 'maintenance') then
    raise exception 'inventory: cannot transfer from status %', v_asset.operational_status
      using errcode = '55000';
  end if;
  v_from_staff := v_asset.responsible_staff_id;
  v_from_loc := v_asset.location_id;
  if p_to_staff_id is not null then
    perform public.inventory_assign_asset(p_asset_id, p_to_staff_id, p_to_location_id, p_note);
  else
    update public.inventory_assets as a
    set
      location_id = p_to_location_id,
      updated_at = now(),
      updated_by_email = public.inventory_actor_email()
    where a.id = p_asset_id
    returning * into v_asset;
    perform public.inventory_log_asset_event(
      p_asset_id, 'transferred',
      jsonb_build_object(
        'from_location', v_from_loc, 'to_location', p_to_location_id,
        'from_staff', v_from_staff
      ), p_note
    );
  end if;
  select * into v_asset from public.inventory_assets as a where a.id = p_asset_id;
  return v_asset;
end;
$fn$;

revoke all on function public.inventory_transfer_asset(uuid, bigint, uuid, text) from public, anon;
grant execute on function public.inventory_transfer_asset(uuid, bigint, uuid, text) to authenticated;

create or replace function public.inventory_set_asset_condition(
  p_asset_id uuid,
  p_condition text
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
  v_before text;
begin
  perform public.inventory_assert_cap('edit_assets');
  if p_condition not in ('new', 'good', 'fair', 'poor', 'unserviceable') then
    raise exception 'inventory: invalid condition' using errcode = '22023';
  end if;
  select a.condition into v_before from public.inventory_assets as a where a.id = p_asset_id;
  update public.inventory_assets as a
  set condition = p_condition, updated_at = now(), updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
    and a.operational_status not in ('written_off', 'archived')
  returning * into v_row;
  if not found then
    raise exception 'inventory: asset not found or terminal' using errcode = 'P0002';
  end if;
  perform public.inventory_log_asset_event(
    v_row.id, 'condition_changed',
    jsonb_build_object('from', v_before, 'to', p_condition), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_set_asset_condition(uuid, text) from public, anon;
grant execute on function public.inventory_set_asset_condition(uuid, text) to authenticated;

create or replace function public.inventory_record_maintenance(
  p_asset_id uuid,
  p_event_kind text,
  p_summary text,
  p_performed_on date default null,
  p_cost_eur numeric default null,
  p_work_order_id uuid default null
)
returns public.inventory_maintenance_events
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_maintenance_events%rowtype;
  v_status text;
begin
  perform public.inventory_assert_cap('edit_assets');
  if p_event_kind not in ('inspection', 'repair', 'service', 'calibration', 'other') then
    raise exception 'inventory: invalid maintenance kind' using errcode = '22023';
  end if;
  select a.operational_status into v_status from public.inventory_assets as a where a.id = p_asset_id;
  if v_status is null or v_status in ('draft', 'written_off', 'archived') then
    raise exception 'inventory: maintenance not allowed for status %', v_status
      using errcode = '55000';
  end if;
  insert into public.inventory_maintenance_events (
    asset_id, event_kind, performed_on, performed_by_staff_id, performed_by_email,
    summary, cost_eur, work_order_id
  ) values (
    p_asset_id, p_event_kind,
    coalesce(p_performed_on, (timezone('Europe/Sofia', now()))::date),
    public.inventory_current_staff_id(), public.inventory_actor_email(),
    btrim(p_summary), p_cost_eur, p_work_order_id
  )
  returning * into v_row;
  update public.inventory_assets as a
  set operational_status = 'maintenance', updated_at = now(),
      updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id and a.operational_status in ('active', 'assigned', 'maintenance');
  perform public.inventory_log_asset_event(
    p_asset_id, 'maintenance',
    jsonb_build_object('maintenance_id', v_row.id, 'kind', p_event_kind), p_summary
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_record_maintenance(
  uuid, text, text, date, numeric, uuid
) from public, anon;
grant execute on function public.inventory_record_maintenance(
  uuid, text, text, date, numeric, uuid
) to authenticated;

create or replace function public.inventory_propose_asset_write_off(
  p_asset_id uuid,
  p_reason text
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.inventory_assert_cap('write_off');
  if v_reason is null then
    raise exception 'inventory: write-off reason required' using errcode = '22023';
  end if;
  update public.inventory_assets as a
  set
    write_off_reason = v_reason,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
    and a.operational_status in ('active', 'assigned', 'maintenance')
  returning * into v_row;
  if not found then
    raise exception 'inventory: write-off propose not allowed' using errcode = '55000';
  end if;
  perform public.inventory_log_asset_event(
    v_row.id, 'status_changed',
    jsonb_build_object('stage', 'write_off_proposed', 'reason', v_reason), v_reason
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_propose_asset_write_off(uuid, text) from public, anon;
grant execute on function public.inventory_propose_asset_write_off(uuid, text) to authenticated;

create or replace function public.inventory_approve_asset_write_off(
  p_asset_id uuid,
  p_reason text default null
)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
  v_reason text;
begin
  perform public.inventory_assert_authenticated();
  if not public.inventory_is_admin() then
    raise exception 'inventory: admin approval required for write-off' using errcode = '42501';
  end if;
  select * into v_row from public.inventory_assets as a where a.id = p_asset_id for update;
  if not found then
    raise exception 'inventory: asset not found' using errcode = 'P0002';
  end if;
  if v_row.operational_status = 'written_off' then
    return v_row; -- idempotent
  end if;
  if v_row.operational_status in ('draft', 'archived') then
    raise exception 'inventory: cannot write off status %', v_row.operational_status
      using errcode = '55000';
  end if;
  v_reason := coalesce(
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_row.write_off_reason
  );
  if v_reason is null then
    raise exception 'inventory: write-off reason required' using errcode = '22023';
  end if;
  update public.inventory_assignments
  set released_at = now(), release_reason = 'written_off'
  where asset_id = p_asset_id and released_at is null;
  update public.inventory_assets as a
  set
    operational_status = 'written_off',
    written_off_at = now(),
    write_off_reason = v_reason,
    write_off_by_email = public.inventory_actor_email(),
    responsible_staff_id = null,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
  returning * into v_row;
  perform public.inventory_log_asset_event(
    v_row.id, 'write_off', jsonb_build_object('reason', v_reason), v_reason
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_approve_asset_write_off(uuid, text) from public, anon;
grant execute on function public.inventory_approve_asset_write_off(uuid, text) to authenticated;

create or replace function public.inventory_archive_asset(p_asset_id uuid)
returns public.inventory_assets
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_assets%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not public.inventory_is_admin() then
    raise exception 'inventory: admin only' using errcode = '42501';
  end if;
  update public.inventory_assets as a
  set
    operational_status = 'archived',
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where a.id = p_asset_id
    and a.operational_status = 'written_off'
  returning * into v_row;
  if not found then
    select * into v_row from public.inventory_assets as a where a.id = p_asset_id;
    if found and v_row.operational_status = 'archived' then
      return v_row;
    end if;
    raise exception 'inventory: archive requires written_off' using errcode = '55000';
  end if;
  perform public.inventory_log_asset_event(
    v_row.id, 'status_changed',
    jsonb_build_object('from', 'written_off', 'to', 'archived'), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_archive_asset(uuid) from public, anon;
grant execute on function public.inventory_archive_asset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Stock operations
-- ---------------------------------------------------------------------------

create or replace function public.inventory_register_stock_item(
  p_sku_code text,
  p_name text,
  p_ownership_kind text,
  p_unit_code text,
  p_category_id uuid default null,
  p_ownership_note text default null,
  p_default_location_id uuid default null,
  p_min_qty numeric default null,
  p_estimated_unit_value_eur numeric default null,
  p_idempotency_key uuid default null,
  p_description text default null
)
returns public.inventory_stock_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_stock_items%rowtype;
  v_sku text := nullif(btrim(coalesce(p_sku_code, '')), '');
begin
  perform public.inventory_assert_cap('stock_move');
  if p_idempotency_key is not null then
    select * into v_row from public.inventory_stock_items as s
    where s.idempotency_key = p_idempotency_key;
    if found then return v_row; end if;
  end if;
  if v_sku is null or nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'inventory: sku and name required' using errcode = '22023';
  end if;
  if p_ownership_kind not in ('CONDOMINIUM', 'MANAGEMENT_COMPANY', 'THIRD_PARTY') then
    raise exception 'inventory: invalid ownership_kind' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_units as u where u.code = p_unit_code) then
    raise exception 'inventory: unknown unit' using errcode = '22023';
  end if;
  insert into public.inventory_stock_items (
    sku_code, name, description, category_id, ownership_kind, ownership_note,
    unit_code, default_location_id, min_qty, estimated_unit_value_eur,
    idempotency_key, created_by_email, updated_by_email
  ) values (
    v_sku, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    p_category_id, p_ownership_kind, nullif(btrim(coalesce(p_ownership_note, '')), ''),
    p_unit_code, p_default_location_id, p_min_qty, p_estimated_unit_value_eur,
    p_idempotency_key, public.inventory_actor_email(), public.inventory_actor_email()
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_register_stock_item(
  text, text, text, text, uuid, text, uuid, numeric, numeric, uuid, text
) from public, anon;
grant execute on function public.inventory_register_stock_item(
  text, text, text, text, uuid, text, uuid, numeric, numeric, uuid, text
) to authenticated;

create or replace function public.inventory_stock_move(
  p_stock_item_id uuid,
  p_movement_type text,
  p_qty numeric,
  p_location_id uuid default null,
  p_from_location_id uuid default null,
  p_to_location_id uuid default null,
  p_reason text default null,
  p_idempotency_key uuid default null,
  p_session_item_id uuid default null
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item public.inventory_stock_items%rowtype;
  v_row public.inventory_stock_movements%rowtype;
  v_delta numeric;
  v_abs numeric;
begin
  perform public.inventory_assert_cap('stock_move');
  if p_idempotency_key is not null then
    select * into v_row from public.inventory_stock_movements as m
    where m.idempotency_key = p_idempotency_key;
    if found then return v_row; end if;
  end if;
  if p_movement_type not in (
    'OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'WRITE_OFF'
  ) then
    raise exception 'inventory: invalid movement_type' using errcode = '22023';
  end if;
  select * into v_item from public.inventory_stock_items as s
  where s.id = p_stock_item_id for update;
  if not found then
    raise exception 'inventory: stock item not found' using errcode = 'P0002';
  end if;
  if v_item.active is not true then
    raise exception 'inventory: stock item inactive' using errcode = '55000';
  end if;
  v_abs := abs(p_qty);
  if v_abs = 0 or p_qty is null then
    raise exception 'inventory: qty required nonzero' using errcode = '22023';
  end if;
  v_delta := case p_movement_type
    when 'OPENING' then v_abs
    when 'RECEIPT' then v_abs
    when 'ISSUE' then -v_abs
    when 'WRITE_OFF' then -v_abs
    when 'ADJUSTMENT' then p_qty  -- signed
    when 'TRANSFER' then v_abs
  end;
  insert into public.inventory_stock_movements (
    stock_item_id, location_id, movement_type, qty_delta, unit_code,
    from_location_id, to_location_id, reason, session_item_id, idempotency_key,
    created_by_email, created_by_staff_id
  ) values (
    p_stock_item_id,
    coalesce(p_location_id, v_item.default_location_id),
    p_movement_type, v_delta, v_item.unit_code,
    p_from_location_id, p_to_location_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_session_item_id, p_idempotency_key,
    public.inventory_actor_email(), public.inventory_current_staff_id()
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.inventory_stock_move(
  uuid, text, numeric, uuid, uuid, uuid, text, uuid, uuid
) from public, anon;
grant execute on function public.inventory_stock_move(
  uuid, text, numeric, uuid, uuid, uuid, text, uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Collaborative session operations
-- ---------------------------------------------------------------------------

create or replace function public.inventory_create_session(
  p_title text,
  p_scope_note text default null,
  p_zone_location_id uuid default null,
  p_category_id uuid default null,
  p_target_end_at timestamptz default null
)
returns public.inventory_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_sessions%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not (
    public.inventory_is_admin()
    or public.can_approve_inventory_session()
    or public.can_review_inventory_session()
    or public.inventory_staff_cap('edit_assets')
    or public.inventory_staff_cap('session_participate')
  ) then
    raise exception 'inventory: not allowed to create session' using errcode = '42501';
  end if;
  insert into public.inventory_sessions (
    title, status, scope_note, zone_location_id, category_id, target_end_at,
    created_by_email, updated_by_email
  ) values (
    btrim(p_title), 'DRAFT', nullif(btrim(coalesce(p_scope_note, '')), ''),
    p_zone_location_id, p_category_id, p_target_end_at,
    public.inventory_actor_email(), public.inventory_actor_email()
  )
  returning * into v_row;
  -- auto-add creator as lead when staff id known
  if public.inventory_current_staff_id() is not null then
    insert into public.inventory_session_participants (
      session_id, staff_id, role_in_session
    ) values (
      v_row.id, public.inventory_current_staff_id(), 'lead'
    )
    on conflict (session_id, staff_id) do nothing;
  end if;
  perform public.inventory_log_session_event(
    v_row.id, 'created', jsonb_build_object('title', v_row.title), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_create_session(
  text, text, uuid, uuid, timestamptz
) from public, anon;
grant execute on function public.inventory_create_session(
  text, text, uuid, uuid, timestamptz
) to authenticated;

create or replace function public.inventory_add_session_participant(
  p_session_id uuid,
  p_staff_id bigint,
  p_role_in_session text default 'counter',
  p_assigned_zone_location_id uuid default null,
  p_assigned_category_id uuid default null
)
returns public.inventory_session_participants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_session_participants%rowtype;
  v_status text;
begin
  perform public.inventory_assert_authenticated();
  if not (
    public.inventory_is_admin()
    or public.can_approve_inventory_session()
    or public.can_review_inventory_session()
  ) then
    raise exception 'inventory: not allowed to assign participants' using errcode = '42501';
  end if;
  select s.status into v_status from public.inventory_sessions as s where s.id = p_session_id;
  if v_status is null or v_status in ('APPROVED', 'CLOSED') then
    raise exception 'inventory: cannot add participants in status %', v_status
      using errcode = '55000';
  end if;
  if p_role_in_session not in ('counter', 'reviewer', 'lead') then
    raise exception 'inventory: invalid session role' using errcode = '22023';
  end if;
  insert into public.inventory_session_participants (
    session_id, staff_id, role_in_session,
    assigned_zone_location_id, assigned_category_id, active
  ) values (
    p_session_id, p_staff_id, p_role_in_session,
    p_assigned_zone_location_id, p_assigned_category_id, true
  )
  on conflict (session_id, staff_id) do update set
    role_in_session = excluded.role_in_session,
    assigned_zone_location_id = excluded.assigned_zone_location_id,
    assigned_category_id = excluded.assigned_category_id,
    active = true
  returning * into v_row;
  perform public.inventory_log_session_event(
    p_session_id, 'participant_added',
    jsonb_build_object('staff_id', p_staff_id, 'role', p_role_in_session), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_add_session_participant(
  uuid, bigint, text, uuid, uuid
) from public, anon;
grant execute on function public.inventory_add_session_participant(
  uuid, bigint, text, uuid, uuid
) to authenticated;

create or replace function public.inventory_start_session(
  p_session_id uuid,
  p_row_version integer
)
returns public.inventory_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_sessions%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not (
    public.inventory_is_admin()
    or public.can_approve_inventory_session()
    or public.can_review_inventory_session()
  ) then
    perform public.inventory_assert_session_participant(p_session_id);
  end if;
  select * into v_row from public.inventory_sessions as s
  where s.id = p_session_id for update;
  if not found then
    raise exception 'inventory: session not found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('DRAFT', 'IN_PROGRESS') then
    raise exception 'inventory: cannot start from %', v_row.status using errcode = '55000';
  end if;
  if v_row.status = 'IN_PROGRESS' and v_row.row_version = p_row_version then
    return v_row; -- idempotent start
  end if;
  update public.inventory_sessions as s
  set
    status = 'IN_PROGRESS',
    started_at = coalesce(s.started_at, now()),
    row_version = s.row_version + 1,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where s.id = p_session_id
    and s.row_version = p_row_version
  returning * into v_row;
  if not found then
    raise exception 'inventory: stale session row_version' using errcode = '40001';
  end if;
  perform public.inventory_log_session_event(p_session_id, 'started', '{}'::jsonb, null);
  return v_row;
end;
$fn$;

revoke all on function public.inventory_start_session(uuid, integer) from public, anon;
grant execute on function public.inventory_start_session(uuid, integer) to authenticated;

create or replace function public.inventory_add_session_item(
  p_session_id uuid,
  p_tracking_type text,
  p_draft_name text,
  p_asset_id uuid default null,
  p_stock_item_id uuid default null,
  p_draft_inventory_number text default null,
  p_draft_sku_code text default null,
  p_draft_category_id uuid default null,
  p_draft_ownership_kind text default null,
  p_draft_location_id uuid default null,
  p_draft_condition text default null,
  p_expected_qty numeric default null,
  p_counted_qty numeric default null,
  p_unit_code text default null,
  p_discrepancy_note text default null
)
returns public.inventory_session_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sess public.inventory_sessions%rowtype;
  v_row public.inventory_session_items%rowtype;
begin
  perform public.inventory_assert_session_participant(p_session_id);
  select * into v_sess from public.inventory_sessions as s where s.id = p_session_id;
  if v_sess.status not in ('DRAFT', 'IN_PROGRESS') then
    raise exception 'inventory: cannot add findings in %', v_sess.status using errcode = '55000';
  end if;
  if p_tracking_type not in ('INDIVIDUAL_ASSET', 'QUANTITY_STOCK') then
    raise exception 'inventory: invalid tracking_type' using errcode = '22023';
  end if;
  insert into public.inventory_session_items (
    session_id, tracking_type, asset_id, stock_item_id,
    draft_inventory_number, draft_sku_code, draft_name, draft_category_id,
    draft_ownership_kind, draft_location_id, draft_condition,
    expected_qty, counted_qty, unit_code, discrepancy_note,
    finding_status, entered_by_staff_id, entered_by_email
  ) values (
    p_session_id, p_tracking_type, p_asset_id, p_stock_item_id,
    nullif(btrim(coalesce(p_draft_inventory_number, '')), ''),
    nullif(btrim(coalesce(p_draft_sku_code, '')), ''),
    btrim(p_draft_name), p_draft_category_id, p_draft_ownership_kind,
    p_draft_location_id, p_draft_condition,
    p_expected_qty, p_counted_qty, p_unit_code,
    nullif(btrim(coalesce(p_discrepancy_note, '')), ''),
    'draft', public.inventory_current_staff_id(), public.inventory_actor_email()
  )
  returning * into v_row;
  perform public.inventory_log_session_event(
    p_session_id, 'item_draft_saved',
    jsonb_build_object('item_id', v_row.id), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_add_session_item(
  uuid, text, text, uuid, uuid, text, text, uuid, text, uuid, text, numeric, numeric, text, text
) from public, anon;
grant execute on function public.inventory_add_session_item(
  uuid, text, text, uuid, uuid, text, text, uuid, text, uuid, text, numeric, numeric, text, text
) to authenticated;

create or replace function public.inventory_update_session_item(
  p_item_id uuid,
  p_row_version integer,
  p_draft_name text default null,
  p_draft_inventory_number text default null,
  p_draft_sku_code text default null,
  p_draft_category_id uuid default null,
  p_draft_ownership_kind text default null,
  p_draft_location_id uuid default null,
  p_draft_condition text default null,
  p_expected_qty numeric default null,
  p_counted_qty numeric default null,
  p_unit_code text default null,
  p_discrepancy_note text default null
)
returns public.inventory_session_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.inventory_session_items%rowtype;
  v_row public.inventory_session_items%rowtype;
  v_sid bigint;
begin
  select * into v_before from public.inventory_session_items as i where i.id = p_item_id;
  if not found then
    raise exception 'inventory: session item not found' using errcode = 'P0002';
  end if;
  perform public.inventory_assert_session_participant(v_before.session_id);
  v_sid := public.inventory_current_staff_id();
  if not public.inventory_is_admin()
     and not public.can_review_inventory_session()
     and v_before.entered_by_staff_id is distinct from v_sid then
    raise exception 'inventory: can only edit own draft findings' using errcode = '42501';
  end if;
  if v_before.finding_status not in ('draft', 'submitted') then
    raise exception 'inventory: item not editable in status %', v_before.finding_status
      using errcode = '55000';
  end if;
  update public.inventory_session_items as i
  set
    draft_name = coalesce(nullif(btrim(coalesce(p_draft_name, '')), ''), i.draft_name),
    draft_inventory_number = case when p_draft_inventory_number is null then i.draft_inventory_number
      else nullif(btrim(p_draft_inventory_number), '') end,
    draft_sku_code = case when p_draft_sku_code is null then i.draft_sku_code
      else nullif(btrim(p_draft_sku_code), '') end,
    draft_category_id = coalesce(p_draft_category_id, i.draft_category_id),
    draft_ownership_kind = coalesce(p_draft_ownership_kind, i.draft_ownership_kind),
    draft_location_id = coalesce(p_draft_location_id, i.draft_location_id),
    draft_condition = coalesce(p_draft_condition, i.draft_condition),
    expected_qty = coalesce(p_expected_qty, i.expected_qty),
    counted_qty = coalesce(p_counted_qty, i.counted_qty),
    unit_code = coalesce(p_unit_code, i.unit_code),
    discrepancy_note = case when p_discrepancy_note is null then i.discrepancy_note
      else nullif(btrim(p_discrepancy_note), '') end,
    finding_status = 'draft',
    row_version = i.row_version + 1,
    updated_at = now()
  where i.id = p_item_id
    and i.row_version = p_row_version
  returning * into v_row;
  if not found then
    raise exception 'inventory: stale item row_version' using errcode = '40001';
  end if;
  perform public.inventory_log_session_event(
    v_row.session_id, 'item_draft_saved',
    jsonb_build_object('item_id', v_row.id, 'row_version', v_row.row_version), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_update_session_item(
  uuid, integer, text, text, text, uuid, text, uuid, text, numeric, numeric, text, text
) from public, anon;
grant execute on function public.inventory_update_session_item(
  uuid, integer, text, text, text, uuid, text, uuid, text, numeric, numeric, text, text
) to authenticated;

create or replace function public.inventory_submit_session_item(p_item_id uuid)
returns public.inventory_session_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_session_items%rowtype;
begin
  select * into v_row from public.inventory_session_items as i where i.id = p_item_id;
  if not found then
    raise exception 'inventory: session item not found' using errcode = 'P0002';
  end if;
  perform public.inventory_assert_session_participant(v_row.session_id);
  update public.inventory_session_items as i
  set finding_status = 'submitted', updated_at = now(), row_version = i.row_version + 1
  where i.id = p_item_id and i.finding_status in ('draft', 'submitted')
  returning * into v_row;
  if not found then
    raise exception 'inventory: cannot submit item' using errcode = '55000';
  end if;
  perform public.inventory_log_session_event(
    v_row.session_id, 'item_submitted', jsonb_build_object('item_id', v_row.id), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_submit_session_item(uuid) from public, anon;
grant execute on function public.inventory_submit_session_item(uuid) to authenticated;

create or replace function public.inventory_submit_session_for_review(
  p_session_id uuid,
  p_row_version integer
)
returns public.inventory_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_sessions%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not (
    public.inventory_is_admin()
    or public.can_review_inventory_session()
    or public.can_approve_inventory_session()
  ) then
    perform public.inventory_assert_session_participant(p_session_id);
  end if;
  select * into v_row from public.inventory_sessions as s where s.id = p_session_id;
  if v_row.status not in ('IN_PROGRESS', 'REVIEW') then
    raise exception 'inventory: submit-for-review requires IN_PROGRESS' using errcode = '55000';
  end if;
  if v_row.status = 'REVIEW' then
    return v_row;
  end if;
  v_row := public.inventory_bump_session(p_session_id, p_row_version, 'REVIEW');
  -- mark remaining drafts as submitted
  update public.inventory_session_items as i
  set finding_status = 'submitted', updated_at = now()
  where i.session_id = p_session_id and i.finding_status = 'draft';
  perform public.inventory_log_session_event(
    p_session_id, 'submitted_for_review', '{}'::jsonb, null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_submit_session_for_review(uuid, integer)
  from public, anon;
grant execute on function public.inventory_submit_session_for_review(uuid, integer)
  to authenticated;

create or replace function public.inventory_review_session_item(
  p_item_id uuid,
  p_decision text,
  p_note text default null
)
returns public.inventory_session_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_session_items%rowtype;
  v_status text;
begin
  perform public.inventory_assert_authenticated();
  if not (
    public.inventory_is_admin()
    or public.can_review_inventory_session()
    or public.can_approve_inventory_session()
  ) then
    raise exception 'inventory: review not allowed' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'inventory: decision must be accepted|rejected' using errcode = '22023';
  end if;
  select * into v_row from public.inventory_session_items as i where i.id = p_item_id;
  if not found then
    raise exception 'inventory: session item not found' using errcode = 'P0002';
  end if;
  select s.status into v_status
  from public.inventory_sessions as s
  where s.id = v_row.session_id;
  if v_status not in ('REVIEW', 'IN_PROGRESS') then
    raise exception 'inventory: review not allowed in session %', v_status
      using errcode = '55000';
  end if;
  update public.inventory_session_items as i
  set
    finding_status = p_decision,
    discrepancy_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), i.discrepancy_note),
    updated_at = now(),
    row_version = i.row_version + 1
  where i.id = p_item_id
    and i.finding_status in ('draft', 'submitted', 'accepted', 'rejected')
  returning * into v_row;
  perform public.inventory_log_session_event(
    v_row.session_id,
    case when p_decision = 'accepted' then 'item_accepted' else 'item_rejected' end,
    jsonb_build_object('item_id', v_row.id), p_note
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_review_session_item(uuid, text, text) from public, anon;
grant execute on function public.inventory_review_session_item(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Internal balance posting (admin approve + post)
-- ---------------------------------------------------------------------------

create or replace function public.inventory_post_session_item(p_item_id uuid)
returns public.inventory_session_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item public.inventory_session_items%rowtype;
  v_asset public.inventory_assets%rowtype;
  v_stock public.inventory_stock_items%rowtype;
  v_on_hand numeric;
  v_delta numeric;
  v_idem uuid;
  v_num text;
  v_sku text;
  v_own text;
begin
  select * into v_item from public.inventory_session_items as i
  where i.id = p_item_id for update;
  if not found then
    raise exception 'inventory: session item not found' using errcode = 'P0002';
  end if;
  if v_item.finding_status = 'posted' then
    return v_item; -- idempotent
  end if;
  if v_item.finding_status not in ('accepted', 'submitted') then
    raise exception 'inventory: item not postable (%)', v_item.finding_status
      using errcode = '55000';
  end if;
  v_idem := v_item.id; -- stable idempotency from session item

  if v_item.tracking_type = 'INDIVIDUAL_ASSET' then
    if v_item.asset_id is not null then
      select * into v_asset from public.inventory_assets as a
      where a.id = v_item.asset_id for update;
      if not found then
        raise exception 'inventory: linked asset missing' using errcode = 'P0002';
      end if;
      update public.inventory_assets as a
      set
        condition = coalesce(v_item.draft_condition, a.condition),
        location_id = coalesce(v_item.draft_location_id, a.location_id),
        updated_at = now(),
        updated_by_email = public.inventory_actor_email()
      where a.id = v_asset.id;
      perform public.inventory_log_asset_event(
        v_asset.id, 'session_posted',
        jsonb_build_object('session_item_id', v_item.id), null
      );
      update public.inventory_session_items as i
      set
        finding_status = 'posted',
        posted_asset_id = v_asset.id,
        posted_at = now(),
        updated_at = now()
      where i.id = v_item.id
      returning * into v_item;
      return v_item;
    end if;

    v_num := coalesce(
      nullif(btrim(coalesce(v_item.draft_inventory_number, '')), ''),
      'OPEN-' || substr(replace(v_item.id::text, '-', ''), 1, 12)
    );
    if exists (
      select 1 from public.inventory_assets as a where a.inventory_number = v_num
    ) then
      raise exception 'inventory: inventory_number conflict on post (%)', v_num
        using errcode = '23505';
    end if;
    v_own := coalesce(v_item.draft_ownership_kind, 'CONDOMINIUM');
    insert into public.inventory_assets (
      inventory_number, name, category_id, ownership_kind,
      location_id, condition, operational_status, acquisition_method,
      opening_import, idempotency_key, created_by_email, updated_by_email
    ) values (
      v_num, v_item.draft_name, v_item.draft_category_id, v_own,
      v_item.draft_location_id, coalesce(v_item.draft_condition, 'good'),
      'active', 'internal_balance', true, v_idem,
      public.inventory_actor_email(), public.inventory_actor_email()
    )
    on conflict (idempotency_key) do update
      set updated_at = now()
    returning * into v_asset;
    perform public.inventory_log_asset_event(
      v_asset.id, 'opening_import',
      jsonb_build_object('session_item_id', v_item.id, 'method', 'internal_balance'), null
    );
    update public.inventory_session_items as i
    set finding_status = 'posted', posted_asset_id = v_asset.id,
        asset_id = coalesce(i.asset_id, v_asset.id), posted_at = now(), updated_at = now()
    where i.id = v_item.id
    returning * into v_item;
    return v_item;
  end if;

  -- QUANTITY_STOCK
  if v_item.stock_item_id is not null then
    select * into v_stock from public.inventory_stock_items as s
    where s.id = v_item.stock_item_id for update;
  else
    v_sku := coalesce(
      nullif(btrim(coalesce(v_item.draft_sku_code, '')), ''),
      'SKU-' || substr(replace(v_item.id::text, '-', ''), 1, 12)
    );
    select * into v_stock from public.inventory_stock_items as s
    where s.idempotency_key = v_idem;
    if not found then
      if exists (select 1 from public.inventory_stock_items as s where s.sku_code = v_sku) then
        raise exception 'inventory: sku conflict on post (%)', v_sku using errcode = '23505';
      end if;
      if v_item.unit_code is null then
        raise exception 'inventory: unit_code required for new stock post' using errcode = '22023';
      end if;
      insert into public.inventory_stock_items (
        sku_code, name, category_id, ownership_kind, unit_code,
        default_location_id, opening_import, idempotency_key,
        created_by_email, updated_by_email
      ) values (
        v_sku, v_item.draft_name, v_item.draft_category_id,
        coalesce(v_item.draft_ownership_kind, 'CONDOMINIUM'),
        v_item.unit_code, v_item.draft_location_id, true, v_idem,
        public.inventory_actor_email(), public.inventory_actor_email()
      )
      returning * into v_stock;
    end if;
  end if;

  v_on_hand := public.inventory_stock_on_hand(v_stock.id);
  if v_item.counted_qty is null then
    raise exception 'inventory: counted_qty required for stock post' using errcode = '22023';
  end if;
  if v_item.counted_qty < 0 then
    raise exception 'inventory: counted_qty cannot be negative' using errcode = '22023';
  end if;
  v_delta := v_item.counted_qty - v_on_hand;
  if v_delta <> 0 then
    if v_delta > 0
       and v_on_hand = 0
       and not exists (
         select 1 from public.inventory_stock_movements as m where m.stock_item_id = v_stock.id
       ) then
      perform public.inventory_stock_move(
        v_stock.id, 'OPENING', v_delta, v_item.draft_location_id,
        null, null, 'session_opening', v_idem, v_item.id
      );
    else
      perform public.inventory_stock_move(
        v_stock.id, 'ADJUSTMENT', v_delta, v_item.draft_location_id,
        null, null, 'session_adjustment', v_idem, v_item.id
      );
    end if;
  end if;

  update public.inventory_session_items as i
  set
    finding_status = 'posted',
    posted_stock_item_id = v_stock.id,
    stock_item_id = coalesce(i.stock_item_id, v_stock.id),
    posted_at = now(),
    updated_at = now()
  where i.id = v_item.id
  returning * into v_item;
  return v_item;
end;
$fn$;

revoke all on function public.inventory_post_session_item(uuid) from public, anon;
-- Internal helper: grant to authenticated for admin post path (still authz inside approve)
grant execute on function public.inventory_post_session_item(uuid) to authenticated;

create or replace function public.inventory_approve_and_post_session(
  p_session_id uuid,
  p_row_version integer,
  p_approval_note text default null
)
returns public.inventory_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_sessions%rowtype;
  r record;
  v_unresolved int;
begin
  perform public.inventory_assert_authenticated();
  if not public.inventory_is_admin() and not public.can_approve_inventory_session() then
    raise exception 'inventory: administrator approval required' using errcode = '42501';
  end if;
  -- Prefer admin for final approval (participants with only participate cannot approve)
  if not public.inventory_is_admin()
     and not public.inventory_staff_cap('approve_sessions') then
    raise exception 'inventory: administrator approval required' using errcode = '42501';
  end if;

  select * into v_row from public.inventory_sessions as s
  where s.id = p_session_id for update;
  if not found then
    raise exception 'inventory: session not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'APPROVED' then
    return v_row; -- already approved (items already posted or empty)
  end if;
  if v_row.status = 'CLOSED' then
    raise exception 'inventory: session closed' using errcode = '55000';
  end if;
  if v_row.status not in ('REVIEW', 'IN_PROGRESS') then
    raise exception 'inventory: approve requires REVIEW (or IN_PROGRESS)' using errcode = '55000';
  end if;
  if v_row.row_version <> p_row_version then
    raise exception 'inventory: stale session row_version' using errcode = '40001';
  end if;

  -- Auto-accept remaining submitted items; fail closed on draft leftovers
  select count(*) into v_unresolved
  from public.inventory_session_items as i
  where i.session_id = p_session_id and i.finding_status = 'draft';
  if v_unresolved > 0 then
    raise exception 'inventory: unresolved draft findings (%)', v_unresolved
      using errcode = '55000';
  end if;

  update public.inventory_session_items as i
  set finding_status = 'accepted', updated_at = now()
  where i.session_id = p_session_id and i.finding_status = 'submitted';

  for r in
    select i.id
    from public.inventory_session_items as i
    where i.session_id = p_session_id
      and i.finding_status = 'accepted'
    order by i.created_at, i.id
  loop
    perform public.inventory_post_session_item(r.id);
  end loop;

  update public.inventory_sessions as s
  set
    status = 'APPROVED',
    approved_at = now(),
    approved_by_email = public.inventory_actor_email(),
    approval_note = nullif(btrim(coalesce(p_approval_note, '')), ''),
    row_version = s.row_version + 1,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where s.id = p_session_id
    and s.row_version = p_row_version
  returning * into v_row;
  if not found then
    raise exception 'inventory: stale session row_version' using errcode = '40001';
  end if;

  perform public.inventory_log_session_event(
    p_session_id, 'approved',
    jsonb_build_object('posted', true), p_approval_note
  );
  perform public.inventory_log_session_event(
    p_session_id, 'posted',
    jsonb_build_object('session_id', p_session_id), null
  );
  return v_row;
end;
$fn$;

revoke all on function public.inventory_approve_and_post_session(uuid, integer, text)
  from public, anon;
grant execute on function public.inventory_approve_and_post_session(uuid, integer, text)
  to authenticated;

create or replace function public.inventory_close_session(
  p_session_id uuid,
  p_row_version integer
)
returns public.inventory_sessions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.inventory_sessions%rowtype;
begin
  perform public.inventory_assert_authenticated();
  if not public.inventory_is_admin() and not public.can_approve_inventory_session() then
    raise exception 'inventory: admin required to close' using errcode = '42501';
  end if;
  select * into v_row from public.inventory_sessions as s where s.id = p_session_id;
  if v_row.status = 'CLOSED' then
    return v_row;
  end if;
  if v_row.status <> 'APPROVED' then
    raise exception 'inventory: close requires APPROVED' using errcode = '55000';
  end if;
  update public.inventory_sessions as s
  set
    status = 'CLOSED',
    closed_at = now(),
    row_version = s.row_version + 1,
    updated_at = now(),
    updated_by_email = public.inventory_actor_email()
  where s.id = p_session_id
    and s.row_version = p_row_version
  returning * into v_row;
  if not found then
    raise exception 'inventory: stale session row_version' using errcode = '40001';
  end if;
  perform public.inventory_log_session_event(p_session_id, 'closed', '{}'::jsonb, null);
  return v_row;
end;
$fn$;

revoke all on function public.inventory_close_session(uuid, integer) from public, anon;
grant execute on function public.inventory_close_session(uuid, integer) to authenticated;

-- Ensure module remains not auto-activated by this migration
update public.module_catalog
set implemented = false
where module_key = 'inventory' and implemented is distinct from false;

-- Do not set building_modules.enabled = true here.

commit;
