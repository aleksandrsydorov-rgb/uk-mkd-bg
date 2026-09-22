-- =============================================================================
-- AMADEUS 11 — capital repair RPC (SECURITY DEFINER)
-- =============================================================================
-- Writes via RPC only. Does not change support_fee, properties.debt,
-- meter_readings, or existing helpers.
-- Authorization: public.has_staff_role(...) — never a client-supplied role.
-- Empty staff.role is not администрация (enforced inside has_staff_role).
-- This file has no BEGIN/COMMIT.
--
-- OWNER A: create/charge/payment DENY; get_capital_repair_balance own ALLOW.
-- ADMIN / ACCOUNTANT: assessment, charge, payment, balance ALLOW.
-- ENGINEER / CLEANER: all capital finance RPC DENY.
-- =============================================================================

create or replace function public.create_capital_repair_assessment(
  p_title text,
  p_description text default null,
  p_decision_date date default current_date,
  p_due_date date default null
)
returns setof public.capital_repair_assessments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_title text;
  v_description text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'Title is required.';
  end if;

  if p_decision_date is null then
    raise exception 'Decision date is required.';
  end if;

  if p_decision_date > current_date then
    raise exception 'Decision date cannot be in the future.';
  end if;

  if p_due_date is not null and p_due_date < p_decision_date then
    raise exception 'Due date cannot be earlier than decision date.';
  end if;

  v_description := nullif(btrim(coalesce(p_description, '')), '');

  return query
  insert into public.capital_repair_assessments (
    title,
    description,
    decision_date,
    due_date,
    status,
    created_by_email
  )
  values (
    v_title,
    v_description,
    p_decision_date,
    p_due_date,
    'active',
    v_email
  )
  returning *;
end;
$$;

revoke all on function public.create_capital_repair_assessment(text, text, date, date) from public;
revoke all on function public.create_capital_repair_assessment(text, text, date, date) from anon;
grant execute on function public.create_capital_repair_assessment(text, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------

create or replace function public.charge_capital_repair(
  p_property_id bigint,
  p_assessment_id uuid,
  p_amount_eur numeric,
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
as $$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_status text;
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

  if p_assessment_id is null then
    raise exception 'Assessment not found.';
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

  perform 1
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.';
  end if;

  select a.status
    into v_status
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
    select 1
    from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = p_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'Capital repair charge already exists for this property and assessment.';
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
      p_assessment_id,
      'charge',
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
$$;

revoke all on function public.charge_capital_repair(bigint, uuid, numeric, text, uuid) from public;
revoke all on function public.charge_capital_repair(bigint, uuid, numeric, text, uuid) from anon;
grant execute on function public.charge_capital_repair(bigint, uuid, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------

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
    select 1
    from public.properties as p
    where p.id = p_property_id
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
  from public.capital_repair_ledger as l
  where l.property_id = p_property_id;
end;
$$;

revoke all on function public.get_capital_repair_balance(bigint) from public;
revoke all on function public.get_capital_repair_balance(bigint) from anon;
grant execute on function public.get_capital_repair_balance(bigint) to authenticated;
