-- =============================================================================
-- IS-8 — Capital Repair opening inventarisation
-- =============================================================================
-- Declared historical amounts (Q-CR-2). Mandatory assessment_id (Q-CR-3).
-- Opening ledger kinds — NEVER kind=payment / never charge_* RPCs.
-- Does NOT mutate properties.debt / overpayment (capital is ledger-derived).
-- Does NOT rewrite existing operational ledger rows.
-- Idempotent CREATE IF NOT EXISTS / DROP CONSTRAINT IF EXISTS patterns.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Expand ledger kind check + require assessment_id for opening kinds
-- ---------------------------------------------------------------------------

alter table public.capital_repair_ledger
  drop constraint if exists capital_repair_ledger_kind_check;

alter table public.capital_repair_ledger
  add constraint capital_repair_ledger_kind_check
  check (
    kind = any (
      array[
        'charge'::text,
        'payment'::text,
        'adjustment_debit'::text,
        'adjustment_credit'::text,
        'opening_obligation'::text,
        'opening_historical_settlement'::text,
        'opening_credit'::text
      ]
    )
  );

comment on constraint capital_repair_ledger_kind_check on public.capital_repair_ledger is
  'IS-8 adds opening_obligation / opening_historical_settlement / opening_credit — not operational payments or charges.';

alter table public.capital_repair_ledger
  drop constraint if exists capital_repair_charge_requires_assessment;

alter table public.capital_repair_ledger
  add constraint capital_repair_opening_or_charge_requires_assessment
  check (
    kind not in (
      'charge',
      'opening_obligation',
      'opening_historical_settlement',
      'opening_credit'
    )
    or assessment_id is not null
  );

-- One opening obligation per apartment per assessment (parallel to one charge)
create unique index if not exists capital_repair_ledger_one_opening_obligation_per_property_assessment_idx
  on public.capital_repair_ledger (property_id, assessment_id)
  where kind = 'opening_obligation' and assessment_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Opening import audit table
-- ---------------------------------------------------------------------------

create table if not exists public.capital_repair_opening_imports (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete restrict,
  billing_year integer not null,
  assessment_id uuid not null references public.capital_repair_assessments (id) on delete restrict,
  assessed_amount numeric(12, 2) not null,
  historically_paid_amount numeric(12, 2) not null,
  remaining_debt numeric(12, 2) not null,
  opening_overpayment numeric(12, 2) not null default 0,
  transition_date date not null,
  source_reference text null,
  notes text null,
  imported_by_email text not null,
  idempotency_key uuid not null,
  batch_id uuid null,
  created_at timestamptz not null default now(),
  constraint capital_repair_opening_imports_amounts_chk check (
    assessed_amount >= 0
    and historically_paid_amount >= 0
    and remaining_debt >= 0
    and opening_overpayment >= 0
    and round(assessed_amount, 2) = round(historically_paid_amount + remaining_debt, 2)
  ),
  constraint capital_repair_opening_imports_year_chk check (
    billing_year >= 2000 and billing_year <= 2100
  ),
  constraint capital_repair_opening_imports_credit_vs_debt_chk check (
    opening_overpayment = 0 or remaining_debt = 0
  )
);

comment on table public.capital_repair_opening_imports is
  'IS-8: audited Capital Repair opening inventarisation rows. Not bank/cash fund balances.';

create unique index if not exists capital_repair_opening_imports_idem_uidx
  on public.capital_repair_opening_imports (idempotency_key);

create unique index if not exists capital_repair_opening_imports_scope_uidx
  on public.capital_repair_opening_imports (property_id, billing_year);

create unique index if not exists capital_repair_opening_imports_source_uidx
  on public.capital_repair_opening_imports (property_id, source_reference)
  where source_reference is not null and length(trim(source_reference)) > 0;

alter table public.capital_repair_opening_imports enable row level security;
revoke all on table public.capital_repair_opening_imports from public, anon, authenticated;

drop policy if exists capital_repair_opening_imports_staff_select on public.capital_repair_opening_imports;
create policy capital_repair_opening_imports_staff_select
  on public.capital_repair_opening_imports
  for select
  to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

grant select on table public.capital_repair_opening_imports to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Balance consumers — include opening kinds (debit/credit semantics)
-- ---------------------------------------------------------------------------

create or replace function public.get_capital_repair_balance(
  p_property_id bigint
)
returns table (
  charged_eur numeric,
  paid_eur numeric,
  adjustments_debit_eur numeric,
  adjustments_credit_eur numeric,
  balance_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from public.properties as p where p.id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  return query
  select
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('charge', 'opening_obligation')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('payment', 'opening_historical_settlement')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind = 'adjustment_debit'
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('adjustment_credit', 'opening_credit')
    ), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (
        where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
      ), 0)
      - coalesce(sum(l.amount_eur) filter (
        where l.kind in (
          'payment',
          'opening_historical_settlement',
          'adjustment_credit',
          'opening_credit'
        )
      ), 0)
    )::numeric(12, 2)
  from public.capital_repair_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_capital_repair_balance(bigint) from public;
revoke all on function public.get_capital_repair_balance(bigint) from anon;
grant execute on function public.get_capital_repair_balance(bigint) to authenticated;

create or replace function public.get_capital_repair_fund_totals()
returns table (
  charged_eur numeric,
  paid_eur numeric,
  balance_eur numeric,
  apartments_with_debt integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_capital_repair_fund_totals: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'get_capital_repair_fund_totals: not allowed'
      using errcode = '42501';
  end if;

  return query
  with signed as (
    select
      l.property_id,
      case
        when l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
          then l.amount_eur
        when l.kind in (
          'payment',
          'opening_historical_settlement',
          'adjustment_credit',
          'opening_credit'
        )
          then -l.amount_eur
        else 0
      end as signed_amt,
      case when l.kind in ('charge', 'opening_obligation') then l.amount_eur else 0 end as charged_amt,
      case
        when l.kind in ('payment', 'opening_historical_settlement') then l.amount_eur
        else 0
      end as paid_amt
    from public.capital_repair_ledger as l
  ),
  agg as (
    select
      round(coalesce(sum(charged_amt), 0), 2) as charged,
      round(coalesce(sum(paid_amt), 0), 2) as paid,
      round(coalesce(sum(signed_amt), 0), 2) as bal
    from signed
  ),
  by_prop as (
    select property_id, round(coalesce(sum(signed_amt), 0), 2) as bal
    from signed
    group by property_id
  )
  select
    a.charged,
    a.paid,
    a.bal,
    (select count(*)::int from by_prop as p where p.bal > 0)
  from agg as a;
end;
$fn$;

revoke all on function public.get_capital_repair_fund_totals() from public;
revoke all on function public.get_capital_repair_fund_totals() from anon;
grant execute on function public.get_capital_repair_fund_totals() to authenticated;

-- Ownership overdue: opening_obligation must count as debit (not "else -amount")
create or replace function public.ownership_change_overdue_debt(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sf_overdue numeric := 0;
  v_sf_future numeric := 0;
  v_cap_overdue numeric := 0;
  v_cap_future numeric := 0;
  v_overdue numeric := 0;
  v_future numeric := 0;
  v_prop_debt numeric := 0;
  v_gate boolean := false;
begin
  if auth.role() is not distinct from 'service_role' then
    null;
  elsif public.has_staff_role('администрация')
     or public.has_staff_role('бухгалтер') then
    null;
  elsif auth.uid() is not null and public.owns_property(p_property_id) then
    null;
  else
    raise exception 'ownership_change_overdue_debt: forbidden'
      using errcode = '42501';
  end if;

  select
    coalesce(sum(case
      when a.remaining_due > 0
       and a.early_deadline_at is not null
       and a.early_deadline_at < now()
      then a.remaining_due else 0 end), 0),
    coalesce(sum(case
      when a.remaining_due > 0
       and (a.early_deadline_at is null or a.early_deadline_at >= now())
      then a.remaining_due else 0 end), 0)
  into v_sf_overdue, v_sf_future
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected';

  select
    coalesce(sum(case
      when n.net > 0 and n.due_date is not null and n.due_date < current_date
      then n.net else 0 end), 0),
    coalesce(sum(case
      when n.net > 0 and (n.due_date is null or n.due_date >= current_date)
      then n.net else 0 end), 0)
  into v_cap_overdue, v_cap_future
  from (
    select
      a.due_date,
      coalesce(sum(
        case
          when l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
            then l.amount_eur
          when l.kind in (
            'payment',
            'opening_historical_settlement',
            'adjustment_credit',
            'opening_credit'
          )
            then -l.amount_eur
          else 0
        end
      ), 0) as net
    from public.capital_repair_ledger as l
    join public.capital_repair_assessments as a on a.id = l.assessment_id
    where l.property_id = p_property_id
      and coalesce(a.status, 'open') is distinct from 'cancelled'
      and coalesce(a.status, 'open') is distinct from 'void'
    group by a.id, a.due_date
  ) as n;

  v_overdue := v_sf_overdue + v_cap_overdue;
  v_future := v_sf_future + v_cap_future;

  select coalesce(p.debt, 0) into v_prop_debt
  from public.properties as p
  where p.id = p_property_id;

  select s.ordinary_debt_gate_enabled into v_gate
  from public.ownership_change_settings as s
  where s.id = 1;

  return jsonb_build_object(
    'overdue_unpaid_eur', v_overdue,
    'future_due_eur', v_future,
    'support_fee_overdue_eur', v_sf_overdue,
    'support_fee_future_eur', v_sf_future,
    'capital_repair_overdue_eur', v_cap_overdue,
    'capital_repair_future_eur', v_cap_future,
    'portal_debt_eur', v_prop_debt,
    'blocks_ordinary', v_overdue > 0,
    'ordinary_debt_gate_enabled', coalesce(v_gate, false),
    'reason', case
      when v_overdue > 0 then 'overdue_unpaid_obligations'
      else null
    end
  );
end;
$fn$;

revoke all on function public.ownership_change_overdue_debt(bigint) from public, anon;
grant execute on function public.ownership_change_overdue_debt(bigint) to authenticated;
grant execute on function public.ownership_change_overdue_debt(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. RPC: import_capital_repair_opening_state
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

  -- Idempotent replay
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

  -- Lock property (concurrency; no portal debt mutation)
  select p.id into v_lock
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'import_capital_repair_opening_state: property not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and i.billing_year = p_billing_year
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  v_src := nullif(btrim(coalesce(p_source_reference, '')), '');
  if v_src is not null and exists (
    select 1
    from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and i.source_reference = v_src
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing source_reference'
      using errcode = '23505';
  end if;

  -- Resolve assessment by business title (never invent operational charge)
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
      title,
      description,
      decision_date,
      due_date,
      status,
      created_by_email
    ) values (
      v_title,
      'IS-8 opening inventarisation shell (no operational charge)',
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

  -- Conflict: operational charge already posted for this apt × assessment
  if exists (
    select 1
    from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing operational charge'
      using errcode = '23505';
  end if;

  -- Conflict: prior opening obligation for same apt × assessment
  if exists (
    select 1
    from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'opening_obligation'
  ) then
    raise exception 'import_capital_repair_opening_state: conflict existing opening obligation'
      using errcode = '23505';
  end if;

  -- Opening obligation (debit — not kind=charge)
  if v_assessed > 0 then
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    ) values (
      p_property_id,
      v_assessment_id,
      'opening_obligation',
      v_assessed,
      'IS-8 opening obligation; source=' || coalesce(v_src, 'n/a'),
      v_email,
      p_idempotency_key
    );
  end if;

  -- Historical settlement (NOT payment)
  if v_paid > 0 then
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    ) values (
      p_property_id,
      v_assessment_id,
      'opening_historical_settlement',
      v_paid,
      'IS-8 historical settlement (not a platform payment)',
      v_email,
      gen_random_uuid()
    );
  end if;

  if v_over_in > 0 then
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    ) values (
      p_property_id,
      v_assessment_id,
      'opening_credit',
      v_over_in,
      'IS-8 opening credit/overpayment',
      v_email,
      gen_random_uuid()
    );
  end if;

  -- Edge: all-zero assessed/paid/remaining/over — still record audit import
  if v_assessed = 0 and v_paid = 0 and v_remaining = 0 and v_over_in = 0 then
    null; -- audit row below is sufficient
  end if;

  insert into public.capital_repair_opening_imports (
    property_id,
    billing_year,
    assessment_id,
    assessed_amount,
    historically_paid_amount,
    remaining_debt,
    opening_overpayment,
    transition_date,
    source_reference,
    notes,
    imported_by_email,
    idempotency_key,
    batch_id
  ) values (
    p_property_id,
    p_billing_year,
    v_assessment_id,
    v_assessed,
    v_paid,
    v_remaining,
    v_over_in,
    p_transition_date,
    v_src,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_email,
    p_idempotency_key,
    p_batch_id
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

comment on function public.import_capital_repair_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, text, uuid
) is
  'IS-8: Capital Repair opening inventarisation. Opening ledger kinds only; mandatory assessment_id; no payment/charge RPCs; no portal debt mutation.';

commit;
