-- R1-RC8 — first_run_assert_tariffs_ready: require tariffs only for modules in
-- first_run_draft.modules_selected (same rule as client tariffKeysForModules).

create or replace function public.first_run_assert_tariffs_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_modules jsonb;
  v_keys text[] := array[]::text[];
  v_key text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_modules := coalesce(v_inst.first_run_draft -> 'modules_selected', '[]'::jsonb);

  if exists (
    select 1 from jsonb_array_elements_text(v_modules) as t(v)
    where lower(btrim(t.v)) = 'water'
  ) then
    v_keys := v_keys || array['water'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_modules) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  ) then
    v_keys := v_keys || array['electricity'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_modules) as t(v)
    where lower(btrim(t.v)) = 'internet'
  ) then
    v_keys := v_keys || array['internet'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_modules) as t(v)
    where lower(btrim(t.v)) = 'support_fee'
  ) then
    v_keys := v_keys || array['support_fee'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_modules) as t(v)
    where lower(btrim(t.v)) = 'capital_repair'
  ) then
    v_keys := v_keys || array['capital_repair'];
  end if;

  -- Legacy drafts without modules_selected: keep prior SF+CR + meters_selected behaviour.
  if jsonb_typeof(v_modules) is distinct from 'array' or jsonb_array_length(v_modules) = 0 then
    v_keys := array['support_fee', 'capital_repair'];
    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    ) then
      v_keys := v_keys || array['water'];
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    ) then
      v_keys := v_keys || array['electricity'];
    end if;
  end if;

  foreach v_key in array v_keys
  loop
    if not public.first_run_tariff_step_satisfied(p_installation_id, v_key) then
      raise exception 'first_run: tariff prep missing %', v_key using errcode = 'P0001';
    end if;
  end loop;
end;
$fn$;

revoke all on function public.first_run_assert_tariffs_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_tariffs_ready(uuid) to authenticated;
