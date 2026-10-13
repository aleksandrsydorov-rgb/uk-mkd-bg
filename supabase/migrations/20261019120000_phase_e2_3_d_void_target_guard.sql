-- Phase E2.3-D — void target guard (wrong-apartment protection)
-- Adds p_expected_property_id: when provided, must match assessment.property_id
-- before any financial mutation. PREPARED — apply only in a coordinated safe release.

begin;

create or replace function public.void_support_fee_assessment(
  p_assessment_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_expected_property_id bigint default null
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

  -- E2.3-D: reject mismatched apartment/property before any mutation.
  if p_expected_property_id is null then
    raise exception 'void_support_fee_assessment: expected property id required'
      using errcode = '22023';
  end if;
  if v_a.property_id is distinct from p_expected_property_id then
    raise exception
      'void_support_fee_assessment: property mismatch — assessment belongs to property % but expected %',
      v_a.property_id, p_expected_property_id
      using errcode = '22023';
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
      'overpayment', v_existing.overpayment_after,
      'property_id', v_a.property_id
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

  if v_due <= v_debt then
    v_new_debt := round(v_debt - v_due, 2);
    v_new_over := v_over;
  else
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
        'overpayment', v_existing.overpayment_after,
        'property_id', v_a.property_id
      );
  end;

  update public.support_fee_assessments
     set remaining_due = 0,
         status = 'void',
         void_reason = v_reason,
         voided_at = now(),
         voided_by_email = btrim(v_email)
   where id = p_assessment_id
     and property_id = p_expected_property_id;

  if not found then
    raise exception 'void_support_fee_assessment: property mismatch on update'
      using errcode = '22023';
  end if;

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
    'property_id', v_a.property_id,
    'note', 're_finalize_same_year_blocked_while_charge_ledger_exists'
  );
end;
$fn$;

revoke all on function public.void_support_fee_assessment(uuid, text, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.void_support_fee_assessment(uuid, text, uuid, bigint)
  to authenticated;

-- Keep 3-arg overload callable only if PostgREST still resolves it; redirect to guarded path
-- by requiring expected property (callers must migrate). Drop old 3-arg after deploy window.
drop function if exists public.void_support_fee_assessment(uuid, text, uuid);

commit;
