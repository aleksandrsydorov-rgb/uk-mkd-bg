-- R1-RC8: Capital repair tariff overview/charge must accept dual subject rates
-- (natural + legal) published at first-run activation.
--
-- Root cause: resolve_capital_tariff_for_year(integer) required exactly one
-- tariff_rate_items row. First-run always inserts natural+legal, so
-- get_applicable_capital_tariff failed and the UI showed «Нет тарифа на этот год»
-- even though a published mid-year version existed (valid_from = activation date).
--
-- Version selection stays on tariff_version_for_billing_year (shared with Tariffs /
-- Support Fee). No republication of unchanged rates. No charges created here.

begin;

-- Restore subject-aware single-arg wrapper (same pattern as support_fee).
create or replace function public.resolve_capital_tariff_for_year(p_billing_year integer)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select *
  from public.resolve_capital_tariff_for_year(p_billing_year, 'natural');
$fn$;

revoke all on function public.resolve_capital_tariff_for_year(integer) from public, anon, authenticated;

-- Overview RPC: return both subject rates + shared version metadata.
drop function if exists public.get_applicable_capital_tariff(integer);

create function public.get_applicable_capital_tariff(
  p_billing_year integer default null
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric,
  rate_natural_eur numeric,
  rate_legal_eur numeric,
  billing_year integer,
  currency text,
  unit_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
  v_email text := nullif(btrim(auth.email()), '');
  v_cat_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_natural numeric;
  v_legal numeric;
  v_currency text;
  v_unit text;
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

  select c.id, c.currency, c.unit_code
    into v_cat_id, v_currency, v_unit
  from public.tariff_catalog as c
  where c.tariff_key = 'capital_repair'
    and c.active is true;

  if v_cat_id is null then
    return;
  end if;

  v_version_id := public.tariff_version_for_billing_year(v_cat_id, v_year);
  if v_version_id is null then
    return;
  end if;

  select tv.valid_from
    into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id
    and tv.status = 'published'
    and tv.cancelled_at is null;

  if v_valid_from is null then
    return;
  end if;

  select ri.rate into v_natural
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base'
    and ri.subject_kind = 'natural';

  select ri.rate into v_legal
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base'
    and ri.subject_kind = 'legal';

  if v_natural is null or v_natural <= 0 then
    return;
  end if;

  if v_legal is null or v_legal <= 0 then
    v_legal := v_natural;
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  amount_eur := round(v_natural, 2);
  rate_natural_eur := round(v_natural, 2);
  rate_legal_eur := round(v_legal, 2);
  billing_year := v_year;
  currency := coalesce(v_currency, 'EUR');
  unit_code := coalesce(v_unit, 'item');
  return next;
end;
$fn$;

revoke all on function public.get_applicable_capital_tariff(integer) from public, anon;
grant execute on function public.get_applicable_capital_tariff(integer) to authenticated;

comment on function public.get_applicable_capital_tariff(integer) is
  'Published capital_repair tariff for a billing year via tariff_version_for_billing_year. Returns natural+legal rates; amount_eur = natural for backward compat.';

-- Keep TABLE return shape; only switch rate resolve to property subject_kind.
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
  v_subject text;
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

  v_subject := coalesce(public.property_tariff_subject_kind(p_property_id), 'natural');
  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year, v_subject) as r;

  if v_amount is null or v_amount <= 0 then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

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

revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from public, anon;
grant execute on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) to authenticated;

-- Bulk: per-property subject rate via the same resolver as overview/preview.
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
  v_subject text;
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

  -- Shared year selector must find a published version before charging anyone.
  perform 1
  from public.resolve_capital_tariff_for_year(p_billing_year, 'natural') as r;

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

    v_subject := coalesce(public.property_tariff_subject_kind(v_id), 'natural');
    select r.amount_eur into v_amount
    from public.resolve_capital_tariff_for_year(p_billing_year, v_subject) as r;

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

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from public, anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text) to authenticated;

commit;
