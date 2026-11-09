-- R1-RC8: Enforce one-shot initial setup (complex first-run + per-module wizard).
-- Uses existing first_run_stage_progress + module_lifecycle + first_run_status.
-- Does not republish tariffs, inventarise, charge, or flip building_modules.enabled.
-- Does not mark unfinished modules complete.

begin;

-- ---------------------------------------------------------------------------
-- Helpers: when is initial setup already finished for a module?
-- ---------------------------------------------------------------------------

create or replace function public.module_first_run_stage_key(p_module_key text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case lower(btrim(coalesce(p_module_key, '')))
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
$fn$;

revoke all on function public.module_first_run_stage_key(text) from public, anon;
grant execute on function public.module_first_run_stage_key(text) to authenticated;

create or replace function public.module_initial_setup_completed(
  p_installation_id uuid,
  p_module_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_stage text;
  v_stage_ok boolean := false;
  v_state text;
  v_fr_complete boolean := false;
begin
  if p_installation_id is null or v_key = '' then
    return false;
  end if;

  v_stage := public.module_first_run_stage_key(v_key);
  if v_stage is not null then
    select exists (
      select 1
      from public.first_run_stage_progress as p
      where p.installation_id = p_installation_id
        and p.stage_key = v_stage
        and p.status = 'complete'
    ) into v_stage_ok;
    if v_stage_ok then
      return true;
    end if;
  end if;

  select i.first_run_status = 'complete'
    into v_fr_complete
  from public.platform_installations as i
  where i.id = p_installation_id;

  select upper(ml.state)
    into v_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id
    and ml.module_key = v_key;

  -- After complex first-run, ACTIVE/SUSPENDED means initial setup is done
  -- (including modules activated by their own wizard, e.g. inventory).
  -- During first-run (status not complete), ACTIVE alone does not lock imports
  -- so the wizard can finish the stage after activateModule.
  if coalesce(v_fr_complete, false)
     and v_state in ('ACTIVE', 'SUSPENDED') then
    return true;
  end if;

  return false;
end;
$fn$;

revoke all on function public.module_initial_setup_completed(uuid, text) from public, anon;
grant execute on function public.module_initial_setup_completed(uuid, text) to authenticated;

create or replace function public.admin_assert_module_initial_setup_writable(p_module_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
begin
  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(btrim(i.installation_key)) = 'default'
  limit 1;

  if v_install is null then
    raise exception 'module_setup: installation missing' using errcode = 'P0001';
  end if;

  if public.module_initial_setup_completed(v_install, v_key) then
    raise exception 'module_setup: initial_setup_already_complete'
      using errcode = 'P0001',
            hint = 'Initial setup for this module is finished. Change rates and operations in normal admin sections; do not re-run the wizard.';
  end if;
end;
$fn$;

revoke all on function public.admin_assert_module_initial_setup_writable(text)
  from public, anon;
grant execute on function public.admin_assert_module_initial_setup_writable(text) to authenticated;

comment on function public.module_initial_setup_completed(uuid, text) is
  'True when first-run stage for the module is complete, or (after complex first-run) lifecycle is ACTIVE/SUSPENDED.';

comment on function public.admin_assert_module_initial_setup_writable(text) is
  'Raises if module initial setup is already finished — blocks wizard/import/setup mutations.';

-- ---------------------------------------------------------------------------
-- Freeze complex first-run progress mutations after completion
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
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  -- One-shot: after successful finish, do not mutate draft/stages/profile via wizard RPC.
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

  update public.platform_installations as i
  set
    first_run_status = 'in_progress',
    first_run_stage = v_stage,
    first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || coalesce(p_draft, '{}'::jsonb)
      || case
           when p_complex is null then '{}'::jsonb
           else jsonb_build_object('complex_profile', p_complex)
         end
      || jsonb_build_object('current_stage', v_stage),
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
-- Per-module wizard: block setup mutations when already complete
-- ---------------------------------------------------------------------------

create or replace function public.admin_transition_module_lifecycle(
  p_module_key text,
  p_to_state text,
  p_reason text default null
)
returns table (
  module_key text,
  state text,
  last_transition_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_from text;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_to text := upper(btrim(coalesce(p_to_state, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.admin_assert_module_setup();

  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  if v_install is null then
    raise exception 'module_setup: installation missing' using errcode = 'P0001';
  end if;

  select ml.state into v_from
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key
  for update;

  if not found then
    insert into public.module_lifecycle (installation_id, module_key, state)
    values (v_install, v_key, 'DISABLED')
    returning public.module_lifecycle.state into v_from;
  end if;

  -- One-shot: never re-enter initial-setup states after completion.
  -- Reconcile / re-enable uses DISABLED|READY|ACTIVE|SUSPENDED only.
  if v_to in ('SETUP_REQUIRED', 'SETUP_IN_PROGRESS')
     and public.module_initial_setup_completed(v_install, v_key) then
    raise exception 'module_setup: initial_setup_already_complete'
      using errcode = 'P0001',
            hint = 'Module initial setup is finished; use normal admin sections.';
  end if;

  if not public.module_lifecycle_transition_allowed(v_from, v_to) then
    raise exception 'module_setup: invalid transition % → %', v_from, v_to
      using errcode = '22023';
  end if;

  -- IS-1: lifecycle transitions do NOT mutate building_modules.enabled.
  update public.module_lifecycle as ml
  set
    state = v_to,
    last_transition_at = now(),
    last_transition_by = auth.uid(),
    notes = v_reason
  where ml.installation_id = v_install
    and ml.module_key = v_key;

  insert into public.module_lifecycle_audit (
    installation_id, module_key, from_state, to_state, actor_uid, actor_email, reason
  ) values (
    v_install, v_key, v_from, v_to, auth.uid(), auth.email(), v_reason
  );

  return query
  select ml.module_key, ml.state, ml.last_transition_at
  from public.module_lifecycle as ml
  where ml.installation_id = v_install
    and ml.module_key = v_key;
end;
$fn$;

revoke all on function public.admin_transition_module_lifecycle(text, text, text) from public, anon;
grant execute on function public.admin_transition_module_lifecycle(text, text, text) to authenticated;

create or replace function public.admin_save_module_setup_progress(
  p_module_key text,
  p_current_step text,
  p_draft jsonb,
  p_validation_errors jsonb default '[]'::jsonb,
  p_setup_schema_version text default '1.0'
)
returns public.module_setup_progress
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_row public.module_setup_progress%rowtype;
begin
  perform public.admin_assert_module_setup();
  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  perform public.admin_assert_module_initial_setup_writable(v_key);

  insert into public.module_setup_progress as sp (
    installation_id, module_key, setup_schema_version, current_step, draft,
    validation_errors, updated_at, updated_by
  ) values (
    v_install, v_key, coalesce(nullif(btrim(p_setup_schema_version), ''), '1.0'),
    nullif(btrim(coalesce(p_current_step, '')), ''),
    coalesce(p_draft, '{}'::jsonb),
    coalesce(p_validation_errors, '[]'::jsonb),
    now(), auth.uid()
  )
  on conflict (installation_id, module_key) do update
  set
    setup_schema_version = excluded.setup_schema_version,
    current_step = excluded.current_step,
    draft = excluded.draft,
    validation_errors = excluded.validation_errors,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_save_module_setup_progress(text, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.admin_save_module_setup_progress(text, text, jsonb, jsonb, text)
  to authenticated;

create or replace function public.admin_create_module_import_batch(
  p_module_key text,
  p_schema_version text,
  p_source text,
  p_file_name text,
  p_preview jsonb,
  p_row_count integer,
  p_create_count integer,
  p_update_count integer,
  p_skip_count integer,
  p_error_count integer,
  p_error_report jsonb default '[]'::jsonb
)
returns public.module_import_batches
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_install uuid;
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_source text := lower(btrim(coalesce(p_source, 'xlsx')));
  v_row public.module_import_batches%rowtype;
begin
  perform public.admin_assert_module_setup();
  if v_key = '' then
    raise exception 'module_setup: module_key required' using errcode = '22023';
  end if;
  if v_source not in ('xlsx', 'manual', 'api') then
    raise exception 'module_setup: invalid source' using errcode = '22023';
  end if;

  perform public.admin_assert_module_initial_setup_writable(v_key);

  select i.id into v_install
  from public.platform_installations as i
  where lower(i.installation_key) = 'default'
  limit 1;

  insert into public.module_import_batches (
    installation_id, module_key, schema_version, source, status, file_name,
    row_count, create_count, update_count, skip_count, error_count,
    preview, error_report, created_by, created_by_email
  ) values (
    v_install, v_key, coalesce(nullif(btrim(p_schema_version), ''), '1.0'),
    v_source, 'preview', nullif(btrim(coalesce(p_file_name, '')), ''),
    greatest(coalesce(p_row_count, 0), 0),
    greatest(coalesce(p_create_count, 0), 0),
    greatest(coalesce(p_update_count, 0), 0),
    greatest(coalesce(p_skip_count, 0), 0),
    greatest(coalesce(p_error_count, 0), 0),
    coalesce(p_preview, '{}'::jsonb),
    coalesce(p_error_report, '[]'::jsonb),
    auth.uid(), auth.email()
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_create_module_import_batch(
  text, text, text, text, jsonb, integer, integer, integer, integer, integer, jsonb
) from public, anon;
grant execute on function public.admin_create_module_import_batch(
  text, text, text, text, jsonb, integer, integer, integer, integer, integer, jsonb
) to authenticated;

create or replace function public.admin_commit_module_import_batch(p_batch_id uuid)
returns public.module_import_batches
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.module_import_batches%rowtype;
  v_key text;
begin
  perform public.admin_assert_module_setup();

  select b.module_key into v_key
  from public.module_import_batches as b
  where b.id = p_batch_id;

  if v_key is null then
    raise exception 'module_setup: batch not found or not in preview'
      using errcode = 'P0001';
  end if;

  perform public.admin_assert_module_initial_setup_writable(v_key);

  update public.module_import_batches as b
  set
    status = 'committed',
    committed_at = now(),
    confirmed_by = auth.uid()
  where b.id = p_batch_id
    and b.status = 'preview'
  returning * into v_row;

  if not found then
    raise exception 'module_setup: batch not found or not in preview'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_commit_module_import_batch(uuid) from public, anon;
grant execute on function public.admin_commit_module_import_batch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Inject writable assert into opening inventarisation RPCs (bodies intact).
-- Skip admin_import_property_book — day-to-day Property Book uses it too.
-- ---------------------------------------------------------------------------

do $patch$
declare
  r record;
  def text;
  newdef text;
  v_module text;
  v_insert text;
  v_marker text;
  v_pos int;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'import_support_fee_opening_state',
        'admin_import_support_fee_opening',
        'import_capital_repair_opening_state',
        'admin_import_capital_repair_opening',
        'admin_set_capital_repair_fund_cash_opening',
        'import_internet_opening_state',
        'admin_import_internet_opening',
        'import_uk_expense_opening_row',
        'register_water_opening_reading',
        'admin_import_water_meters_opening',
        'register_electricity_opening_reading',
        'admin_import_electricity_meters_opening',
        'admin_save_first_run_opening_totals'
      )
  loop
    v_module := case r.proname
      when 'import_support_fee_opening_state' then 'support_fee'
      when 'admin_import_support_fee_opening' then 'support_fee'
      when 'import_capital_repair_opening_state' then 'capital_repair'
      when 'admin_import_capital_repair_opening' then 'capital_repair'
      when 'admin_set_capital_repair_fund_cash_opening' then 'capital_repair'
      when 'import_internet_opening_state' then 'internet'
      when 'admin_import_internet_opening' then 'internet'
      when 'import_uk_expense_opening_row' then 'uk_expenses'
      when 'admin_save_first_run_opening_totals' then 'uk_expenses'
      when 'register_water_opening_reading' then 'water'
      when 'admin_import_water_meters_opening' then 'water'
      when 'register_electricity_opening_reading' then 'electricity'
      when 'admin_import_electricity_meters_opening' then 'electricity'
      else null
    end;

    if v_module is null then
      continue;
    end if;

    def := pg_get_functiondef(r.oid);
    if def is null then
      continue;
    end if;
    if position('admin_assert_module_initial_setup_writable' in def) > 0 then
      continue;
    end if;

    v_insert := format(
      E'\n  perform public.admin_assert_module_initial_setup_writable(%L);',
      v_module
    );

    if position('perform public.admin_assert_module_setup();' in def) > 0 then
      newdef := replace(
        def,
        'perform public.admin_assert_module_setup();',
        'perform public.admin_assert_module_setup();' || v_insert
      );
    elsif position('perform public.budget_assert_admin();' in def) > 0 then
      newdef := replace(
        def,
        'perform public.budget_assert_admin();',
        'perform public.budget_assert_admin();' || v_insert
      );
    else
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
        raise notice 'oneshot patch skip/fail %(%)', r.proname, r.args;
        continue;
      end if;
      newdef :=
        substr(def, 1, v_pos + length(v_marker) - 1)
        || v_insert
        || substr(def, v_pos + length(v_marker));
    end if;

    if newdef is not distinct from def then
      raise notice 'oneshot patch skip/fail %(%)', r.proname, r.args;
      continue;
    end if;

    execute newdef;
    raise notice 'oneshot patched %(%) → %', r.proname, r.args, v_module;
  end loop;
end;
$patch$;

commit;
