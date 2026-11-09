-- =============================================================================
-- R1-RC8 — Module choice after welcome.
-- Required: property book, support fee, capital repair.
-- Water, electricity and the UK budget are optional. Zero meter types are
-- allowed. Budget readiness is required only when the budget is selected.
-- Does not create charges or rewrite opening balances.
-- Completed installations stay complete. In-progress installations keep an
-- inferred selection and are not sent back to the new step.
-- =============================================================================

begin;

insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values ('modules_select', 15, true, null, 'admin.firstRunStageModules')
on conflict (stage_key) do update
set
  sort_order = excluded.sort_order,
  required = excluded.required,
  label_i18n_key = excluded.label_i18n_key;

create or replace function public.first_run_draft_has_module(p_draft jsonb, p_key text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
begin
  if v_key in ('property_book', 'support_fee', 'capital_repair') then
    return true;
  end if;

  if coalesce(p_draft, '{}'::jsonb) ? 'modules_selected' then
    return exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_draft -> 'modules_selected', '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = v_key
    );
  end if;

  if v_key = 'water' then
    return exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_draft -> 'meters_selected', '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    );
  end if;

  if v_key = 'electricity' then
    return exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_draft -> 'meters_selected', '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    );
  end if;

  if v_key = 'budget' then
    return nullif(btrim(coalesce(p_draft ->> 'budget_calendar_year', '')), '') is not null
      or nullif(btrim(coalesce(p_draft ->> 'budget_year_id', '')), '') is not null
      or nullif(btrim(coalesce(p_draft ->> 'budget_ui_step', '')), '') is not null;
  end if;

  return false;
end;
$fn$;

revoke all on function public.first_run_draft_has_module(jsonb, text) from public, anon;
grant execute on function public.first_run_draft_has_module(jsonb, text) to authenticated;

create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
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

  if nullif(btrim(coalesce(v_inst.display_name, v_inst.complex_name, '')), '') is null then
    raise exception 'first_run: complex card incomplete (name)' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.address, '')), '') is null then
    raise exception 'first_run: complex card incomplete (address)' using errcode = 'P0001';
  end if;
  if v_inst.apartment_count is null or v_inst.apartment_count <= 0 then
    raise exception 'first_run: complex card incomplete (apartment_count)' using errcode = 'P0001';
  end if;

  foreach v_stage_status in array array[
    'welcome', 'modules_select', 'complex_card', 'property_book',
    'support_fee_opening', 'capital_repair_opening', 'tariffs'
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
        and p.stage_key = 'meters_water'
        and p.status = 'complete'
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
        and p.stage_key = 'meters_electricity'
        and p.status = 'complete'
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

  if v_need_budget then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'budget'
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage budget not complete' using errcode = 'P0001';
    end if;
    perform public.first_run_assert_budget_ready(p_installation_id);
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

-- Replace completion so an empty meter selection is valid and the module
-- step owns the route. The previous body lives in 20261125190000.
create or replace function public.admin_complete_first_run_stage(
  p_stage text,
  p_next_stage text default null,
  p_draft jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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

    foreach v_key in array array['property_book', 'support_fee', 'capital_repair']
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
      if v_key in ('property_book', 'support_fee', 'capital_repair', 'water', 'electricity', 'budget', 'tariffs') then
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
      select unnest(array['support_fee', 'capital_repair', 'tariffs'])
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
        and c.module_key not in ('support_fee', 'capital_repair', 'tariffs', 'platform_support', 'user_activation', 'residence_status')
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
    if v_next is null then
      v_next := 'tariffs';
    end if;
  end if;

  if v_stage = 'tariffs' then
    perform public.first_run_assert_tariffs_ready(v_id);
    if v_next is null then
      select public.first_run_draft_has_module(i.first_run_draft, 'budget')
      into v_need_budget
      from public.platform_installations as i
      where i.id = v_id;
      v_next := case when v_need_budget then 'budget' else 'complete' end;
    end if;
  end if;

  if v_stage = 'budget' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_budget_ready(v_id);
    if v_next is null then
      v_next := 'complete';
    end if;
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
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, now()),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', now(), now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, now()), updated_at = now();
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
$fn$;

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;

-- Skip a stage without pretending it was completed. A completed stage stays complete.
create or replace function public.first_run_skip_stage(p_installation_id uuid, p_stage_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.first_run_stage_progress p
    where p.installation_id = p_installation_id
      and p.stage_key = p_stage_key
      and p.status = 'complete'
  ) then
    return;
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  ) values (
    p_installation_id, p_stage_key, 'skipped', '{}'::jsonb, now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = case when p.status = 'complete' then p.status else 'skipped' end,
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();
end;
$fn$;

revoke all on function public.first_run_skip_stage(uuid, text) from public, anon, authenticated;

-- Completed installs stay outside the wizard. Record the new stage as done.
insert into public.first_run_stage_progress (
  installation_id, stage_key, status, completed_at, updated_at
)
select i.id, 'modules_select', 'complete', now(), now()
from public.platform_installations as i
where i.first_run_status = 'complete'
on conflict (installation_id, stage_key) do nothing;

-- In-progress installs already past welcome keep inferred choices and progress.
with inferred as (
  select
    i.id,
    (
      select coalesce(jsonb_agg(distinct m.k), '[]'::jsonb)
      from (
        select unnest(array['property_book', 'support_fee', 'capital_repair']) as k
        union
        select case when public.first_run_draft_has_module(i.first_run_draft, 'water') then 'water' end
        union
        select case when public.first_run_draft_has_module(i.first_run_draft, 'electricity') then 'electricity' end
        union
        select case
          when public.first_run_draft_has_module(i.first_run_draft, 'budget')
            or exists (
              select 1 from public.building_modules bm
              where bm.module_key = 'budget' and bm.enabled is true
            )
            or exists (
              select 1 from public.first_run_stage_progress p
              where p.installation_id = i.id
                and p.stage_key = 'budget'
                and p.status in ('complete', 'in_progress')
            )
          then 'budget'
        end
        union
        select bm.module_key
        from public.building_modules bm
        join public.module_catalog c on c.module_key = bm.module_key
        where bm.enabled is true
          and c.implemented is true
          and bm.module_key not in (
            'platform_support', 'user_activation', 'residence_status', 'tariffs'
          )
      ) as m(k)
      where m.k is not null
    ) as selected
  from public.platform_installations as i
  where i.first_run_status = 'in_progress'
    and i.first_run_stage is distinct from 'welcome'
    and i.first_run_stage is distinct from 'modules_select'
    and not (coalesce(i.first_run_draft, '{}'::jsonb) ? 'modules_selected')
)
update public.platform_installations as i
set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
  || jsonb_build_object('modules_selected', inferred.selected)
from inferred
where i.id = inferred.id;

insert into public.first_run_stage_progress (
  installation_id, stage_key, status, completed_at, updated_at
)
select i.id, 'modules_select', 'complete', now(), now()
from public.platform_installations as i
where i.first_run_status = 'in_progress'
  and i.first_run_stage is distinct from 'welcome'
  and i.first_run_stage is distinct from 'modules_select'
on conflict (installation_id, stage_key) do nothing;

commit;
