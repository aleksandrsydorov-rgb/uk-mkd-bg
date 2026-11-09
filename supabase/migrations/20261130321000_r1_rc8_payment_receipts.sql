-- =============================================================================
-- R1-RC8 — Unified payment receipts (квитанции за получено плащане)
-- Server-side 1:1 link to ledger payment rows; PDF stored privately.
-- Does not create receipts for charges / openings / adjustments.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.payment_receipt_sequences (
  series text primary key,
  next_number bigint not null check (next_number >= 1)
);

insert into public.payment_receipt_sequences (series, next_number)
values ('KP', 1)
on conflict (series) do nothing;

create table if not exists public.payment_receipt_intents (
  idempotency_key uuid primary key,
  payer_name text,
  payment_method text,
  external_refs jsonb not null default '{}'::jsonb,
  is_advance boolean not null default false,
  purpose_override text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours')
);

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  series text not null default 'KP',
  number bigint not null,
  number_display text not null,
  status text not null
    check (status in ('pending_details', 'pending_pdf', 'ready', 'failed', 'voided')),
  source_module text not null
    check (source_module in ('water', 'electricity', 'internet', 'support_fee', 'capital_repair')),
  ledger_id text not null,
  property_id bigint not null references public.properties (id),
  amount_eur numeric(12, 2) not null check (amount_eur > 0),
  currency text not null default 'EUR',
  payment_at timestamptz not null,
  payment_date date not null,
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  payer_name text not null,
  payer_details jsonb not null default '{}'::jsonb,
  payment_method text,
  external_refs jsonb not null default '{}'::jsonb,
  purpose_lines jsonb not null,
  note text,
  is_advance boolean not null default false,
  recorded_by_email text not null,
  recorded_by_name text,
  owner_email_at_issue text,
  apartment_number text not null,
  party_snapshot jsonb not null,
  missing_uk_fields text[] not null default '{}',
  storage_path text,
  pdf_sha256 text,
  pdf_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_receipts_module_ledger_uidx unique (source_module, ledger_id),
  constraint payment_receipts_series_number_uidx unique (series, number)
);

create index if not exists payment_receipts_property_idx
  on public.payment_receipts (property_id, issued_at desc);
create index if not exists payment_receipts_status_idx
  on public.payment_receipts (status);

alter table public.payment_receipts enable row level security;
alter table public.payment_receipt_intents enable row level security;
alter table public.payment_receipt_sequences enable row level security;

revoke all on table public.payment_receipts from public, anon;
revoke all on table public.payment_receipt_intents from public, anon;
revoke all on table public.payment_receipt_sequences from public, anon;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_payment_receipts()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_staff_role('администрация')
      or public.has_staff_role('бухгалтер');
$fn$;

revoke all on function public.can_manage_payment_receipts() from public, anon;
grant execute on function public.can_manage_payment_receipts() to authenticated;

create or replace function public.can_read_payment_receipt(p_receipt public.payment_receipts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.can_manage_payment_receipts()
    or (
      public.owns_property(p_receipt.property_id)
      and p_receipt.owner_email_at_issue is not null
      and lower(nullif(btrim(auth.email()), '')) = lower(p_receipt.owner_email_at_issue)
    );
$fn$;

revoke all on function public.can_read_payment_receipt(public.payment_receipts) from public, anon;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to authenticated;

drop policy if exists payment_receipts_select on public.payment_receipts;
create policy payment_receipts_select on public.payment_receipts
  for select to authenticated
  using (public.can_read_payment_receipt(payment_receipts));

-- No direct insert/update/delete for clients — RPCs only.
grant select on table public.payment_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- UK completeness
-- ---------------------------------------------------------------------------

create or replace function public.payment_receipt_missing_uk_fields(p_snapshot jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_mgmt jsonb := coalesce(p_snapshot -> 'management_company', '{}'::jsonb);
  v_complex jsonb := coalesce(p_snapshot -> 'complex', '{}'::jsonb);
  v_missing text[] := '{}';
begin
  if nullif(btrim(coalesce(v_mgmt ->> 'legal_name', '')), '') is null then
    v_missing := array_append(v_missing, 'mgmt_legal_name');
  end if;
  if nullif(btrim(coalesce(v_mgmt ->> 'registration_number', '')), '') is null then
    v_missing := array_append(v_missing, 'mgmt_registration_number');
  end if;
  if nullif(btrim(coalesce(v_mgmt ->> 'registered_address', '')), '') is null then
    v_missing := array_append(v_missing, 'mgmt_registered_address');
  end if;
  if nullif(btrim(coalesce(v_complex ->> 'display_name', '')), '') is null then
    v_missing := array_append(v_missing, 'complex_display_name');
  end if;
  if nullif(btrim(coalesce(v_complex ->> 'address', '')), '') is null
     and (
       nullif(btrim(coalesce(v_complex ->> 'address_street', '')), '') is null
       or nullif(btrim(coalesce(v_complex ->> 'address_city', '')), '') is null
     ) then
    v_missing := array_append(v_missing, 'complex_address');
  end if;
  return v_missing;
end;
$fn$;

revoke all on function public.payment_receipt_missing_uk_fields(jsonb) from public, anon;
grant execute on function public.payment_receipt_missing_uk_fields(jsonb) to authenticated;

create or replace function public.payment_receipt_service_label_bg(p_module text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_module
    when 'water' then 'Водоснабдяване'
    when 'electricity' then 'Електроенергия'
    when 'internet' then 'Интернет'
    when 'support_fee' then 'Такса поддръжка'
    when 'capital_repair' then 'Капитален ремонт'
    else p_module
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- Allocate unique number (never reuse)
-- ---------------------------------------------------------------------------

create or replace function public.payment_receipt_allocate_number(p_series text default 'KP')
returns table (out_series text, out_number bigint, out_number_display text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_series text := coalesce(nullif(btrim(p_series), ''), 'KP');
  v_num bigint;
begin
  insert into public.payment_receipt_sequences as s (series, next_number)
  values (v_series, 1)
  on conflict (series) do nothing;

  update public.payment_receipt_sequences as s
     set next_number = s.next_number + 1
   where s.series = v_series
   returning s.next_number - 1 into v_num;

  if v_num is null then
    raise exception 'payment_receipt: sequence missing' using errcode = 'P0001';
  end if;

  return query
  select v_series, v_num, (v_series || '-' || lpad(v_num::text, 6, '0'));
end;
$fn$;

revoke all on function public.payment_receipt_allocate_number(text) from public, anon;

-- ---------------------------------------------------------------------------
-- Core ensure (idempotent per module+ledger)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_payment_receipt_for_ledger(
  p_source_module text,
  p_ledger_id text,
  p_property_id bigint,
  p_amount_eur numeric,
  p_note text,
  p_recorded_by_email text,
  p_payment_at timestamptz,
  p_idempotency_key uuid default null,
  p_payer_name text default null,
  p_payment_method text default null,
  p_external_refs jsonb default null,
  p_is_advance boolean default null,
  p_purpose_override text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_existing public.payment_receipts%rowtype;
  v_prop public.properties%rowtype;
  v_snap jsonb;
  v_missing text[];
  v_intent public.payment_receipt_intents%rowtype;
  v_payer text;
  v_method text;
  v_refs jsonb;
  v_advance boolean;
  v_purpose text;
  v_staff_name text;
  v_out_series text;
  v_out_number bigint;
  v_out_display text;
  v_status text;
  v_lines jsonb;
  v_id uuid;
begin
  if p_source_module is null or p_ledger_id is null or p_property_id is null then
    raise exception 'payment_receipt: invalid args' using errcode = '22023';
  end if;

  select r.* into v_existing
  from public.payment_receipts as r
  where r.source_module = p_source_module
    and r.ledger_id = p_ledger_id;
  if found then
    return v_existing.id;
  end if;

  select p.* into v_prop from public.properties as p where p.id = p_property_id;
  if not found then
    raise exception 'payment_receipt: property not found' using errcode = 'P0002';
  end if;

  begin
    v_snap := public.building_party_snapshot();
  exception
    when others then
      v_snap := jsonb_build_object(
        'captured_at', now(),
        'complex', '{}'::jsonb,
        'management_company', '{}'::jsonb,
        'bank_accounts', '[]'::jsonb,
        'snapshot_error', sqlerrm
      );
  end;

  v_missing := public.payment_receipt_missing_uk_fields(v_snap);

  if p_idempotency_key is not null then
    select i.* into v_intent
    from public.payment_receipt_intents as i
    where i.idempotency_key = p_idempotency_key
      and i.expires_at > now();
  end if;

  v_payer := nullif(btrim(coalesce(p_payer_name, v_intent.payer_name, v_prop.owner_name, v_prop.owner_email, '')), '');
  if v_payer is null then
    v_payer := 'Платец';
  end if;
  v_method := nullif(btrim(coalesce(p_payment_method, v_intent.payment_method, '')), '');
  v_refs := coalesce(p_external_refs, v_intent.external_refs, '{}'::jsonb);
  v_advance := coalesce(p_is_advance, v_intent.is_advance, false);
  v_purpose := nullif(btrim(coalesce(p_purpose_override, v_intent.purpose_override, '')), '');

  select s.name into v_staff_name
  from public.staff as s
  where lower(coalesce(s.email, '')) = lower(coalesce(p_recorded_by_email, ''))
  order by s.id
  limit 1;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'service_code', p_source_module,
      'service_label_bg', public.payment_receipt_service_label_bg(p_source_module),
      'description_bg', coalesce(
        v_purpose,
        case when v_advance then 'Авансово плащане — ' || public.payment_receipt_service_label_bg(p_source_module)
             else public.payment_receipt_service_label_bg(p_source_module)
        end
      ),
      'period', null,
      'amount_eur', round(p_amount_eur, 2),
      'is_advance', v_advance
    )
  );

  v_status := case when cardinality(v_missing) > 0 then 'pending_details' else 'pending_pdf' end;

  select a.out_series, a.out_number, a.out_number_display
    into v_out_series, v_out_number, v_out_display
  from public.payment_receipt_allocate_number('KP') as a;

  insert into public.payment_receipts (
    series, number, number_display, status,
    source_module, ledger_id, property_id,
    amount_eur, currency, payment_at, payment_date, issued_at,
    payer_name, payer_details, payment_method, external_refs,
    purpose_lines, note, is_advance,
    recorded_by_email, recorded_by_name, owner_email_at_issue, apartment_number,
    party_snapshot, missing_uk_fields
  ) values (
    v_out_series, v_out_number, v_out_display, v_status,
    p_source_module, p_ledger_id, p_property_id,
    round(p_amount_eur, 2), 'EUR', p_payment_at, (p_payment_at at time zone 'Europe/Sofia')::date, now(),
    v_payer,
    jsonb_build_object(
      'defaulted_from_owner', (p_payer_name is null and (v_intent.payer_name is null)),
      'owner_name', v_prop.owner_name,
      'owner_email', v_prop.owner_email
    ),
    v_method, v_refs, v_lines, nullif(btrim(coalesce(p_note, '')), ''), v_advance,
    p_recorded_by_email, v_staff_name, nullif(btrim(coalesce(v_prop.owner_email, '')), ''),
    coalesce(nullif(btrim(coalesce(v_prop.apartment_number, '')), ''), v_prop.id::text),
    v_snap, v_missing
  )
  returning id into v_id;

  if p_idempotency_key is not null then
    delete from public.payment_receipt_intents where idempotency_key = p_idempotency_key;
  end if;

  return v_id;
exception
  when unique_violation then
    select r.id into v_id
    from public.payment_receipts as r
    where r.source_module = p_source_module
      and r.ledger_id = p_ledger_id;
    if v_id is null then
      raise;
    end if;
    return v_id;
end;
$fn$;

revoke all on function public.ensure_payment_receipt_for_ledger(
  text, text, bigint, numeric, text, text, timestamptz, uuid, text, text, jsonb, boolean, text
) from public, anon;

-- ---------------------------------------------------------------------------
-- Triggers on payment ledger inserts
-- ---------------------------------------------------------------------------

create or replace function public.trg_payment_receipt_from_water_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind is distinct from 'payment' then
    return new;
  end if;
  perform public.ensure_payment_receipt_for_ledger(
    'water', new.id::text, new.property_id, new.amount_eur, new.note,
    new.recorded_by_email, new.created_at, new.idempotency_key
  );
  return new;
end;
$fn$;

drop trigger if exists trg_payment_receipt_water on public.water_ledger;
create trigger trg_payment_receipt_water
  after insert on public.water_ledger
  for each row execute function public.trg_payment_receipt_from_water_ledger();

create or replace function public.trg_payment_receipt_from_electricity_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind is distinct from 'payment' then
    return new;
  end if;
  perform public.ensure_payment_receipt_for_ledger(
    'electricity', new.id::text, new.property_id, new.amount_eur, new.note,
    new.recorded_by_email, new.created_at, new.idempotency_key
  );
  return new;
end;
$fn$;

drop trigger if exists trg_payment_receipt_electricity on public.electricity_ledger;
create trigger trg_payment_receipt_electricity
  after insert on public.electricity_ledger
  for each row execute function public.trg_payment_receipt_from_electricity_ledger();

create or replace function public.trg_payment_receipt_from_internet_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind is distinct from 'payment' then
    return new;
  end if;
  perform public.ensure_payment_receipt_for_ledger(
    'internet', new.id::text, new.property_id, new.amount_eur, new.note,
    new.recorded_by_email, new.created_at, new.idempotency_key
  );
  return new;
end;
$fn$;

drop trigger if exists trg_payment_receipt_internet on public.internet_ledger;
create trigger trg_payment_receipt_internet
  after insert on public.internet_ledger
  for each row execute function public.trg_payment_receipt_from_internet_ledger();

create or replace function public.trg_payment_receipt_from_capital_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind is distinct from 'payment' then
    return new;
  end if;
  perform public.ensure_payment_receipt_for_ledger(
    'capital_repair', new.id::text, new.property_id, new.amount_eur, new.note,
    new.recorded_by_email, new.created_at, new.idempotency_key
  );
  return new;
end;
$fn$;

drop trigger if exists trg_payment_receipt_capital on public.capital_repair_ledger;
create trigger trg_payment_receipt_capital
  after insert on public.capital_repair_ledger
  for each row execute function public.trg_payment_receipt_from_capital_ledger();

create or replace function public.trg_payment_receipt_from_support_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_key uuid;
begin
  if new.kind = 'payment' then
    v_email := coalesce(nullif(btrim(coalesce(new.recorded_by, '')), ''), nullif(btrim(auth.email()), ''), 'staff');
    begin
      v_key := nullif(btrim(coalesce(new.idempotency_key::text, '')), '')::uuid;
    exception
      when others then
        v_key := null;
    end;
    perform public.ensure_payment_receipt_for_ledger(
      'support_fee', new.id::text, new.property_id, new.amount, new.note,
      v_email, new.created_at, v_key
    );
  elsif new.kind = 'payment_reversal' and new.reverses_ledger_id is not null then
    update public.payment_receipts as r
       set status = 'voided',
           voided_at = coalesce(r.voided_at, now()),
           void_reason = coalesce(nullif(btrim(coalesce(new.reversal_reason, new.note, '')), ''), 'Анулиране на плащане'),
           updated_at = now()
     where r.source_module = 'support_fee'
       and r.ledger_id = new.reverses_ledger_id::text
       and r.status is distinct from 'voided';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_payment_receipt_support on public.support_fee_ledger;
create trigger trg_payment_receipt_support
  after insert on public.support_fee_ledger
  for each row execute function public.trg_payment_receipt_from_support_ledger();

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

create or replace function public.prepare_payment_receipt_intent(
  p_idempotency_key uuid,
  p_payer_name text default null,
  p_payment_method text default null,
  p_external_refs jsonb default null,
  p_is_advance boolean default false,
  p_purpose_override text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.can_manage_payment_receipts() then
    raise exception 'Not authorized.';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  insert into public.payment_receipt_intents as i (
    idempotency_key, payer_name, payment_method, external_refs, is_advance, purpose_override, created_by_email, expires_at
  ) values (
    p_idempotency_key,
    nullif(btrim(coalesce(p_payer_name, '')), ''),
    nullif(btrim(coalesce(p_payment_method, '')), ''),
    coalesce(p_external_refs, '{}'::jsonb),
    coalesce(p_is_advance, false),
    nullif(btrim(coalesce(p_purpose_override, '')), ''),
    v_email,
    now() + interval '2 hours'
  )
  on conflict (idempotency_key) do update
    set payer_name = excluded.payer_name,
        payment_method = excluded.payment_method,
        external_refs = excluded.external_refs,
        is_advance = excluded.is_advance,
        purpose_override = excluded.purpose_override,
        created_by_email = excluded.created_by_email,
        expires_at = excluded.expires_at;

  return p_idempotency_key;
end;
$fn$;

revoke all on function public.prepare_payment_receipt_intent(uuid, text, text, jsonb, boolean, text)
  from public, anon;
grant execute on function public.prepare_payment_receipt_intent(uuid, text, text, jsonb, boolean, text)
  to authenticated;

create or replace function public.get_payment_receipt(p_receipt_id uuid)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
begin
  select r.* into v_row from public.payment_receipts as r where r.id = p_receipt_id;
  if not found then
    raise exception 'payment_receipt: not found' using errcode = 'P0002';
  end if;
  if not public.can_read_payment_receipt(v_row) then
    raise exception 'Not authorized.';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.get_payment_receipt(uuid) from public, anon;
grant execute on function public.get_payment_receipt(uuid) to authenticated;

create or replace function public.get_payment_receipt_for_ledger(
  p_source_module text,
  p_ledger_id text
)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
begin
  select r.* into v_row
  from public.payment_receipts as r
  where r.source_module = p_source_module
    and r.ledger_id = p_ledger_id;
  if not found then
    return null;
  end if;
  if not public.can_read_payment_receipt(v_row) then
    raise exception 'Not authorized.';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.get_payment_receipt_for_ledger(text, text) from public, anon;
grant execute on function public.get_payment_receipt_for_ledger(text, text) to authenticated;

create or replace function public.list_payment_receipts_for_property(p_property_id bigint)
returns setof public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_property_id is null then
    raise exception 'payment_receipt: property required' using errcode = '22023';
  end if;
  if not (
    public.can_manage_payment_receipts()
    or public.owns_property(p_property_id)
  ) then
    raise exception 'Not authorized.';
  end if;

  return query
  select r.*
  from public.payment_receipts as r
  where r.property_id = p_property_id
    and public.can_read_payment_receipt(r)
  order by r.issued_at desc, r.number desc;
end;
$fn$;

revoke all on function public.list_payment_receipts_for_property(bigint) from public, anon;
grant execute on function public.list_payment_receipts_for_property(bigint) to authenticated;

create or replace function public.issue_payment_receipt_for_existing_payment(
  p_source_module text,
  p_ledger_id text,
  p_payer_name text default null,
  p_payment_method text default null,
  p_external_refs jsonb default null,
  p_is_advance boolean default false,
  p_purpose_override text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_amount numeric;
  v_note text;
  v_property_id bigint;
  v_recorded text;
  v_payment_at timestamptz;
  v_kind text;
begin
  if v_email is null or not public.can_manage_payment_receipts() then
    raise exception 'Not authorized.';
  end if;

  if p_source_module = 'water' then
    select l.amount_eur, l.note, l.property_id, l.recorded_by_email, l.created_at, l.kind
      into v_amount, v_note, v_property_id, v_recorded, v_payment_at, v_kind
    from public.water_ledger as l where l.id::text = p_ledger_id;
  elsif p_source_module = 'electricity' then
    select l.amount_eur, l.note, l.property_id, l.recorded_by_email, l.created_at, l.kind
      into v_amount, v_note, v_property_id, v_recorded, v_payment_at, v_kind
    from public.electricity_ledger as l where l.id::text = p_ledger_id;
  elsif p_source_module = 'internet' then
    select l.amount_eur, l.note, l.property_id, l.recorded_by_email, l.created_at, l.kind
      into v_amount, v_note, v_property_id, v_recorded, v_payment_at, v_kind
    from public.internet_ledger as l where l.id::text = p_ledger_id;
  elsif p_source_module = 'capital_repair' then
    select l.amount_eur, l.note, l.property_id, l.recorded_by_email, l.created_at, l.kind
      into v_amount, v_note, v_property_id, v_recorded, v_payment_at, v_kind
    from public.capital_repair_ledger as l where l.id::text = p_ledger_id;
  elsif p_source_module = 'support_fee' then
    select l.amount, l.note, l.property_id, l.recorded_by, l.created_at, l.kind
      into v_amount, v_note, v_property_id, v_recorded, v_payment_at, v_kind
    from public.support_fee_ledger as l where l.id::text = p_ledger_id;
  else
    raise exception 'payment_receipt: unknown module' using errcode = '22023';
  end if;

  if v_property_id is null then
    raise exception 'payment_receipt: payment not found' using errcode = 'P0002';
  end if;
  if v_kind is distinct from 'payment' then
    raise exception 'payment_receipt: not a payment row' using errcode = '22023';
  end if;

  return public.ensure_payment_receipt_for_ledger(
    p_source_module, p_ledger_id, v_property_id, v_amount, v_note,
    coalesce(v_recorded, v_email), v_payment_at, null,
    p_payer_name, p_payment_method, p_external_refs, p_is_advance, p_purpose_override
  );
end;
$fn$;

revoke all on function public.issue_payment_receipt_for_existing_payment(text, text, text, text, jsonb, boolean, text)
  from public, anon;
grant execute on function public.issue_payment_receipt_for_existing_payment(text, text, text, text, jsonb, boolean, text)
  to authenticated;

create or replace function public.refresh_payment_receipt_party_snapshot(p_receipt_id uuid)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
  v_snap jsonb;
  v_missing text[];
begin
  if not public.can_manage_payment_receipts() then
    raise exception 'Not authorized.';
  end if;
  select r.* into v_row from public.payment_receipts as r where r.id = p_receipt_id for update;
  if not found then
    raise exception 'payment_receipt: not found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('pending_details', 'failed', 'pending_pdf') then
    raise exception 'payment_receipt: snapshot locked' using errcode = 'P0001';
  end if;
  if v_row.status = 'voided' then
    raise exception 'payment_receipt: voided' using errcode = 'P0001';
  end if;

  v_snap := public.building_party_snapshot();
  v_missing := public.payment_receipt_missing_uk_fields(v_snap);

  update public.payment_receipts as r
     set party_snapshot = v_snap,
         missing_uk_fields = v_missing,
         status = case when cardinality(v_missing) > 0 then 'pending_details' else 'pending_pdf' end,
         pdf_error = case when cardinality(v_missing) > 0 then r.pdf_error else null end,
         updated_at = now()
   where r.id = p_receipt_id
   returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.refresh_payment_receipt_party_snapshot(uuid) from public, anon;
grant execute on function public.refresh_payment_receipt_party_snapshot(uuid) to authenticated;

create or replace function public.finalize_payment_receipt_pdf(
  p_receipt_id uuid,
  p_storage_path text,
  p_pdf_sha256 text
)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_sha text := lower(nullif(btrim(coalesce(p_pdf_sha256, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  select r.* into v_row from public.payment_receipts as r where r.id = p_receipt_id for update;
  if not found then
    raise exception 'payment_receipt: not found' using errcode = 'P0002';
  end if;
  if not public.can_read_payment_receipt(v_row) then
    raise exception 'Not authorized.';
  end if;
  if v_row.status = 'voided' then
    raise exception 'payment_receipt: voided' using errcode = 'P0001';
  end if;
  if cardinality(v_row.missing_uk_fields) > 0 then
    raise exception 'payment_receipt: uk details incomplete' using errcode = 'P0001';
  end if;
  if v_path is null or v_path not like 'payment-receipts/' || v_row.property_id::text || '/' || v_row.id::text || '.pdf' then
    raise exception 'payment_receipt: invalid storage path' using errcode = '22023';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'payment_receipt: invalid sha256' using errcode = '22023';
  end if;

  -- Idempotent finalize: same path+sha keeps ready.
  if v_row.status = 'ready'
     and v_row.storage_path = v_path
     and v_row.pdf_sha256 = v_sha then
    return v_row;
  end if;

  update public.payment_receipts as r
     set status = 'ready',
         storage_path = v_path,
         pdf_sha256 = v_sha,
         pdf_error = null,
         updated_at = now()
   where r.id = p_receipt_id
   returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.finalize_payment_receipt_pdf(uuid, text, text) from public, anon;
grant execute on function public.finalize_payment_receipt_pdf(uuid, text, text) to authenticated;

create or replace function public.mark_payment_receipt_pdf_failed(
  p_receipt_id uuid,
  p_error text
)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
begin
  if not public.can_manage_payment_receipts() then
    raise exception 'Not authorized.';
  end if;
  select r.* into v_row from public.payment_receipts as r where r.id = p_receipt_id for update;
  if not found then
    raise exception 'payment_receipt: not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'voided' then
    return v_row;
  end if;
  if v_row.status = 'ready' and v_row.storage_path is not null then
    return v_row;
  end if;

  update public.payment_receipts as r
     set status = 'failed',
         pdf_error = left(coalesce(nullif(btrim(p_error), ''), 'pdf_failed'), 500),
         updated_at = now()
   where r.id = p_receipt_id
   returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.mark_payment_receipt_pdf_failed(uuid, text) from public, anon;
grant execute on function public.mark_payment_receipt_pdf_failed(uuid, text) to authenticated;

create or replace function public.payment_receipt_storage_path(p_receipt_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payment_receipts%rowtype;
begin
  select r.* into v_row from public.payment_receipts as r where r.id = p_receipt_id;
  if not found then
    raise exception 'payment_receipt: not found' using errcode = 'P0002';
  end if;
  if not public.can_read_payment_receipt(v_row) then
    raise exception 'Not authorized.';
  end if;
  return 'payment-receipts/' || v_row.property_id::text || '/' || v_row.id::text || '.pdf';
end;
$fn$;

revoke all on function public.payment_receipt_storage_path(uuid) from public, anon;
grant execute on function public.payment_receipt_storage_path(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket + policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts', 'payment-receipts', false, 10485760,
  array['application/pdf']
)
on conflict (id) do update
  set public = false,
      name = excluded.name,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_write_payment_receipt_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
  v_receipt_id uuid;
  v_row public.payment_receipts%rowtype;
begin
  if p_name is null or position('..' in p_name) > 0 then
    return false;
  end if;
  if p_name !~ '^payment-receipts/[0-9]+/[0-9a-f-]{36}\.pdf$' then
    return false;
  end if;
  v_property_id := split_part(p_name, '/', 2)::bigint;
  v_receipt_id := replace(split_part(p_name, '/', 3), '.pdf', '')::uuid;
  select r.* into v_row from public.payment_receipts as r where r.id = v_receipt_id;
  if not found then
    return false;
  end if;
  if v_row.property_id is distinct from v_property_id then
    return false;
  end if;
  return public.can_read_payment_receipt(v_row)
    and v_row.status in ('pending_pdf', 'failed', 'pending_details', 'ready');
end;
$fn$;

create or replace function public.can_read_payment_receipt_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_receipt_id uuid;
  v_row public.payment_receipts%rowtype;
begin
  if p_name is null or position('..' in p_name) > 0 then
    return false;
  end if;
  if p_name !~ '^payment-receipts/[0-9]+/[0-9a-f-]{36}\.pdf$' then
    return false;
  end if;
  v_receipt_id := replace(split_part(p_name, '/', 3), '.pdf', '')::uuid;
  select r.* into v_row from public.payment_receipts as r where r.id = v_receipt_id;
  if not found then
    return false;
  end if;
  return public.can_read_payment_receipt(v_row);
end;
$fn$;

revoke all on function public.can_write_payment_receipt_object(text) from public, anon;
revoke all on function public.can_read_payment_receipt_object(text) from public, anon;
grant execute on function public.can_write_payment_receipt_object(text) to authenticated;
grant execute on function public.can_read_payment_receipt_object(text) to authenticated;

drop policy if exists payment_receipts_storage_select on storage.objects;
create policy payment_receipts_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and public.can_read_payment_receipt_object(name)
  );

drop policy if exists payment_receipts_storage_insert on storage.objects;
create policy payment_receipts_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and public.can_write_payment_receipt_object(name)
  );

drop policy if exists payment_receipts_storage_update on storage.objects;
create policy payment_receipts_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'payment-receipts'
    and public.can_write_payment_receipt_object(name)
  )
  with check (
    bucket_id = 'payment-receipts'
    and public.can_write_payment_receipt_object(name)
  );

commit;
