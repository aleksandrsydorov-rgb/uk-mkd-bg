-- =============================================================================
-- MTR-4 — Utility balance / payment RPC packaging (Distribution R1.0)
-- =============================================================================
-- Canonical sources:
--   get_water_balance ← legacy water_rpc / live types (5-column balance)
--   record_electricity_payment / get_electricity_balance ← electricity_finance_hotfix
-- Auth aligned with has_staff_role (same as record_water_payment).
-- No seeds. No charge invention. Additive create-or-replace only.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.water_ledger') is null
     or to_regclass('public.electricity_ledger') is null then
    raise exception 'mtr4: utility ledgers missing';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null
     or to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'mtr4: auth helpers missing';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- get_water_balance
-- ---------------------------------------------------------------------------

create or replace function public.get_water_balance(
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
as $fn$
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
    coalesce(sum(l.amount_eur) filter (where l.kind = 'charge'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'payment'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'adjustment_debit'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'adjustment_credit'), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
      - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
    )::numeric(12, 2)
  from public.water_ledger as l
  where l.property_id = p_property_id;
end;
$fn$;

revoke all on function public.get_water_balance(bigint) from public, anon;
grant execute on function public.get_water_balance(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- record_electricity_payment
-- ---------------------------------------------------------------------------

create or replace function public.record_electricity_payment(
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
as $fn$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_row public.electricity_ledger%rowtype;
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

  select l.* into v_row
  from public.electricity_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.kind is distinct from 'payment'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;
    return query
    select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  begin
    insert into public.electricity_ledger (
      property_id, charge_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, null, 'payment', v_amount, v_note, v_email, p_idempotency_key
    )
    returning * into v_row;
  exception
    when unique_violation then
      select l.* into v_row
      from public.electricity_ledger as l
      where l.idempotency_key = p_idempotency_key;
      if not found then
        raise;
      end if;
      if v_row.property_id is distinct from p_property_id
         or v_row.kind is distinct from 'payment'
         or v_row.amount_eur is distinct from v_amount
         or v_row.note is distinct from v_note then
        raise exception 'Idempotency key conflict.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$fn$;

revoke all on function public.record_electricity_payment(bigint, numeric, text, uuid)
  from public, anon;
grant execute on function public.record_electricity_payment(bigint, numeric, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- get_electricity_balance
-- ---------------------------------------------------------------------------

create or replace function public.get_electricity_balance(
  p_property_id bigint
)
returns table (
  charged_eur numeric,
  paid_eur numeric,
  adjustments_debit_eur numeric,
  adjustments_credit_eur numeric,
  balance_eur numeric,
  debt_eur numeric,
  overpayment_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
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
    coalesce(sum(l.amount_eur) filter (where l.kind = 'charge'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'payment'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'adjustment_debit'), 0)::numeric(12, 2),
    coalesce(sum(l.amount_eur) filter (where l.kind = 'adjustment_credit'), 0)::numeric(12, 2),
    (
      coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
      - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
    )::numeric(12, 2),
    greatest(
      (
        coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
        - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
      ),
      0
    )::numeric(12, 2),
    greatest(
      -(
        coalesce(sum(l.amount_eur) filter (where l.kind in ('charge', 'adjustment_debit')), 0)
        - coalesce(sum(l.amount_eur) filter (where l.kind in ('payment', 'adjustment_credit')), 0)
      ),
      0
    )::numeric(12, 2)
  from public.electricity_ledger as l
  where l.property_id = p_property_id;
end;
$fn$;

revoke all on function public.get_electricity_balance(bigint) from public, anon;
grant execute on function public.get_electricity_balance(bigint) to authenticated;

commit;
