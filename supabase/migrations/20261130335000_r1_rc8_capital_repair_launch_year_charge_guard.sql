-- Capital repair: block new operational charges for billing_year <= complex_launch_year.
-- First allowed charge year = launch_year + 1 (same rule as support fee).
-- Opening inventarisation years remain independent (opening_import_blocks_charge unchanged).
-- Existing ledger rows for the launch year are left as-is; only new charges are blocked.

begin;

-- ---------------------------------------------------------------------------
-- Helpers (reuse public.complex_launch_year from 20261130334000)
-- ---------------------------------------------------------------------------

create or replace function public.capital_repair_min_charge_year()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when public.complex_launch_year() is null then null
    else public.complex_launch_year() + 1
  end;
$fn$;

comment on function public.capital_repair_min_charge_year() is
  'First billing year allowed for a new operational capital-repair charge (= launch_year + 1).';

revoke all on function public.capital_repair_min_charge_year() from public;
revoke all on function public.capital_repair_min_charge_year() from anon;
grant execute on function public.capital_repair_min_charge_year() to authenticated;
grant execute on function public.capital_repair_min_charge_year() to service_role;

create or replace function public.capital_repair_launch_year_blocks(p_billing_year integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    p_billing_year is not null
    and public.complex_launch_year() is not null
    and p_billing_year <= public.complex_launch_year();
$fn$;

revoke all on function public.capital_repair_launch_year_blocks(integer) from public;
revoke all on function public.capital_repair_launch_year_blocks(integer) from anon;
grant execute on function public.capital_repair_launch_year_blocks(integer) to authenticated;
grant execute on function public.capital_repair_launch_year_blocks(integer) to service_role;

create or replace function public.capital_repair_launch_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_launch integer := public.complex_launch_year();
  v_min integer := public.capital_repair_min_charge_year();
begin
  return jsonb_build_object(
    'launch_year', v_launch,
    'min_charge_year', v_min,
    'has_launch_year', v_launch is not null
  );
end;
$fn$;

revoke all on function public.capital_repair_launch_context() from public;
revoke all on function public.capital_repair_launch_context() from anon;
grant execute on function public.capital_repair_launch_context() to authenticated;
grant execute on function public.capital_repair_launch_context() to service_role;

create or replace function public.capital_repair_year_charge_context(p_billing_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_launch integer := public.complex_launch_year();
  v_min integer := public.capital_repair_min_charge_year();
  v_blocked boolean := public.capital_repair_launch_year_blocks(p_billing_year);
  v_title text;
  v_assessment_id uuid;
  v_total int := 0;
  v_charged int := 0;
  v_opening int := 0;
  v_remaining int := 0;
begin
  if v_email is null then
    raise exception 'capital_repair_year_charge_context: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'capital_repair_year_charge_context: not allowed'
      using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'capital_repair_year_charge_context: invalid billing year'
      using errcode = '22023';
  end if;

  v_title := 'Капитальный ремонт ' || p_billing_year::text;

  select a.id into v_assessment_id
  from public.capital_repair_assessments as a
  where a.status = 'active'
    and a.title = v_title
  order by a.created_at desc
  limit 1;

  select count(*)::int into v_total from public.properties;

  if v_assessment_id is not null then
    select count(*)::int into v_charged
    from public.capital_repair_ledger as l
    where l.assessment_id = v_assessment_id
      and l.kind = 'charge';
  end if;

  select count(*)::int into v_opening
  from public.capital_repair_opening_imports as i
  where i.billing_year = p_billing_year
     or (v_assessment_id is not null and i.assessment_id = v_assessment_id);

  if v_blocked then
    v_remaining := 0;
  else
    v_remaining := greatest(0, v_total - v_charged - v_opening);
  end if;

  return jsonb_build_object(
    'billing_year', p_billing_year,
    'launch_year', v_launch,
    'min_charge_year', v_min,
    'blocked', v_blocked,
    'block_reason', case when v_blocked then 'launch_year_blocks_charge' else null end,
    'assessment_id', v_assessment_id,
    'apartments_total', v_total,
    'apartments_charged', v_charged,
    'apartments_opening', v_opening,
    'apartments_remaining', v_remaining
  );
end;
$fn$;

revoke all on function public.capital_repair_year_charge_context(integer) from public;
revoke all on function public.capital_repair_year_charge_context(integer) from anon;
grant execute on function public.capital_repair_year_charge_context(integer) to authenticated;
grant execute on function public.capital_repair_year_charge_context(integer) to service_role;

-- ---------------------------------------------------------------------------
-- ensure: refuse creating/using assessment for blocked years
-- ---------------------------------------------------------------------------

create or replace function public.ensure_capital_repair_year_assessment(
  p_billing_year integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_id uuid;
  v_title text;
  v_decision date;
  v_launch integer;
begin
  if v_email is null then
    raise exception 'ensure_capital_repair_year_assessment: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'ensure_capital_repair_year_assessment: not allowed'
      using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'ensure_capital_repair_year_assessment: invalid year'
      using errcode = '22023';
  end if;

  v_launch := public.complex_launch_year();
  if v_launch is not null and p_billing_year <= v_launch then
    raise exception 'ensure_capital_repair_year_assessment: launch_year_blocks_charge'
      using errcode = 'P0001';
  end if;

  v_title := 'Капитальный ремонт ' || p_billing_year::text;
  -- Keep the billing year in decision_date even for future years so years never cross-match.
  v_decision := make_date(p_billing_year, 1, 1);

  select a.id into v_id
  from public.capital_repair_assessments as a
  where a.status = 'active'
    and a.title = v_title
  order by a.created_at desc
  limit 1;

  if v_id is not null then
    update public.capital_repair_assessments as a
       set decision_date = v_decision
     where a.id = v_id
       and a.decision_date is distinct from v_decision;
    return v_id;
  end if;

  insert into public.capital_repair_assessments (
    title, description, decision_date, due_date, status, created_by_email
  ) values (
    v_title,
    'Автоматическое решение для начисления по тарифу ' || p_billing_year::text,
    v_decision,
    null,
    'active',
    v_email
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.ensure_capital_repair_year_assessment(integer) from public;
revoke all on function public.ensure_capital_repair_year_assessment(integer) from anon;
grant execute on function public.ensure_capital_repair_year_assessment(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- year_bulk: early JSON block (no assessment created)
-- ---------------------------------------------------------------------------

create or replace function public.charge_capital_repair_year_bulk(
  p_billing_year integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assessment_id uuid;
  v_res jsonb;
  v_launch integer := public.complex_launch_year();
begin
  if public.capital_repair_launch_year_blocks(p_billing_year) then
    return jsonb_build_object(
      'total', 0,
      'created', 0,
      'skipped', 0,
      'skipped_existing', 0,
      'not_applied', 0,
      'repriced', 0,
      'opening_import_blocked', 0,
      'launch_year_blocked', true,
      'reason', 'launch_year_blocks_charge',
      'launch_year', v_launch,
      'min_charge_year', public.capital_repair_min_charge_year(),
      'billing_year', p_billing_year,
      'assessment_id', null
    );
  end if;

  v_assessment_id := public.ensure_capital_repair_year_assessment(p_billing_year);
  v_res := public.charge_capital_repair_bulk(
    v_assessment_id,
    p_billing_year,
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Начисление по тарифу ' || p_billing_year::text)
  );
  return v_res || jsonb_build_object('assessment_id', v_assessment_id);
end;
$fn$;

revoke all on function public.charge_capital_repair_year_bulk(integer, text) from public;
revoke all on function public.charge_capital_repair_year_bulk(integer, text) from anon;
grant execute on function public.charge_capital_repair_year_bulk(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- single charge: refuse launch-year billing
-- ---------------------------------------------------------------------------

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
  v_note text;
  v_status text;
  v_row public.capital_repair_ledger%rowtype;
  v_module_enabled boolean;
  v_calc record;
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

  if public.capital_repair_launch_year_blocks(p_billing_year) then
    raise exception 'charge_capital_repair: launch_year_blocks_charge'
      using errcode = 'P0001';
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

  select * into v_calc
  from public.capital_repair_charge_amount_for_year(p_property_id, p_billing_year);

  if v_calc.amount_eur is null or v_calc.amount_eur <= 0 then
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
       or v_row.amount_eur is distinct from v_calc.amount_eur
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
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key,
      area_sqm_snapshot, rate_eur_per_sqm_year_snapshot, tariff_version_id, subject_kind
    ) values (
      p_property_id, p_assessment_id, 'charge', v_calc.amount_eur, v_note, v_email, p_idempotency_key,
      v_calc.area_sqm, v_calc.rate_eur_per_sqm_year, v_calc.tariff_version_id, v_calc.subject_kind
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
           or v_row.amount_eur is distinct from v_calc.amount_eur
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

-- ---------------------------------------------------------------------------
-- bulk: early JSON block when year is launch-blocked
-- ---------------------------------------------------------------------------

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
  v_note text;
  v_status text;
  v_id bigint;
  v_rows int;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_blocked int := 0;
  v_module_enabled boolean;
  v_calc record;
  v_apt text;
  v_launch integer := public.complex_launch_year();
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

  if public.capital_repair_launch_year_blocks(p_billing_year) then
    return jsonb_build_object(
      'total', 0,
      'created', 0,
      'skipped', 0,
      'skipped_existing', 0,
      'not_applied', 0,
      'repriced', 0,
      'opening_import_blocked', 0,
      'launch_year_blocked', true,
      'reason', 'launch_year_blocks_charge',
      'launch_year', v_launch,
      'min_charge_year', public.capital_repair_min_charge_year(),
      'billing_year', p_billing_year,
      'assessment_id', p_assessment_id
    );
  end if;

  -- Ensure a published year tariff exists before locking properties.
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

    if exists (
      select 1 from public.capital_repair_ledger as l
      where l.property_id = v_id
        and l.assessment_id = p_assessment_id
        and l.kind = 'charge'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      select * into v_calc
      from public.capital_repair_charge_amount_for_year(v_id, p_billing_year);
    exception
      when others then
        select nullif(btrim(coalesce(p.apartment_number::text, '')), '') into v_apt
        from public.properties as p where p.id = v_id;
        raise exception 'capital_repair bulk: apartment % — %',
          coalesce(v_apt, v_id::text), SQLERRM
          using errcode = 'P0001';
    end;

    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key,
      area_sqm_snapshot, rate_eur_per_sqm_year_snapshot, tariff_version_id, subject_kind
    ) values (
      v_id, p_assessment_id, 'charge', v_calc.amount_eur, v_note, v_email, pg_catalog.gen_random_uuid(),
      v_calc.area_sqm, v_calc.rate_eur_per_sqm_year, v_calc.tariff_version_id, v_calc.subject_kind
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
    'skipped_existing', v_skipped,
    'not_applied', 0,
    'repriced', 0,
    'opening_import_blocked', v_blocked,
    'assessment_id', p_assessment_id,
    'billing_year', p_billing_year
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from public, anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text) to authenticated;

commit;
