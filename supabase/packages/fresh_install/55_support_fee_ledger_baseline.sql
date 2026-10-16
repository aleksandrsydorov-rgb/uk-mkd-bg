-- =============================================================================
-- IS-10c fresh-install — Support Fee ledger baseline (pre-chronological migrations)
-- =============================================================================
-- Canonical shape from legacy support_fee.sql + later column/kind expansions
-- reflected in IS-4 (opening kinds). No rate seed. No assessment/policy rows.
-- Independent of Capital Repair / Internet ledgers.
-- =============================================================================

create table if not exists public.building_settings (
  id int primary key default 1 check (id = 1),
  support_rate_eur_per_sqm_year numeric(12, 4) null,
  updated_at timestamptz not null default now(),
  updated_by text null,
  -- Utility information modes (required by SH-2C1 grants before utility_mode RPC migration).
  -- NULL = unset; admin configures via set_utility_information_mode — no default publish.
  electricity_mode text null,
  water_mode text null
);

comment on table public.building_settings is
  'Building-level settings shell. Fresh-install: no seeded support rate (admin configures).';

-- Do NOT insert a default support_rate — that would preconfigure a financial tariff.

create table if not exists public.support_fee_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  kind text not null,
  amount numeric(12, 2) not null,
  period text null,
  note text null,
  recorded_by text null,
  debt_after numeric(12, 2) null,
  overpayment_after numeric(12, 2) null,
  idempotency_key uuid null,
  reverses_ledger_id bigint null,
  reversal_reason text null,
  constraint support_fee_ledger_amount_positive check (amount > 0),
  constraint support_fee_ledger_kind_chk
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
    )
);

comment on table public.support_fee_ledger is
  'Independent Support Fee journal. Empty on fresh install — no synthetic payments.';

create index if not exists support_fee_ledger_property_idx
  on public.support_fee_ledger (property_id, created_at desc);

create unique index if not exists support_fee_ledger_charge_period_idx
  on public.support_fee_ledger (property_id, period)
  where kind = 'charge' and period is not null;

alter table public.building_settings enable row level security;
alter table public.support_fee_ledger enable row level security;

revoke all on table public.building_settings from public, anon;
revoke all on table public.support_fee_ledger from public, anon;
revoke all on table public.building_settings from authenticated;
revoke all on table public.support_fee_ledger from authenticated;
grant select on table public.building_settings to authenticated;
grant select on table public.support_fee_ledger to authenticated;

do $$
begin
  if to_regprocedure('public.has_staff_role(text)') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'building_settings'
      and policyname = 'building_settings_staff_select'
  ) then
    create policy building_settings_staff_select
    on public.building_settings
    for select to authenticated
    using (
      public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
    );
  end if;

  if to_regprocedure('public.owns_property(bigint)') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'support_fee_ledger'
         and policyname = 'support_fee_ledger_select'
     ) then
    create policy support_fee_ledger_select
    on public.support_fee_ledger
    for select to authenticated
    using (
      public.owns_property(property_id)
      or public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
    );
  elsif not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_fee_ledger'
      and policyname = 'support_fee_ledger_staff_select'
  ) then
    create policy support_fee_ledger_staff_select
    on public.support_fee_ledger
    for select to authenticated
    using (
      public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер')
    );
  end if;
end $$;
