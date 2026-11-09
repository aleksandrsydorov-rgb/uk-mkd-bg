-- R1-RC8 — identical draft re-import returns idempotent (no false "saved" message).

CREATE OR REPLACE FUNCTION public.admin_commit_budget_plan(p_calendar_year integer, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Round to cents; do not reject more than two fractional digits.
    begin
      v_amount := round(v_norm::numeric, 2);
    exception when others then
      v_errors := v_errors || format('row %s: invalid amount', v_row);
      continue;
    end;
    if v_code <> '' and lower(v_code) = any (v_seen) then
      v_errors := v_errors || format('row %s: duplicate code %s', v_row, v_code);
      continue;
    end if;
    if v_code <> '' then
      v_seen := v_seen || lower(v_code);
    end if;
    if v_code <> '' and v_name <> '' then
      v_articles := v_articles || jsonb_build_array(jsonb_build_object(
        'row', v_row, 'code', v_code, 'name', v_name, 'amount', v_amount
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
      'categories', jsonb_array_length(v_articles),
      'total', (
        select coalesce(sum((value ->> 'amount')::numeric), 0)
        from jsonb_array_elements(v_articles)
      ),
      'skipped', v_skipped
    );
  end if;

  -- Draft: identical set → idempotent (clear re-import UX).
  if (
    select count(*)::integer
    from public.budget_lines as l
    where l.year_id = v_year.id
  ) = jsonb_array_length(v_articles)
     and jsonb_array_length(v_articles) > 0
     and not exists (
       select 1
       from jsonb_array_elements(v_articles) as a(value)
       where not exists (
         select 1
         from public.budget_lines as l
         join public.budget_categories as c on c.id = l.category_id
         where l.year_id = v_year.id
           and c.code = (a.value ->> 'code')
           and l.planned_amount_eur is not distinct from (a.value ->> 'amount')::numeric
       )
     ) then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'year_id', v_year.id,
      'categories', jsonb_array_length(v_articles),
      'total', (
        select coalesce(sum((value ->> 'amount')::numeric), 0)
        from jsonb_array_elements(v_articles)
      ),
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
$function$
