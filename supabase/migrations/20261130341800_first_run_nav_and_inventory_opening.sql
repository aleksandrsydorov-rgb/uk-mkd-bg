-- R1-RC8: clickable first-run nav (no stage regression on draft save)
-- + optional inventory_opening stage when module "inventory" is selected.
-- Does not re-open completed wizards (admin_save / complete already no-op when complete).

-- ---------------------------------------------------------------------------
-- Catalog: inventory opening between uk_expenses and complete
-- ---------------------------------------------------------------------------
insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values ('inventory_opening', 970, false, 'inventory', 'admin.firstRunStageInventory')
on conflict (stage_key) do update
  set sort_order = excluded.sort_order,
      required = excluded.required,
      module_key = excluded.module_key,
      label_i18n_key = excluded.label_i18n_key;

-- ---------------------------------------------------------------------------
-- Draft save: never move first_run_stage backwards; never un-complete a stage
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_first_run_progress(
  p_stage text,
  p_draft jsonb default '{}'::jsonb,
  p_complex jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_stage text;
  v_mode text;
  v_cur text;
  v_cur_ord integer;
  v_new_ord integer;
  v_keep_stage text;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.platform_installations as i
    where i.id = v_id and i.first_run_status = 'complete'
  ) then
    return public.admin_get_first_run_state();
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null then
    raise exception 'first_run: stage required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.first_run_stage_catalog as c where c.stage_key = v_stage
  ) then
    raise exception 'first_run: unknown stage %', v_stage using errcode = '22023';
  end if;

  if p_complex is not null then
    v_mode := case
      when lower(btrim(coalesce(p_complex ->> 'as_draft', ''))) in ('true', 't', '1', 'yes')
        then 'draft'
      else 'commit'
    end;
    perform public.apply_building_profile(v_id, p_complex, v_mode);
  end if;

  select i.first_run_stage into v_cur
  from public.platform_installations as i
  where i.id = v_id;

  select c.sort_order into v_cur_ord
  from public.first_run_stage_catalog as c
  where c.stage_key = coalesce(v_cur, '');
  select c.sort_order into v_new_ord
  from public.first_run_stage_catalog as c
  where c.stage_key = v_stage;

  -- Keep the furthest stage as resume pointer; viewing/saving a past step does not regress it.
  if v_cur_ord is not null and v_new_ord is not null and v_new_ord < v_cur_ord then
    v_keep_stage := v_cur;
  else
    v_keep_stage := v_stage;
  end if;

  update public.platform_installations as i
  set
    first_run_status = 'in_progress',
    first_run_stage = v_keep_stage,
    first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || coalesce(p_draft, '{}'::jsonb)
      || case
           when p_complex is null then '{}'::jsonb
           else jsonb_build_object('complex_profile', p_complex)
         end
      || jsonb_build_object(
           'current_stage', v_stage,
           'resume_stage', v_keep_stage
         ),
    updated_at = now()
  where i.id = v_id
    and i.first_run_status is distinct from 'complete';

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, updated_at, updated_by
  )
  values (
    v_id,
    v_stage,
    'in_progress',
    coalesce(p_draft, '{}'::jsonb)
      || case when p_complex is null then '{}'::jsonb else jsonb_build_object('complex_profile', p_complex) end,
    now(),
    auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = case
      when p.status = 'complete' then p.status
      else 'in_progress'
    end,
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    updated_at = now(),
    updated_by = auth.uid();

  return public.admin_get_first_run_state();
end;
$fn$;

revoke all on function public.admin_save_first_run_progress(text, jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_first_run_progress(text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Inventory opening readiness (defer OR import; never wipe existing assets)
-- ---------------------------------------------------------------------------
create or replace function public.first_run_assert_inventory_opening_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_deferred boolean;
  v_imported boolean;
  v_asset_count integer;
  v_stock_count integer;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if not public.first_run_draft_has_module(v_inst.first_run_draft, 'inventory') then
    return;
  end if;

  v_deferred := lower(btrim(coalesce(v_inst.first_run_draft ->> 'inventory_opening_deferred', '')))
    in ('true', 't', '1', 'yes');
  v_imported := lower(btrim(coalesce(v_inst.first_run_draft ->> 'inventory_opening_imported', '')))
    in ('true', 't', '1', 'yes');

  select count(*)::integer into v_asset_count from public.inventory_assets;
  select count(*)::integer into v_stock_count from public.inventory_stock_items;

  -- Explicit defer is allowed even with zero assets (upload later). Existing assets stay.
  if v_deferred then
    return;
  end if;

  if v_imported or v_asset_count > 0 or v_stock_count > 0 then
    return;
  end if;

  raise exception 'first_run: inventory opening missing'
    using errcode = 'P0001';
end;
$fn$;

revoke all on function public.first_run_assert_inventory_opening_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_inventory_opening_ready(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Coerce next: uk_expenses → inventory (if selected) → complete
-- ---------------------------------------------------------------------------
create or replace function public.first_run_coerce_next_stage(
  p_installation_id uuid,
  p_completed_stage text,
  p_requested_next text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_draft jsonb;
  v_next text := nullif(btrim(coalesce(p_requested_next, '')), '');
  v_internet boolean;
  v_internet_done boolean;
  v_need_budget boolean;
  v_need_inventory boolean;
  v_inventory_done boolean;
begin
  select i.first_run_draft into v_draft
  from public.platform_installations as i
  where i.id = p_installation_id;
  v_draft := coalesce(v_draft, '{}'::jsonb);
  v_internet := public.first_run_draft_has_module(v_draft, 'internet');
  select exists (
    select 1
    from public.first_run_stage_progress as p
    where p.installation_id = p_installation_id
      and p.stage_key = 'internet_opening'
      and p.status in ('complete', 'skipped')
  ) into v_internet_done;
  v_need_budget := public.first_run_draft_has_module(v_draft, 'budget');
  v_need_inventory := public.first_run_draft_has_module(v_draft, 'inventory');
  select exists (
    select 1
    from public.first_run_stage_progress as p
    where p.installation_id = p_installation_id
      and p.stage_key = 'inventory_opening'
      and p.status in ('complete', 'skipped')
  ) into v_inventory_done;

  if p_completed_stage = 'capital_repair_opening' then
    if v_next is null then
      return case when v_internet then 'internet_opening' else 'tariffs' end;
    end if;
    if v_internet and not v_internet_done
       and v_next in ('tariffs', 'budget', 'uk_expenses_opening', 'inventory_opening', 'complete') then
      return 'internet_opening';
    end if;
    return v_next;
  end if;

  if p_completed_stage = 'internet_opening' then
    if v_next is null or v_next in ('budget', 'uk_expenses_opening', 'inventory_opening', 'complete') then
      return 'tariffs';
    end if;
    return v_next;
  end if;

  if p_completed_stage = 'tariffs' then
    if v_internet and not v_internet_done then
      return 'internet_opening';
    end if;
    if not v_internet then
      perform public.first_run_skip_stage(p_installation_id, 'internet_opening');
    end if;
    if v_next is null or v_next = 'internet_opening' then
      return case when v_need_budget then 'budget' else 'uk_expenses_opening' end;
    end if;
    return v_next;
  end if;

  if p_completed_stage = 'uk_expenses_opening' then
    if not v_need_inventory then
      perform public.first_run_skip_stage(p_installation_id, 'inventory_opening');
      if v_next is null or v_next = 'inventory_opening' then
        return 'complete';
      end if;
      return v_next;
    end if;
    if v_next is null or v_next = 'complete' then
      return 'inventory_opening';
    end if;
    return v_next;
  end if;

  if p_completed_stage = 'inventory_opening' then
    if v_next is null then
      return 'complete';
    end if;
    return v_next;
  end if;

  return v_next;
end;
$function$;

revoke all on function public.first_run_coerce_next_stage(uuid, text, text) from public, anon;
grant execute on function public.first_run_coerce_next_stage(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Assert ready to complete: inventory when selected
-- ---------------------------------------------------------------------------
create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_inst public.platform_installations%rowtype;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_budget boolean := false;
  v_book_state text;
  v_water_state text;
  v_elec_state text;
  v_sf_state text;
  v_cr_state text;
  v_stage_status text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  perform public.first_run_assert_building_profile_ready(p_installation_id);

  foreach v_stage_status in array array[
    'welcome', 'modules_select', 'complex_card',
    'support_fee_opening', 'capital_repair_opening', 'tariffs', 'budget', 'uk_expenses_opening'
  ]
  loop
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = v_stage_status
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage % not complete', v_stage_status using errcode = 'P0001';
    end if;
  end loop;

  -- Property book: legacy single stage OR apartments + owners substages.
  if not exists (
    select 1 from public.first_run_stage_progress p
    where p.installation_id = p_installation_id
      and p.stage_key = 'property_book'
      and p.status = 'complete'
  ) and not (
    exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'property_book_objects'
        and p.status = 'complete'
    )
    and exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'property_book_owners'
        and p.status = 'complete'
    )
  ) then
    raise exception 'first_run: stage property_book not complete' using errcode = 'P0001';
  end if;

  v_need_water := public.first_run_draft_has_module(v_inst.first_run_draft, 'water');
  v_need_elec := public.first_run_draft_has_module(v_inst.first_run_draft, 'electricity');
  v_need_budget := public.first_run_draft_has_module(v_inst.first_run_draft, 'budget');

  select ml.state into v_book_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'property_book';
  if v_book_state is distinct from 'ACTIVE' then
    raise exception 'first_run: property_book must be ACTIVE (got %)', coalesce(v_book_state, 'missing')
      using errcode = 'P0001';
  end if;

  if v_need_water then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_water' and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_water stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_water_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'water';
    if v_water_state is distinct from 'ACTIVE' then
      raise exception 'first_run: water must be ACTIVE (got %)', coalesce(v_water_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  if v_need_elec then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_electricity stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_elec_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'electricity';
    if v_elec_state is distinct from 'ACTIVE' then
      raise exception 'first_run: electricity must be ACTIVE (got %)', coalesce(v_elec_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  select ml.state into v_sf_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'support_fee';
  if v_sf_state is distinct from 'ACTIVE' then
    raise exception 'first_run: support_fee must be ACTIVE (got %)', coalesce(v_sf_state, 'missing')
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.support_fee_opening_imports) then
    raise exception 'first_run: support_fee opening inventarisation missing' using errcode = 'P0001';
  end if;

  perform public.first_run_assert_capital_repair_opening_ready(p_installation_id);

  select ml.state into v_cr_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'capital_repair';
  if v_cr_state is distinct from 'ACTIVE' then
    raise exception 'first_run: capital_repair must be ACTIVE (got %)', coalesce(v_cr_state, 'missing')
      using errcode = 'P0001';
  end if;

  perform public.first_run_assert_tariffs_ready(p_installation_id);

  if public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'internet_opening'
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage internet_opening not complete' using errcode = 'P0001';
    end if;
    perform public.first_run_assert_internet_opening_ready(p_installation_id);
  end if;

  if v_need_budget then
    perform public.first_run_assert_budget_ready(p_installation_id);
  end if;
  perform public.first_run_assert_uk_expenses_opening_ready(p_installation_id);

  if public.first_run_draft_has_module(v_inst.first_run_draft, 'inventory') then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'inventory_opening'
        and p.status in ('complete', 'skipped')
    ) then
      raise exception 'first_run: stage inventory_opening not complete' using errcode = 'P0001';
    end if;
    perform public.first_run_assert_inventory_opening_ready(p_installation_id);
  end if;
end;
$function$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

-- Patched admin_complete_first_run_stage (inventory after uk_expenses)
CREATE OR REPLACE FUNCTION public.admin_complete_first_run_stage(p_stage text, p_next_stage text DEFAULT NULL::text, p_draft jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_budget boolean := false;
  v_draft jsonb;
  v_key text;
  v_stage_done text;
  v_activated_at timestamptz;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.platform_installations as i
    where i.id = v_id and i.first_run_status = 'complete'
  ) then
    return public.admin_get_first_run_state();
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');
  v_draft := coalesce(p_draft, '{}'::jsonb);

  if v_stage = 'modules_select' then
    if not (v_draft ? 'modules_selected') or jsonb_typeof(v_draft -> 'modules_selected') is distinct from 'array' then
      raise exception 'first_run: modules_selected required' using errcode = '22023';
    end if;

    foreach v_key in array array['property_book', 'support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode']
    loop
      if not exists (
        select 1
        from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
        where lower(btrim(t.v)) = v_key
      ) then
        raise exception 'first_run: required module % missing', v_key using errcode = '22023';
      end if;
    end loop;

    for v_key in
      select lower(btrim(t.v))
      from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
    loop
      if v_key in ('property_book', 'support_fee', 'capital_repair', 'water', 'electricity', 'budget', 'uk_expenses', 'guest_mode', 'tariffs') then
        continue;
      end if;
      if v_key in ('platform_support', 'user_activation', 'residence_status') then
        raise exception 'first_run: module % is not optional', v_key using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.module_catalog as c
        where c.module_key = v_key and c.implemented is true
      ) then
        raise exception 'first_run: module % is not available', v_key using errcode = '22023';
      end if;
    end loop;

    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_water' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'water') then
      raise exception 'first_run: water setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'electricity') then
      raise exception 'first_run: electricity setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'budget' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'budget') then
      raise exception 'first_run: budget setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;

    v_need_water := public.first_run_draft_has_module(v_draft, 'water');
    v_need_elec := public.first_run_draft_has_module(v_draft, 'electricity');
    v_selected := '[]'::jsonb;
    if v_need_water then
      v_selected := v_selected || jsonb_build_array('water');
    end if;
    if v_need_elec then
      v_selected := v_selected || jsonb_build_array('electricity');
    end if;
    v_draft := v_draft || jsonb_build_object('meters_selected', v_selected);

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;

    -- Connect selected catalog modules. This does not create charges or openings.
    for v_key in
      select distinct lower(btrim(t.v))
      from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
      union
      select unnest(array['support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'tariffs'])
    loop
      if exists (
        select 1 from public.module_catalog as c
        where c.module_key = v_key and c.implemented is true
      ) then
        perform public.set_building_module_enabled(v_key, true);
      end if;
    end loop;

    for v_key in
      select c.module_key
      from public.module_catalog as c
      where c.implemented is true
        and c.module_key not in ('support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'tariffs', 'platform_support', 'user_activation', 'residence_status')
        and not exists (
          select 1
          from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
          where lower(btrim(t.v)) = c.module_key
        )
    loop
      v_stage_done := case v_key
        when 'water' then 'meters_water'
        when 'electricity' then 'meters_electricity'
        when 'budget' then 'budget'
        else null
      end;
      if v_stage_done is not null and exists (
        select 1 from public.first_run_stage_progress p
        where p.installation_id = v_id and p.stage_key = v_stage_done and p.status = 'complete'
      ) then
        continue;
      end if;
      perform public.set_building_module_enabled(v_key, false);
    end loop;

    perform public.first_run_skip_stage(v_id, 'meters_select');
    if not v_need_water then
      perform public.first_run_skip_stage(v_id, 'meters_water');
    end if;
    if not v_need_elec then
      perform public.first_run_skip_stage(v_id, 'meters_electricity');
    end if;
    if not public.first_run_draft_has_module(v_draft, 'budget') then
      perform public.first_run_skip_stage(v_id, 'budget');
    end if;
    if not public.first_run_draft_has_module(v_draft, 'internet') then
      perform public.first_run_skip_stage(v_id, 'internet_opening');
    end if;

    if v_next is null then
      v_next := 'complex_card';
    end if;
  end if;

  if v_stage = 'support_fee_opening' then
    perform public.first_run_assert_support_fee_opening_ready(v_id);
    if v_next is null then
      v_next := 'capital_repair_opening';
    end if;
  end if;

  if v_stage = 'capital_repair_opening' then
    perform public.first_run_assert_capital_repair_opening_ready(v_id);
    v_next := public.first_run_coerce_next_stage(v_id, v_stage, v_next);
  end if;

  if v_stage = 'tariffs' then
    perform public.first_run_assert_tariffs_ready(v_id);
    v_next := public.first_run_coerce_next_stage(v_id, v_stage, v_next);
  end if;

  if v_stage = 'internet_opening' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_internet_opening_ready(v_id);
    v_next := public.first_run_coerce_next_stage(v_id, v_stage, v_next);
  end if;

  if v_stage = 'budget' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_budget_ready(v_id);
    if v_next is null then
      v_next := 'uk_expenses_opening';
    end if;
  end if;

  if v_stage = 'uk_expenses_opening' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_uk_expenses_opening_ready(v_id);
    if v_next is null then
      v_next := public.first_run_coerce_next_stage(v_id, v_stage, null);
    end if;
    v_next := public.first_run_coerce_next_stage(v_id, v_stage, v_next);
  end if;

  if v_stage = 'inventory_opening' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_inventory_opening_ready(v_id);
    if v_next is null then
      v_next := 'complete';
    end if;
    v_next := public.first_run_coerce_next_stage(v_id, v_stage, v_next);
  end if;

  if v_stage = 'complete' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', v_draft, now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', v_draft -> 'meters_selected', '[]'::jsonb)
    into v_selected
    from public.platform_installations as i
    where i.id = v_id;

    v_need_water := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    );
    v_need_elec := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    );

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || jsonb_build_object('meters_selected', coalesce(v_selected, '[]'::jsonb))
      || v_draft
    where i.id = v_id;

    if not v_need_water then
      perform public.first_run_skip_stage(v_id, 'meters_water');
    end if;
    if not v_need_elec then
      perform public.first_run_skip_stage(v_id, 'meters_electricity');
    end if;

    if v_next is null then
      v_next := case
        when v_need_water then 'meters_water'
        when v_need_elec then 'meters_electricity'
        else 'support_fee_opening'
      end;
    end if;
  end if;

  if v_stage = 'meters_water' and v_next is null then
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status in ('skipped', 'complete')
    ) or not exists (
      select 1 from public.platform_installations as i
      where i.id = v_id and public.first_run_draft_has_module(i.first_run_draft, 'electricity')
    ) then
      v_next := 'support_fee_opening';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'support_fee_opening';
  end if;

  if v_next = 'complete' and v_stage is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    v_activated_at := now();
    perform public.first_run_publish_activation_tariffs(v_id, v_activated_at);
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, v_activated_at),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', v_activated_at, v_activated_at, auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, v_activated_at), updated_at = v_activated_at;
  elsif v_next is not null then
    update public.platform_installations as i
    set
      first_run_status = case when i.first_run_status = 'complete' then 'complete' else 'in_progress' end,
      first_run_stage = case when i.first_run_status = 'complete' then i.first_run_stage else v_next end,
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id
      and i.first_run_status is distinct from 'complete';

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, updated_at, updated_by
    ) values (v_id, v_next, 'in_progress', now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set
      status = case when p.status in ('complete', 'skipped') then p.status else 'in_progress' end,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  return public.admin_get_first_run_state();
end;
$function$;

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;
