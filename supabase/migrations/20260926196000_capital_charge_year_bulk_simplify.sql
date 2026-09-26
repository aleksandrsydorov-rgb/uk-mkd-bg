-- Charge all apartments for a billing year from capital Tariff Core.
-- Auto-ensures one active assessment titled for that year (grouping key).
-- Duplicate control: existing charge for property+assessment is skipped.

begin;

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

create or replace function public.get_capital_repair_fund_totals()
returns table (
  charged_eur numeric,
  paid_eur numeric,
  balance_eur numeric,
  apartments_with_debt integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_capital_repair_fund_totals: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'get_capital_repair_fund_totals: not allowed'
      using errcode = '42501';
  end if;

  return query
  with agg as (
    select
      round(coalesce(sum(case when l.kind = 'charge' then l.amount_eur else 0 end), 0), 2) as charged,
      round(coalesce(sum(case when l.kind = 'payment' then l.amount_eur else 0 end), 0), 2) as paid,
      round(coalesce(sum(
        case
          when l.kind = 'charge' then l.amount_eur
          when l.kind = 'payment' then -l.amount_eur
          when l.kind = 'adjustment_debit' then l.amount_eur
          when l.kind = 'adjustment_credit' then -l.amount_eur
          else 0
        end
      ), 0), 2) as bal
    from public.capital_repair_ledger as l
  ),
  by_prop as (
    select
      l.property_id,
      round(coalesce(sum(
        case
          when l.kind = 'charge' then l.amount_eur
          when l.kind = 'payment' then -l.amount_eur
          when l.kind = 'adjustment_debit' then l.amount_eur
          when l.kind = 'adjustment_credit' then -l.amount_eur
          else 0
        end
      ), 0), 2) as bal
    from public.capital_repair_ledger as l
    group by l.property_id
  )
  select
    a.charged,
    a.paid,
    a.bal,
    (select count(*)::int from by_prop as p where p.bal > 0)
  from agg as a;
end;
$fn$;

revoke all on function public.get_capital_repair_fund_totals() from public;
revoke all on function public.get_capital_repair_fund_totals() from anon;
grant execute on function public.get_capital_repair_fund_totals() to authenticated;

commit;
