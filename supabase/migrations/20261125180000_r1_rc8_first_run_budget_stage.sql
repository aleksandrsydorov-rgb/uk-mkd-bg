-- =============================================================================
-- R1-RC8 — Mandatory first-run budget stage after tariffs.
-- Order: book → meters → support fee → capital repair → tariffs → budget → complete.
-- Budget setup is not implemented: the stage and the whole wizard cannot be
-- completed (including direct admin_complete_first_run_stage). Already-complete
-- installations are backfilled and are not reopened.
-- =============================================================================

begin;

insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values
  ('budget', 100, true, 'budget', 'admin.firstRunStageBudget')
on conflict (stage_key) do update
set
  sort_order = excluded.sort_order,
  required = excluded.required,
  module_key = excluded.module_key,
  label_i18n_key = excluded.label_i18n_key;

-- Grandfather finished installs only. Do not flip first_run_status.
insert into public.first_run_stage_progress (installation_id, stage_key, status, completed_at)
select i.id, 'budget', 'complete', coalesce(i.first_run_completed_at, now())
from public.platform_installations as i
where i.first_run_status = 'complete'
on conflict (installation_id, stage_key) do nothing;

-- Incomplete installs parked on the terminal screen move to the new stage.
-- Status stays pending / in_progress — a finished install is not reopened.
update public.platform_installations as i
set
  first_run_stage = 'budget',
  updated_at = now()
where i.first_run_status is distinct from 'complete'
  and i.first_run_stage = 'complete';

insert into public.first_run_stage_progress (installation_id, stage_key, status, updated_at)
select i.id, 'budget', 'in_progress', now()
from public.platform_installations as i
where i.first_run_status is distinct from 'complete'
  and i.first_run_stage = 'budget'
on conflict (installation_id, stage_key) do nothing;

-- Hide the previous completer from PostgREST. The wrapper is the only RPC.
alter function public.admin_complete_first_run_stage(text, text, jsonb)
  rename to admin_complete_first_run_stage_before_budget;

revoke all on function public.admin_complete_first_run_stage_before_budget(text, text, jsonb)
  from public, anon, authenticated;

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
  v_status text;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');

  select i.first_run_status into v_status
  from public.platform_installations as i
  where i.id = v_id;

  -- Direct RPC cannot mark budget complete until budget setup exists.
  if v_stage = 'budget' then
    raise exception 'first_run: budget setup not implemented' using errcode = 'P0001';
  end if;

  -- Tariffs advance only to budget. A client-supplied "complete" cannot skip it.
  if v_stage = 'tariffs' then
    if v_next is null or v_next = 'complete' or v_next = 'budget' then
      v_next := 'budget';
    else
      raise exception 'first_run: tariffs advances only to budget' using errcode = 'P0001';
    end if;
  end if;

  -- Whole wizard stays closed until budget setup is implemented.
  -- An installation that is already complete is left complete (not reopened).
  if (v_stage = 'complete' or v_next = 'complete')
     and v_status is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
    raise exception 'first_run: budget setup not implemented' using errcode = 'P0001';
  end if;

  return public.admin_complete_first_run_stage_before_budget(v_stage, v_next, p_draft);
end;
$fn$;

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb)
  from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb)
  to authenticated;

comment on function public.admin_complete_first_run_stage(text, text, jsonb) is
  'R1-RC8: tariffs → budget. Budget and wizard completion are refused until budget setup is implemented. Completed installations are not reopened.';

commit;
