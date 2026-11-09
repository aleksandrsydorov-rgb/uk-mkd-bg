-- =============================================================================
-- R1-RC8 — Shared server guard for workplace financial RPCs
-- =============================================================================
-- Mirrors client isModuleWorkplaceAvailable / classifyModuleSetupStatus:
--   UX enabled (building_modules.enabled) AND setup/lifecycle complete.
-- Role checks remain separate — staff role ≠ module readiness.
-- Does NOT flip enabled, delete ledger/history, or block first-run/setup/opening
-- import paths (those keep admin_assert_module_initial_setup_writable).
-- Canon today: enabled is UX gating; this hardens money RPCs with the same
-- readiness rule without inventing a parallel policy.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Readiness predicate (stable; no auth)
-- ---------------------------------------------------------------------------

create or replace function public.building_module_workplace_ready(p_module_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_enabled boolean;
  v_install uuid;
  v_fr_done boolean;
  v_state text;
  v_stage text;
  v_stage_ok boolean;
  v_requires_setup boolean;
begin
  v_key := nullif(btrim(coalesce(p_module_key, '')), '');
  if v_key is null then
    return false;
  end if;

  select coalesce(bm.enabled, false)
    into v_enabled
  from public.building_modules as bm
  where bm.module_key = v_key;

  if not found or v_enabled is not true then
    return false;
  end if;

  select i.id, (i.first_run_completed_at is not null)
    into v_install, v_fr_done
  from public.platform_installations as i
  where lower(btrim(i.installation_key)) = 'default'
  limit 1;

  if v_install is null then
    return false;
  end if;

  select coalesce(ml.state, 'DISABLED')
    into v_state
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key;

  if not found then
    v_state := 'DISABLED';
  end if;

  -- UX on + lifecycle active → workplace ready.
  if upper(v_state) = 'ACTIVE' then
    return true;
  end if;

  -- Map module → first-run stage that proves opening/setup (same as reconcile).
  v_stage := case v_key
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

  v_requires_setup := v_key in (
    'property_book', 'water', 'electricity', 'support_fee', 'capital_repair',
    'internet', 'budget', 'uk_expenses', 'inventory', 'building_documents'
  );

  if v_stage is not null then
    select exists (
      select 1
      from public.first_run_stage_progress as p
      where p.installation_id = v_install
        and p.stage_key = v_stage
        and p.status = 'complete'
    ) into v_stage_ok;

    if coalesce(v_stage_ok, false) then
      return true;
    end if;
  elsif coalesce(v_fr_done, false) and not v_requires_setup then
    -- No dedicated opening stage; first-run done + UX enabled is enough.
    return true;
  end if;

  return false;
end;
$fn$;

revoke all on function public.building_module_workplace_ready(text)
  from public, anon, authenticated;
grant execute on function public.building_module_workplace_ready(text) to authenticated;

comment on function public.building_module_workplace_ready(text) is
  'True when building_modules.enabled and setup/lifecycle complete (ACTIVE or completed first-run stage). Role checks are separate. Disable does not delete history.';

-- ---------------------------------------------------------------------------
-- Assert (raises; used by workplace finance RPCs)
-- ---------------------------------------------------------------------------

create or replace function public.assert_building_module_workplace_ready(p_module_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
begin
  v_key := nullif(btrim(coalesce(p_module_key, '')), '');
  if v_key is null then
    raise exception 'module workplace not ready'
      using errcode = '42501';
  end if;

  if not public.building_module_workplace_ready(v_key) then
    raise exception '%: module workplace not ready', v_key
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.assert_building_module_workplace_ready(text)
  from public, anon, authenticated;
-- Internal use from SECURITY DEFINER RPCs; keep execute for authenticated
-- so staff-facing helpers can probe readiness if needed.
grant execute on function public.assert_building_module_workplace_ready(text) to authenticated;

comment on function public.assert_building_module_workplace_ready(text) is
  'Raises when module is disabled or not configured for workplace finance. Does not replace role auth. Setup/opening RPCs must not call this.';

-- ---------------------------------------------------------------------------
-- Wire into operational water/electricity finance RPCs (single shared call).
-- Skip opening/import/setup and payment-receipt trigger helpers.
-- Idempotent: skip if assert already present.
-- ---------------------------------------------------------------------------

do $wire$
declare
  r record;
  def text;
  newdef text;
  v_insert text;
  v_module text;
  v_pos int;
  v_marker text;
begin
  for r in
    select
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_water_balance',
        'record_water_payment',
        'submit_water_reading',
        'correct_water_reading',
        'get_electricity_balance',
        'record_electricity_payment',
        'submit_electricity_reading',
        'correct_electricity_reading',
        'confirm_electricity_legal_charge',
        'quote_electricity_legal_charge'
      )
  loop
    v_module := case
      when r.proname like '%water%' then 'water'
      when r.proname like '%electricity%' then 'electricity'
      else null
    end;

    if v_module is null then
      continue;
    end if;

    def := pg_get_functiondef(r.oid);
    if def is null then
      continue;
    end if;

    if position('assert_building_module_workplace_ready' in def) > 0 then
      continue;
    end if;

    v_insert := format(
      E'\n  perform public.assert_building_module_workplace_ready(%L);',
      v_module
    );

    def := replace(def, E'\r\n', E'\n');
    def := replace(def, E'\r', E'\n');
    v_pos := position(E'\nbegin\n' in def);
    if v_pos = 0 then
      v_pos := position(E'\nBEGIN\n' in def);
      v_marker := E'\nBEGIN\n';
    else
      v_marker := E'\nbegin\n';
    end if;

    if v_pos = 0 then
      raise notice 'workplace_ready wire skip/fail %(%)', r.proname, r.args;
      continue;
    end if;

    newdef :=
      substr(def, 1, v_pos + length(v_marker) - 1)
      || v_insert
      || substr(def, v_pos + length(v_marker));

    if newdef is not distinct from def then
      raise notice 'workplace_ready wire unchanged %(%)', r.proname, r.args;
      continue;
    end if;

    execute newdef;
    raise notice 'workplace_ready wired %(%) → %', r.proname, r.args, v_module;
  end loop;
end;
$wire$;

commit;
