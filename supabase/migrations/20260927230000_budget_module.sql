-- Budget module v1: annual budget by cost category, hybrid adoption, execution
-- from published uk_expenses + manual adjustments. No owner billing.

begin;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('budget', 'Бюджет', 'finance', true, 30)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
select 'budget', false, now(), null
where not exists (
  select 1 from public.building_modules as bm where bm.module_key = 'budget'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_ru text not null,
  name_en text not null,
  name_bg text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint budget_categories_code_uidx unique (code),
  constraint budget_categories_code_nonempty check (length(btrim(code)) > 0)
);

create index if not exists budget_categories_active_sort_idx
  on public.budget_categories (active, sort_order, code);

insert into public.budget_categories (code, name_ru, name_en, name_bg, sort_order)
values
  ('maintenance', 'Содержание', 'Maintenance', 'Поддръжка', 10),
  ('cleaning', 'Уборка', 'Cleaning', 'Почистване', 20),
  ('security', 'Охрана', 'Security', 'Охрана', 30),
  ('repairs', 'Ремонт', 'Repairs', 'Ремонт', 40),
  ('utilities_common', 'Коммуналка общих зон', 'Common utilities', 'Комунални общи части', 50),
  ('management', 'Управление', 'Management', 'Управление', 60),
  ('other', 'Прочее', 'Other', 'Други', 90)
on conflict (code) do nothing;

create table if not exists public.budget_years (
  id uuid primary key default gen_random_uuid(),
  calendar_year integer not null,
  status text not null default 'draft'
    constraint budget_years_status_check
      check (status in ('draft', 'published', 'adopted', 'closed')),
  title text null,
  decision_note text null,
  decision_id uuid null
    references public.general_meeting_decisions (id) on delete set null,
  published_at timestamptz null,
  adopted_at timestamptz null,
  closed_at timestamptz null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_years_calendar_year_uidx unique (calendar_year),
  constraint budget_years_year_range check (
    calendar_year >= 2020 and calendar_year <= 2100
  )
);

create table if not exists public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  year_id uuid not null
    references public.budget_years (id) on delete cascade,
  category_id uuid not null
    references public.budget_categories (id) on delete restrict,
  planned_amount_eur numeric(14, 2) not null default 0
    constraint budget_lines_planned_nonneg check (planned_amount_eur >= 0),
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_lines_year_category_uidx unique (year_id, category_id)
);

create index if not exists budget_lines_year_idx
  on public.budget_lines (year_id);

create table if not exists public.budget_adjustments (
  id uuid primary key default gen_random_uuid(),
  year_id uuid not null
    references public.budget_years (id) on delete cascade,
  category_id uuid not null
    references public.budget_categories (id) on delete restrict,
  amount_eur numeric(14, 2) not null
    constraint budget_adjustments_amount_nonzero check (amount_eur <> 0),
  reason text not null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint budget_adjustments_reason_nonempty check (length(btrim(reason)) > 0)
);

create index if not exists budget_adjustments_year_cat_idx
  on public.budget_adjustments (year_id, category_id);

alter table public.uk_expenses
  add column if not exists budget_category_id uuid null
    references public.budget_categories (id) on delete set null;

create index if not exists uk_expenses_budget_category_idx
  on public.uk_expenses (budget_category_id)
  where budget_category_id is not null;

alter table public.budget_categories enable row level security;
alter table public.budget_years enable row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_adjustments enable row level security;

revoke all on table public.budget_categories from public, anon, authenticated;
revoke all on table public.budget_years from public, anon, authenticated;
revoke all on table public.budget_lines from public, anon, authenticated;
revoke all on table public.budget_adjustments from public, anon, authenticated;

grant select on table public.budget_categories to authenticated;
grant select on table public.budget_years to authenticated;
grant select on table public.budget_lines to authenticated;
grant select on table public.budget_adjustments to authenticated;

drop policy if exists budget_categories_select on public.budget_categories;
create policy budget_categories_select on public.budget_categories
  for select to authenticated
  using (true);

drop policy if exists budget_years_select on public.budget_years;
create policy budget_years_select on public.budget_years
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
    or status in ('published', 'adopted', 'closed')
  );

drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
    or exists (
      select 1 from public.budget_years as y
      where y.id = year_id
        and y.status in ('published', 'adopted', 'closed')
    )
  );

drop policy if exists budget_adjustments_select on public.budget_adjustments;
create policy budget_adjustments_select on public.budget_adjustments
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.budget_module_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bm.enabled from public.building_modules as bm where bm.module_key = 'budget'),
    false
  );
$$;

revoke all on function public.budget_module_enabled() from public;
revoke all on function public.budget_module_enabled() from anon;
revoke all on function public.budget_module_enabled() from authenticated;

create or replace function public.budget_assert_module()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.budget_module_enabled() then
    raise exception 'budget: module disabled'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.budget_assert_module() from public;
revoke all on function public.budget_assert_module() from anon;

create or replace function public.budget_assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'budget: not authenticated'
      using errcode = '28000';
  end if;
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'budget: not allowed'
      using errcode = '42501';
  end if;
  perform public.budget_assert_module();
end;
$fn$;

revoke all on function public.budget_assert_admin() from public;
revoke all on function public.budget_assert_admin() from anon;

create or replace function public.budget_is_expense_published(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(p_status, '')) in ('опубликован', 'approved', 'published');
$$;

revoke all on function public.budget_is_expense_published(text) from public;

-- Require category when publishing expense while budget module is on
create or replace function public.uk_expenses_budget_category_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if public.budget_module_enabled()
     and public.budget_is_expense_published(NEW.status)
     and NEW.budget_category_id is null
  then
    raise exception 'uk_expenses: budget_category_id required when budget module enabled'
      using errcode = '23502';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists uk_expenses_budget_category_biu on public.uk_expenses;
create trigger uk_expenses_budget_category_biu
  before insert or update of status, budget_category_id on public.uk_expenses
  for each row
  execute function public.uk_expenses_budget_category_trg();

-- ---------------------------------------------------------------------------
-- Categories / years / lines
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_budget_categories()
returns setof public.budget_categories
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.budget_assert_admin();
  return query
  select c.*
  from public.budget_categories as c
  where c.active is true
  order by c.sort_order, c.code;
end;
$fn$;

revoke all on function public.admin_list_budget_categories() from public;
revoke all on function public.admin_list_budget_categories() from anon;
grant execute on function public.admin_list_budget_categories() to authenticated;

create or replace function public.admin_list_budget_years()
returns setof public.budget_years
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.budget_assert_admin();
  return query
  select y.*
  from public.budget_years as y
  order by y.calendar_year desc;
end;
$fn$;

revoke all on function public.admin_list_budget_years() from public;
revoke all on function public.admin_list_budget_years() from anon;
grant execute on function public.admin_list_budget_years() to authenticated;

create or replace function public.admin_create_budget_year(
  p_calendar_year integer,
  p_title text default null
)
returns public.budget_years
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.budget_years%rowtype;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_cat record;
begin
  perform public.budget_assert_admin();
  if p_calendar_year is null or p_calendar_year < 2020 or p_calendar_year > 2100 then
    raise exception 'admin_create_budget_year: invalid year'
      using errcode = '22023';
  end if;

  insert into public.budget_years (
    calendar_year, status, title, created_by_email
  ) values (
    p_calendar_year, 'draft', nullif(btrim(coalesce(p_title, '')), ''), v_email
  )
  returning * into v_row;

  -- seed zero lines for all active categories
  for v_cat in
    select c.id from public.budget_categories as c where c.active is true
  loop
    insert into public.budget_lines (year_id, category_id, planned_amount_eur)
    values (v_row.id, v_cat.id, 0)
    on conflict do nothing;
  end loop;

  return v_row;
end;
$fn$;

revoke all on function public.admin_create_budget_year(integer, text) from public;
revoke all on function public.admin_create_budget_year(integer, text) from anon;
grant execute on function public.admin_create_budget_year(integer, text) to authenticated;

create or replace function public.admin_list_budget_lines(p_year_id uuid)
returns table (
  id uuid,
  year_id uuid,
  category_id uuid,
  category_code text,
  category_name_ru text,
  planned_amount_eur numeric,
  note text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.budget_assert_admin();
  if p_year_id is null then
    raise exception 'admin_list_budget_lines: year required'
      using errcode = '22023';
  end if;
  return query
  select
    l.id,
    l.year_id,
    l.category_id,
    c.code,
    c.name_ru,
    l.planned_amount_eur,
    l.note
  from public.budget_lines as l
  join public.budget_categories as c on c.id = l.category_id
  where l.year_id = p_year_id
  order by c.sort_order, c.code;
end;
$fn$;

revoke all on function public.admin_list_budget_lines(uuid) from public;
revoke all on function public.admin_list_budget_lines(uuid) from anon;
grant execute on function public.admin_list_budget_lines(uuid) to authenticated;

create or replace function public.admin_upsert_budget_line(
  p_year_id uuid,
  p_category_id uuid,
  p_planned_amount_eur numeric,
  p_note text default null
)
returns public.budget_lines
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_row public.budget_lines%rowtype;
  v_amount numeric := coalesce(p_planned_amount_eur, 0);
begin
  perform public.budget_assert_admin();
  if p_year_id is null or p_category_id is null then
    raise exception 'admin_upsert_budget_line: year and category required'
      using errcode = '22023';
  end if;
  if v_amount < 0 then
    raise exception 'admin_upsert_budget_line: amount must be >= 0'
      using errcode = '22023';
  end if;

  select y.status into v_status
  from public.budget_years as y
  where y.id = p_year_id;
  if v_status is null then
    raise exception 'admin_upsert_budget_line: year not found'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'admin_upsert_budget_line: only draft editable'
      using errcode = 'P0001';
  end if;

  insert into public.budget_lines (
    year_id, category_id, planned_amount_eur, note, updated_at
  ) values (
    p_year_id, p_category_id, v_amount, nullif(btrim(coalesce(p_note, '')), ''), now()
  )
  on conflict (year_id, category_id) do update
    set planned_amount_eur = excluded.planned_amount_eur,
        note = excluded.note,
        updated_at = now()
  returning * into v_row;

  update public.budget_years set updated_at = now() where id = p_year_id;
  return v_row;
end;
$fn$;

revoke all on function public.admin_upsert_budget_line(uuid, uuid, numeric, text) from public;
revoke all on function public.admin_upsert_budget_line(uuid, uuid, numeric, text) from anon;
grant execute on function public.admin_upsert_budget_line(uuid, uuid, numeric, text) to authenticated;

create or replace function public.admin_set_budget_year_status(
  p_year_id uuid,
  p_status text,
  p_decision_note text default null,
  p_decision_id uuid default null
)
returns public.budget_years
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_row public.budget_years%rowtype;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  perform public.budget_assert_admin();
  if p_year_id is null then
    raise exception 'admin_set_budget_year_status: year required'
      using errcode = '22023';
  end if;
  if v_status is null or v_status not in ('draft', 'published', 'adopted', 'closed') then
    raise exception 'admin_set_budget_year_status: invalid status'
      using errcode = '22023';
  end if;

  select y.* into v_row
  from public.budget_years as y
  where y.id = p_year_id
  for update;
  if not found then
    raise exception 'admin_set_budget_year_status: not found'
      using errcode = 'P0002';
  end if;

  if v_status = 'draft' then
    if v_row.status not in ('draft', 'published') then
      raise exception 'admin_set_budget_year_status: reopen only from published'
        using errcode = 'P0001';
    end if;
    update public.budget_years as y
       set status = 'draft',
           published_at = null,
           updated_at = now()
     where y.id = p_year_id
    returning * into v_row;

  elsif v_status = 'published' then
    if v_row.status is distinct from 'draft' then
      raise exception 'admin_set_budget_year_status: publish only from draft'
        using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.budget_lines as l where l.year_id = p_year_id) then
      raise exception 'admin_set_budget_year_status: no lines'
        using errcode = 'P0001';
    end if;
    update public.budget_years as y
       set status = 'published',
           published_at = now(),
           updated_at = now()
     where y.id = p_year_id
    returning * into v_row;

  elsif v_status = 'adopted' then
    if v_row.status not in ('published', 'adopted') then
      raise exception 'admin_set_budget_year_status: adopt from published'
        using errcode = 'P0001';
    end if;
    if p_decision_id is not null and not exists (
      select 1 from public.general_meeting_decisions as d where d.id = p_decision_id
    ) then
      raise exception 'admin_set_budget_year_status: decision not found'
        using errcode = 'P0002';
    end if;
    update public.budget_years as y
       set status = 'adopted',
           adopted_at = coalesce(y.adopted_at, now()),
           decision_note = coalesce(v_note, y.decision_note),
           decision_id = coalesce(p_decision_id, y.decision_id),
           updated_at = now()
     where y.id = p_year_id
    returning * into v_row;

  else -- closed
    if v_row.status not in ('adopted', 'closed') then
      raise exception 'admin_set_budget_year_status: close from adopted'
        using errcode = 'P0001';
    end if;
    update public.budget_years as y
       set status = 'closed',
           closed_at = coalesce(y.closed_at, now()),
           updated_at = now()
     where y.id = p_year_id
    returning * into v_row;
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_set_budget_year_status(uuid, text, text, uuid) from public;
revoke all on function public.admin_set_budget_year_status(uuid, text, text, uuid) from anon;
grant execute on function public.admin_set_budget_year_status(uuid, text, text, uuid) to authenticated;

create or replace function public.admin_create_budget_adjustment(
  p_year_id uuid,
  p_category_id uuid,
  p_amount_eur numeric,
  p_reason text
)
returns public.budget_adjustments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_row public.budget_adjustments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  perform public.budget_assert_admin();
  if p_year_id is null or p_category_id is null then
    raise exception 'admin_create_budget_adjustment: year and category required'
      using errcode = '22023';
  end if;
  if p_amount_eur is null or p_amount_eur = 0 then
    raise exception 'admin_create_budget_adjustment: amount required'
      using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'admin_create_budget_adjustment: reason required'
      using errcode = '22023';
  end if;

  select y.status into v_status from public.budget_years as y where y.id = p_year_id;
  if v_status is null then
    raise exception 'admin_create_budget_adjustment: year not found'
      using errcode = 'P0002';
  end if;
  if v_status not in ('adopted', 'published') then
    raise exception 'admin_create_budget_adjustment: year not open for adjustments'
      using errcode = 'P0001';
  end if;

  insert into public.budget_adjustments (
    year_id, category_id, amount_eur, reason, created_by_email
  ) values (
    p_year_id, p_category_id, p_amount_eur, v_reason, v_email
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.admin_create_budget_adjustment(uuid, uuid, numeric, text) from public;
revoke all on function public.admin_create_budget_adjustment(uuid, uuid, numeric, text) from anon;
grant execute on function public.admin_create_budget_adjustment(uuid, uuid, numeric, text) to authenticated;

create or replace function public.admin_list_budget_adjustments(p_year_id uuid)
returns setof public.budget_adjustments
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.budget_assert_admin();
  return query
  select a.*
  from public.budget_adjustments as a
  where a.year_id = p_year_id
  order by a.created_at desc
  limit 200;
end;
$fn$;

revoke all on function public.admin_list_budget_adjustments(uuid) from public;
revoke all on function public.admin_list_budget_adjustments(uuid) from anon;
grant execute on function public.admin_list_budget_adjustments(uuid) to authenticated;

-- Execution report (plan vs fact)
create or replace function public.admin_budget_execution(p_year_id uuid)
returns table (
  category_id uuid,
  category_code text,
  category_name_ru text,
  planned_amount_eur numeric,
  expenses_amount_eur numeric,
  adjustments_amount_eur numeric,
  actual_amount_eur numeric,
  remaining_amount_eur numeric
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
    raise exception 'admin_budget_execution: year not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    c.id,
    c.code,
    c.name_ru,
    coalesce(l.planned_amount_eur, 0)::numeric,
    coalesce((
      select sum(e.amount)::numeric
      from public.uk_expenses as e
      where e.budget_category_id = c.id
        and public.budget_is_expense_published(e.status)
        and extract(year from e.expense_date::date)::integer = v_year
    ), 0)::numeric as expenses_amount_eur,
    coalesce((
      select sum(a.amount_eur)::numeric
      from public.budget_adjustments as a
      where a.year_id = p_year_id and a.category_id = c.id
    ), 0)::numeric as adjustments_amount_eur,
    (
      coalesce((
        select sum(e.amount)::numeric
        from public.uk_expenses as e
        where e.budget_category_id = c.id
          and public.budget_is_expense_published(e.status)
          and extract(year from e.expense_date::date)::integer = v_year
      ), 0)
      + coalesce((
        select sum(a.amount_eur)::numeric
        from public.budget_adjustments as a
        where a.year_id = p_year_id and a.category_id = c.id
      ), 0)
    )::numeric as actual_amount_eur,
    (
      coalesce(l.planned_amount_eur, 0)
      - (
        coalesce((
          select sum(e.amount)::numeric
          from public.uk_expenses as e
          where e.budget_category_id = c.id
            and public.budget_is_expense_published(e.status)
            and extract(year from e.expense_date::date)::integer = v_year
        ), 0)
        + coalesce((
          select sum(a.amount_eur)::numeric
          from public.budget_adjustments as a
          where a.year_id = p_year_id and a.category_id = c.id
        ), 0)
      )
    )::numeric as remaining_amount_eur
  from public.budget_categories as c
  left join public.budget_lines as l
    on l.category_id = c.id and l.year_id = p_year_id
  where c.active is true
     or l.id is not null
  order by c.sort_order, c.code;
end;
$fn$;

revoke all on function public.admin_budget_execution(uuid) from public;
revoke all on function public.admin_budget_execution(uuid) from anon;
grant execute on function public.admin_budget_execution(uuid) to authenticated;

-- Owner view (no draft)
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
    'actual_amount_eur',
      coalesce((
        select sum(e.amount)::numeric
        from public.uk_expenses as e
        where e.budget_category_id = c.id
          and public.budget_is_expense_published(e.status)
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

-- Public list of categories for expense form (admin)
create or replace function public.list_budget_categories_for_expenses()
returns table (
  id uuid,
  code text,
  name_ru text,
  name_en text,
  name_bg text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'list_budget_categories_for_expenses: not allowed'
      using errcode = '42501';
  end if;
  return query
  select c.id, c.code, c.name_ru, c.name_en, c.name_bg
  from public.budget_categories as c
  where c.active is true
  order by c.sort_order, c.code;
end;
$fn$;

revoke all on function public.list_budget_categories_for_expenses() from public;
revoke all on function public.list_budget_categories_for_expenses() from anon;
grant execute on function public.list_budget_categories_for_expenses() to authenticated;

commit;
