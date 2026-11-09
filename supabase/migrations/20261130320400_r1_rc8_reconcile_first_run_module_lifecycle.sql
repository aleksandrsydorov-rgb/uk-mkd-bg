-- R1-RC8: Idempotent lifecycle sync after first-run enabled building_modules
-- without promoting module_lifecycle past DISABLED.
-- Never flips building_modules.enabled (respects later explicit disable).
-- Never republishes tariffs, imports, charges, or first_run_completed_at.

create or replace function public.admin_reconcile_first_run_module_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_completed_at timestamptz;
  v_synced int := 0;
  v_details jsonb := '[]'::jsonb;
  r record;
  v_from text;
  v_stage text;
  v_stage_ok boolean;
  v_requires_setup boolean;
  v_err text;
begin
  perform public.admin_assert_module_setup();

  select i.id, i.first_run_completed_at
  into v_install, v_completed_at
  from public.platform_installations i
  where lower(btrim(i.installation_key)) = 'default'
  limit 1;

  if v_install is null then
    return jsonb_build_object('ok', false, 'error', 'no_installation', 'synced', 0, 'details', '[]'::jsonb);
  end if;

  if v_completed_at is null then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'first_run_incomplete',
      'synced', 0,
      'details', '[]'::jsonb
    );
  end if;

  for r in
    select
      bm.module_key,
      bm.enabled as building_enabled,
      coalesce(ml.state, 'DISABLED') as lifecycle_state
    from public.building_modules bm
    left join public.module_lifecycle ml
      on ml.installation_id = v_install
     and ml.module_key = bm.module_key
    where bm.enabled = true
  loop
    -- Map module → first-run stage that proves opening/setup.
    v_stage := case r.module_key
      when 'property_book' then 'property_book'
      when 'water' then 'meters_water'
      when 'electricity' then 'meters_electricity'
      when 'support_fee' then 'support_fee_opening'
      when 'capital_repair' then 'capital_repair_opening'
      when 'internet' then 'internet_opening'
      when 'budget' then 'budget'
      when 'uk_expenses' then 'uk_expenses_opening'
      else null
    end;

    -- Modules that need dedicated opening data beyond first-run module select.
    v_requires_setup := r.module_key in (
      'property_book', 'water', 'electricity', 'support_fee', 'capital_repair',
      'internet', 'budget', 'uk_expenses', 'inventory', 'building_documents'
    );

    if v_stage is not null then
      select exists (
        select 1
        from public.first_run_stage_progress p
        where p.installation_id = v_install
          and p.stage_key = v_stage
          and p.status = 'complete'
      ) into v_stage_ok;
    else
      -- No dedicated opening stage: first-run completion + UX enabled is enough
      -- (cleaning, chat, security, general_meeting, …). Inventory / docs stay out
      -- via v_requires_setup.
      v_stage_ok := not v_requires_setup;
    end if;

    if not coalesce(v_stage_ok, false) then
      continue;
    end if;

    if upper(r.lifecycle_state) = 'ACTIVE' then
      continue;
    end if;

    v_from := upper(coalesce(r.lifecycle_state, 'DISABLED'));

    begin
      -- Ensure lifecycle row exists (transition RPC also inserts, but keep explicit).
      insert into public.module_lifecycle (installation_id, module_key, state)
      values (v_install, r.module_key, 'DISABLED')
      on conflict (installation_id, module_key) do nothing;

      -- Promote along allowed edges to ACTIVE without touching building_modules.enabled.
      if v_from = 'DISABLED' then
        perform public.admin_transition_module_lifecycle(r.module_key, 'READY', 'reconcile_first_run');
        perform public.admin_transition_module_lifecycle(r.module_key, 'ACTIVE', 'reconcile_first_run');
      elsif v_from = 'SETUP_REQUIRED' then
        perform public.admin_transition_module_lifecycle(r.module_key, 'SETUP_IN_PROGRESS', 'reconcile_first_run');
        perform public.admin_transition_module_lifecycle(r.module_key, 'READY', 'reconcile_first_run');
        perform public.admin_transition_module_lifecycle(r.module_key, 'ACTIVE', 'reconcile_first_run');
      elsif v_from = 'SETUP_IN_PROGRESS' then
        perform public.admin_transition_module_lifecycle(r.module_key, 'READY', 'reconcile_first_run');
        perform public.admin_transition_module_lifecycle(r.module_key, 'ACTIVE', 'reconcile_first_run');
      elsif v_from = 'READY' then
        perform public.admin_transition_module_lifecycle(r.module_key, 'ACTIVE', 'reconcile_first_run');
      elsif v_from = 'SUSPENDED' then
        perform public.admin_transition_module_lifecycle(r.module_key, 'ACTIVE', 'reconcile_first_run');
      else
        continue;
      end if;

      v_synced := v_synced + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'module_key', r.module_key,
        'from', coalesce(r.lifecycle_state, 'DISABLED'),
        'to', 'ACTIVE',
        'stage', v_stage,
        'building_enabled', true
      ));
    exception
      when others then
        v_err := SQLERRM;
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'module_key', r.module_key,
          'from', coalesce(r.lifecycle_state, 'DISABLED'),
          'error', v_err
        ));
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'installation_id', v_install,
    'synced', v_synced,
    'details', v_details
  );
end;
$fn$;

revoke all on function public.admin_reconcile_first_run_module_lifecycle() from public, anon, authenticated;
grant execute on function public.admin_reconcile_first_run_module_lifecycle() to authenticated;

comment on function public.admin_reconcile_first_run_module_lifecycle() is
  'Idempotent: promote module_lifecycle to ACTIVE when building_modules.enabled and first-run stage (or FR complete for non-setup modules) prove readiness. Does not change enabled, tariffs, imports, or first_run_completed_at.';
