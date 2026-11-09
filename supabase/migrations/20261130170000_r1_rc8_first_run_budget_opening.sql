-- =============================================================================
-- R1-RC8 — Complex budget articles and opening expense totals in first-run.
-- Uses budget_categories, budget_lines and uk_expenses.opening_import.
-- Does not adopt a plan, create owner charges, or move opening cash.
-- Completed installations are not rewritten.
-- =============================================================================

begin;

insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values ('uk_expenses_opening', 960, true, 'uk_expenses', 'admin.firstRunStageOpeningExpenses')
on conflict (stage_key) do update
set
  sort_order = excluded.sort_order,
  required = excluded.required,
  module_key = excluded.module_key,
  label_i18n_key = excluded.label_i18n_key;

create or replace function public.first_run_assert_budget_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_year integer;
  v_by public.budget_years%rowtype;
  v_sum numeric;
  v_zero_confirmed boolean;
  v_ml_state text;
begin
  if p_installation_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  begin
    v_year := nullif(btrim(coalesce(v_inst.first_run_draft ->> 'budget_calendar_year', '')), '')::integer;
  exception when others then
    v_year := null;
  end;
  if v_year is null or v_year < 2020 or v_year > 2100 then
    raise exception 'first_run: budget calendar year required' using errcode = 'P0001';
  end if;

  select y.* into v_by
  from public.budget_years as y
  where y.calendar_year = v_year;
  if not found then
    raise exception 'first_run: budget year % missing', v_year using errcode = 'P0001';
  end if;
  if v_by.status = 'closed' then
    raise exception 'first_run: budget year % is closed', v_year using errcode = 'P0001';
  end if;
  if v_by.status not in ('published', 'adopted') then
    raise exception 'first_run: budget year % must be published or adopted (got %)',
      v_year, coalesce(v_by.status, 'missing')
      using errcode = 'P0001';
  end if;

  select coalesce(sum(l.planned_amount_eur), 0) into v_sum
  from public.budget_lines as l
  where l.year_id = v_by.id;

  v_zero_confirmed := lower(btrim(coalesce(v_inst.first_run_draft ->> 'budget_zero_confirmed', '')))
    in ('true', 't', '1', 'yes');
  if coalesce(v_sum, 0) = 0 and not v_zero_confirmed then
    raise exception 'first_run: zero budget plan requires confirmation' using errcode = 'P0001';
  end if;

  if not public.budget_module_enabled() then
    raise exception 'first_run: budget module must be enabled' using errcode = 'P0001';
  end if;

  select ml.state into v_ml_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id
    and ml.module_key = 'budget';
  if v_ml_state is distinct from 'ACTIVE' then
    raise exception 'first_run: budget must be ACTIVE (got %)', coalesce(v_ml_state, 'missing')
      using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_budget_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_budget_ready(uuid) to authenticated;

create or replace function public.admin_commit_budget_plan(
  p_calendar_year integer,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_raw jsonb := '[]'::jsonb;
  v_row integer;
  v_code text;
  v_name text;
  v_amount_text text;
  v_norm text;
  v_amount numeric;
  v_errors text[] := '{}';
  v_seen text[] := '{}';
  v_articles jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_year public.budget_years%rowtype;
  v_article jsonb;
  v_cat_id uuid;
  v_existing numeric;
  v_sort integer := 0;
  v_total numeric := 0;
begin
  perform public.budget_assert_admin();
  if p_calendar_year is null or p_calendar_year < 2020 or p_calendar_year > 2100 then
    raise exception 'budget_import: year invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) is distinct from 'array' then
    raise exception 'budget_import: rows required' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_row := coalesce((v_item ->> 'row')::integer, 0);
    v_code := btrim(coalesce(v_item ->> 'code', ''));
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_amount_text := btrim(coalesce(v_item ->> 'amount', ''));
    if v_code = '' and v_name = '' and v_amount_text = '' then
      continue;
    end if;
    v_raw := v_raw || jsonb_build_array(jsonb_build_object(
      'row', v_row, 'code', v_code, 'name', v_name, 'amount', v_amount_text
    ));
  end loop;

  for v_item in select value from jsonb_array_elements(v_raw)
  loop
    v_row := (v_item ->> 'row')::integer;
    v_code := v_item ->> 'code';
    v_name := v_item ->> 'name';
    v_amount_text := v_item ->> 'amount';
    if v_code ~* '^(итого|всего|total|общо|sum|сумма|сума)([[:space:]]|$)'
       or v_name ~* '^(итого|всего|total|общо|sum|сумма|сума)([[:space:]]|$)' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_code <> '' and exists (
      select 1
      from jsonb_array_elements(v_raw) as other(value)
      where btrim(other.value ->> 'code') <> v_code
        and starts_with(btrim(other.value ->> 'code'), v_code || '.')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_code = '' then
      v_errors := v_errors || format('row %s: code required', v_row);
    end if;
    if v_name = '' then
      v_errors := v_errors || format('row %s: name required', v_row);
    end if;
    v_norm := replace(replace(v_amount_text, ' ', ''), ',', '.');
    if v_norm = '' then
      v_errors := v_errors || format('row %s: amount required', v_row);
      continue;
    end if;
    if v_norm ~ '^-' then
      v_errors := v_errors || format('row %s: negative amount', v_row);
      continue;
    end if;
    if v_norm !~ '^[0-9]+(\.[0-9]+)?$' then
      v_errors := v_errors || format('row %s: invalid amount', v_row);
      continue;
    end if;
    if v_norm ~ '\.[0-9]{3,}$' then
      v_errors := v_errors || format('row %s: amount precision', v_row);
      continue;
    end if;
    if v_code <> '' and lower(v_code) = any (v_seen) then
      v_errors := v_errors || format('row %s: duplicate code %s', v_row, v_code);
      continue;
    end if;
    if v_code <> '' then
      v_seen := v_seen || lower(v_code);
    end if;
    if v_code <> '' and v_name <> '' then
      v_articles := v_articles || jsonb_build_array(jsonb_build_object(
        'row', v_row, 'code', v_code, 'name', v_name, 'amount', v_norm::numeric
      ));
    end if;
  end loop;

  if cardinality(v_errors) > 0 then
    raise exception 'budget_import: %', array_to_string(v_errors, '; ') using errcode = '22023';
  end if;

  select y.* into v_year
  from public.budget_years as y
  where y.calendar_year = p_calendar_year
  for update;
  if not found then
    insert into public.budget_years (calendar_year, status, created_by_email)
    values (p_calendar_year, 'draft', auth.email())
    returning * into v_year;
  end if;
  if v_year.status = 'closed' then
    raise exception 'budget_import: year closed' using errcode = 'P0001';
  end if;

  if v_year.status is distinct from 'draft' then
    for v_article in select value from jsonb_array_elements(v_articles)
    loop
      select l.planned_amount_eur into v_existing
      from public.budget_lines as l
      join public.budget_categories as c on c.id = l.category_id
      where l.year_id = v_year.id
        and c.code = (v_article ->> 'code');
      if v_existing is null or v_existing is distinct from (v_article ->> 'amount')::numeric then
        raise exception 'budget_import: published plan differs at row %', (v_article ->> 'row')
          using errcode = 'P0001';
      end if;
    end loop;
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'year_id', v_year.id,
      'skipped', v_skipped
    );
  end if;

  for v_article in select value from jsonb_array_elements(v_articles)
  loop
    v_sort := v_sort + 10;
    v_code := v_article ->> 'code';
    v_name := v_article ->> 'name';
    v_amount := (v_article ->> 'amount')::numeric;
    v_total := v_total + v_amount;
    insert into public.budget_categories (code, name_ru, name_en, name_bg, sort_order, active)
    values (v_code, v_name, v_name, v_name, v_sort, true)
    on conflict (code) do update
      set name_ru = excluded.name_ru,
          name_en = excluded.name_en,
          name_bg = excluded.name_bg,
          active = true
    returning id into v_cat_id;

    insert into public.budget_lines (year_id, category_id, planned_amount_eur, updated_at)
    values (v_year.id, v_cat_id, v_amount, now())
    on conflict (year_id, category_id) do update
      set planned_amount_eur = excluded.planned_amount_eur,
          updated_at = now();
  end loop;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'year_id', v_year.id,
    'categories', jsonb_array_length(v_articles),
    'total', v_total,
    'skipped', v_skipped
  );
end;
$fn$;

revoke all on function public.admin_commit_budget_plan(integer, jsonb) from public, anon;
grant execute on function public.admin_commit_budget_plan(integer, jsonb) to authenticated;

create or replace function public.first_run_opening_source_ref(p_year_id uuid, p_category_id uuid)
returns text
language sql
immutable
as $fn$
  select 'first-run-opening:' || p_year_id::text || ':' || p_category_id::text;
$fn$;

revoke all on function public.first_run_opening_source_ref(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_list_first_run_opening_totals(p_calendar_year integer)
returns table (
  category_id uuid,
  code text,
  name_ru text,
  name_en text,
  name_bg text,
  planned_amount_eur numeric,
  opening_amount_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year_id uuid;
begin
  perform public.budget_assert_admin();
  select y.id into v_year_id
  from public.budget_years as y
  where y.calendar_year = p_calendar_year;
  if v_year_id is null then
    return;
  end if;

  return query
  select
    c.id,
    c.code,
    c.name_ru,
    c.name_en,
    c.name_bg,
    l.planned_amount_eur,
    coalesce(e.amount, 0)::numeric
  from public.budget_lines as l
  join public.budget_categories as c on c.id = l.category_id
  left join public.uk_expenses as e
    on e.opening_import is true
   and e.source_ref = public.first_run_opening_source_ref(v_year_id, c.id)
  where l.year_id = v_year_id
  order by c.sort_order, c.code;
end;
$fn$;

revoke all on function public.admin_list_first_run_opening_totals(integer) from public, anon;
grant execute on function public.admin_list_first_run_opening_totals(integer) to authenticated;

create or replace function public.admin_save_first_run_opening_totals(
  p_calendar_year integer,
  p_rows jsonb,
  p_none boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_year public.budget_years%rowtype;
  v_item jsonb;
  v_cat uuid;
  v_amount numeric;
  v_norm text;
  v_row integer;
  v_errors text[] := '{}';
  v_line public.budget_lines%rowtype;
  v_ref text;
  v_existing public.uk_expenses%rowtype;
  v_name text;
  v_day date;
  v_email text := auth.email();
  v_saved integer := 0;
  v_key uuid;
  v_exists boolean;
begin
  perform public.budget_assert_admin();
  if auth.uid() is null then
    raise exception 'opening_import: authentication required' using errcode = '42501';
  end if;
  select y.* into v_year
  from public.budget_years as y
  where y.calendar_year = p_calendar_year
  for update;
  if not found then
    raise exception 'opening_import: budget year missing' using errcode = 'P0002';
  end if;

  v_day := least(
    make_date(p_calendar_year, 1, 1),
    (timezone('Europe/Sofia', now()))::date
  );

  for v_item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row := coalesce((v_item ->> 'row')::integer, 0);
    begin
      v_cat := nullif(btrim(coalesce(v_item ->> 'category_id', '')), '')::uuid;
    exception when others then
      v_errors := v_errors || format('row %s: unknown category', v_row);
      continue;
    end;
    v_norm := replace(replace(btrim(coalesce(v_item ->> 'amount', '')), ' ', ''), ',', '.');
    if v_norm = '' then
      v_norm := '0';
    end if;
    if v_norm ~ '^-' then
      v_errors := v_errors || format('row %s: negative amount', v_row);
      continue;
    end if;
    if v_norm !~ '^[0-9]+(\.[0-9]+)?$' or v_norm ~ '\.[0-9]{3,}$' then
      v_errors := v_errors || format('row %s: invalid amount', v_row);
      continue;
    end if;
    v_amount := v_norm::numeric;
    if not exists (
      select 1 from public.budget_lines as l
      where l.year_id = v_year.id and l.category_id = v_cat
    ) then
      v_errors := v_errors || format('row %s: unknown category', v_row);
      continue;
    end if;
    if coalesce(p_none, false) and v_amount > 0 then
      v_errors := v_errors || format('row %s: amount conflicts with no expenses', v_row);
    end if;
  end loop;

  if cardinality(v_errors) > 0 then
    raise exception 'opening_import: %', array_to_string(v_errors, '; ') using errcode = '22023';
  end if;

  if coalesce(p_none, false) then
    for v_line in
      select l.* from public.budget_lines as l where l.year_id = v_year.id
    loop
      v_ref := public.first_run_opening_source_ref(v_year.id, v_line.category_id);
      delete from public.uk_expense_opening_imports as i
      where lower(btrim(i.source_ref)) = lower(v_ref);
      delete from public.uk_expenses as e
      where e.opening_import is true and e.source_ref = v_ref;
    end loop;
    return jsonb_build_object('applied', true, 'none', true, 'saved', 0);
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_cat := (v_item ->> 'category_id')::uuid;
    v_norm := replace(replace(btrim(coalesce(v_item ->> 'amount', '0')), ' ', ''), ',', '.');
    if v_norm = '' then
      v_norm := '0';
    end if;
    v_amount := round(v_norm::numeric, 2);
    v_ref := public.first_run_opening_source_ref(v_year.id, v_cat);
    select c.name_ru into v_name from public.budget_categories as c where c.id = v_cat;

    if v_amount <= 0 then
      delete from public.uk_expense_opening_imports as i
      where lower(btrim(i.source_ref)) = lower(v_ref);
      delete from public.uk_expenses as e
      where e.opening_import is true and e.source_ref = v_ref;
      continue;
    end if;

    select * into v_existing
    from public.uk_expenses as e
    where e.opening_import is true and e.source_ref = v_ref
    for update;
    v_exists := found;

    perform set_config('app.uk_expense_opening_import', '1', true);
    if v_exists then
      update public.uk_expenses as e
      set amount = v_amount,
          title = v_name,
          budget_category_id = v_cat
      where e.id = v_existing.id;
      update public.uk_expense_opening_imports as i
      set amount = v_amount,
          title = v_name,
          budget_category_id = v_cat,
          category_code = (select c.code from public.budget_categories as c where c.id = v_cat)
      where i.expense_id = v_existing.id;
    else
      perform ux_guard.claim_uk_expense_opening_origin();
      v_key := (
        substr(md5(v_ref), 1, 8) || '-' ||
        substr(md5(v_ref), 9, 4) || '-' ||
        '4' || substr(md5(v_ref), 14, 3) || '-' ||
        '8' || substr(md5(v_ref), 18, 3) || '-' ||
        substr(md5(v_ref), 21, 12)
      )::uuid;
      insert into public.uk_expenses (
        expense_date, amount, title, created_by, status, photo_urls,
        budget_category_id, opening_import, opening_transition_date, source_ref,
        opening_notes, opening_imported_at, opening_imported_by
      ) values (
        v_day, v_amount, v_name, v_email, 'на проверке', array[]::text[],
        v_cat, true, v_day, v_ref,
        'Historical total from the budget year start until system accounting starts. An expense dated on the activation day is operational and is not part of this total.',
        now(), v_email
      ) returning id into v_existing.id;
      insert into public.uk_expense_opening_imports (
        expense_id, source_ref, title, expense_date, amount, transition_date,
        budget_category_id, category_code, notes, idempotency_key, created_by_email
      ) values (
        v_existing.id, v_ref, v_name, v_day, v_amount, v_day,
        v_cat,
        (select c.code from public.budget_categories as c where c.id = v_cat),
        'first-run opening total',
        v_key,
        v_email
      );
    end if;
    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object('applied', true, 'none', false, 'saved', v_saved);
end;
$fn$;

revoke all on function public.admin_save_first_run_opening_totals(integer, jsonb, boolean) from public, anon;
grant execute on function public.admin_save_first_run_opening_totals(integer, jsonb, boolean) to authenticated;

create or replace function public.first_run_assert_uk_expenses_opening_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_year integer;
  v_year_id uuid;
  v_none boolean;
  v_count integer;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  begin
    v_year := nullif(btrim(coalesce(v_inst.first_run_draft ->> 'budget_calendar_year', '')), '')::integer;
  exception when others then
    v_year := null;
  end;
  if v_year is null then
    raise exception 'first_run: opening expenses confirmation required' using errcode = 'P0001';
  end if;
  select y.id into v_year_id from public.budget_years as y where y.calendar_year = v_year;
  v_none := lower(btrim(coalesce(v_inst.first_run_draft ->> 'uk_expenses_opening_none', '')))
    in ('true', 't', '1', 'yes');
  select count(*)::integer into v_count
  from public.uk_expenses as e
  where e.opening_import is true
    and v_year_id is not null
    and e.source_ref like 'first-run-opening:' || v_year_id::text || ':%'
    and e.amount > 0;
  if v_none and coalesce(v_count, 0) > 0 then
    raise exception 'first_run: opening expenses still present' using errcode = 'P0001';
  end if;
  if not v_none and coalesce(v_count, 0) = 0 then
    raise exception 'first_run: opening expenses confirmation required' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_uk_expenses_opening_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_uk_expenses_opening_ready(uuid) to authenticated;

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

  if v_need_budget then
    perform public.first_run_assert_budget_ready(p_installation_id);
  end if;
  perform public.first_run_assert_uk_expenses_opening_ready(p_installation_id);
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

drop function if exists public.admin_budget_execution(uuid);

create or replace function public.admin_budget_execution(p_year_id uuid)
returns table (
  category_id uuid,
  category_code text,
  category_name_ru text,
  planned_amount_eur numeric,
  expenses_amount_eur numeric,
  adjustments_amount_eur numeric,
  actual_amount_eur numeric,
  remaining_amount_eur numeric,
  opening_amount_eur numeric,
  operational_amount_eur numeric,
  total_expenses_eur numeric,
  plan_remainder_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
begin
  perform public.budget_assert_admin();
  select y.calendar_year into v_year
  from public.budget_years as y
  where y.id = p_year_id;
  if v_year is null then
    raise exception 'admin_budget_execution: year not found' using errcode = 'P0002';
  end if;

  return query
  select
    c.id,
    c.code,
    c.name_ru,
    coalesce(l.planned_amount_eur, 0)::numeric,
    coalesce(op.amount, 0)::numeric,
    coalesce(adj.amount, 0)::numeric,
    (coalesce(op.amount, 0) + coalesce(adj.amount, 0))::numeric,
    (coalesce(l.planned_amount_eur, 0) - (coalesce(op.amount, 0) + coalesce(adj.amount, 0)))::numeric,
    coalesce(opn.amount, 0)::numeric,
    coalesce(op.amount, 0)::numeric,
    (coalesce(opn.amount, 0) + coalesce(op.amount, 0))::numeric,
    (coalesce(l.planned_amount_eur, 0) - (coalesce(opn.amount, 0) + coalesce(op.amount, 0)))::numeric
  from public.budget_categories as c
  left join public.budget_lines as l
    on l.category_id = c.id and l.year_id = p_year_id
  left join lateral (
    select sum(e.amount)::numeric as amount
    from public.uk_expenses as e
    where e.budget_category_id = c.id
      and e.opening_import is true
      and e.status not in ('отменён', 'cancelled', 'rejected')
      and extract(year from e.expense_date::date)::integer = v_year
  ) as opn on true
  left join lateral (
    select sum(e.amount)::numeric as amount
    from public.uk_expenses as e
    where e.budget_category_id = c.id
      and public.budget_is_expense_published(e.status)
      and public.budget_expense_counts_in_operational_execution(e.opening_import)
      and extract(year from e.expense_date::date)::integer = v_year
  ) as op on true
  left join lateral (
    select sum(a.amount_eur)::numeric as amount
    from public.budget_adjustments as a
    where a.year_id = p_year_id and a.category_id = c.id
  ) as adj on true
  where c.active is true or l.id is not null
  order by c.sort_order, c.code;
end;
$fn$;

revoke all on function public.admin_budget_execution(uuid) from public, anon;
grant execute on function public.admin_budget_execution(uuid) to authenticated;

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
      v_next := 'uk_expenses_opening';
    end if;
  end if;

  if v_stage = 'uk_expenses_opening' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_uk_expenses_opening_ready(v_id);
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
$fn$;


revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;

create or replace function public.owner_get_budget_year(p_calendar_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer := coalesce(
    p_calendar_year,
    extract(year from (now() at time zone 'Europe/Sofia'))::integer
  );
  v_row public.budget_years%rowtype;
  v_lines jsonb;
  v_exec jsonb;
begin
  if auth.uid() is null then
    raise exception 'owner_get_budget_year: not authenticated'
      using errcode = '28000';
  end if;
  perform public.budget_assert_module();

  if not exists (
    select 1 from public.properties as p where public.owns_property(p.id)
  ) then
    raise exception 'owner_get_budget_year: not allowed'
      using errcode = '42501';
  end if;

  select y.* into v_row
  from public.budget_years as y
  where y.calendar_year = v_year
    and y.status in ('published', 'adopted', 'closed')
  limit 1;

  if not found then
    return jsonb_build_object(
      'year', null,
      'calendar_year', v_year,
      'lines', '[]'::jsonb,
      'execution', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', c.id,
    'category_code', c.code,
    'category_name_ru', c.name_ru,
    'category_name_en', c.name_en,
    'category_name_bg', c.name_bg,
    'planned_amount_eur', l.planned_amount_eur
  ) order by c.sort_order), '[]'::jsonb)
    into v_lines
  from public.budget_lines as l
  join public.budget_categories as c on c.id = l.category_id
  where l.year_id = v_row.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', c.id,
    'category_code', c.code,
    'category_name_ru', c.name_ru,
    'category_name_en', c.name_en,
    'category_name_bg', c.name_bg,
    'planned_amount_eur', coalesce(l.planned_amount_eur, 0),
    'opening_amount_eur', coalesce((
      select sum(e.amount)::numeric
      from public.uk_expenses as e
      where e.budget_category_id = c.id
        and e.opening_import is true
        and e.status not in ('отменён', 'cancelled', 'rejected')
        and extract(year from e.expense_date::date)::integer = v_row.calendar_year
    ), 0),
    'operational_amount_eur', coalesce((
      select sum(e.amount)::numeric
      from public.uk_expenses as e
      where e.budget_category_id = c.id
        and public.budget_is_expense_published(e.status)
        and public.budget_expense_counts_in_operational_execution(e.opening_import)
        and extract(year from e.expense_date::date)::integer = v_row.calendar_year
    ), 0),
    'total_expenses_eur', coalesce((
      select sum(e.amount)::numeric
      from public.uk_expenses as e
      where e.budget_category_id = c.id
        and e.opening_import is true
        and e.status not in ('отменён', 'cancelled', 'rejected')
        and extract(year from e.expense_date::date)::integer = v_row.calendar_year
    ), 0) + coalesce((
      select sum(e.amount)::numeric
      from public.uk_expenses as e
      where e.budget_category_id = c.id
        and public.budget_is_expense_published(e.status)
        and public.budget_expense_counts_in_operational_execution(e.opening_import)
        and extract(year from e.expense_date::date)::integer = v_row.calendar_year
    ), 0),
    'plan_remainder_eur', coalesce(l.planned_amount_eur, 0) - (
      coalesce((
        select sum(e.amount)::numeric
        from public.uk_expenses as e
        where e.budget_category_id = c.id
          and e.opening_import is true
          and e.status not in ('отменён', 'cancelled', 'rejected')
          and extract(year from e.expense_date::date)::integer = v_row.calendar_year
      ), 0) + coalesce((
        select sum(e.amount)::numeric
        from public.uk_expenses as e
        where e.budget_category_id = c.id
          and public.budget_is_expense_published(e.status)
          and public.budget_expense_counts_in_operational_execution(e.opening_import)
          and extract(year from e.expense_date::date)::integer = v_row.calendar_year
      ), 0)
    ),
    'actual_amount_eur',
      coalesce((
        select sum(e.amount)::numeric
        from public.uk_expenses as e
        where e.budget_category_id = c.id
          and public.budget_is_expense_published(e.status)
          and public.budget_expense_counts_in_operational_execution(e.opening_import)
          and extract(year from e.expense_date::date)::integer = v_row.calendar_year
      ), 0)
      + coalesce((
        select sum(a.amount_eur)::numeric
        from public.budget_adjustments as a
        where a.year_id = v_row.id and a.category_id = c.id
      ), 0),
    'remaining_amount_eur',
      coalesce(l.planned_amount_eur, 0)
      - (
        coalesce((
          select sum(e.amount)::numeric
          from public.uk_expenses as e
          where e.budget_category_id = c.id
            and public.budget_is_expense_published(e.status)
            and public.budget_expense_counts_in_operational_execution(e.opening_import)
            and extract(year from e.expense_date::date)::integer = v_row.calendar_year
        ), 0)
        + coalesce((
          select sum(a.amount_eur)::numeric
          from public.budget_adjustments as a
          where a.year_id = v_row.id and a.category_id = c.id
        ), 0)
      )
  ) order by c.sort_order), '[]'::jsonb)
    into v_exec
  from public.budget_categories as c
  left join public.budget_lines as l
    on l.category_id = c.id and l.year_id = v_row.id
  where c.active is true or l.id is not null;

  return jsonb_build_object(
    'year', jsonb_build_object(
      'id', v_row.id,
      'calendar_year', v_row.calendar_year,
      'status', v_row.status,
      'title', v_row.title,
      'decision_note', v_row.decision_note,
      'published_at', v_row.published_at,
      'adopted_at', v_row.adopted_at,
      'closed_at', v_row.closed_at
    ),
    'calendar_year', v_row.calendar_year,
    'lines', v_lines,
    'execution', v_exec
  );
end;
$fn$;

revoke all on function public.owner_get_budget_year(integer) from public;
revoke all on function public.owner_get_budget_year(integer) from anon;
grant execute on function public.owner_get_budget_year(integer) to authenticated;

commit;
