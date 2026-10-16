-- =============================================================================
-- IS-9b — Capital Repair operational RPCs (canonical)
-- =============================================================================
-- Sources:
--   record_capital_repair_payment — legacy capital_repair_rpc.sql (not in migrations/)
--   get_capital_repair_balance / fund_totals — IS-8 opening-compatible semantics
--   resolve_capital_tariff_for_year + charge_capital_repair — tariff cutover migration
-- Depends on: capital_repair_* tables, owns_property, has_staff_role, tariff resolvers.
-- Does NOT invent Support Fee opening mechanisms.
-- =============================================================================

create or replace function public.record_capital_repair_payment(
  p_property_id bigint,
  p_amount_eur numeric,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  amount_eur numeric,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_row public.capital_repair_ledger%rowtype;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if p_amount_eur is null then
    raise exception 'Amount must be greater than zero.';
  end if;

  v_amount := round(p_amount_eur, 2);
  if v_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.*
    into v_row
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is not null
       or v_row.kind is distinct from 'payment'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;

    return query
    select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  begin
    insert into public.capital_repair_ledger (
      property_id,
      assessment_id,
      kind,
      amount_eur,
      note,
      recorded_by_email,
      idempotency_key
    )
    values (
      p_property_id,
      null,
      'payment',
      v_amount,
      v_note,
      v_email,
      p_idempotency_key
    )
    returning * into v_row;
  exception
    when unique_violation then
      select l.*
        into v_row
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_row.property_id is distinct from p_property_id
         or v_row.assessment_id is not null
         or v_row.kind is distinct from 'payment'
         or v_row.amount_eur is distinct from v_amount
         or v_row.note is distinct from v_note then
        raise exception 'Idempotency key conflict.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$$;

revoke all on function public.record_capital_repair_payment(bigint, numeric, text, uuid) from public;
revoke all on function public.record_capital_repair_payment(bigint, numeric, text, uuid) from anon;
grant execute on function public.record_capital_repair_payment(bigint, numeric, text, uuid) to authenticated;

create or replace function public.get_capital_repair_balance(
  p_property_id bigint
)
returns table (
  charged_eur numeric,
  paid_eur numeric,
  adjustments_debit_eur numeric,
  adjustments_credit_eur numeric,
  balance_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if p_property_id is null then
    raise exception 'Property not found.';
  end if;

  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from public.properties as p where p.id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  return query
  select
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('charge', 'opening_obligation')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('payment', 'opening_historical_settlement')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind = 'adjustment_debit'
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('adjustment_credit', 'opening_credit')
    ), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (
        where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
      ), 0)
      - coalesce(sum(l.amount_eur) filter (
        where l.kind in (
          'payment',
          'opening_historical_settlement',
          'adjustment_credit',
          'opening_credit'
        )
      ), 0)
    )::numeric(12, 2)
  from public.capital_repair_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_capital_repair_balance(bigint) from public;
revoke all on function public.get_capital_repair_balance(bigint) from anon;
grant execute on function public.get_capital_repair_balance(bigint) to authenticated;

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
  with per_apt as (
    select
      l.property_id,
      (
        coalesce(sum(l.amount_eur) filter (
          where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
        ), 0)
        - coalesce(sum(l.amount_eur) filter (
          where l.kind in (
            'payment',
            'opening_historical_settlement',
            'adjustment_credit',
            'opening_credit'
          )
        ), 0)
      )::numeric(12, 2) as bal
    from public.capital_repair_ledger as l
    group by l.property_id
  )
  select
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('charge', 'opening_obligation')
    ), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (
      where l.kind in ('payment', 'opening_historical_settlement')
    ), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (
        where l.kind in ('charge', 'opening_obligation', 'adjustment_debit')
      ), 0)
      - coalesce(sum(l.amount_eur) filter (
        where l.kind in (
          'payment',
          'opening_historical_settlement',
          'adjustment_credit',
          'opening_credit'
        )
      ), 0)
    )::numeric(12, 2),
    (select count(*)::integer from per_apt as a where a.bal > 0)
  from public.capital_repair_ledger as l;
end;
$fn$;

revoke all on function public.get_capital_repair_fund_totals() from public;
revoke all on function public.get_capital_repair_fund_totals() from anon;
grant execute on function public.get_capital_repair_fund_totals() to authenticated;

-- Charge path requires Tariff Core resolvers (packaged in 85_*).
-- Defined here only when resolver already exists; 85 re-creates charge after resolvers.
do $$
begin
  if to_regprocedure('public.resolve_capital_tariff_for_year(integer)') is null then
    raise notice
      'IS-9b: charge_capital_repair deferred until resolve_capital_tariff_for_year exists (85_tariff_versions_schema.sql)';
  end if;
end $$;
