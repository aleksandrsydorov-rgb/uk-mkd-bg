-- =============================================================================
-- IS-9b — Tariff Core versions / rate schema + capital charge resolver
-- =============================================================================
-- Creates tariff_versions + tariff_rate_items WITHOUT inserting published prices.
-- decision_id is uuid without FK until general_meeting_decisions exists
-- (FK attached conditionally). Admin publish remains a later UI/RPC step.
-- =============================================================================

create table if not exists public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null
    references public.tariff_catalog (id)
    on delete restrict,
  valid_from date not null,
  status text not null
    constraint tariff_versions_status_check
      check (status in ('published', 'cancelled')),
  basis_type text not null
    constraint tariff_versions_basis_type_check
      check (basis_type in (
        'general_meeting',
        'external_decision',
        'supplier_notice',
        'invoice',
        'other',
        'legacy_import'
      )),
  basis_reference text null,
  basis_date date null,
  basis_note text not null
    constraint tariff_versions_basis_note_nonempty
      check (length(btrim(basis_note)) > 0),
  decision_id uuid null,
  published_at timestamptz not null default now(),
  published_by uuid null,
  legacy_author text null,
  idempotency_key uuid not null,
  payload_fingerprint text not null,
  cancelled_at timestamptz null,
  cancelled_by uuid null,
  cancellation_reason text null,
  cancellation_idempotency_key uuid null,
  constraint tariff_versions_idempotency_key_key unique (idempotency_key),
  constraint tariff_versions_cancellation_idempotency_key_key unique (cancellation_idempotency_key),
  constraint tariff_versions_published_no_cancel_fields check (
    status <> 'published'
    or (
      cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null
      and cancellation_idempotency_key is null
    )
  ),
  constraint tariff_versions_cancelled_fields check (
    status <> 'cancelled'
    or (
      cancelled_at is not null
      and cancelled_by is not null
      and cancellation_reason is not null
      and length(btrim(cancellation_reason)) > 0
      and cancellation_idempotency_key is not null
    )
  )
);

comment on table public.tariff_versions is
  'Published/cancelled tariff versions. Fresh-install: schema only — no published price rows.';

create unique index if not exists tariff_versions_one_published_per_valid_from_uidx
  on public.tariff_versions (tariff_id, valid_from)
  where status = 'published';

create index if not exists tariff_versions_history_idx
  on public.tariff_versions (tariff_id, valid_from desc, id desc);

create index if not exists tariff_versions_decision_id_idx
  on public.tariff_versions (decision_id);

-- Attach GM FK when decisions table already exists (else chronological migrations may add it).
do $$
begin
  if to_regclass('public.general_meeting_decisions') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'tariff_versions_decision_id_fkey'
     ) then
    alter table public.tariff_versions
      add constraint tariff_versions_decision_id_fkey
      foreign key (decision_id)
      references public.general_meeting_decisions (id)
      on delete restrict;
  end if;
end $$;

create table if not exists public.tariff_rate_items (
  version_id uuid not null
    references public.tariff_versions (id)
    on delete restrict,
  component_key text not null,
  rate numeric(12, 4) not null
    constraint tariff_rate_items_rate_nonneg check (rate >= 0),
  primary key (version_id, component_key)
);

comment on table public.tariff_rate_items is
  'Atomic rate components per tariff version. Empty on fresh install.';

alter table public.tariff_versions enable row level security;
alter table public.tariff_rate_items enable row level security;

revoke all on table public.tariff_versions from public, anon, authenticated;
revoke all on table public.tariff_rate_items from public, anon, authenticated;
grant select on table public.tariff_versions to authenticated;
grant select on table public.tariff_rate_items to authenticated;

do $$
begin
  if to_regprocedure('public.tariff_can_view()') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'tariff_versions'
        and policyname = 'tariff_versions_select'
    ) then
      create policy tariff_versions_select on public.tariff_versions
      for select to authenticated
      using (public.tariff_can_view());
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'tariff_rate_items'
        and policyname = 'tariff_rate_items_select'
    ) then
      create policy tariff_rate_items_select on public.tariff_rate_items
      for select to authenticated
      using (public.tariff_can_view());
    end if;
  end if;
end $$;

-- Internal resolvers (not granted to clients) — required by capital charge path
create or replace function public.resolve_tariff_version_by_date(
  p_tariff_id uuid,
  p_on_date date
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_tariff_id is null or p_on_date is null then
    raise exception 'resolve_tariff_version_by_date: arguments required' using errcode = '22023';
  end if;

  select tv.id into v_id
  from public.tariff_versions as tv
  where tv.tariff_id = p_tariff_id
    and tv.status = 'published'
    and tv.valid_from <= p_on_date
  order by tv.valid_from desc, tv.id desc
  limit 1;

  if v_id is null then
    raise exception 'resolve_tariff_version_by_date: no matching version'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.resolve_tariff_version_by_date(uuid, date) from public;
revoke all on function public.resolve_tariff_version_by_date(uuid, date) from anon;
revoke all on function public.resolve_tariff_version_by_date(uuid, date) from authenticated;

create or replace function public.resolve_support_tariff_version_by_year(
  p_tariff_id uuid,
  p_billing_year integer
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_from date;
begin
  if p_tariff_id is null or p_billing_year is null then
    raise exception 'resolve_support_tariff_version_by_year: arguments required'
      using errcode = '22023';
  end if;
  if p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_support_tariff_version_by_year: invalid year' using errcode = '22023';
  end if;
  v_from := make_date(p_billing_year, 1, 1);
  return public.resolve_tariff_version_by_date(p_tariff_id, v_from);
end;
$fn$;

revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from public;
revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from anon;
revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from authenticated;

create or replace function public.resolve_capital_tariff_for_year(
  p_billing_year integer
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cat_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_amount numeric;
begin
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_capital_tariff_for_year: invalid billing year'
      using errcode = '22023';
  end if;

  select c.id
    into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'capital_repair'
    and c.active is true;

  if v_cat_id is null then
    raise exception 'resolve_capital_tariff_for_year: capital_repair catalog missing'
      using errcode = 'P0002';
  end if;

  begin
    v_version_id := public.resolve_support_tariff_version_by_year(v_cat_id, p_billing_year);
  exception
    when sqlstate 'P0002' then
      raise exception 'No capital repair tariff configured for billing year %', p_billing_year
        using errcode = 'P0002';
  end;

  select tv.valid_from
    into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id
    and tv.status = 'published';

  if v_valid_from is null then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  select ri.rate
    into v_amount
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base';

  if v_amount is null or v_amount <= 0 then
    raise exception 'resolve_capital_tariff_for_year: invalid amount'
      using errcode = '22023';
  end if;

  if (
    select count(*)::int
    from public.tariff_rate_items as ri
    where ri.version_id = v_version_id
  ) <> 1 then
    raise exception 'resolve_capital_tariff_for_year: expected exactly one rate component'
      using errcode = '22023';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  amount_eur := round(v_amount, 2);
  return next;
end;
$fn$;

revoke all on function public.resolve_capital_tariff_for_year(integer) from public;
revoke all on function public.resolve_capital_tariff_for_year(integer) from anon;
revoke all on function public.resolve_capital_tariff_for_year(integer) from authenticated;

create or replace function public.get_applicable_capital_tariff(
  p_billing_year integer default null
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric,
  billing_year integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_applicable_capital_tariff: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'get_applicable_capital_tariff: not allowed'
      using errcode = '42501';
  end if;

  v_year := coalesce(
    p_billing_year,
    extract(year from (now() at time zone 'Europe/Sofia'))::integer
  );

  return query
  select
    r.tariff_version_id,
    r.valid_from,
    r.amount_eur,
    v_year
  from public.resolve_capital_tariff_for_year(v_year) as r;
end;
$fn$;

revoke all on function public.get_applicable_capital_tariff(integer) from public;
revoke all on function public.get_applicable_capital_tariff(integer) from anon;
grant execute on function public.get_applicable_capital_tariff(integer) to authenticated;

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

revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from public;
revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from anon;
grant execute on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) to authenticated;
