-- R1-RC8: budget Group → Article (no subgroups).
-- Adds group fields on budget_categories; prefills from catalog.
-- admin_commit_budget_plan: no auto-create categories; blank amount skips (no wipe);
-- explicit 0 saved; optional group/name must match catalog for known codes.

alter table public.budget_categories
  add column if not exists group_code text,
  add column if not exists group_name_ru text,
  add column if not exists group_name_en text,
  add column if not exists group_name_bg text;

comment on column public.budget_categories.group_code is
  'Budget group code (Group → Article). Not a nested subgroup.';
comment on column public.budget_categories.group_name_ru is
  'Display name of the budget group (RU). Stored catalog text — not machine-translated at runtime.';

-- Default seed articles under one operational group.
insert into public.budget_categories (
  code, name_ru, name_en, name_bg, sort_order, active,
  group_code, group_name_ru, group_name_en, group_name_bg
)
values
  ('maintenance', 'Содержание', 'Maintenance', 'Поддръжка', 10, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  ('cleaning', 'Уборка', 'Cleaning', 'Почистване', 20, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  ('security', 'Охрана', 'Security', 'Охрана', 30, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  ('repairs', 'Ремонт', 'Repairs', 'Ремонт', 40, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  ('utilities_common', 'Коммуналка общих зон', 'Common utilities', 'Комунални общи части', 50, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  ('management', 'Управление', 'Management', 'Управление', 60, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  ('other', 'Прочее', 'Other', 'Други', 90, true,
   'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване'),
  -- Text-code exemplar so 1.10 stays 1.10 (not 1.1 / date).
  ('1.10', 'Резерв группы 1', 'Group 1 reserve', 'Резерв на група 1', 15, true,
   '1', 'Содержание и текущие расходы', 'Maintenance and current expenses', 'Поддръжка и текущи разходи')
on conflict (code) do update
  set group_code = coalesce(public.budget_categories.group_code, excluded.group_code),
      group_name_ru = coalesce(nullif(btrim(public.budget_categories.group_name_ru), ''), excluded.group_name_ru),
      group_name_en = coalesce(nullif(btrim(public.budget_categories.group_name_en), ''), excluded.group_name_en),
      group_name_bg = coalesce(nullif(btrim(public.budget_categories.group_name_bg), ''), excluded.group_name_bg),
      active = true;

-- Backfill numeric codes: group = first path segment.
update public.budget_categories c
set
  group_code = coalesce(nullif(btrim(c.group_code), ''), split_part(c.code, '.', 1)),
  group_name_ru = coalesce(
    nullif(btrim(c.group_name_ru), ''),
    case split_part(c.code, '.', 1)
      when '1' then 'Содержание и текущие расходы'
      when '2' then 'Регулярные услуги'
      else 'Группа ' || split_part(c.code, '.', 1)
    end
  ),
  group_name_en = coalesce(
    nullif(btrim(c.group_name_en), ''),
    case split_part(c.code, '.', 1)
      when '1' then 'Maintenance and current expenses'
      when '2' then 'Regular services'
      else 'Group ' || split_part(c.code, '.', 1)
    end
  ),
  group_name_bg = coalesce(
    nullif(btrim(c.group_name_bg), ''),
    case split_part(c.code, '.', 1)
      when '1' then 'Поддръжка и текущи разходи'
      when '2' then 'Редовни услуги'
      else 'Група ' || split_part(c.code, '.', 1)
    end
  )
where c.code ~ '^[0-9]'
  and (
    c.group_code is null
    or nullif(btrim(c.group_code), '') is null
    or c.group_name_ru is null
    or nullif(btrim(c.group_name_ru), '') is null
  );

-- Slug codes without group → own group = article name (still two-level: group label + article).
update public.budget_categories c
set
  group_code = coalesce(nullif(btrim(c.group_code), ''), c.code),
  group_name_ru = coalesce(nullif(btrim(c.group_name_ru), ''), c.name_ru),
  group_name_en = coalesce(nullif(btrim(c.group_name_en), ''), c.name_en),
  group_name_bg = coalesce(nullif(btrim(c.group_name_bg), ''), c.name_bg)
where c.group_code is null
   or nullif(btrim(c.group_code), '') is null;

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
  v_group text;
  v_amount_text text;
  v_norm text;
  v_amount numeric;
  v_amount_blank boolean;
  v_errors text[] := '{}';
  v_seen text[] := '{}';
  v_articles jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_blank_skipped integer := 0;
  v_year public.budget_years%rowtype;
  v_article jsonb;
  v_cat public.budget_categories%rowtype;
  v_existing numeric;
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
    v_group := btrim(coalesce(v_item ->> 'group', v_item ->> 'group_name', ''));
    v_amount_text := btrim(coalesce(v_item ->> 'amount', ''));
    if v_code = '' and v_name = '' and v_group = '' and v_amount_text = '' then
      continue;
    end if;
    v_raw := v_raw || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'code', v_code,
      'name', v_name,
      'group', v_group,
      'amount', v_amount_text
    ));
  end loop;

  for v_item in select value from jsonb_array_elements(v_raw)
  loop
    v_row := (v_item ->> 'row')::integer;
    v_code := v_item ->> 'code';
    v_name := v_item ->> 'name';
    v_group := v_item ->> 'group';
    v_amount_text := v_item ->> 'amount';
    v_amount_blank := (v_amount_text is null or btrim(v_amount_text) = '');

    if v_code ~* '^(итого|всего|total|общо|sum|сумма|сума)([[:space:]]|$)'
       or v_name ~* '^(итого|всего|total|общо|sum|сумма|сума)([[:space:]]|$)' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Legacy section rows (parent codes present as prefixes in the same file).
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
      continue;
    end if;

    select c.* into v_cat
    from public.budget_categories as c
    where c.code = v_code
      and c.active is true
    limit 1;
    if not found then
      v_errors := v_errors || format('row %s: unknown code %s', v_row, v_code);
      continue;
    end if;

    -- Name must match catalog when provided (no typo auto-create / rename).
    if v_name <> ''
       and lower(v_name) is distinct from lower(v_cat.name_ru)
       and lower(v_name) is distinct from lower(v_cat.name_en)
       and lower(v_name) is distinct from lower(v_cat.name_bg) then
      v_errors := v_errors || format('row %s: name mismatch for code %s', v_row, v_code);
      continue;
    end if;

    -- Group must match catalog when provided; legacy files omit group → catalog group used.
    if v_group <> ''
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_code, ''))
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_name_ru, ''))
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_name_en, ''))
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_name_bg, '')) then
      v_errors := v_errors || format('row %s: group mismatch for code %s', v_row, v_code);
      continue;
    end if;

    if v_amount_blank then
      -- Empty amount: do not wipe an existing planned amount.
      v_blank_skipped := v_blank_skipped + 1;
      continue;
    end if;

    v_norm := replace(replace(v_amount_text, ' ', ''), ',', '.');
    if v_norm ~ '^-' then
      v_errors := v_errors || format('row %s: negative amount', v_row);
      continue;
    end if;
    if v_norm !~ '^[0-9]+(\.[0-9]+)?$' then
      v_errors := v_errors || format('row %s: invalid amount', v_row);
      continue;
    end if;
    begin
      v_amount := round(v_norm::numeric, 2);
    exception when others then
      v_errors := v_errors || format('row %s: invalid amount', v_row);
      continue;
    end;

    if lower(v_code) = any (v_seen) then
      v_errors := v_errors || format('row %s: duplicate code %s', v_row, v_code);
      continue;
    end if;
    v_seen := v_seen || lower(v_code);

    v_articles := v_articles || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'code', v_code,
      'name', coalesce(nullif(v_name, ''), v_cat.name_ru),
      'group', coalesce(nullif(v_group, ''), v_cat.group_name_ru, v_cat.group_code),
      'amount', v_amount,
      'category_id', v_cat.id
    ));
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
      'skipped', v_skipped,
      'blank_skipped', v_blank_skipped
    );
  end if;

  -- Draft: identical set → idempotent.
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
      'skipped', v_skipped,
      'blank_skipped', v_blank_skipped
    );
  end if;

  for v_article in select value from jsonb_array_elements(v_articles)
  loop
    v_total := v_total + (v_article ->> 'amount')::numeric;
    insert into public.budget_lines (year_id, category_id, planned_amount_eur, updated_at)
    values (
      v_year.id,
      (v_article ->> 'category_id')::uuid,
      (v_article ->> 'amount')::numeric,
      now()
    )
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
    'skipped', v_skipped,
    'blank_skipped', v_blank_skipped
  );
end;
$function$;

revoke all on function public.admin_commit_budget_plan(integer, jsonb) from public, anon;
grant execute on function public.admin_commit_budget_plan(integer, jsonb) to authenticated;
