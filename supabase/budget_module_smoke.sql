-- =============================================================================
-- Budget module smoke (BEGIN / ROLLBACK)
-- =============================================================================
-- Prefer CLI:
--   npx supabase db query --linked -f supabase/budget_module_smoke.sql
--
-- Success = one row: result = ALL CHECKS PASSED (then ROLLBACK).
-- =============================================================================

begin;

create or replace function pg_temp.budget_module_smoke()
returns text
language plpgsql
security definer
set search_path = public
as $body$
declare
  staff_email text;
  staff_uid uuid;
  owner_email text;
  owner_uid uuid;
  smoke_year integer := 2097;
  year_row public.budget_years%rowtype;
  cat_id uuid;
  line_row public.budget_lines%rowtype;
  exp_id bigint;
  adj_row public.budget_adjustments%rowtype;
  exec_planned numeric;
  exec_actual numeric;
  exec_expenses numeric;
  exec_adj numeric;
  owner_payload jsonb;
  prop_id bigint;
begin
  if to_regprocedure('public.admin_create_budget_year(integer,text)') is null then
    raise exception 'smoke#schema FAIL: admin_create_budget_year missing';
  end if;
  if to_regprocedure('public.owner_get_budget_year(integer)') is null then
    raise exception 'smoke#schema FAIL: owner_get_budget_year missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'uk_expenses'
      and column_name = 'budget_category_id'
  ) then
    raise exception 'smoke#schema FAIL: uk_expenses.budget_category_id missing';
  end if;

  select s.email, u.id into staff_email, staff_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id
  limit 1;

  if staff_uid is null then
    raise exception 'smoke: admin@example.com missing in staff/auth.users';
  end if;

  update public.building_modules
     set enabled = true, updated_at = now()
   where module_key = 'budget';
  if not found then
    insert into public.building_modules (module_key, enabled, updated_at)
    values ('budget', true, now());
  end if;

  perform set_config('request.jwt.claim.sub', staff_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', staff_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', staff_uid::text, 'role', 'authenticated', 'email', staff_email)::text,
    true
  );

  delete from public.budget_years where calendar_year = smoke_year;
  delete from public.uk_expenses where title in ('smoke budget expense', 'smoke no category');

  year_row := public.admin_create_budget_year(smoke_year, 'Smoke budget');
  if year_row.status is distinct from 'draft' then
    raise exception 'smoke#create FAIL: status=%', year_row.status;
  end if;

  select c.id into cat_id
  from public.budget_categories as c
  where c.code = 'maintenance'
  limit 1;
  if cat_id is null then
    raise exception 'smoke#categories FAIL: maintenance missing';
  end if;

  line_row := public.admin_upsert_budget_line(year_row.id, cat_id, 1000, 'smoke line');
  if line_row.planned_amount_eur is distinct from 1000 then
    raise exception 'smoke#line FAIL: planned=%', line_row.planned_amount_eur;
  end if;

  year_row := public.admin_set_budget_year_status(year_row.id, 'published', null, null);
  if year_row.status is distinct from 'published' then
    raise exception 'smoke#publish FAIL: %', year_row.status;
  end if;

  year_row := public.admin_set_budget_year_status(year_row.id, 'adopted', 'OS smoke decision', null);
  if year_row.status is distinct from 'adopted'
     or year_row.decision_note is distinct from 'OS smoke decision' then
    raise exception 'smoke#adopt FAIL: % / %', year_row.status, year_row.decision_note;
  end if;

  insert into public.uk_expenses (
    expense_date, amount, title, created_by, status, budget_category_id, approved_by, approved_at
  ) values (
    make_date(smoke_year, 3, 15),
    250,
    'smoke budget expense',
    staff_email,
    'опубликован',
    cat_id,
    staff_email,
    now()
  )
  returning id into exp_id;

  adj_row := public.admin_create_budget_adjustment(
    year_row.id, cat_id, 50, 'smoke adjustment'
  );
  if adj_row.amount_eur is distinct from 50 then
    raise exception 'smoke#adj FAIL: %', adj_row.amount_eur;
  end if;

  select e.planned_amount_eur, e.actual_amount_eur, e.expenses_amount_eur, e.adjustments_amount_eur
    into exec_planned, exec_actual, exec_expenses, exec_adj
  from public.admin_budget_execution(year_row.id) as e
  where e.category_id = cat_id;

  if exec_planned is distinct from 1000 then
    raise exception 'smoke#exec FAIL: planned=%', exec_planned;
  end if;
  if exec_expenses is distinct from 250 then
    raise exception 'smoke#exec FAIL: expenses=%', exec_expenses;
  end if;
  if exec_adj is distinct from 50 then
    raise exception 'smoke#exec FAIL: adj=%', exec_adj;
  end if;
  if exec_actual is distinct from 300 then
    raise exception 'smoke#exec FAIL: actual=%', exec_actual;
  end if;

  -- Fail closed: published expense without category must raise
  begin
    insert into public.uk_expenses (
      expense_date, amount, title, created_by, status, budget_category_id
    ) values (
      make_date(smoke_year, 4, 1), 10, 'smoke no category', staff_email, 'опубликован', null
    );
    raise exception 'smoke#trigger FAIL: expected category required';
  exception
    when others then
      if sqlerrm not ilike '%budget_category_id required%' then
        raise;
      end if;
  end;

  -- Prefer an existing owner auth user linked to a property (legacy owner_email).
  select u.id, lower(btrim(p.owner_email)), p.id
    into owner_uid, owner_email, prop_id
  from public.properties as p
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(p.owner_email))
  where p.owner_email is not null
    and btrim(p.owner_email) <> ''
  order by p.id
  limit 1;

  if owner_uid is null then
    raise exception 'smoke: no owner auth.users with properties.owner_email for owner_get_budget_year';
  end if;

  perform set_config('request.jwt.claim.sub', owner_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', owner_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_uid::text, 'role', 'authenticated', 'email', owner_email)::text,
    true
  );

  owner_payload := public.owner_get_budget_year(smoke_year);
  if owner_payload -> 'year' is null or owner_payload -> 'year' = 'null'::jsonb then
    raise exception 'smoke#owner FAIL: year missing %', owner_payload;
  end if;
  if (owner_payload -> 'year' ->> 'status') is distinct from 'adopted' then
    raise exception 'smoke#owner FAIL: status=%', owner_payload -> 'year' ->> 'status';
  end if;

  return 'ALL CHECKS PASSED';
end;
$body$;

select pg_temp.budget_module_smoke() as result;

rollback;
