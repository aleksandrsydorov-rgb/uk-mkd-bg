-- R1-RC8: budget Group → Subgroup → Article.
-- Extends budget_categories with nullable subgroup fields (no parallel catalog).
-- Existing articles keep NULL subgroup (shown directly under the group).
-- Adds a second working-group branch with real subgroups for path matching.
-- admin_commit_budget_plan validates optional subgroup when provided.

alter table public.budget_categories
  add column if not exists subgroup_code text,
  add column if not exists subgroup_name_ru text,
  add column if not exists subgroup_name_en text,
  add column if not exists subgroup_name_bg text;

comment on column public.budget_categories.group_code is
  'Budget group code (Group → Subgroup → Article). Internal; not shown in user templates.';
comment on column public.budget_categories.subgroup_code is
  'Optional subgroup under the group. NULL = article sits directly in the group.';
comment on column public.budget_categories.subgroup_name_ru is
  'Display name of the budget subgroup (RU). Stored catalog text — not machine-translated at runtime.';

-- Do not invent subgroups for existing seed articles (cleaning, security, …).
-- Extend catalog with a second group and nested subgroups (new codes only).
insert into public.budget_categories (
  code, name_ru, name_en, name_bg, sort_order, active,
  group_code, group_name_ru, group_name_en, group_name_bg,
  subgroup_code, subgroup_name_ru, subgroup_name_en, subgroup_name_bg
)
values
  (
    'svc_cctv', 'Видеонаблюдение', 'CCTV', 'Видеонаблюдение', 110, true,
    'services', 'Регулярные услуги', 'Regular services', 'Редовни услуги',
    'sec', 'Охрана и контроль', 'Security and control', 'Охрана и контрол'
  ),
  (
    'svc_guard_post', 'Пост охраны', 'Guard post', 'Пост охрана', 120, true,
    'services', 'Регулярные услуги', 'Regular services', 'Редовни услуги',
    'sec', 'Охрана и контроль', 'Security and control', 'Охрана и контрол'
  ),
  (
    'svc_hall_clean', 'Уборка холлов', 'Hall cleaning', 'Почистване на фоайета', 130, true,
    'services', 'Регулярные услуги', 'Regular services', 'Редовни услуги',
    'clean', 'Клининг', 'Cleaning', 'Клийнинг'
  ),
  (
    'svc_reserve', 'Резерв', 'Reserve', 'Резерв', 140, true,
    'services', 'Регулярные услуги', 'Regular services', 'Редовни услуги',
    null, null, null, null
  ),
  (
    'ops_reserve', 'Резерв', 'Reserve', 'Резерв', 95, true,
    'ops', 'Содержание и обслуживание', 'Maintenance and services', 'Поддръжка и обслужване',
    null, null, null, null
  )
on conflict (code) do update
  set group_code = coalesce(public.budget_categories.group_code, excluded.group_code),
      group_name_ru = coalesce(nullif(btrim(public.budget_categories.group_name_ru), ''), excluded.group_name_ru),
      group_name_en = coalesce(nullif(btrim(public.budget_categories.group_name_en), ''), excluded.group_name_en),
      group_name_bg = coalesce(nullif(btrim(public.budget_categories.group_name_bg), ''), excluded.group_name_bg),
      subgroup_code = coalesce(public.budget_categories.subgroup_code, excluded.subgroup_code),
      subgroup_name_ru = coalesce(nullif(btrim(public.budget_categories.subgroup_name_ru), ''), excluded.subgroup_name_ru),
      subgroup_name_en = coalesce(nullif(btrim(public.budget_categories.subgroup_name_en), ''), excluded.subgroup_name_en),
      subgroup_name_bg = coalesce(nullif(btrim(public.budget_categories.subgroup_name_bg), ''), excluded.subgroup_name_bg),
      active = true;

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
  v_subgroup text;
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
    v_subgroup := btrim(coalesce(v_item ->> 'subgroup', v_item ->> 'subgroup_name', ''));
    v_amount_text := btrim(coalesce(v_item ->> 'amount', ''));
    if v_code = '' and v_name = '' and v_group = '' and v_subgroup = '' and v_amount_text = '' then
      continue;
    end if;
    v_raw := v_raw || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'code', v_code,
      'name', v_name,
      'group', v_group,
      'subgroup', v_subgroup,
      'amount', v_amount_text
    ));
  end loop;

  for v_item in select value from jsonb_array_elements(v_raw)
  loop
    v_row := (v_item ->> 'row')::integer;
    v_code := v_item ->> 'code';
    v_name := v_item ->> 'name';
    v_group := v_item ->> 'group';
    v_subgroup := v_item ->> 'subgroup';
    v_amount_text := v_item ->> 'amount';
    v_amount_blank := (v_amount_text is null or btrim(v_amount_text) = '');

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

    if v_name <> ''
       and lower(v_name) is distinct from lower(v_cat.name_ru)
       and lower(v_name) is distinct from lower(v_cat.name_en)
       and lower(v_name) is distinct from lower(v_cat.name_bg) then
      v_errors := v_errors || format('row %s: name mismatch for code %s', v_row, v_code);
      continue;
    end if;

    if v_group <> ''
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_code, ''))
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_name_ru, ''))
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_name_en, ''))
       and lower(v_group) is distinct from lower(coalesce(v_cat.group_name_bg, '')) then
      v_errors := v_errors || format('row %s: group mismatch for code %s', v_row, v_code);
      continue;
    end if;

    -- Subgroup optional: blank accepts any catalog subgroup (filled from catalog).
    -- When provided, must match catalog subgroup labels / code.
    if v_subgroup <> ''
       and lower(v_subgroup) is distinct from lower(coalesce(v_cat.subgroup_code, ''))
       and lower(v_subgroup) is distinct from lower(coalesce(v_cat.subgroup_name_ru, ''))
       and lower(v_subgroup) is distinct from lower(coalesce(v_cat.subgroup_name_en, ''))
       and lower(v_subgroup) is distinct from lower(coalesce(v_cat.subgroup_name_bg, '')) then
      v_errors := v_errors || format('row %s: subgroup mismatch for code %s', v_row, v_code);
      continue;
    end if;

    if v_amount_blank then
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
      'subgroup', coalesce(
        nullif(v_subgroup, ''),
        v_cat.subgroup_name_ru,
        v_cat.subgroup_code,
        ''
      ),
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
