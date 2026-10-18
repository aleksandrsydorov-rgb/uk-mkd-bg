-- =============================================================================
-- R1-CR FINAL — Capital Repair bulk / year-bulk charge RPCs (canonical)
-- =============================================================================
-- Sources (unchanged semantics):
--   20260926194000_capital_repair_tariff_charge_cutover.sql → charge_capital_repair_bulk
--   20260926196000_capital_charge_year_bulk_simplify.sql → ensure + year_bulk
-- Depends on: capital_repair_* tables, resolve_capital_tariff_for_year (85),
--   has_staff_role, building_modules, unique (property_id, assessment_id) charge.
-- Does NOT invent new tariff policy, auto-publish tariffs, or mass billing outside
-- the approved assessment+ledger charge model.
-- Idempotency: ON CONFLICT DO NOTHING on existing charge per property+assessment.
-- Atomic transaction: all inserts succeed or whole call rolls back; skips reported.
-- =============================================================================

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

  v_title := 'Капитальный ремонт ' || p_billing_year::text;
  v_decision := make_date(p_billing_year, 1, 1);

  select a.id into v_id
  from public.capital_repair_assessments as a
  where a.status = 'active'
    and (
      a.title = v_title
      or extract(year from a.decision_date)::int = p_billing_year
    )
  order by case when a.title = v_title then 0 else 1 end, a.created_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.capital_repair_assessments (
    title, description, decision_date, due_date, status, created_by_email
  ) values (
    v_title,
    'Автоматическое решение для начисления по тарифу ' || p_billing_year::text,
    least(v_decision, (now() at time zone 'Europe/Sofia')::date),
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
  v_module_enabled boolean;
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

  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year) as r;

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
    'skipped_existing', v_skipped,
    'not_applied', 0,
    'assessment_id', p_assessment_id,
    'billing_year', p_billing_year,
    'amount_eur', v_amount
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from public;
revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text) to authenticated;

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
begin
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

comment on function public.charge_capital_repair_bulk(uuid, integer, text) is
  'R1-CR: charge all apartments for one active assessment from resolve_capital_tariff_for_year; skips existing property+assessment charges.';

comment on function public.charge_capital_repair_year_bulk(integer, text) is
  'R1-CR: ensure year assessment then charge_capital_repair_bulk. Requires published capital tariff for year.';
