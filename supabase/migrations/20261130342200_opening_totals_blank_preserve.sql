-- Opening expenses: blank amount preserves existing fact (does not write zero).
-- List returns NULL opening when no opening expense exists (distinguish unset vs 0).
-- Expose group/subgroup labels for hierarchical UI (not written into the XLSX template).

drop function if exists public.admin_list_first_run_opening_totals(integer);

create or replace function public.admin_list_first_run_opening_totals(p_calendar_year integer)
returns table (
  category_id uuid,
  code text,
  name_ru text,
  name_en text,
  name_bg text,
  planned_amount_eur numeric,
  opening_amount_eur numeric,
  group_name_ru text,
  group_name_en text,
  group_name_bg text,
  subgroup_name_ru text,
  subgroup_name_en text,
  subgroup_name_bg text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
    e.amount::numeric,
    c.group_name_ru,
    c.group_name_en,
    c.group_name_bg,
    c.subgroup_name_ru,
    c.subgroup_name_en,
    c.subgroup_name_bg
  from public.budget_lines as l
  join public.budget_categories as c on c.id = l.category_id
  left join public.uk_expenses as e
    on e.opening_import is true
   and e.source_ref = public.first_run_opening_source_ref(v_year_id, c.id)
  where l.year_id = v_year_id
  order by c.sort_order, c.code;
end;
$function$;

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
set search_path to ''
as $function$
declare
  v_year public.budget_years%rowtype;
  v_item jsonb;
  v_cat uuid;
  v_amount numeric;
  v_norm text;
  v_row integer;
  v_amount_blank boolean;
  v_errors text[] := '{}';
  v_line public.budget_lines%rowtype;
  v_ref text;
  v_existing public.uk_expenses%rowtype;
  v_name text;
  v_day date;
  v_email text := auth.email();
  v_saved integer := 0;
  v_skipped_blank integer := 0;
  v_key uuid;
  v_exists boolean;
begin
  perform public.budget_assert_admin();
  perform public.admin_assert_module_initial_setup_writable('uk_expenses');
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
    v_amount_blank := (v_norm is null or v_norm = '');
    if v_amount_blank then
      -- Blank preserves existing fact — skip validation of amount.
      if v_cat is null or not exists (
        select 1 from public.budget_lines as l
        where l.year_id = v_year.id and l.category_id = v_cat
      ) then
        v_errors := v_errors || format('row %s: unknown category', v_row);
      end if;
      continue;
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
    return jsonb_build_object('applied', true, 'none', true, 'saved', 0, 'blank_skipped', 0);
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_cat := (v_item ->> 'category_id')::uuid;
    v_norm := replace(replace(btrim(coalesce(v_item ->> 'amount', '')), ' ', ''), ',', '.');
    if v_norm is null or v_norm = '' then
      v_skipped_blank := v_skipped_blank + 1;
      continue;
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

  return jsonb_build_object(
    'applied', true,
    'none', false,
    'saved', v_saved,
    'blank_skipped', v_skipped_blank
  );
end;
$function$;

revoke all on function public.admin_save_first_run_opening_totals(integer, jsonb, boolean) from public, anon;
grant execute on function public.admin_save_first_run_opening_totals(integer, jsonb, boolean) to authenticated;
