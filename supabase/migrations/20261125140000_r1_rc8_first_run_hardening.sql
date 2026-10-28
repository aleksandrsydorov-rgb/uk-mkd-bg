-- =============================================================================
-- R1-RC8 — First-run hardening: complete gates, meter import conflicts,
-- tighter upgrade grandfathering (partial setups stay pending).
-- Additive create-or-replace only.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tighten grandfathering: require Book ACTIVE + at least one meter utility
-- ACTIVE + complex card identity. Partial upgrades stay pending.
-- ---------------------------------------------------------------------------

-- Re-open installs marked complete without full prior setup
-- (e.g. book-only / READY-only / missing complex card from older grandfather rule).
update public.platform_installations as i
set
  first_run_status = 'pending',
  first_run_stage = 'welcome',
  first_run_completed_at = null
where i.first_run_status = 'complete'
  and not (
    nullif(btrim(coalesce(i.display_name, i.complex_name, '')), '') is not null
    and nullif(btrim(coalesce(i.address, '')), '') is not null
    and i.apartment_count is not null
    and i.apartment_count > 0
    and exists (
      select 1 from public.module_lifecycle ml
      where ml.installation_id = i.id
        and ml.module_key = 'property_book'
        and ml.state = 'ACTIVE'
    )
    and exists (
      select 1 from public.module_lifecycle ml
      where ml.installation_id = i.id
        and ml.module_key in ('water', 'electricity')
        and ml.state = 'ACTIVE'
    )
  );

delete from public.first_run_stage_progress p
using public.platform_installations i
where p.installation_id = i.id
  and i.first_run_status is distinct from 'complete';

-- Still-pending installs that satisfy the full upgrade rule → complete.
-- Partial upgrades (missing card / Book / meters) stay pending.
update public.platform_installations as i
set
  first_run_status = 'complete',
  first_run_stage = 'complete',
  first_run_completed_at = coalesce(i.first_run_completed_at, now()),
  apartment_count = coalesce(
    i.apartment_count,
    nullif((select count(*)::integer from public.properties), 0)
  )
where coalesce(i.first_run_status, 'pending') <> 'complete'
  and nullif(btrim(coalesce(i.display_name, i.complex_name, '')), '') is not null
  and nullif(btrim(coalesce(i.address, '')), '') is not null
  and coalesce(
    i.apartment_count,
    nullif((select count(*)::integer from public.properties), 0)
  ) is not null
  and coalesce(
    i.apartment_count,
    nullif((select count(*)::integer from public.properties), 0)
  ) > 0
  and exists (
    select 1 from public.module_lifecycle ml
    where ml.installation_id = i.id
      and ml.module_key = 'property_book'
      and ml.state = 'ACTIVE'
  )
  and exists (
    select 1 from public.module_lifecycle ml
    where ml.installation_id = i.id
      and ml.module_key in ('water', 'electricity')
      and ml.state = 'ACTIVE'
  );

insert into public.first_run_stage_progress (installation_id, stage_key, status, completed_at)
select i.id, c.stage_key, 'complete', now()
from public.platform_installations as i
cross join public.first_run_stage_catalog as c
where i.first_run_status = 'complete'
on conflict (installation_id, stage_key) do nothing;

-- Also fix the original migration's looser grandfather for brand-new applies:
-- (create-or-replace of complete RPC below is the runtime gate).

-- ---------------------------------------------------------------------------
-- Assert first-run may be marked complete (no stage skipping).
-- ---------------------------------------------------------------------------

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

  foreach v_stage_status in array array['welcome', 'complex_card', 'property_book', 'meters_select']
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
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

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
        else 'complete'
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
      v_next := 'complete';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'complete';
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

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Water meters opening import — foreign serial + conflicting apt balances
-- ---------------------------------------------------------------------------

create or replace function public.admin_import_water_meters_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_reading numeric;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_bal_kind_by_prop jsonb := '{}'::jsonb;
  v_bal_amt_by_prop jsonb := '{}'::jsonb;
  v_prev_kind text;
  v_prev_amt numeric;
  v_existing_meter_id uuid;
  v_existing_prop_id bigint;
  v_result jsonb;
  v_norm_amt text;
begin
  perform public.admin_assert_module_setup();
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_water_meters_opening: rows array required'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_bal_kind := lower(btrim(coalesce(v_row ->> 'opening_balance_kind', 'zero')));
    if v_bal_kind = '' then v_bal_kind := 'zero'; end if;

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required'
      ));
      continue;
    end if;
    if v_serial is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'required', 'reason', 'meter_number_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if exists (
      select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
        'apartment_number', v_apt, 'meter_number', v_serial
      ));
      continue;
    end if;
    v_seen_serials := array_append(v_seen_serials, v_serial);

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;
    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'unknown_apartment', 'reason', 'unknown_apartment',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_reading := nullif(btrim(coalesce(v_row ->> 'initial_reading', '')), '')::numeric;
    exception when others then
      v_reading := null;
    end;
    if v_reading is null or v_reading < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_installed := null;
    end;
    if v_installed is null or v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if v_bal_kind = 'zero' then
      v_bal_amt := 0;
    elsif v_bal_amt is null or v_bal_amt <= 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    -- Conflicting opening balances for the same apartment in one file.
    v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
    if v_prev_kind is not null then
      v_prev_amt := nullif(v_bal_amt_by_prop ->> v_prop_id::text, '')::numeric;
      if v_prev_kind is distinct from v_bal_kind
         or coalesce(v_prev_amt, 0) is distinct from coalesce(v_bal_amt, 0) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
          'code', 'opening_balance_conflict',
          'reason', 'opening_balance_conflict_same_apartment',
          'apartment_number', v_apt
        ));
        continue;
      end if;
    else
      v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
      v_norm_amt := coalesce(v_bal_amt, 0)::text;
      v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
    end if;

    select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
    from public.water_meters as m
    where m.meter_number = v_serial
    limit 1;

    if v_existing_meter_id is not null then
      if v_existing_prop_id is distinct from v_prop_id then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'meter_number_other_apartment',
          'reason', 'meter_number_belongs_to_other_apartment',
          'apartment_number', v_apt,
          'meter_number', v_serial
        ));
        continue;
      end if;
      v_skipped := v_skipped + 1;
      if not coalesce(p_dry_run, true)
         and v_bal_kind <> 'zero'
         and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_water_meter(v_prop_id, v_serial, v_reading, v_installed) as m
    limit 1;

    perform public.register_water_opening_reading(
      v_prop_id, v_reading, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    if v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_water_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'water',
    'errors', v_errors,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$fn$;

revoke all on function public.admin_import_water_meters_opening(jsonb, boolean) from public, anon;
grant execute on function public.admin_import_water_meters_opening(jsonb, boolean) to authenticated;

create or replace function public.admin_import_electricity_meters_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_day numeric;
  v_night numeric;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_bal_kind_by_prop jsonb := '{}'::jsonb;
  v_bal_amt_by_prop jsonb := '{}'::jsonb;
  v_prev_kind text;
  v_prev_amt numeric;
  v_existing_meter_id uuid;
  v_existing_prop_id bigint;
  v_result jsonb;
  v_norm_amt text;
begin
  perform public.admin_assert_module_setup();
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_electricity_meters_opening: rows array required'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_bal_kind := lower(btrim(coalesce(v_row ->> 'opening_balance_kind', 'zero')));
    if v_bal_kind = '' then v_bal_kind := 'zero'; end if;

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required'
      ));
      continue;
    end if;
    if v_serial is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'required', 'reason', 'meter_number_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    if exists (
      select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
        'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    v_seen_serials := array_append(v_seen_serials, v_serial);

    select p.id into v_prop_id
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;
    if v_prop_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'unknown_apartment', 'reason', 'unknown_apartment',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_day := nullif(btrim(coalesce(v_row ->> 'initial_day_reading', '')), '')::numeric;
      v_night := nullif(btrim(coalesce(v_row ->> 'initial_night_reading', '')), '')::numeric;
    exception when others then
      v_day := null; v_night := null;
    end;
    if v_day is null or v_day < 0 or v_night is null or v_night < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_day_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_installed := null;
    end;
    if v_installed is null or v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if v_bal_kind = 'zero' then
      v_bal_amt := 0;
    elsif v_bal_amt is null or v_bal_amt <= 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
    if v_prev_kind is not null then
      v_prev_amt := nullif(v_bal_amt_by_prop ->> v_prop_id::text, '')::numeric;
      if v_prev_kind is distinct from v_bal_kind
         or coalesce(v_prev_amt, 0) is distinct from coalesce(v_bal_amt, 0) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
          'code', 'opening_balance_conflict',
          'reason', 'opening_balance_conflict_same_apartment',
          'apartment_number', v_apt
        ));
        continue;
      end if;
    else
      v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
      v_norm_amt := coalesce(v_bal_amt, 0)::text;
      v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
    end if;

    select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
    from public.electricity_meters as m
    where m.meter_number = v_serial
    limit 1;

    if v_existing_meter_id is not null then
      if v_existing_prop_id is distinct from v_prop_id then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'meter_number_other_apartment',
          'reason', 'meter_number_belongs_to_other_apartment',
          'apartment_number', v_apt,
          'meter_number', v_serial
        ));
        continue;
      end if;
      v_skipped := v_skipped + 1;
      if not coalesce(p_dry_run, true)
         and v_bal_kind <> 'zero'
         and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_electricity_meter(
      v_prop_id, v_serial, v_day, v_night, v_installed
    ) as m
    limit 1;

    perform public.register_electricity_opening_reading(
      v_prop_id, v_day, v_night, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    if v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_electricity_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'electricity',
    'errors', v_errors,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$fn$;

revoke all on function public.admin_import_electricity_meters_opening(jsonb, boolean) from public, anon;
grant execute on function public.admin_import_electricity_meters_opening(jsonb, boolean) to authenticated;

commit;
