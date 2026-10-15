-- IS-5 — Internet opening-state inventarisation (PREPARED — do not apply until Safe Release).
-- Upserts subscription schedule + append-only opening_debit / opening_credit ledger rows.
-- NEVER calls request_internet_connect; never creates work orders or payment rows.
-- Auth: администрация only. Idempotent. Conflict on mismatched existing subscription.

begin;

-- ---------------------------------------------------------------------------
-- Schema: opening audit columns on subscriptions
-- ---------------------------------------------------------------------------

alter table public.internet_subscriptions
  add column if not exists opening_import boolean not null default false;

alter table public.internet_subscriptions
  add column if not exists opening_transition_date date null;

alter table public.internet_subscriptions
  add column if not exists opening_paid_through date null;

alter table public.internet_subscriptions
  add column if not exists opening_source_reference text null;

alter table public.internet_subscriptions
  add column if not exists opening_notes text null;

comment on column public.internet_subscriptions.opening_import is
  'IS-5: true when created/updated by import_internet_opening_state (not connect workflow).';

-- ---------------------------------------------------------------------------
-- Ledger kinds: opening_debit / opening_credit (never payment)
-- ---------------------------------------------------------------------------

alter table public.internet_ledger
  drop constraint if exists internet_ledger_kind_check;

alter table public.internet_ledger
  add constraint internet_ledger_kind_check
  check (
    kind = any (
      array[
        'charge'::text,
        'payment'::text,
        'adjustment_debit'::text,
        'adjustment_credit'::text,
        'opening_debit'::text,
        'opening_credit'::text
      ]
    )
  );

comment on constraint internet_ledger_kind_check on public.internet_ledger is
  'IS-5 adds opening_debit / opening_credit — inventarisation, not operational payment/charge.';

-- ---------------------------------------------------------------------------
-- Opening import audit table
-- ---------------------------------------------------------------------------

create table if not exists public.internet_opening_imports (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id),
  subscription_id uuid not null references public.internet_subscriptions (id),
  status text not null,
  tariff_key text not null default 'internet',
  tariff_version_id uuid null references public.tariff_versions (id),
  connection_date date null,
  transition_date date not null,
  paid_through date null,
  next_charge_on date null,
  billing_day smallint null,
  opening_debt numeric(12, 2) not null default 0,
  opening_credit numeric(12, 2) not null default 0,
  source_reference text null,
  notes text null,
  idempotency_key uuid not null,
  batch_id uuid null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  constraint internet_opening_imports_amounts_chk check (
    opening_debt >= 0
    and opening_credit >= 0
  ),
  constraint internet_opening_imports_status_chk check (
    status in ('active', 'inactive')
  )
);

create unique index if not exists internet_opening_imports_idem_uidx
  on public.internet_opening_imports (idempotency_key);

create unique index if not exists internet_opening_imports_property_uidx
  on public.internet_opening_imports (property_id);

alter table public.internet_opening_imports enable row level security;
revoke all on table public.internet_opening_imports from public, anon, authenticated;

drop policy if exists internet_opening_imports_staff_select on public.internet_opening_imports;
create policy internet_opening_imports_staff_select
  on public.internet_opening_imports
  for select
  to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

grant select on table public.internet_opening_imports to authenticated;

-- ---------------------------------------------------------------------------
-- Balance: include opening_* kinds
-- ---------------------------------------------------------------------------

create or replace function public.get_internet_balance(p_property_id bigint)
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
as $fn$
begin
  if auth.uid() is null then
    raise exception 'get_internet_balance: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'get_internet_balance: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    round(coalesce(sum(case when l.kind = 'charge' then l.amount_eur else 0 end), 0), 2),
    round(coalesce(sum(case when l.kind = 'payment' then l.amount_eur else 0 end), 0), 2),
    round(coalesce(sum(case
      when l.kind in ('adjustment_debit', 'opening_debit') then l.amount_eur
      else 0
    end), 0), 2),
    round(coalesce(sum(case
      when l.kind in ('adjustment_credit', 'opening_credit') then l.amount_eur
      else 0
    end), 0), 2),
    round(coalesce(sum(
      case
        when l.kind in ('charge', 'adjustment_debit', 'opening_debit') then l.amount_eur
        when l.kind in ('payment', 'adjustment_credit', 'opening_credit') then -l.amount_eur
        else 0
      end
    ), 0), 2)
  from public.internet_ledger as l
  where l.property_id = p_property_id;
end;
$fn$;

revoke all on function public.get_internet_balance(bigint) from public, anon;
grant execute on function public.get_internet_balance(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: next_charge_on from paid_through (must be strictly after sofia today)
-- ---------------------------------------------------------------------------

create or replace function public.internet_next_charge_after_paid_through(
  p_paid_through date,
  p_billing_day smallint,
  p_sofia_today date
)
returns date
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_next date;
begin
  if p_paid_through is null then
    raise exception 'internet_next_charge_after_paid_through: paid_through required'
      using errcode = '22023';
  end if;
  v_next := public.internet_next_charge_on(p_paid_through, p_billing_day);
  -- Cron charges when next_charge_on <= today — refuse inventarisation that would fire immediately.
  if v_next <= p_sofia_today then
    raise exception 'internet_next_charge_after_paid_through: next_charge_on % not after today % (extend paid_through)',
      v_next, p_sofia_today
      using errcode = '22023';
  end if;
  return v_next;
end;
$fn$;

revoke all on function public.internet_next_charge_after_paid_through(date, smallint, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: import_internet_opening_state
-- ---------------------------------------------------------------------------

create or replace function public.import_internet_opening_state(
  p_property_id bigint,
  p_status text,
  p_tariff_key text,
  p_connection_date date,
  p_transition_date date,
  p_paid_through date,
  p_opening_debt numeric,
  p_opening_credit numeric,
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
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_tariff_key text := lower(btrim(coalesce(p_tariff_key, 'internet')));
  v_debt numeric(12, 2);
  v_credit numeric(12, 2);
  v_sofia date := public.tariff_sofia_today();
  v_conn date;
  v_billing_day smallint;
  v_next date;
  v_anchor date;
  v_period_start date;
  v_version_id uuid;
  v_sub public.internet_subscriptions;
  v_import public.internet_opening_imports;
  v_sub_id uuid;
  v_import_id uuid;
  v_ledger_debt uuid;
  v_ledger_credit uuid;
  v_bal numeric(12, 2);
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_internet_opening_state: authentication required' using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_internet_opening_state: not allowed' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_internet_opening_state: idempotency key is required' using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_internet_opening_state: invalid property' using errcode = '22023';
  end if;

  if p_transition_date is null then
    raise exception 'import_internet_opening_state: transition date required' using errcode = '22023';
  end if;

  if p_transition_date > v_sofia then
    raise exception 'import_internet_opening_state: transition date in future' using errcode = '22023';
  end if;

  if v_status not in ('active', 'inactive') then
    raise exception 'import_internet_opening_state: unsupported status' using errcode = '22023';
  end if;

  if v_tariff_key is distinct from 'internet' then
    raise exception 'import_internet_opening_state: unsupported tariff_key' using errcode = '22023';
  end if;

  v_debt := round(coalesce(p_opening_debt, 0), 2);
  v_credit := round(coalesce(p_opening_credit, 0), 2);
  if v_debt < 0 or v_credit < 0 then
    raise exception 'import_internet_opening_state: amounts must be nonnegative' using errcode = '22023';
  end if;

  -- Published tariff must exist
  begin
    select r.tariff_version_id into v_version_id
    from public.resolve_internet_tariff(p_transition_date) as r;
  exception
    when sqlstate 'P0002' then
      raise exception 'import_internet_opening_state: no internet tariff configured'
        using errcode = 'P0002';
  end;

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'import_internet_opening_state: property not found' using errcode = 'P0002';
  end if;

  -- Idempotent replay
  select * into v_import
  from public.internet_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    select b.balance_eur into v_bal
    from public.get_internet_balance(p_property_id) as b;
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', 'SKIPPED_EXISTING',
      'import_id', v_import.id,
      'subscription_id', v_import.subscription_id,
      'property_id', v_import.property_id,
      'status', v_import.status,
      'next_charge_on', v_import.next_charge_on,
      'opening_debt', v_import.opening_debt,
      'opening_credit', v_import.opening_credit,
      'balance_eur', v_bal,
      'synthetic_payments', false,
      'work_orders_created', false
    );
  end if;

  -- Pending Internet work orders (Q5)
  if exists (
    select 1
    from public.work_orders as wo
    where wo.target_property_id = p_property_id
      and wo.internet_action is not null
      and wo.status in ('open', 'in_progress')
  ) then
    raise exception 'import_internet_opening_state: conflict pending internet work order'
      using errcode = '23505';
  end if;

  -- Prior opening import for property (different idempotency)
  if exists (
    select 1 from public.internet_opening_imports as i where i.property_id = p_property_id
  ) then
    raise exception 'import_internet_opening_state: conflict existing opening import'
      using errcode = '23505';
  end if;

  -- Lock subscription row if any — Q4: never overwrite existing subscription
  select * into v_sub
  from public.internet_subscriptions as s
  where s.property_id = p_property_id
  for update;

  if found then
    raise exception 'import_internet_opening_state: conflict existing subscription'
      using errcode = '23505';
  end if;

  -- Existing opening ledger for property → conflict
  if exists (
    select 1
    from public.internet_ledger as l
    where l.property_id = p_property_id
      and l.kind in ('opening_debit', 'opening_credit')
  ) then
    raise exception 'import_internet_opening_state: conflict existing opening ledger'
      using errcode = '23505';
  end if;

  -- Existing operational charges/payments: do not inventarise on top (manual reconcile)
  if exists (
    select 1
    from public.internet_ledger as l
    where l.property_id = p_property_id
  ) then
    raise exception 'import_internet_opening_state: conflict existing ledger'
      using errcode = '23505';
  end if;

  v_conn := coalesce(p_connection_date, p_transition_date);
  if v_conn > p_transition_date then
    raise exception 'import_internet_opening_state: connection_date after transition'
      using errcode = '22023';
  end if;

  v_billing_day := public.internet_billing_day_from_date(v_conn);
  v_anchor := v_conn;
  v_period_start := v_conn;

  if v_status = 'active' then
    if p_paid_through is null then
      raise exception 'import_internet_opening_state: paid_through required for active'
        using errcode = '22023';
    end if;
    if p_paid_through < v_conn then
      raise exception 'import_internet_opening_state: paid_through before connection'
        using errcode = '22023';
    end if;
    v_next := public.internet_next_charge_after_paid_through(
      p_paid_through, v_billing_day, v_sofia
    );
  else
    -- inactive: no cron schedule
    v_next := null;
    v_billing_day := null;
    v_anchor := null;
    -- paid_through optional for inactive (audit only)
  end if;

  insert into public.internet_subscriptions (
    property_id,
    status,
    period_start,
    period_end,
    pending_days,
    billing_day,
    billing_anchor_date,
    next_charge_on,
    opening_import,
    opening_transition_date,
    opening_paid_through,
    opening_source_reference,
    opening_notes
  ) values (
    p_property_id,
    v_status,
    case when v_status = 'active' then v_period_start else null end,
    case when v_status = 'inactive' then p_transition_date else null end,
    null,
    v_billing_day,
    v_anchor,
    v_next,
    true,
    p_transition_date,
    p_paid_through,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_sub_id;

  if v_debt > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'opening_debit',
      v_debt,
      null,
      v_version_id,
      'IS-5 opening debt; source=' || coalesce(nullif(btrim(coalesce(p_source_reference, '')), ''), 'n/a'),
      v_email,
      p_idempotency_key
    )
    returning id into v_ledger_debt;
  end if;

  if v_credit > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'opening_credit',
      v_credit,
      null,
      v_version_id,
      'IS-5 opening credit; source=' || coalesce(nullif(btrim(coalesce(p_source_reference, '')), ''), 'n/a'),
      v_email,
      case when v_debt > 0 then gen_random_uuid() else p_idempotency_key end
    )
    returning id into v_ledger_credit;
  end if;

  insert into public.internet_opening_imports (
    property_id,
    subscription_id,
    status,
    tariff_key,
    tariff_version_id,
    connection_date,
    transition_date,
    paid_through,
    next_charge_on,
    billing_day,
    opening_debt,
    opening_credit,
    source_reference,
    notes,
    idempotency_key,
    batch_id,
    created_by_email
  ) values (
    p_property_id,
    v_sub_id,
    v_status,
    v_tariff_key,
    v_version_id,
    p_connection_date,
    p_transition_date,
    p_paid_through,
    v_next,
    v_billing_day,
    v_debt,
    v_credit,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    p_batch_id,
    v_email
  )
  returning id into v_import_id;

  select b.balance_eur into v_bal
  from public.get_internet_balance(p_property_id) as b;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'subscription_id', v_sub_id,
    'property_id', p_property_id,
    'status', v_status,
    'tariff_key', v_tariff_key,
    'tariff_version_id', v_version_id,
    'billing_day', v_billing_day,
    'next_charge_on', v_next,
    'paid_through', p_paid_through,
    'opening_debt', v_debt,
    'opening_credit', v_credit,
    'balance_eur', v_bal,
    'synthetic_payments', false,
    'work_orders_created', false,
    'ledger_debt_id', v_ledger_debt,
    'ledger_credit_id', v_ledger_credit
  );
end;
$fn$;

revoke all on function public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid
) from public, anon;

grant execute on function public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid
) to authenticated;

comment on function public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid
) is
  'IS-5: inventarise Internet subscription + opening AR without connect WO or payments. Admin only.';

commit;
