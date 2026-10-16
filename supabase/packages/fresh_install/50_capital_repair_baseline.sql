-- =============================================================================
-- IS-9a fresh-install package — Capital Repair assessments + ledger baseline
-- =============================================================================
-- Independent financial domain (not Support Fee). Kind check includes IS-8
-- opening kinds so greenfield does not need a destructive rewrite of values.
-- Assessment-required constraint uses the PRE-IS-8 name so
-- 20261027120000_is8_… can DROP IF EXISTS + ADD the widened constraint.
-- =============================================================================

create table if not exists public.capital_repair_assessments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text null,
  decision_date date null,
  due_date date null,
  status text not null default 'active',
  created_by_email text null,
  created_at timestamptz not null default now(),
  constraint capital_repair_assessments_title_not_blank
    check (length(trim(title)) > 0),
  constraint capital_repair_assessments_status_check
    check (status in ('active', 'closed', 'cancelled'))
);

comment on table public.capital_repair_assessments is
  'Capital repair decision / fund campaign. Charges live in capital_repair_ledger.';

create table if not exists public.capital_repair_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete restrict,
  assessment_id uuid null
    references public.capital_repair_assessments (id) on delete restrict,
  kind text not null,
  amount_eur numeric(12, 2) not null,
  note text null,
  recorded_by_email text null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint capital_repair_ledger_kind_check
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
    ),
  constraint capital_repair_ledger_amount_positive
    check (amount_eur > 0),
  -- Pre-IS-8 name (charge only). IS-8 migration widens to opening kinds.
  constraint capital_repair_charge_requires_assessment
    check (kind <> 'charge' or assessment_id is not null),
  constraint capital_repair_ledger_idempotency_key_key
    unique (idempotency_key)
);

comment on table public.capital_repair_ledger is
  'Immutable capital-repair finance journal. Balances are derived, not stored on properties.';

comment on constraint capital_repair_ledger_kind_check on public.capital_repair_ledger is
  'IS-8 opening kinds included at baseline — not operational payments or charges.';

create unique index if not exists capital_repair_ledger_one_charge_per_property_assessment_idx
  on public.capital_repair_ledger (property_id, assessment_id)
  where kind = 'charge' and assessment_id is not null;

create unique index if not exists capital_repair_ledger_one_opening_obligation_per_property_assessment_idx
  on public.capital_repair_ledger (property_id, assessment_id)
  where kind = 'opening_obligation' and assessment_id is not null;

create index if not exists capital_repair_ledger_property_created_idx
  on public.capital_repair_ledger (property_id, created_at desc);

create index if not exists capital_repair_ledger_assessment_id_idx
  on public.capital_repair_ledger (assessment_id);

create index if not exists capital_repair_ledger_kind_idx
  on public.capital_repair_ledger (kind);

alter table public.capital_repair_assessments enable row level security;
alter table public.capital_repair_ledger enable row level security;

revoke all on table public.capital_repair_assessments from public;
revoke all on table public.capital_repair_assessments from anon;
revoke all on table public.capital_repair_assessments from authenticated;
revoke all on table public.capital_repair_ledger from public;
revoke all on table public.capital_repair_ledger from anon;
revoke all on table public.capital_repair_ledger from authenticated;

grant select on table public.capital_repair_assessments to authenticated;
grant select on table public.capital_repair_ledger to authenticated;

-- SELECT policies when auth helpers exist. Writes remain RPC-only (no INSERT policies).
do $$
begin
  if to_regprocedure('public.has_staff_role(text)') is null then
    return;
  end if;

  if to_regprocedure('public.owns_property(bigint)') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'capital_repair_assessments'
        and policyname = 'capital_repair_assessments_select'
    ) then
      create policy capital_repair_assessments_select
      on public.capital_repair_assessments
      for select
      to authenticated
      using (
        public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
        or exists (
          select 1
          from public.capital_repair_ledger as l
          where l.assessment_id = capital_repair_assessments.id
            and public.owns_property(l.property_id)
        )
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'capital_repair_ledger'
        and policyname = 'capital_repair_ledger_select'
    ) then
      create policy capital_repair_ledger_select
      on public.capital_repair_ledger
      for select
      to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
      );
    end if;
  else
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'capital_repair_assessments'
        and policyname = 'capital_repair_assessments_staff_select'
    ) then
      create policy capital_repair_assessments_staff_select
      on public.capital_repair_assessments
      for select
      to authenticated
      using (
        public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'capital_repair_ledger'
        and policyname = 'capital_repair_ledger_staff_select'
    ) then
      create policy capital_repair_ledger_staff_select
      on public.capital_repair_ledger
      for select
      to authenticated
      using (
        public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
      );
    end if;
  end if;
end $$;
