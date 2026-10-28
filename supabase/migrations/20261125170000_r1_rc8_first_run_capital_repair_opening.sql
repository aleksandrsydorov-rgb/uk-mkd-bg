-- =============================================================================
-- R1-RC8 — First-run Capital Repair opening stage (after Support Fee):
-- atomic preview/commit for apartments; separate fund bank-cash inventarisation;
-- block operational re-charge of imported period; stage complete → tariffs.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fund cash opening (bank/cash reserves — NEVER derived from apt debts / payments)
-- ---------------------------------------------------------------------------

create table if not exists public.capital_repair_fund_cash_opening (
  id uuid primary key default gen_random_uuid(),
  balance_eur numeric(12, 2) not null
    constraint capital_repair_fund_cash_opening_balance_chk check (balance_eur >= 0),
  as_of_date date not null,
  source_reference text not null
    constraint capital_repair_fund_cash_opening_source_chk check (length(btrim(source_reference)) > 0),
  notes text null,
  recorded_by_email text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.capital_repair_fund_cash_opening is
  'R1-RC8: factual CR fund bank/cash balance at transition. Not apartment obligation net; not a payment.';

create unique index if not exists capital_repair_fund_cash_opening_idem_uidx
  on public.capital_repair_fund_cash_opening (idempotency_key);

-- Singleton: one confirmed inventarisation row for the installation.
create unique index if not exists capital_repair_fund_cash_opening_singleton_uidx
  on public.capital_repair_fund_cash_opening ((true));

alter table public.capital_repair_fund_cash_opening enable row level security;
revoke all on table public.capital_repair_fund_cash_opening from public, anon, authenticated;

drop policy if exists capital_repair_fund_cash_opening_staff_select
  on public.capital_repair_fund_cash_opening;
create policy capital_repair_fund_cash_opening_staff_select
  on public.capital_repair_fund_cash_opening
  for select
  to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

grant select on table public.capital_repair_fund_cash_opening to authenticated;

-- ---------------------------------------------------------------------------
-- Soft-skip matching re-import + require source_reference on single-row RPC
-- ---------------------------------------------------------------------------

create or replace function public.import_capital_repair_opening_state(
  p_property_id bigint,
  p_billing_year integer,
  p_obligation_type text,
  p_assessed_amount numeric,
  p_historically_paid_amount numeric,
  p_remaining_debt numeric,
  p_opening_overpayment numeric,
  p_transition_date date,
  p_source_reference text,
  p_notes text,
  p_idempotency_key uuid,
  p_assessment_title text default null,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_obl text := lower(btrim(coalesce(p_obligation_type, 'capital_repair')));
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over_in numeric(12, 2);
  v_title text;
  v_assessment_id uuid;
  v_import_id uuid;
  v_existing_import public.capital_repair_opening_imports;
  v_lock bigint;
  v_src text;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_capital_repair_opening_state: authentication required'
      using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_capital_repair_opening_state: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_capital_repair_opening_state: idempotency key is required'
      using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_capital_repair_opening_state: invalid property'
      using errcode = '22023';
  end if;

  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'import_capital_repair_opening_state: invalid billing year'
      using errcode = '22023';
  end if;

  if p_transition_date is null then
    raise exception 'import_capital_repair_opening_state: transition date required'
      using errcode = '22023';
  end if;

  if p_transition_date > (timezone('Europe/Sofia', now()))::date then
    raise exception 'import_capital_repair_opening_state: transition date cannot be in the future'
      using errcode = '22023';
  end if;

  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  if v_src is null then
    raise exception 'import_capital_repair_opening_state: source_reference required'
      using errcode = '22023';
  end if;

  if v_obl is distinct from 'capital_repair' then
    raise exception 'import_capital_repair_opening_state: unsupported obligation_type'
      using errcode = '22023';
  end if;

  v_assessed := round(coalesce(p_assessed_amount, -1), 2);
  v_paid := round(coalesce(p_historically_paid_amount, -1), 2);
  v_remaining := round(coalesce(p_remaining_debt, -1), 2);
  v_over_in := round(coalesce(p_opening_overpayment, 0), 2);

  if v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over_in < 0 then
    raise exception 'import_capital_repair_opening_state: amounts must be nonnegative'
      using errcode = '22023';
  end if;

  if v_assessed <> round(v_paid + v_remaining, 2) then
    raise exception 'import_capital_repair_opening_state: assessed must equal historically_paid + remaining'
      using errcode = '22023';
  end if;

  if v_over_in > 0 and v_remaining > 0 then
    raise exception 'import_capital_repair_opening_state: opening_overpayment and remaining_debt are mutually exclusive'
      using errcode = '22023';
  end if;

  select * into v_existing_import
  from public.capital_repair_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', 'SKIPPED_EXISTING',
      'import_id', v_existing_import.id,
      'assessment_id', v_existing_import.assessment_id,
      'property_id', v_existing_import.property_id,
      'billing_year', v_existing_import.billing_year,
      'remaining_debt', v_existing_import.remaining_debt,
      'opening_overpayment', v_existing_import.opening_overpayment,
      'synthetic_payments', false,
      'operational_charges', false
    );
  end if;

  select p.id into v_lock
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'import_capital_repair_opening_state: property not found'
      using errcode = 'P0002';
  end if;

  select * into v_existing_import
  from public.capital_repair_opening_imports as i
  where i.property_id = p_property_id
    and i.billing_year = p_billing_year;

  if found then
    if v_existing_import.assessed_amount is not distinct from v_assessed
       and v_existing_import.historically_paid_amount is not distinct from v_paid
       and v_existing_import.remaining_debt is not distinct from v_remaining
       and v_existing_import.opening_overpayment is not distinct from v_over_in then
      return jsonb_build_object(
        'applied', false,
        'idempotent', true,
        'outcome', 'SKIPPED_EXISTING',
        'import_id', v_existing_import.id,
        'assessment_id', v_existing_import.assessment_id,
        'property_id', v_existing_import.property_id,
        'billing_year', v_existing_import.billing_year,
        'remaining_debt', v_existing_import.remaining_debt,
        'opening_overpayment', v_existing_import.opening_overpayment,
        'synthetic_payments', false,
        'operational_charges', false
      );
    end if;
    raise exception 'import_capital_repair_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and i.source_reference = v_src
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing source_reference'
      using errcode = '23505';
  end if;

  v_title := nullif(btrim(coalesce(p_assessment_title, '')), '');
  if v_title is null then
    v_title := 'Капитальный ремонт ' || p_billing_year::text;
  end if;

  select a.id into v_assessment_id
  from public.capital_repair_assessments as a
  where a.title = v_title
    and coalesce(a.status, 'active') is distinct from 'cancelled'
  order by a.created_at asc
  limit 1;

  if v_assessment_id is null then
    insert into public.capital_repair_assessments (
      title, description, decision_date, due_date, status, created_by_email
    ) values (
      v_title,
      'R1-RC8 / IS-8 opening inventarisation shell (no operational charge)',
      p_transition_date,
      null,
      'active',
      v_email
    )
    returning id into v_assessment_id;
  end if;

  if v_assessment_id is null then
    raise exception 'import_capital_repair_opening_state: assessment linkage failed'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing operational charge'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'opening_obligation'
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing opening obligation'
      using errcode = '23505';
  end if;

  if v_assessed > 0 then
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_assessment_id, 'opening_obligation', v_assessed,
      'IS-8 opening obligation; source=' || v_src, v_email, p_idempotency_key
    );
  end if;

  if v_paid > 0 then
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_assessment_id, 'opening_historical_settlement', v_paid,
      'IS-8 historical settlement (not a platform payment)', v_email, gen_random_uuid()
    );
  end if;

  if v_over_in > 0 then
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, v_assessment_id, 'opening_credit', v_over_in,
      'IS-8 opening credit/overpayment', v_email, gen_random_uuid()
    );
  end if;

  insert into public.capital_repair_opening_imports (
    property_id, billing_year, assessment_id,
    assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,
    transition_date, source_reference, notes, imported_by_email, idempotency_key, batch_id
  ) values (
    p_property_id, p_billing_year, v_assessment_id,
    v_assessed, v_paid, v_remaining, v_over_in,
    p_transition_date, v_src, nullif(btrim(coalesce(p_notes, '')), ''),
    v_email, p_idempotency_key, p_batch_id
  )
  returning id into v_import_id;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'assessment_id', v_assessment_id,
    'assessment_title', v_title,
    'property_id', p_property_id,
    'billing_year', p_billing_year,
    'remaining_debt', v_remaining,
    'opening_overpayment', v_over_in,
    'synthetic_payments', false,
    'operational_charges', false
  );
end;
$fn$;

revoke all on function public.import_capital_repair_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, text, uuid
) from public, anon;
grant execute on function public.import_capital_repair_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic batch preview / commit
-- ---------------------------------------------------------------------------

create or replace function public.admin_import_capital_repair_opening(
  p_rows jsonb,
  p_dry_run boolean default true,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_idx int := 0;
  v_row_num int;
  v_apt text;
  v_property_id bigint;
  v_year int;
  v_obl text;
  v_title text;
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over numeric(12, 2);
  v_transition date;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_res jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_years int[];
  v_year_one int;
  v_missing text;
  v_scope text;
  v_scopes text[] := '{}';
  v_row_errors text[];
  v_outcome text;
  v_assessment_id uuid;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_capital_repair_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_capital_repair_opening: not allowed' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_capital_repair_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if coalesce(p_dry_run, true) then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'batch_id', v_batch,
        'row_count', 0,
        'created_count', 0,
        'skipped_existing_count', 0,
        'error_count', 1,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0, 'field', 'rows', 'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch')
        )),
        'rows', '[]'::jsonb,
        'synthetic_payments', false,
        'charges_generated', false,
        'tariff_required', false,
        'reason', 'empty_batch'
      );
    end if;
    raise exception 'admin_import_capital_repair_opening: empty batch not allowed'
      using errcode = '22023';
  end if;

  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_row_num := coalesce(nullif(btrim(coalesce(v_elem->>'rowNumber', v_elem->>'row', '')), '')::int, v_idx + 1);
    v_row_errors := '{}';
    v_apt := nullif(btrim(coalesce(v_elem->>'apartment_number', '')), '');
    v_property_id := null;
    v_year := null;
    v_assessed := null;
    v_paid := null;
    v_remaining := null;
    v_over := 0;
    v_transition := null;
    v_src := nullif(btrim(coalesce(v_elem->>'source_reference', '')), '');
    v_notes := nullif(btrim(coalesce(v_elem->>'notes', '')), '');
    v_title := nullif(btrim(coalesce(v_elem->>'assessment_title', '')), '');
    v_obl := lower(btrim(coalesce(v_elem->>'obligation_type', 'capital_repair')));

    if v_apt is null then
      v_row_errors := array_append(v_row_errors, 'required:apartment_number');
    else
      select p.id into v_property_id
      from public.properties as p
      where lower(btrim(p.apartment_number)) = lower(v_apt)
      limit 1;
      if v_property_id is null then
        v_row_errors := array_append(v_row_errors, 'unknown_apartment');
      end if;
    end if;

    begin
      v_year := nullif(btrim(coalesce(v_elem->>'billing_year', '')), '')::int;
    exception when others then
      v_year := null;
    end;
    if v_year is null or v_year < 2000 or v_year > 2100 then
      v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
    end if;

    if v_obl is distinct from 'capital_repair' then
      v_row_errors := array_append(v_row_errors, 'unsupported:obligation_type');
    end if;

    begin
      v_assessed := round(nullif(btrim(coalesce(v_elem->>'assessed_amount', '')), '')::numeric, 2);
      v_paid := round(nullif(btrim(coalesce(v_elem->>'historically_paid_amount', '')), '')::numeric, 2);
      v_remaining := round(nullif(btrim(coalesce(v_elem->>'remaining_debt', '')), '')::numeric, 2);
      v_over := round(coalesce(nullif(btrim(coalesce(v_elem->>'opening_overpayment', '')), '')::numeric, 0), 2);
    exception when others then
      v_row_errors := array_append(v_row_errors, 'invalid:amounts');
      v_assessed := null;
    end;

    if v_assessed is null or v_paid is null or v_remaining is null
       or v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over < 0 then
      v_row_errors := array_append(v_row_errors, 'invalid:amounts');
    elsif v_assessed <> round(v_paid + v_remaining, 2) then
      v_row_errors := array_append(v_row_errors, 'inconsistent:assessed_ne_paid_plus_remaining');
    end if;

    if v_remaining is not null and v_over is not null and v_remaining > 0 and v_over > 0 then
      v_row_errors := array_append(v_row_errors, 'mutually_exclusive:debt_and_overpayment');
    end if;

    begin
      v_transition := nullif(btrim(coalesce(v_elem->>'transition_date', '')), '')::date;
    exception when others then
      v_transition := null;
    end;
    if v_transition is null then
      v_row_errors := array_append(v_row_errors, 'required:transition_date');
    elsif v_transition > v_today then
      v_row_errors := array_append(v_row_errors, 'invalid:transition_date_future');
    end if;

    if v_src is null then
      v_row_errors := array_append(v_row_errors, 'required:source_reference');
    end if;

    if v_property_id is not null and v_year is not null then
      v_scope := v_property_id::text || '|' || v_year::text;
      if v_scope = any (v_scopes) then
        v_row_errors := array_append(v_row_errors, 'duplicate_in_file:apartment_year');
      else
        v_scopes := array_append(v_scopes, v_scope);
      end if;
    end if;

    if coalesce(array_length(v_row_errors, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'codes', to_jsonb(v_row_errors),
        'reason', v_row_errors[1],
        'field', 'capital_repair_opening'
      ));
      continue;
    end if;

    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = v_property_id
        and i.billing_year = v_year
        and (
          i.assessed_amount is distinct from v_assessed
          or i.historically_paid_amount is distinct from v_paid
          or i.remaining_debt is distinct from v_remaining
          or i.opening_overpayment is distinct from v_over
        )
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_opening_import_mismatch'),
        'reason', 'conflict:existing_opening_import_mismatch',
        'field', 'capital_repair_opening'
      ));
      continue;
    end if;

    -- Resolve assessment title for operational-charge conflict checks.
    v_assessment_id := null;
    if v_title is not null then
      select a.id into v_assessment_id
      from public.capital_repair_assessments as a
      where a.title = v_title
        and coalesce(a.status, 'active') is distinct from 'cancelled'
      order by a.created_at asc
      limit 1;
    else
      select a.id into v_assessment_id
      from public.capital_repair_assessments as a
      where a.title = 'Капитальный ремонт ' || v_year::text
        and coalesce(a.status, 'active') is distinct from 'cancelled'
      order by a.created_at asc
      limit 1;
    end if;

    if v_assessment_id is not null and exists (
      select 1 from public.capital_repair_ledger as l
      where l.property_id = v_property_id
        and l.assessment_id = v_assessment_id
        and l.kind = 'charge'
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_operational_charge'),
        'reason', 'conflict:existing_operational_charge',
        'field', 'capital_repair_opening'
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      if exists (
        select 1 from public.capital_repair_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
          and i.assessed_amount = v_assessed
          and i.historically_paid_amount = v_paid
          and i.remaining_debt = v_remaining
          and i.opening_overpayment = v_over
      ) then
        v_skipped := v_skipped + 1;
        v_outcome := 'SKIP';
      else
        v_outcome := 'CREATE';
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'property_id', v_property_id,
        'billing_year', v_year,
        'outcome', v_outcome,
        'remaining_debt', v_remaining,
        'opening_overpayment', v_over,
        'assessed_amount', v_assessed
      ));
      continue;
    end if;

    v_idem := coalesce(
      nullif(btrim(coalesce(v_elem->>'idempotency_key', '')), '')::uuid,
      gen_random_uuid()
    );
    v_res := public.import_capital_repair_opening_state(
      v_property_id,
      v_year,
      'capital_repair',
      v_assessed,
      v_paid,
      v_remaining,
      v_over,
      v_transition,
      v_src,
      v_notes,
      v_idem,
      v_title,
      v_batch
    );
    v_outcome := coalesce(v_res->>'outcome', 'CREATED');
    if v_outcome = 'CREATED' then
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', v_row_num,
      'apartment_number', v_apt,
      'property_id', v_property_id,
      'billing_year', v_year,
      'outcome', v_outcome,
      'remaining_debt', coalesce((v_res->>'remaining_debt')::numeric, v_remaining),
      'opening_overpayment', v_over,
      'assessment_id', v_res->>'assessment_id',
      'import_id', v_res->>'import_id'
    ));
  end loop;

  select array_agg(distinct (split_part(s, '|', 2))::int)
  into v_years
  from unnest(v_scopes) as s;
  if v_years is not null then
    foreach v_year_one in array v_years
    loop
      select string_agg(p.apartment_number, ', ' order by p.apartment_number)
      into v_missing
      from public.properties as p
      where not exists (
        select 1
        from unnest(v_scopes) as s
        where split_part(s, '|', 1)::bigint = p.id
          and split_part(s, '|', 2)::int = v_year_one
      );
      if v_missing is not null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', 0,
          'apartment_number', '',
          'codes', jsonb_build_array('missing_apartment_coverage'),
          'reason', 'missing_apartment_coverage',
          'field', 'billing_year',
          'billing_year', v_year_one,
          'missing', v_missing
        ));
      end if;
    end loop;
  end if;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_capital_repair_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'dry_run', coalesce(p_dry_run, true),
    'batch_id', v_batch,
    'row_count', jsonb_array_length(p_rows),
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'rows', v_results,
    'synthetic_payments', false,
    'charges_generated', false,
    'tariff_required', false,
    'reconcile', jsonb_build_object(
      'remaining_debt_sum', (
        select coalesce(sum((r->>'remaining_debt')::numeric), 0)
        from jsonb_array_elements(v_results) as r
        where r->>'outcome' in ('CREATE', 'CREATED', 'SKIP', 'SKIPPED_EXISTING')
      ),
      'opening_overpayment_sum', (
        select coalesce(sum((r->>'opening_overpayment')::numeric), 0)
        from jsonb_array_elements(v_results) as r
        where r->>'outcome' in ('CREATE', 'CREATED', 'SKIP', 'SKIPPED_EXISTING')
      ),
      'apartment_rows', jsonb_array_length(v_results)
    )
  );
end;
$fn$;

revoke all on function public.admin_import_capital_repair_opening(jsonb, boolean, uuid)
  from public, anon;
grant execute on function public.admin_import_capital_repair_opening(jsonb, boolean, uuid)
  to authenticated;

comment on function public.admin_import_capital_repair_opening(jsonb, boolean, uuid) is
  'R1-RC8: atomic CR opening preview/commit. Opening kinds only; no synthetic payments/charges.';

-- ---------------------------------------------------------------------------
-- Separate fund bank-cash inventarisation
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_capital_repair_fund_cash_opening(
  p_balance_eur numeric,
  p_as_of_date date,
  p_source_reference text,
  p_notes text default null,
  p_dry_run boolean default true,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_bal numeric(12, 2);
  v_src text;
  v_notes text;
  v_idem uuid := coalesce(p_idempotency_key, gen_random_uuid());
  v_existing public.capital_repair_fund_cash_opening;
  v_id uuid;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_set_capital_repair_fund_cash_opening: authentication required'
      using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_set_capital_repair_fund_cash_opening: not allowed'
      using errcode = '42501';
  end if;

  v_bal := round(coalesce(p_balance_eur, -1), 2);
  if v_bal < 0 then
    raise exception 'admin_set_capital_repair_fund_cash_opening: balance must be nonnegative'
      using errcode = '22023';
  end if;
  if p_as_of_date is null then
    raise exception 'admin_set_capital_repair_fund_cash_opening: as_of_date required'
      using errcode = '22023';
  end if;
  if p_as_of_date > v_today then
    raise exception 'admin_set_capital_repair_fund_cash_opening: as_of_date cannot be in the future'
      using errcode = '22023';
  end if;

  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  if v_src is null then
    raise exception 'admin_set_capital_repair_fund_cash_opening: source_reference required'
      using errcode = '22023';
  end if;
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  select * into v_existing
  from public.capital_repair_fund_cash_opening
  limit 1;

  if found then
    if v_existing.balance_eur is not distinct from v_bal
       and v_existing.as_of_date is not distinct from p_as_of_date
       and v_existing.source_reference is not distinct from v_src then
      return jsonb_build_object(
        'ok', true,
        'dry_run', coalesce(p_dry_run, true),
        'applied', false,
        'idempotent', true,
        'outcome', 'SKIPPED_EXISTING',
        'id', v_existing.id,
        'balance_eur', v_existing.balance_eur,
        'as_of_date', v_existing.as_of_date,
        'source_reference', v_existing.source_reference,
        'derived_from_apartment_debts', false,
        'synthetic_payment', false
      );
    end if;
    if coalesce(p_dry_run, true) then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'reason', 'conflict:existing_fund_cash_mismatch',
        'errors', jsonb_build_array(jsonb_build_object(
          'codes', jsonb_build_array('conflict:existing_fund_cash_mismatch'),
          'reason', 'conflict:existing_fund_cash_mismatch'
        ))
      );
    end if;
    raise exception 'admin_set_capital_repair_fund_cash_opening: conflict existing fund cash'
      using errcode = '23505';
  end if;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'applied', false,
      'outcome', 'CREATE',
      'balance_eur', v_bal,
      'as_of_date', p_as_of_date,
      'source_reference', v_src,
      'derived_from_apartment_debts', false,
      'synthetic_payment', false
    );
  end if;

  insert into public.capital_repair_fund_cash_opening (
    balance_eur, as_of_date, source_reference, notes, recorded_by_email, idempotency_key
  ) values (
    v_bal, p_as_of_date, v_src, v_notes, btrim(v_email), v_idem
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'applied', true,
    'outcome', 'CREATED',
    'id', v_id,
    'balance_eur', v_bal,
    'as_of_date', p_as_of_date,
    'source_reference', v_src,
    'derived_from_apartment_debts', false,
    'synthetic_payment', false
  );
end;
$fn$;

revoke all on function public.admin_set_capital_repair_fund_cash_opening(
  numeric, date, text, text, boolean, uuid
) from public, anon;
grant execute on function public.admin_set_capital_repair_fund_cash_opening(
  numeric, date, text, text, boolean, uuid
) to authenticated;

comment on function public.admin_set_capital_repair_fund_cash_opening(
  numeric, date, text, text, boolean, uuid
) is
  'R1-RC8: inventarise factual CR fund bank/cash balance. Not computed from apt debts; not a payment.';

-- ---------------------------------------------------------------------------
-- Block operational charge on opening-imported assessment/period
-- ---------------------------------------------------------------------------

create or replace function public.tg_capital_repair_ledger_block_opening_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' and new.kind = 'charge' and new.assessment_id is not null then
    if exists (
      select 1
      from public.capital_repair_opening_imports as i
      where i.property_id = new.property_id
        and i.assessment_id = new.assessment_id
    ) or exists (
      select 1
      from public.capital_repair_ledger as l
      where l.property_id = new.property_id
        and l.assessment_id = new.assessment_id
        and l.kind = 'opening_obligation'
    ) then
      raise exception
        'capital_repair_ledger: opening_import blocks charge for property % assessment %',
        new.property_id, new.assessment_id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists capital_repair_ledger_block_opening_charge_trg
  on public.capital_repair_ledger;
create trigger capital_repair_ledger_block_opening_charge_trg
  before insert on public.capital_repair_ledger
  for each row
  execute function public.tg_capital_repair_ledger_block_opening_charge();

create or replace function public.charge_capital_repair(
  p_property_id bigint,
  p_assessment_id uuid,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  assessment_id uuid,
  amount_eur numeric,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_status text;
  v_row public.capital_repair_ledger%rowtype;
  v_module_enabled boolean;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'capital_repair';
  if v_module_enabled is not true then
    raise exception 'Capital repair module is disabled.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;
  if p_assessment_id is null then
    raise exception 'Assessment not found.';
  end if;

  if exists (
    select 1 from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and (
        i.assessment_id = p_assessment_id
        or i.billing_year = p_billing_year
      )
  ) then
    raise exception 'charge_capital_repair: opening_import_blocks_charge'
      using errcode = 'P0001';
  end if;

  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year) as r;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.* into v_row
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is distinct from p_assessment_id
       or v_row.kind is distinct from 'charge'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;
    return query
    select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  select a.status into v_status
  from public.capital_repair_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'Assessment not found.';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Assessment is not active.';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = p_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'Capital repair charge already exists for this property and assessment.';
  end if;

  begin
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, p_assessment_id, 'charge', v_amount, v_note, v_email, p_idempotency_key
    )
    returning * into v_row;
  exception
    when unique_violation then
      select l.* into v_row
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;
      if found then
        if v_row.property_id is distinct from p_property_id
           or v_row.assessment_id is distinct from p_assessment_id
           or v_row.kind is distinct from 'charge'
           or v_row.amount_eur is distinct from v_amount
           or v_row.note is distinct from v_note then
          raise exception 'Idempotency key conflict.';
        end if;
      else
        raise exception 'Capital repair charge already exists for this property and assessment.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$fn$;

revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid)
  from public, anon;
grant execute on function public.charge_capital_repair(bigint, uuid, integer, text, uuid)
  to authenticated;

create or replace function public.charge_capital_repair_bulk(
  p_assessment_id uuid,
  p_billing_year integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_amount numeric;
  v_note text;
  v_status text;
  v_id bigint;
  v_rows int;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_blocked int := 0;
  v_module_enabled boolean;
begin
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'capital_repair';
  if v_module_enabled is not true then
    raise exception 'Capital repair module is disabled.';
  end if;

  if p_assessment_id is null then
    raise exception 'Assessment not found.';
  end if;

  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year) as r;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    perform 1 from public.properties as p where p.id = v_id for update;
  end loop;

  select a.status into v_status
  from public.capital_repair_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found.';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Assessment is not active.';
  end if;

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;

    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = v_id
        and (i.assessment_id = p_assessment_id or i.billing_year = p_billing_year)
    ) then
      v_blocked := v_blocked + 1;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      v_id, p_assessment_id, 'charge', v_amount, v_note, v_email, pg_catalog.gen_random_uuid()
    )
    on conflict (property_id, assessment_id) where kind = 'charge' and assessment_id is not null
    do nothing;

    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'created', v_created,
    'skipped', v_skipped,
    'opening_import_blocked', v_blocked,
    'assessment_id', p_assessment_id,
    'billing_year', p_billing_year
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text)
  from public, anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Stage assert + complete wiring
-- ---------------------------------------------------------------------------

create or replace function public.first_run_assert_capital_repair_opening_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_props int;
  v_missing text;
  v_years int;
begin
  select count(*)::int into v_props from public.properties;
  if v_props <= 0 then
    raise exception 'first_run: capital_repair opening requires property book apartments'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.capital_repair_opening_imports) then
    raise exception 'first_run: capital_repair opening batch is empty'
      using errcode = 'P0001';
  end if;

  select count(distinct billing_year)::int into v_years
  from public.capital_repair_opening_imports;
  if v_years is null or v_years < 1 then
    raise exception 'first_run: capital_repair opening period missing'
      using errcode = 'P0001';
  end if;

  select string_agg(fmt, ', ' order by fmt)
  into v_missing
  from (
    select p.apartment_number || '@' || y.billing_year::text as fmt
    from public.properties as p
    cross join (select distinct billing_year from public.capital_repair_opening_imports) as y
    where not exists (
      select 1
      from public.capital_repair_opening_imports as i
      where i.property_id = p.id
        and i.billing_year = y.billing_year
    )
  ) as miss;

  if v_missing is not null then
    raise exception 'first_run: capital_repair opening missing apartments/years: %', v_missing
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.capital_repair_fund_cash_opening) then
    raise exception 'first_run: capital_repair fund cash opening required'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.module_lifecycle ml
    where ml.installation_id = p_installation_id
      and ml.module_key = 'capital_repair'
      and ml.state = 'ACTIVE'
  ) then
    raise exception 'first_run: capital_repair must be ACTIVE before stage complete'
      using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_capital_repair_opening_ready(uuid)
  from public, anon;
grant execute on function public.first_run_assert_capital_repair_opening_ready(uuid)
  to authenticated;

create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
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
    'welcome', 'complex_card', 'property_book', 'meters_select',
    'support_fee_opening', 'capital_repair_opening', 'tariffs'
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

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)
  into v_selected;

  v_need_water := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) = 'water'
  );
  v_need_elec := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  );
  if not v_need_water and not v_need_elec then
    raise exception 'first_run: at least one meter utility required' using errcode = 'P0001';
  end if;

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
        and p.stage_key = 'meters_water'
        and p.status = 'complete'
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
        and p.stage_key = 'meters_electricity'
        and p.status = 'complete'
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
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_complete_first_run_stage(p_stage text, p_next_stage text DEFAULT NULL::text, p_draft jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');


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

  -- Direct jump to terminal stage (skipping setup) is rejected up front.
  if v_stage = 'complete' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb)
    where i.id = v_id;
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', coalesce(p_draft, '{}'::jsonb), now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', p_draft -> 'meters_selected', '[]'::jsonb)
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

    if not v_need_water and not v_need_elec then
      raise exception 'first_run: at least one meter utility required' using errcode = '22023';
    end if;

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || jsonb_build_object('meters_selected', coalesce(v_selected, '[]'::jsonb))
      || coalesce(p_draft, '{}'::jsonb)
    where i.id = v_id;

    if not v_need_water then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_water', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
    end if;
    if not v_need_elec then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_electricity', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
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
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'skipped'
    ) or exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      v_next := 'support_fee_opening';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'support_fee_opening';
  end if;

  -- Re-check when advancing into complete after meter stage completion.
  if v_next = 'complete' and v_stage is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, now()),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', now(), now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, now()), updated_at = now();
  elsif v_next is not null then
    update public.platform_installations as i
    set
      first_run_status = case when i.first_run_status = 'complete' then 'complete' else 'in_progress' end,
      first_run_stage = case when i.first_run_status = 'complete' then i.first_run_stage else v_next end,
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
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

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb)
  from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb)
  to authenticated;

commit;
