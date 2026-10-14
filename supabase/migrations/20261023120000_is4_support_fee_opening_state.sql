-- IS-4 — Support Fee opening-state inventarisation (PREPARED — do not apply until Safe Release).
-- Append-only opening assessments + ledger kinds that are NOT operational payments.
-- Preserves Finance D1 remaining_due; never fabricates payment/allocation rows.
-- Auth: администрация only. Idempotent. Conflict on existing active obligations.

begin;

-- ---------------------------------------------------------------------------
-- Schema: opening audit columns on assessments
-- ---------------------------------------------------------------------------

alter table public.support_fee_assessments
  add column if not exists opening_import boolean not null default false;

alter table public.support_fee_assessments
  add column if not exists opening_historically_paid_amount numeric(12, 2) null;

alter table public.support_fee_assessments
  add column if not exists opening_transition_date date null;

alter table public.support_fee_assessments
  add column if not exists opening_source_reference text null;

alter table public.support_fee_assessments
  add column if not exists opening_obligation_type text null;

alter table public.support_fee_assessments
  add column if not exists opening_notes text null;

comment on column public.support_fee_assessments.opening_import is
  'IS-4: true when created by import_support_fee_opening_state (not operational finalize).';

comment on column public.support_fee_assessments.opening_historically_paid_amount is
  'IS-4: declared historical settlement amount; NOT a platform payment.';

-- ---------------------------------------------------------------------------
-- Schema: opening import audit table (idempotency + uniqueness)
-- ---------------------------------------------------------------------------

create table if not exists public.support_fee_opening_imports (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id),
  billing_year integer not null,
  obligation_type text not null default 'support_fee',
  assessment_id uuid not null references public.support_fee_assessments (id),
  assessed_amount numeric(12, 2) not null,
  historically_paid_amount numeric(12, 2) not null,
  remaining_debt numeric(12, 2) not null,
  opening_overpayment numeric(12, 2) not null default 0,
  transition_date date not null,
  source_reference text null,
  notes text null,
  idempotency_key uuid not null,
  batch_id uuid null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  constraint support_fee_opening_imports_amounts_chk check (
    assessed_amount >= 0
    and historically_paid_amount >= 0
    and remaining_debt >= 0
    and opening_overpayment >= 0
    and round(assessed_amount, 2) = round(historically_paid_amount + remaining_debt, 2)
  ),
  constraint support_fee_opening_imports_year_chk check (
    billing_year >= 2000 and billing_year <= 2100
  )
);

create unique index if not exists support_fee_opening_imports_idem_uidx
  on public.support_fee_opening_imports (idempotency_key);

create unique index if not exists support_fee_opening_imports_scope_uidx
  on public.support_fee_opening_imports (property_id, billing_year, obligation_type);

alter table public.support_fee_opening_imports enable row level security;
revoke all on table public.support_fee_opening_imports from public, anon, authenticated;

-- Staff read for admin UI / audit
drop policy if exists support_fee_opening_imports_staff_select on public.support_fee_opening_imports;
create policy support_fee_opening_imports_staff_select
  on public.support_fee_opening_imports
  for select
  to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

grant select on table public.support_fee_opening_imports to authenticated;

-- ---------------------------------------------------------------------------
-- Ledger kinds: opening_* (never payment)
-- ---------------------------------------------------------------------------

alter table public.support_fee_ledger
  drop constraint if exists support_fee_ledger_kind_chk;

alter table public.support_fee_ledger
  add constraint support_fee_ledger_kind_chk
  check (
    kind = any (
      array[
        'payment'::text,
        'charge'::text,
        'adjustment_debit'::text,
        'adjustment_credit'::text,
        'payment_reversal'::text,
        'assessment_void'::text,
        'assessment_restore'::text,
        'opening_obligation'::text,
        'opening_historical_settlement'::text,
        'opening_credit'::text
      ]
    )
  );

comment on constraint support_fee_ledger_kind_chk on public.support_fee_ledger is
  'IS-4 adds opening_obligation / opening_historical_settlement / opening_credit — not operational payments.';

-- ---------------------------------------------------------------------------
-- RPC: import_support_fee_opening_state
-- ---------------------------------------------------------------------------

create or replace function public.import_support_fee_opening_state(
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
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_obl text := lower(btrim(coalesce(p_obligation_type, 'support_fee')));
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over_in numeric(12, 2);
  v_debt numeric(12, 2);
  v_over numeric(12, 2);
  v_new_debt numeric(12, 2);
  v_new_over numeric(12, 2);
  v_status text;
  v_assessment_id uuid;
  v_import_id uuid;
  v_period text;
  v_ledger_obl bigint;
  v_ledger_settle bigint;
  v_ledger_credit bigint;
  v_existing_import public.support_fee_opening_imports;
  v_existing_assessment public.support_fee_assessments;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_support_fee_opening_state: authentication required' using errcode = '42501';
  end if;

  -- Initial Setup inventarisation: administration only (stricter than day-to-day cashier).
  if not public.has_staff_role('администрация') then
    raise exception 'import_support_fee_opening_state: not allowed' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_support_fee_opening_state: idempotency key is required' using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_support_fee_opening_state: invalid property' using errcode = '22023';
  end if;

  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'import_support_fee_opening_state: invalid billing year' using errcode = '22023';
  end if;

  if p_transition_date is null then
    raise exception 'import_support_fee_opening_state: transition date required' using errcode = '22023';
  end if;

  if v_obl is distinct from 'support_fee' then
    raise exception 'import_support_fee_opening_state: unsupported obligation_type' using errcode = '22023';
  end if;

  v_assessed := round(coalesce(p_assessed_amount, -1), 2);
  v_paid := round(coalesce(p_historically_paid_amount, -1), 2);
  v_remaining := round(coalesce(p_remaining_debt, -1), 2);
  v_over_in := round(coalesce(p_opening_overpayment, 0), 2);

  if v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over_in < 0 then
    raise exception 'import_support_fee_opening_state: amounts must be nonnegative' using errcode = '22023';
  end if;

  if v_assessed <> round(v_paid + v_remaining, 2) then
    raise exception 'import_support_fee_opening_state: assessed must equal historically_paid + remaining'
      using errcode = '22023';
  end if;

  v_period := p_billing_year::text;

  -- Idempotent replay
  select * into v_existing_import
  from public.support_fee_opening_imports as i
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
      'remaining_due', v_existing_import.remaining_debt,
      'opening_overpayment', v_existing_import.opening_overpayment,
      'synthetic_payments', false
    );
  end if;

  -- Lock apartment portal row (same pattern as payment/finalize)
  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'import_support_fee_opening_state: property not found' using errcode = 'P0002';
  end if;

  -- Conflict: prior opening for same scope (different idempotency)
  if exists (
    select 1
    from public.support_fee_opening_imports as i
    where i.property_id = p_property_id
      and i.billing_year = p_billing_year
      and i.obligation_type = v_obl
  ) then
    raise exception 'import_support_fee_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  -- Conflict: any active operational assessment for year
  select a.* into v_existing_assessment
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.billing_year = p_billing_year
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected'
  order by a.created_at desc
  limit 1;

  if found then
    raise exception 'import_support_fee_opening_state: conflict existing assessment'
      using errcode = '23505';
  end if;

  -- Conflict: operational charge already posted for period
  if exists (
    select 1
    from public.support_fee_ledger as l
    where l.property_id = p_property_id
      and l.kind = 'charge'
      and l.period = v_period
  ) then
    raise exception 'import_support_fee_opening_state: conflict existing charge ledger'
      using errcode = '23505';
  end if;

  v_status := case when v_remaining <= 0 then 'paid' else 'open' end;
  v_new_debt := round(v_debt + v_remaining, 2);
  v_new_over := round(v_over + v_over_in, 2);

  insert into public.support_fee_assessments (
    property_id,
    billing_year,
    policy_id,
    charge_ledger_id,
    base_amount,
    discount_percent,
    increase_percent,
    early_amount,
    late_amount,
    early_deadline_at,
    pricing_rule,
    pricing_reason_code,
    qualification_status,
    qualification_checked_at,
    available_credit_at_check,
    amount_covered_at_check,
    dedicated_payment_at_check,
    applied_credit_amount,
    applied_payment_amount,
    final_amount,
    remaining_due,
    balance_before,
    balance_after,
    status,
    created_by_email,
    finalized_at,
    finalized_by_email,
    tariff_version_id,
    area_sqm_snapshot,
    rate_eur_per_sqm_year_snapshot,
    opening_import,
    opening_historically_paid_amount,
    opening_transition_date,
    opening_source_reference,
    opening_obligation_type,
    opening_notes
  ) values (
    p_property_id,
    p_billing_year,
    null,
    null,
    v_assessed,
    0,
    0,
    v_assessed,
    v_assessed,
    null,
    'standard',
    'is4_opening_state',
    'not_checked',
    null,
    0,
    v_paid,
    0,
    0,
    0,
    v_assessed,
    v_remaining,
    v_debt,
    v_new_debt,
    v_status,
    v_email,
    now(),
    v_email,
    null,
    null,
    null,
    true,
    v_paid,
    p_transition_date,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    v_obl,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_assessment_id;

  -- Opening obligation (audit debit — not kind=charge)
  insert into public.support_fee_ledger (
    property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, idempotency_key
  ) values (
    p_property_id,
    'opening_obligation',
    v_assessed,
    v_period,
    'IS-4 opening obligation; source=' || coalesce(nullif(btrim(coalesce(p_source_reference, '')), ''), 'n/a'),
    v_email,
    v_new_debt,
    v_new_over,
    p_idempotency_key
  )
  returning id into v_ledger_obl;

  update public.support_fee_assessments
  set charge_ledger_id = v_ledger_obl
  where id = v_assessment_id;

  -- Historical settlement (NOT payment — no allocations)
  if v_paid > 0 then
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, idempotency_key
    ) values (
      p_property_id,
      'opening_historical_settlement',
      v_paid,
      v_period,
      'IS-4 historical settlement (not a platform payment)',
      v_email,
      v_new_debt,
      v_new_over,
      null
    )
    returning id into v_ledger_settle;
  end if;

  if v_over_in > 0 then
    insert into public.support_fee_ledger (
      property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after, idempotency_key
    ) values (
      p_property_id,
      'opening_credit',
      v_over_in,
      v_period,
      'IS-4 opening credit/overpayment',
      v_email,
      v_new_debt,
      v_new_over,
      null
    )
    returning id into v_ledger_credit;
  end if;

  -- Portal cache updated only inside this RPC (never client UPDATE)
  update public.properties
  set
    debt = v_new_debt,
    overpayment = v_new_over
  where id = p_property_id;

  insert into public.support_fee_opening_imports (
    property_id,
    billing_year,
    obligation_type,
    assessment_id,
    assessed_amount,
    historically_paid_amount,
    remaining_debt,
    opening_overpayment,
    transition_date,
    source_reference,
    notes,
    idempotency_key,
    batch_id,
    created_by_email
  ) values (
    p_property_id,
    p_billing_year,
    v_obl,
    v_assessment_id,
    v_assessed,
    v_paid,
    v_remaining,
    v_over_in,
    p_transition_date,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    p_batch_id,
    v_email
  )
  returning id into v_import_id;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'assessment_id', v_assessment_id,
    'property_id', p_property_id,
    'billing_year', p_billing_year,
    'obligation_type', v_obl,
    'assessed_amount', v_assessed,
    'historically_paid_amount', v_paid,
    'remaining_due', v_remaining,
    'opening_overpayment', v_over_in,
    'status', v_status,
    'debt_after', v_new_debt,
    'overpayment_after', v_new_over,
    'synthetic_payments', false,
    'ledger_obligation_id', v_ledger_obl,
    'ledger_settlement_id', v_ledger_settle,
    'ledger_credit_id', v_ledger_credit
  );
end;
$fn$;

revoke all on function public.import_support_fee_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, uuid
) from public, anon;

grant execute on function public.import_support_fee_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, uuid
) to authenticated;

comment on function public.import_support_fee_opening_state(
  bigint, integer, text, numeric, numeric, numeric, numeric, date, text, text, uuid, uuid
) is
  'IS-4: inventarise Support Fee opening state per apartment/year without fabricating payments. Admin only.';

commit;
