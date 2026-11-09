-- INV opening import: upsert category/location by code (not insert-only).
-- Without this, the second Excel row that needs the same new category hits
-- inventory_categories_code_uidx and the commit loop stops the rest of the file.

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
    on conflict (code) do update set
      parent_id = excluded.parent_id,
      name_bg = excluded.name_bg,
      name_ru = excluded.name_ru,
      name_en = excluded.name_en,
      description = coalesce(excluded.description, public.inventory_categories.description),
      sort_order = coalesce(excluded.sort_order, public.inventory_categories.sort_order),
      allowed_tracking_type = coalesce(
        excluded.allowed_tracking_type,
        public.inventory_categories.allowed_tracking_type
      ),
      active = true,
      archived_at = null,
      updated_at = now()
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
    on conflict (code) do update set
      name = excluded.name,
      location_kind = excluded.location_kind,
      property_id = coalesce(excluded.property_id, public.inventory_locations.property_id),
      note = coalesce(excluded.note, public.inventory_locations.note),
      active = true,
      updated_at = now()
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
