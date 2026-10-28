-- =============================================================================
-- R1-RC8 — First-run tariffs stage (published Tariff Core) + mandatory budget stub.
-- Completing tariffs requires published tariffs for selected utilities + SF + CR.
-- Publication does not create charges / does not rewrite opening inventarisation.
-- Stage order: … → tariffs → budget → complete. Budget is stub: cannot complete
-- the wizard until a later budget implementation marks the stage ready.
-- =============================================================================

begin;

insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values
  ('budget', 95, true, null, 'admin.firstRunStageBudget')
on conflict (stage_key) do update
set
  sort_order = excluded.sort_order,
  required = excluded.required,
  module_key = excluded.module_key,
  label_i18n_key = excluded.label_i18n_key;

update public.first_run_stage_catalog
set sort_order = 90,
    label_i18n_key = 'admin.firstRunStageTariffs'
where stage_key = 'tariffs';

-- Already-complete installs: treat budget as complete so gate stays closed.
insert into public.first_run_stage_progress (installation_id, stage_key, status, completed_at)
select i.id, 'budget', 'complete', coalesce(i.first_run_completed_at, now())
from public.platform_installations as i
where i.first_run_status = 'complete'
on conflict (installation_id, stage_key) do nothing;

-- ---------------------------------------------------------------------------
-- Published tariff presence (Tariff Core). Does not inspect ledger / openings.
-- ---------------------------------------------------------------------------
create or replace function public.first_run_tariff_has_published(p_tariff_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.tariff_catalog as c
    join public.tariff_versions as tv
      on tv.tariff_id = c.id
     and tv.status = 'published'
    where c.tariff_key = p_tariff_key
      and c.active is true
  );
$fn$;

revoke all on function public.first_run_tariff_has_published(text) from public, anon;
grant execute on function public.first_run_tariff_has_published(text) to authenticated;

create or replace function public.first_run_assert_tariffs_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)
  into v_selected;

  v_need_water := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) = 'water'
  );
  v_need_elec := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  );

  if v_need_water and not public.first_run_tariff_has_published('water') then
    raise exception 'first_run: published water tariff required' using errcode = 'P0001';
  end if;
  if v_need_elec and not public.first_run_tariff_has_published('electricity') then
    raise exception 'first_run: published electricity tariff required' using errcode = 'P0001';
  end if;
  if not public.first_run_tariff_has_published('support_fee') then
    raise exception 'first_run: published support_fee tariff required' using errcode = 'P0001';
  end if;
  if not public.first_run_tariff_has_published('capital_repair') then
    raise exception 'first_run: published capital_repair tariff required' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_tariffs_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_tariffs_ready(uuid) to authenticated;

create or replace function public.first_run_assert_budget_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_installation_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  -- Stub: budget inventarisation not implemented yet — blocks wizard finish.
  raise exception 'first_run: budget stage not implemented' using errcode = 'P0001';
end;
$fn$;

revoke all on function public.first_run_assert_budget_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_budget_ready(uuid) to authenticated;

create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
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
    'welcome', 'complex_card', 'property_book', 'meters_select',
    'support_fee_opening', 'capital_repair_opening', 'tariffs', 'budget'
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

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)
  into v_selected;

  v_need_water := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) = 'water'
  );
  v_need_elec := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  );
  if not v_need_water and not v_need_elec then
    raise exception 'first_run: at least one meter utility required' using errcode = 'P0001';
  end if;

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
  -- Budget inventarisation is still a stub: greenfield cannot mark budget complete
  -- (admin_complete_first_run_stage('budget') raises), so this assert keeps finish blocked.
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_complete_first_run_stage(p_stage text, p_next_stage text DEFAULT NULL::text, p_draft jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');

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
      v_next := 'budget';
    end if;
  end if;

  if v_stage = 'budget' then
    -- Stub: refuse to mark budget complete until inventarisation ships.
    perform public.first_run_assert_budget_ready(v_id);
  end if;

  -- Direct jump to terminal stage (skipping setup) is rejected up front.
  if v_stage = 'complete' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb)
    where i.id = v_id;
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', coalesce(p_draft, '{}'::jsonb), now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', p_draft -> 'meters_selected', '[]'::jsonb)
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

    if not v_need_water and not v_need_elec then
      raise exception 'first_run: at least one meter utility required' using errcode = '22023';
    end if;

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || jsonb_build_object('meters_selected', coalesce(v_selected, '[]'::jsonb))
      || coalesce(p_draft, '{}'::jsonb)
    where i.id = v_id;

    if not v_need_water then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_water', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
    end if;
    if not v_need_elec then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_electricity', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
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
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'skipped'
    ) or exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      v_next := 'support_fee_opening';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'support_fee_opening';
  end if;

  -- Re-check when advancing into complete after meter stage completion.
  if v_next = 'complete' and v_stage is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, now()),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
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
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
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

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb)
  from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb)
  to authenticated;

commit;
