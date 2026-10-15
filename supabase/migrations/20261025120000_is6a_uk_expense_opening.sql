-- IS-6a — Historical UK expenses inventarisation (PREPARED — do not apply until Safe Release).
-- Imports archival uk_expenses rows as pending review. Never publishes. Never creates AP/payments.
-- opening_import rows are excluded from operational budget execution (admin_budget_execution /
-- owner_get_budget_year). Auth: администрация only. Idempotent. Conflict on mismatched source_ref.

begin;

-- ---------------------------------------------------------------------------
-- Schema: opening markers on canonical uk_expenses (no parallel expenses table)
-- ---------------------------------------------------------------------------

alter table public.uk_expenses
  add column if not exists opening_import boolean not null default false;

alter table public.uk_expenses
  add column if not exists opening_transition_date date null;

alter table public.uk_expenses
  add column if not exists source_ref text null;

alter table public.uk_expenses
  add column if not exists opening_source_document text null;

alter table public.uk_expenses
  add column if not exists opening_notes text null;

alter table public.uk_expenses
  add column if not exists opening_import_batch_id uuid null;

alter table public.uk_expenses
  add column if not exists opening_imported_at timestamptz null;

alter table public.uk_expenses
  add column if not exists opening_imported_by text null;

comment on column public.uk_expenses.opening_import is
  'IS-6a: true when created by import_uk_expense_opening_row (historical archival). Excluded from operational budget execution.';

comment on column public.uk_expenses.source_ref is
  'IS-6a: stable external identity for opening imports (unique when opening_import).';

comment on column public.uk_expenses.opening_transition_date is
  'IS-6a: complex transition / go-live date associated with the opening inventarisation.';

-- Unique source_ref for opening rows (installation = this DB).
create unique index if not exists uk_expenses_opening_source_ref_uidx
  on public.uk_expenses (lower(btrim(source_ref)))
  where opening_import is true
    and source_ref is not null
    and length(btrim(source_ref)) > 0;

-- Opening rows must carry source_ref + transition date.
alter table public.uk_expenses
  drop constraint if exists uk_expenses_opening_req_chk;

alter table public.uk_expenses
  add constraint uk_expenses_opening_req_chk
  check (
    opening_import is false
    or (
      source_ref is not null
      and length(btrim(source_ref)) > 0
      and opening_transition_date is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Opening import audit table
-- ---------------------------------------------------------------------------

create table if not exists public.uk_expense_opening_imports (
  id uuid primary key default gen_random_uuid(),
  expense_id bigint not null references public.uk_expenses (id),
  source_ref text not null,
  title text not null,
  expense_date date not null,
  amount numeric(12, 2) not null,
  transition_date date not null,
  budget_category_id uuid null references public.budget_categories (id),
  category_code text null,
  source_document text null,
  notes text null,
  idempotency_key uuid not null,
  batch_id uuid null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  constraint uk_expense_opening_imports_amount_chk check (amount > 0),
  constraint uk_expense_opening_imports_source_ref_chk check (length(btrim(source_ref)) > 0)
);

create unique index if not exists uk_expense_opening_imports_idem_uidx
  on public.uk_expense_opening_imports (idempotency_key);

create unique index if not exists uk_expense_opening_imports_source_ref_uidx
  on public.uk_expense_opening_imports (lower(btrim(source_ref)));

alter table public.uk_expense_opening_imports enable row level security;
revoke all on table public.uk_expense_opening_imports from public, anon, authenticated;

drop policy if exists uk_expense_opening_imports_staff_select on public.uk_expense_opening_imports;
create policy uk_expense_opening_imports_staff_select
  on public.uk_expense_opening_imports
  for select
  to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

grant select on table public.uk_expense_opening_imports to authenticated;

-- ---------------------------------------------------------------------------
-- Guard: only SECURITY DEFINER opening RPC may set opening_import = true
-- ---------------------------------------------------------------------------

create or replace function public.uk_expenses_guard_opening_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if TG_OP = 'INSERT' then
    if NEW.opening_import is true
       and current_setting('app.uk_expense_opening_import', true) is distinct from '1'
    then
      raise exception 'uk_expenses: opening_import inserts only via import_uk_expense_opening_row'
        using errcode = '42501';
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.opening_import is true and NEW.opening_import is distinct from true then
      raise exception 'uk_expenses: cannot clear opening_import'
        using errcode = '42501';
    end if;
    if OLD.opening_import is true
       and (
         NEW.source_ref is distinct from OLD.source_ref
         or NEW.opening_transition_date is distinct from OLD.opening_transition_date
         or NEW.amount is distinct from OLD.amount
         or NEW.expense_date is distinct from OLD.expense_date
         or coalesce(NEW.title, '') is distinct from coalesce(OLD.title, '')
       )
       and current_setting('app.uk_expense_opening_import', true) is distinct from '1'
    then
      -- Allow photo_urls / status / approved_* / budget_category_id via normal admin workflows.
      raise exception 'uk_expenses: opening identity fields are immutable'
        using errcode = '42501';
    end if;
    if NEW.opening_import is true
       and OLD.opening_import is not true
       and current_setting('app.uk_expense_opening_import', true) is distinct from '1'
    then
      raise exception 'uk_expenses: cannot promote row to opening_import'
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists uk_expenses_guard_opening_biu on public.uk_expenses;
create trigger uk_expenses_guard_opening_biu
  before insert or update on public.uk_expenses
  for each row
  execute function public.uk_expenses_guard_opening_write();

-- ---------------------------------------------------------------------------
-- Publish: opening archival rows may omit budget_category even when budget on
-- ---------------------------------------------------------------------------

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
     and coalesce(NEW.opening_import, false) is not true
  then
    raise exception 'uk_expenses: budget_category_id required when budget module enabled'
      using errcode = '23502';
  end if;
  return NEW;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Helper: operational budget fact excludes opening inventarisation rows
-- ---------------------------------------------------------------------------

create or replace function public.budget_expense_counts_in_operational_execution(
  p_opening_import boolean
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_opening_import, false) is not true;
$$;

revoke all on function public.budget_expense_counts_in_operational_execution(boolean) from public;
grant execute on function public.budget_expense_counts_in_operational_execution(boolean) to authenticated;

comment on function public.budget_expense_counts_in_operational_execution(boolean) is
  'IS-6a: opening_import rows never inflate operational budget execution, even when published.';

-- ---------------------------------------------------------------------------
-- admin_budget_execution — exclude opening_import
-- ---------------------------------------------------------------------------

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
        and public.budget_expense_counts_in_operational_execution(e.opening_import)
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
          and public.budget_expense_counts_in_operational_execution(e.opening_import)
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
            and public.budget_expense_counts_in_operational_execution(e.opening_import)
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

-- ---------------------------------------------------------------------------
-- owner_get_budget_year — same exclusion
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: import_uk_expense_opening_row
-- NEVER publishes. NEVER creates supplier invoices/payments/AP.
-- NEVER calls Support Fee / Internet opening or payment RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.import_uk_expense_opening_row(
  p_source_ref text,
  p_title text,
  p_expense_date date,
  p_amount numeric,
  p_transition_date date,
  p_category_code text default null,
  p_source_document text default null,
  p_notes text default null,
  p_idempotency_key uuid default null,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_source_ref text := btrim(coalesce(p_source_ref, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_amount numeric(12, 2);
  v_cat_code text := nullif(lower(btrim(coalesce(p_category_code, ''))), '');
  v_cat_id uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_doc text := nullif(btrim(coalesce(p_source_document, '')), '');
  v_import public.uk_expense_opening_imports;
  v_existing public.uk_expenses;
  v_expense_id bigint;
  v_import_id uuid;
  v_sofia date := (timezone('Europe/Sofia', now()))::date;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_uk_expense_opening_row: authentication required' using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_uk_expense_opening_row: not allowed' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_uk_expense_opening_row: idempotency key is required' using errcode = '22023';
  end if;

  if length(v_source_ref) = 0 then
    raise exception 'import_uk_expense_opening_row: source_ref required' using errcode = '22023';
  end if;

  if length(v_title) = 0 then
    raise exception 'import_uk_expense_opening_row: title required' using errcode = '22023';
  end if;

  if p_expense_date is null then
    raise exception 'import_uk_expense_opening_row: expense_date required' using errcode = '22023';
  end if;

  if p_transition_date is null then
    raise exception 'import_uk_expense_opening_row: transition_date required' using errcode = '22023';
  end if;

  if p_transition_date > v_sofia then
    raise exception 'import_uk_expense_opening_row: transition_date in future' using errcode = '22023';
  end if;

  if p_expense_date > p_transition_date then
    raise exception 'import_uk_expense_opening_row: expense_date after transition' using errcode = '22023';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'import_uk_expense_opening_row: amount must be positive' using errcode = '22023';
  end if;

  -- Optional category: validate if provided; never invent a category.
  if v_cat_code is not null then
    select c.id into v_cat_id
    from public.budget_categories as c
    where lower(c.code) = v_cat_code
      and c.active is true
    limit 1;
    if v_cat_id is null then
      raise exception 'import_uk_expense_opening_row: unknown category_code'
        using errcode = '22023';
    end if;
  end if;

  -- Idempotent replay by key
  select * into v_import
  from public.uk_expense_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', 'SKIPPED_EXISTING',
      'import_id', v_import.id,
      'expense_id', v_import.expense_id,
      'source_ref', v_import.source_ref,
      'status', 'на проверке',
      'opening_import', true,
      'published', false,
      'ap_created', false,
      'payment_created', false,
      'synthetic_payments', false
    );
  end if;

  -- Existing opening by source_ref
  select * into v_existing
  from public.uk_expenses as e
  where e.opening_import is true
    and lower(btrim(e.source_ref)) = lower(v_source_ref)
  for update;

  if found then
    if coalesce(v_existing.title, '') = v_title
       and v_existing.expense_date::date = p_expense_date
       and round(v_existing.amount::numeric, 2) = v_amount
       and v_existing.opening_transition_date = p_transition_date
       and v_existing.budget_category_id is not distinct from v_cat_id
    then
      -- Record idempotency mapping if missing (concurrent-safe via unique)
      begin
        insert into public.uk_expense_opening_imports (
          expense_id, source_ref, title, expense_date, amount, transition_date,
          budget_category_id, category_code, source_document, notes,
          idempotency_key, batch_id, created_by_email
        ) values (
          v_existing.id, v_source_ref, v_title, p_expense_date, v_amount, p_transition_date,
          v_cat_id, v_cat_code, v_doc, v_notes,
          p_idempotency_key, p_batch_id, v_email
        );
      exception
        when unique_violation then
          null;
      end;

      return jsonb_build_object(
        'applied', false,
        'idempotent', true,
        'outcome', 'SKIPPED_EXISTING',
        'expense_id', v_existing.id,
        'source_ref', v_source_ref,
        'status', v_existing.status,
        'opening_import', true,
        'published', false,
        'ap_created', false,
        'payment_created', false,
        'synthetic_payments', false
      );
    end if;

    raise exception 'import_uk_expense_opening_row: conflict existing source_ref mismatch'
      using errcode = '23505';
  end if;

  -- Also conflict if audit table has source_ref with different payload
  if exists (
    select 1
    from public.uk_expense_opening_imports as i
    where lower(btrim(i.source_ref)) = lower(v_source_ref)
  ) then
    raise exception 'import_uk_expense_opening_row: conflict existing opening import'
      using errcode = '23505';
  end if;

  perform set_config('app.uk_expense_opening_import', '1', true);

  insert into public.uk_expenses (
    expense_date,
    amount,
    title,
    created_by,
    status,
    photo_urls,
    budget_category_id,
    opening_import,
    opening_transition_date,
    source_ref,
    opening_source_document,
    opening_notes,
    opening_import_batch_id,
    opening_imported_at,
    opening_imported_by
  ) values (
    p_expense_date,
    v_amount,
    v_title,
    v_email,
    'на проверке',
    array[]::text[],
    v_cat_id,
    true,
    p_transition_date,
    v_source_ref,
    v_doc,
    v_notes,
    p_batch_id,
    now(),
    v_email
  )
  returning id into v_expense_id;

  insert into public.uk_expense_opening_imports (
    expense_id, source_ref, title, expense_date, amount, transition_date,
    budget_category_id, category_code, source_document, notes,
    idempotency_key, batch_id, created_by_email
  ) values (
    v_expense_id, v_source_ref, v_title, p_expense_date, v_amount, p_transition_date,
    v_cat_id, v_cat_code, v_doc, v_notes,
    p_idempotency_key, p_batch_id, v_email
  )
  returning id into v_import_id;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'expense_id', v_expense_id,
    'source_ref', v_source_ref,
    'status', 'на проверке',
    'opening_import', true,
    'published', false,
    'ap_created', false,
    'payment_created', false,
    'synthetic_payments', false
  );
exception
  when unique_violation then
    raise exception 'import_uk_expense_opening_row: conflict duplicate source_ref or idempotency'
      using errcode = '23505';
end;
$fn$;

revoke all on function public.import_uk_expense_opening_row(
  text, text, date, numeric, date, text, text, text, uuid, uuid
) from public, anon;

grant execute on function public.import_uk_expense_opening_row(
  text, text, date, numeric, date, text, text, text, uuid, uuid
) to authenticated;

comment on function public.import_uk_expense_opening_row(
  text, text, date, numeric, date, text, text, text, uuid, uuid
) is
  'IS-6a: create pending historical uk_expenses row. NEVER publishes. NEVER creates AP/payments. NEVER calls SF/Internet opening RPCs.';

commit;
