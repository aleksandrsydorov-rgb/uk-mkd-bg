-- Phase E2.3-B — D4-A: Support Fee payment reversal + unpaid assessment void
-- Append-only. No DELETE of financial history. No debt gate / email changes.
-- DO NOT APPLY until operator authorization (prepare-only).

begin;

-- ---------------------------------------------------------------------------
-- Schema: ledger reversal links + kinds
-- ---------------------------------------------------------------------------

alter table public.support_fee_ledger
  add column if not exists reverses_ledger_id bigint null
    references public.support_fee_ledger (id);

alter table public.support_fee_ledger
  add column if not exists reversal_reason text null;

alter table public.support_fee_ledger
  drop constraint if exists support_fee_ledger_kind_chk;

alter table public.support_fee_ledger
  add constraint support_fee_ledger_kind_chk
  check (
    kind = any (
      array[
        'payment'::text,
        'charge'::text,
        'adjustment_debit'::text,
        'adjustment_credit'::text,
        'payment_reversal'::text,
        'assessment_void'::text
      ]
    )
  );

-- At most one reversal row per original ledger entry.
create unique index if not exists support_fee_ledger_reverses_ledger_uidx
  on public.support_fee_ledger (reverses_ledger_id)
  where reverses_ledger_id is not null;

comment on column public.support_fee_ledger.reverses_ledger_id is
  'E2.3-B: when kind=payment_reversal (or assessment_void link), points at original ledger id.';

-- ---------------------------------------------------------------------------
-- Schema: assessment void metadata + status
-- ---------------------------------------------------------------------------

alter table public.support_fee_assessments
  add column if not exists void_reason text null;

alter table public.support_fee_assessments
  add column if not exists voided_at timestamptz null;

alter table public.support_fee_assessments
  add column if not exists voided_by_email text null;

alter table public.support_fee_assessments
  drop constraint if exists support_fee_assessments_status_check;

alter table public.support_fee_assessments
  add constraint support_fee_assessments_status_check
  check (status = any (array['open'::text, 'paid'::text, 'void'::text, 'corrected'::text]));

-- Allow a new active assessment after void (finalize already ignores void/corrected).
alter table public.support_fee_assessments
  drop constraint if exists support_fee_assessments_property_id_billing_year_key;

create unique index if not exists support_fee_assessments_active_year_uidx
  on public.support_fee_assessments (property_id, billing_year)
  where status is distinct from 'void' and status is distinct from 'corrected';

-- ---------------------------------------------------------------------------
-- Schema: allocation reverse audit rows
-- ---------------------------------------------------------------------------

alter table public.support_fee_allocations
  drop constraint if exists support_fee_allocations_allocation_type_check;

alter table public.support_fee_allocations
  add constraint support_fee_allocations_allocation_type_check
  check (
    allocation_type = any (
      array['payment'::text, 'credit'::text, 'payment_reversal'::text]
    )
  );

-- ---------------------------------------------------------------------------
-- reverse_support_payment
-- ---------------------------------------------------------------------------

create or replace function public.reverse_support_payment(
  p_ledger_id bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_reason text;
  v_pay public.support_fee_ledger;
  v_existing public.support_fee_ledger;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_allocated numeric;
  v_surplus numeric;
  v_take_over numeric;
  v_rev_id bigint;
  v_alloc record;
  v_restored numeric := 0;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'reverse_support_payment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'reverse_support_payment: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'reverse_support_payment: idempotency key is required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'reverse_support_payment: reason required'
      using errcode = '22023';
  end if;

  if p_ledger_id is null then
    raise exception 'reverse_support_payment: ledger id required'
      using errcode = '22023';
  end if;

  select l.* into v_pay
  from public.support_fee_ledger as l
  where l.id = p_ledger_id
  for update;

  if not found then
    raise exception 'reverse_support_payment: payment not found'
      using errcode = 'P0002';
  end if;

  if v_pay.kind is distinct from 'payment' then
    raise exception 'reverse_support_payment: only payment rows can be reversed'
      using errcode = '22023';
  end if;

  -- Serialize apartment balances with the same lock as record_support_payment.
  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_pay.property_id
  for update;

  if not found then
    raise exception 'reverse_support_payment: property not found'
      using errcode = '22023';
  end if;

  -- Idempotent retry by key (must reverse the same payment).
  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'payment_reversal'
       or v_existing.reverses_ledger_id is distinct from p_ledger_id
       or v_existing.property_id is distinct from v_pay.property_id
       or v_existing.amount is distinct from v_pay.amount then
      raise exception 'reverse_support_payment: idempotency key conflict'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'reversal_ledger_id', v_existing.id,
      'original_ledger_id', p_ledger_id,
      'amount', v_existing.amount,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after,
      'idempotent', true
    );
  end if;

  -- Duplicate reversal protection (also enforced by unique index).
  if exists (
    select 1
    from public.support_fee_ledger as l
    where l.reverses_ledger_id = p_ledger_id
      and l.kind = 'payment_reversal'
  ) then
    raise exception 'reverse_support_payment: payment already reversed'
      using errcode = '22023';
  end if;

  select coalesce(sum(a.amount), 0)
    into v_allocated
  from public.support_fee_allocations as a
  where a.ledger_entry_id = p_ledger_id
    and a.allocation_type = 'payment';

  v_allocated := round(v_allocated, 2);
  if v_allocated > v_pay.amount then
    raise exception 'reverse_support_payment: allocation sum exceeds payment'
      using errcode = '22023';
  end if;

  v_surplus := round(v_pay.amount - v_allocated, 2);

  -- Surplus typically sits in overpayment; under-allocated debt pay restores debt.
  v_take_over := least(v_surplus, v_over);
  v_new_over := round(v_over - v_take_over, 2);
  v_new_debt := round(v_debt + v_allocated + (v_surplus - v_take_over), 2);

  if v_new_debt < 0 or v_new_over < 0 then
    raise exception 'reverse_support_payment: invalid balance after reverse'
      using errcode = '22023';
  end if;

  begin
    insert into public.support_fee_ledger (
      property_id,
      kind,
      amount,
      period,
      note,
      recorded_by,
      debt_after,
      overpayment_after,
      idempotency_key,
      reverses_ledger_id,
      reversal_reason
    )
    values (
      v_pay.property_id,
      'payment_reversal',
      v_pay.amount,
      v_pay.period,
      'REVERSAL of payment #' || p_ledger_id::text || ': ' || v_reason,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key,
      p_ledger_id,
      v_reason
    )
    returning id into v_rev_id;
  exception
    when unique_violation then
      select l.* into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key
         or (l.reverses_ledger_id = p_ledger_id and l.kind = 'payment_reversal')
      limit 1;

      if not found then
        raise;
      end if;

      if v_existing.kind is distinct from 'payment_reversal'
         or v_existing.reverses_ledger_id is distinct from p_ledger_id then
        raise exception 'reverse_support_payment: idempotency key conflict'
          using errcode = '22023';
      end if;

      return jsonb_build_object(
        'reversal_ledger_id', v_existing.id,
        'original_ledger_id', p_ledger_id,
        'amount', v_existing.amount,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after,
        'idempotent', true
      );
  end;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_pay.property_id;

  for v_alloc in
    select a.*
    from public.support_fee_allocations as a
    where a.ledger_entry_id = p_ledger_id
      and a.allocation_type = 'payment'
    order by a.created_at, a.id
    for update
  loop
    update public.support_fee_assessments as s
       set remaining_due = round(s.remaining_due + v_alloc.amount, 2),
           applied_payment_amount = greatest(
             0,
             round(s.applied_payment_amount - v_alloc.amount, 2)
           ),
           status = case
             when round(s.remaining_due + v_alloc.amount, 2) > 0 then 'open'
             else s.status
           end
     where s.id = v_alloc.assessment_id
       and s.status is distinct from 'void';

    insert into public.support_fee_allocations (
      assessment_id,
      ledger_entry_id,
      amount,
      allocation_type,
      created_by_email
    )
    values (
      v_alloc.assessment_id,
      v_rev_id,
      v_alloc.amount,
      'payment_reversal',
      btrim(v_email)
    );

    v_restored := round(v_restored + v_alloc.amount, 2);
  end loop;

  return jsonb_build_object(
    'reversal_ledger_id', v_rev_id,
    'original_ledger_id', p_ledger_id,
    'amount', v_pay.amount,
    'allocated_restored', v_restored,
    'surplus_reversed', v_surplus,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false
  );
end;
$fn$;

revoke all on function public.reverse_support_payment(bigint, text, uuid)
  from public, anon, service_role;
grant execute on function public.reverse_support_payment(bigint, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- void_support_fee_assessment (unpaid / no payment-credit applications only)
-- ---------------------------------------------------------------------------

create or replace function public.void_support_fee_assessment(
  p_assessment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_reason text;
  v_a public.support_fee_assessments;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_due numeric;
  v_void_id bigint;
  v_existing public.support_fee_ledger;
  v_pay_alloc numeric;
  v_credit_alloc numeric;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'void_support_fee_assessment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'void_support_fee_assessment: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'void_support_fee_assessment: idempotency key is required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'void_support_fee_assessment: reason required'
      using errcode = '22023';
  end if;

  if p_assessment_id is null then
    raise exception 'void_support_fee_assessment: assessment id required'
      using errcode = '22023';
  end if;

  select a.* into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'void_support_fee_assessment: not found'
      using errcode = 'P0002';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if not found then
    raise exception 'void_support_fee_assessment: property not found'
      using errcode = '22023';
  end if;

  -- Idempotent: prior void ledger for this assessment via note marker + key.
  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'assessment_void'
       or v_existing.property_id is distinct from v_a.property_id then
      raise exception 'void_support_fee_assessment: idempotency key conflict'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'void_ledger_id', v_existing.id,
      'assessment_id', p_assessment_id,
      'status', 'void',
      'idempotent', true,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after
    );
  end if;

  if v_a.status is not distinct from 'void' then
    raise exception 'void_support_fee_assessment: already void'
      using errcode = '22023';
  end if;

  if v_a.status is not distinct from 'corrected' then
    raise exception 'void_support_fee_assessment: corrected assessments cannot be voided'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(a.amount) filter (where a.allocation_type = 'payment'), 0),
    coalesce(sum(a.amount) filter (where a.allocation_type = 'credit'), 0)
    into v_pay_alloc, v_credit_alloc
  from public.support_fee_allocations as a
  where a.assessment_id = p_assessment_id;

  -- D4-A / safety: paid or partially paid / credited assessments are blocked.
  -- Operator must reverse payments first; credit reallocation is not defined.
  if coalesce(v_a.applied_payment_amount, 0) > 0
     or coalesce(v_a.applied_credit_amount, 0) > 0
     or v_pay_alloc > 0
     or v_credit_alloc > 0
     or v_a.status is not distinct from 'paid' then
    raise exception
      'void_support_fee_assessment: blocked — assessment has payments or credits; reverse payments first (reallocation/credit void not defined)'
      using errcode = '22023';
  end if;

  v_due := greatest(0, round(coalesce(v_a.remaining_due, 0), 2));
  if v_due <= 0 then
    raise exception
      'void_support_fee_assessment: blocked — nothing outstanding; paid/zero-due void requires undefined credit handling'
      using errcode = '22023';
  end if;

  -- Unpaid open assessment: remove outstanding from portal debt cache.
  if v_due <= v_debt then
    v_new_debt := round(v_debt - v_due, 2);
    v_new_over := v_over;
  else
    -- Drift guard: clear debt, do not invent overpayment credit from void.
    v_new_debt := 0;
    v_new_over := v_over;
  end if;

  begin
    insert into public.support_fee_ledger (
      property_id,
      kind,
      amount,
      period,
      note,
      recorded_by,
      debt_after,
      overpayment_after,
      idempotency_key,
      reversal_reason
    )
    values (
      v_a.property_id,
      'assessment_void',
      v_due,
      v_a.billing_year::text,
      'VOID assessment ' || p_assessment_id::text || ': ' || v_reason,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key,
      v_reason
    )
    returning id into v_void_id;
  exception
    when unique_violation then
      select l.* into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      return jsonb_build_object(
        'void_ledger_id', v_existing.id,
        'assessment_id', p_assessment_id,
        'status', 'void',
        'idempotent', true,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after
      );
  end;

  update public.support_fee_assessments
     set remaining_due = 0,
         status = 'void',
         void_reason = v_reason,
         voided_at = now(),
         voided_by_email = btrim(v_email)
   where id = p_assessment_id;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'void_ledger_id', v_void_id,
    'assessment_id', p_assessment_id,
    'status', 'void',
    'voided_remaining_due', v_due,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false,
    'note', 're_finalize_same_year_blocked_while_charge_ledger_exists'
  );
end;
$fn$;

revoke all on function public.void_support_fee_assessment(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.void_support_fee_assessment(uuid, text, uuid)
  to authenticated;

commit;
