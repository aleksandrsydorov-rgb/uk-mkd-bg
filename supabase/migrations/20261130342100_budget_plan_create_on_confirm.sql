-- First-run budget import: create Group → Subgroup → Article on confirm.
-- Match known paths; create missing ones in the same transaction as plan lines.
-- Blank amount skips (no wipe). Explicit 0 is saved. Re-import is path-idempotent.

create or replace function public.budget_norm_label(p_text text)
returns text
language sql
immutable
as $fn$
  select lower(btrim(regexp_replace(
    translate(
      coalesce(p_text, ''),
      E'\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\uFEFF',
      '                 '
    ),
    '[[:space:]]+',
    ' ',
    'g'
  )));
$fn$;

revoke all on function public.budget_norm_label(text) from public, anon;
grant execute on function public.budget_norm_label(text) to authenticated;

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
  v_seen_codes text[] := '{}';
  v_seen_paths text[] := '{}';
  v_path_key text;
  v_articles jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_blank_skipped integer := 0;
  v_created integer := 0;
  v_year public.budget_years%rowtype;
  v_article jsonb;
  v_cat public.budget_categories%rowtype;
  v_cat_found boolean;
  v_existing numeric;
  v_total numeric := 0;
  v_sort integer := 0;
  v_group_code text;
  v_subgroup_code text;
  v_new_code text;
  v_needs_create boolean;
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
    v_cat_found := false;
    v_needs_create := false;

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

    if v_name = '' then
      v_errors := v_errors || format('row %s: name required', v_row);
      continue;
    end if;

    if v_code <> '' then
      select c.* into v_cat
      from public.budget_categories as c
      where c.code = v_code
        and c.active is true
      limit 1;
      v_cat_found := found;
      if not v_cat_found then
        v_errors := v_errors || format('row %s: unknown code %s', v_row, v_code);
        continue;
      end if;
      if public.budget_norm_label(v_name) is distinct from public.budget_norm_label(v_cat.name_ru)
         and public.budget_norm_label(v_name) is distinct from public.budget_norm_label(v_cat.name_en)
         and public.budget_norm_label(v_name) is distinct from public.budget_norm_label(v_cat.name_bg) then
        v_errors := v_errors || format('row %s: name mismatch for code %s', v_row, v_code);
        continue;
      end if;
      if v_group <> ''
         and public.budget_norm_label(v_group) is distinct from public.budget_norm_label(coalesce(v_cat.group_code, ''))
         and public.budget_norm_label(v_group) is distinct from public.budget_norm_label(coalesce(v_cat.group_name_ru, ''))
         and public.budget_norm_label(v_group) is distinct from public.budget_norm_label(coalesce(v_cat.group_name_en, ''))
         and public.budget_norm_label(v_group) is distinct from public.budget_norm_label(coalesce(v_cat.group_name_bg, '')) then
        v_errors := v_errors || format('row %s: group mismatch for code %s', v_row, v_code);
        continue;
      end if;
      if v_subgroup <> ''
         and public.budget_norm_label(v_subgroup) is distinct from public.budget_norm_label(coalesce(v_cat.subgroup_code, ''))
         and public.budget_norm_label(v_subgroup) is distinct from public.budget_norm_label(coalesce(v_cat.subgroup_name_ru, ''))
         and public.budget_norm_label(v_subgroup) is distinct from public.budget_norm_label(coalesce(v_cat.subgroup_name_en, ''))
         and public.budget_norm_label(v_subgroup) is distinct from public.budget_norm_label(coalesce(v_cat.subgroup_name_bg, '')) then
        v_errors := v_errors || format('row %s: subgroup mismatch for code %s', v_row, v_code);
        continue;
      end if;
    else
      if v_group = '' then
        v_errors := v_errors || format('row %s: group required', v_row);
        continue;
      end if;
      select c.* into v_cat
      from public.budget_categories as c
      where c.active is true
        and (
          public.budget_norm_label(c.name_ru) = public.budget_norm_label(v_name)
          or public.budget_norm_label(c.name_en) = public.budget_norm_label(v_name)
          or public.budget_norm_label(c.name_bg) = public.budget_norm_label(v_name)
        )
        and (
          public.budget_norm_label(coalesce(c.group_name_ru, '')) = public.budget_norm_label(v_group)
          or public.budget_norm_label(coalesce(c.group_name_en, '')) = public.budget_norm_label(v_group)
          or public.budget_norm_label(coalesce(c.group_name_bg, '')) = public.budget_norm_label(v_group)
        )
        and (
          case
            when btrim(v_subgroup) = '' then
              coalesce(nullif(btrim(c.subgroup_code), ''), nullif(btrim(c.subgroup_name_ru), ''),
                       nullif(btrim(c.subgroup_name_en), ''), nullif(btrim(c.subgroup_name_bg), '')) is null
            else
              public.budget_norm_label(coalesce(c.subgroup_name_ru, '')) = public.budget_norm_label(v_subgroup)
              or public.budget_norm_label(coalesce(c.subgroup_name_en, '')) = public.budget_norm_label(v_subgroup)
              or public.budget_norm_label(coalesce(c.subgroup_name_bg, '')) = public.budget_norm_label(v_subgroup)
              or public.budget_norm_label(coalesce(c.subgroup_code, '')) = public.budget_norm_label(v_subgroup)
          end
        )
      order by c.sort_order, c.code
      limit 1;
      v_cat_found := found;
      if not v_cat_found then
        v_needs_create := true;
      end if;
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

    v_path_key := public.budget_norm_label(v_group) || '|' || public.budget_norm_label(v_subgroup)
      || '|' || public.budget_norm_label(v_name);

    if v_code <> '' then
      if lower(v_code) = any (v_seen_codes) then
        v_errors := v_errors || format('row %s: duplicate code %s', v_row, v_code);
        continue;
      end if;
      v_seen_codes := v_seen_codes || lower(v_code);
    end if;

    if v_path_key = any (v_seen_paths) then
      v_errors := v_errors || format('row %s: duplicate article path', v_row);
      continue;
    end if;
    v_seen_paths := v_seen_paths || v_path_key;

    if v_needs_create then
      v_articles := v_articles || jsonb_build_array(jsonb_build_object(
        'row', v_row,
        'code', '',
        'name', v_name,
        'group', v_group,
        'subgroup', coalesce(v_subgroup, ''),
        'amount', v_amount,
        'category_id', null,
        'create', true
      ));
    else
      v_articles := v_articles || jsonb_build_array(jsonb_build_object(
        'row', v_row,
        'code', v_cat.code,
        'name', coalesce(nullif(v_name, ''), v_cat.name_ru),
        'group', coalesce(nullif(v_group, ''), v_cat.group_name_ru, v_cat.group_code),
        'subgroup', coalesce(
          nullif(v_subgroup, ''),
          v_cat.subgroup_name_ru,
          v_cat.subgroup_code,
          ''
        ),
        'amount', v_amount,
        'category_id', v_cat.id,
        'create', false
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

  if v_year.status is distinct from 'draft'
     and exists (
       select 1 from jsonb_array_elements(v_articles) a
       where coalesce((a.value ->> 'create')::boolean, false)
     ) then
    raise exception 'budget_import: cannot create articles on published plan'
      using errcode = 'P0001';
  end if;

  -- Create missing categories (draft only) before line upsert / idempotent check.
  for v_article in select value from jsonb_array_elements(v_articles)
  loop
    if coalesce((v_article ->> 'create')::boolean, false) is not true then
      continue;
    end if;

    v_name := v_article ->> 'name';
    v_group := v_article ->> 'group';
    v_subgroup := coalesce(v_article ->> 'subgroup', '');

    select c.group_code into v_group_code
    from public.budget_categories as c
    where c.active is true
      and (
        public.budget_norm_label(coalesce(c.group_name_ru, '')) = public.budget_norm_label(v_group)
        or public.budget_norm_label(coalesce(c.group_name_en, '')) = public.budget_norm_label(v_group)
        or public.budget_norm_label(coalesce(c.group_name_bg, '')) = public.budget_norm_label(v_group)
      )
      and nullif(btrim(c.group_code), '') is not null
    order by c.sort_order
    limit 1;
    if not found then
      v_group_code := 'grp_' || substr(md5(public.budget_norm_label(v_group)), 1, 12);
    end if;

    if btrim(v_subgroup) = '' then
      v_subgroup_code := null;
    else
      select c.subgroup_code into v_subgroup_code
      from public.budget_categories as c
      where c.active is true
        and public.budget_norm_label(coalesce(c.group_code, '')) = public.budget_norm_label(v_group_code)
        and (
          public.budget_norm_label(coalesce(c.subgroup_name_ru, '')) = public.budget_norm_label(v_subgroup)
          or public.budget_norm_label(coalesce(c.subgroup_name_en, '')) = public.budget_norm_label(v_subgroup)
          or public.budget_norm_label(coalesce(c.subgroup_name_bg, '')) = public.budget_norm_label(v_subgroup)
        )
        and nullif(btrim(c.subgroup_code), '') is not null
      order by c.sort_order
      limit 1;
      if not found then
        v_subgroup_code := 'sg_' || substr(md5(
          public.budget_norm_label(v_group) || '|' || public.budget_norm_label(v_subgroup)
        ), 1, 12);
      end if;
    end if;

    -- Path-idempotent: reuse if another concurrent confirm already created it.
    select c.* into v_cat
    from public.budget_categories as c
    where c.active is true
      and (
        public.budget_norm_label(c.name_ru) = public.budget_norm_label(v_name)
        or public.budget_norm_label(c.name_en) = public.budget_norm_label(v_name)
        or public.budget_norm_label(c.name_bg) = public.budget_norm_label(v_name)
      )
      and (
        public.budget_norm_label(coalesce(c.group_name_ru, '')) = public.budget_norm_label(v_group)
        or public.budget_norm_label(coalesce(c.group_name_en, '')) = public.budget_norm_label(v_group)
        or public.budget_norm_label(coalesce(c.group_name_bg, '')) = public.budget_norm_label(v_group)
      )
      and (
        case
          when btrim(v_subgroup) = '' then
            coalesce(nullif(btrim(c.subgroup_code), ''), nullif(btrim(c.subgroup_name_ru), ''),
                     nullif(btrim(c.subgroup_name_en), ''), nullif(btrim(c.subgroup_name_bg), '')) is null
          else
            public.budget_norm_label(coalesce(c.subgroup_name_ru, '')) = public.budget_norm_label(v_subgroup)
            or public.budget_norm_label(coalesce(c.subgroup_name_en, '')) = public.budget_norm_label(v_subgroup)
            or public.budget_norm_label(coalesce(c.subgroup_name_bg, '')) = public.budget_norm_label(v_subgroup)
        end
      )
    limit 1;
    v_cat_found := found;

    if not v_cat_found then
      select coalesce(max(c.sort_order), 0) + 10 into v_sort from public.budget_categories as c;
      v_new_code := 'usr_' || substr(md5(
        public.budget_norm_label(v_group) || '|' || public.budget_norm_label(v_subgroup)
        || '|' || public.budget_norm_label(v_name)
      ), 1, 16);
      while exists (select 1 from public.budget_categories c where c.code = v_new_code) loop
        v_new_code := 'usr_' || substr(md5(v_new_code || clock_timestamp()::text), 1, 16);
      end loop;

      insert into public.budget_categories (
        code, name_ru, name_en, name_bg, sort_order, active,
        group_code, group_name_ru, group_name_en, group_name_bg,
        subgroup_code, subgroup_name_ru, subgroup_name_en, subgroup_name_bg
      ) values (
        v_new_code, v_name, v_name, v_name, v_sort, true,
        v_group_code, v_group, v_group, v_group,
        v_subgroup_code,
        nullif(v_subgroup, ''), nullif(v_subgroup, ''), nullif(v_subgroup, '')
      )
      returning * into v_cat;
      v_created := v_created + 1;
    end if;

    v_articles := (
      select coalesce(jsonb_agg(
        case
          when (elem ->> 'row')::integer = (v_article ->> 'row')::integer
            and coalesce((elem ->> 'create')::boolean, false)
          then jsonb_build_object(
            'row', (elem ->> 'row')::integer,
            'code', v_cat.code,
            'name', v_name,
            'group', v_group,
            'subgroup', v_subgroup,
            'amount', (elem ->> 'amount')::numeric,
            'category_id', v_cat.id,
            'create', false
          )
          else elem
        end
      ), '[]'::jsonb)
      from jsonb_array_elements(v_articles) as t(elem)
    );
  end loop;

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
      'created', 0,
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
      'created', 0,
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
    'created', v_created,
    'total', v_total,
    'skipped', v_skipped,
    'blank_skipped', v_blank_skipped
  );
end;
$function$;

revoke all on function public.admin_commit_budget_plan(integer, jsonb) from public, anon;
grant execute on function public.admin_commit_budget_plan(integer, jsonb) to authenticated;
