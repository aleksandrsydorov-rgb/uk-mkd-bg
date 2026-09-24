-- Такса поддержки: ставка (€/м²·год) и журнал начислений/оплат.
-- Электричество и воду собственники платят сами — УК принимает только таксу.

create table if not exists public.building_settings (
  id int primary key default 1 check (id = 1),
  support_rate_eur_per_sqm_year numeric(12, 4) not null default 8,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.building_settings (id, support_rate_eur_per_sqm_year)
values (1, 8)
on conflict (id) do nothing;

create table if not exists public.support_fee_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties (id) on delete cascade,
  kind text not null check (kind in ('payment', 'charge')),
  amount numeric(12, 2) not null check (amount > 0),
  period text,
  note text,
  recorded_by text,
  debt_after numeric(12, 2),
  overpayment_after numeric(12, 2)
);

create index if not exists support_fee_ledger_property_idx
  on public.support_fee_ledger (property_id, created_at desc);

create unique index if not exists support_fee_ledger_charge_period_idx
  on public.support_fee_ledger (property_id, period)
  where kind = 'charge' and period is not null;

alter table public.building_settings enable row level security;
alter table public.support_fee_ledger enable row level security;

drop policy if exists "building_settings_all" on public.building_settings;
create policy "building_settings_all" on public.building_settings for all using (true) with check (true);

drop policy if exists "support_fee_ledger_all" on public.support_fee_ledger;
create policy "support_fee_ledger_all" on public.support_fee_ledger for all using (true) with check (true);
