create table if not exists public.owner_transfers (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  property_id bigint not null references public.properties(id) on delete cascade,
  from_owner_name text,
  from_owner_email text,
  from_owner_phone text,
  to_owner_name text not null,
  to_owner_email text not null,
  to_owner_phone text,
  note text,
  status text not null default 'ожидает',
  decided_at timestamptz,
  decided_by text,
  reject_reason text
);

alter table public.owner_transfers enable row level security;

drop policy if exists "owner_transfers_select" on public.owner_transfers;
drop policy if exists "owner_transfers_insert" on public.owner_transfers;
drop policy if exists "owner_transfers_update" on public.owner_transfers;
drop policy if exists "owner_transfers_delete" on public.owner_transfers;

create policy "owner_transfers_select" on public.owner_transfers for select using (true);
create policy "owner_transfers_insert" on public.owner_transfers for insert with check (true);
create policy "owner_transfers_update" on public.owner_transfers for update using (true);
create policy "owner_transfers_delete" on public.owner_transfers for delete using (true);

create index if not exists owner_transfers_property_idx on public.owner_transfers (property_id);
create index if not exists owner_transfers_status_idx on public.owner_transfers (status);
