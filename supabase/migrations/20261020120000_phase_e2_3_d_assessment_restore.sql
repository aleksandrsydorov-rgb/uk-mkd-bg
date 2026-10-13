-- Phase E2.3-D — auditable restore of incorrectly voided Support Fee assessments
-- Append-only compensating ledger (assessment_restore). Preserves charge + void history.
-- PREPARED — do not apply until coordinated Safe Release. Do not restore incident 99405 here.

begin;

-- ---------------------------------------------------------------------------
-- Schema: ledger kind + assessment restore audit
-- ---------------------------------------------------------------------------

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
        'assessment_void'::text,
        'assessment_restore'::text
      ]
    )
  );

comment on column public.support_fee_ledger.reverses_ledger_id is
  'When kind=payment_reversal → payment ledger; when kind=assessment_restore → assessment_void ledger. Unique.';

alter table public.support_fee_assessments
  add column if not exists restore_reason text null;

alter table public.support_fee_assessments
  add column if not exists restored_at timestamptz null;

alter table public.support_fee_assessments
  add column if not exists restored_by_email text null;

alter table public.support_fee_assessments
  add column if not exists restore_ledger_id bigint null
    references public.support_fee_ledger (id);

comment on column public.support_fee_assessments.restore_reason is
  'E2.3-D: reason for reopening a voided assessment; void_* columns remain as permanent audit.';
comment on column public.support_fee_assessments.restore_ledger_id is
  'E2.3-D: compensating assessment_restore ledger row.';

-- ---------------------------------------------------------------------------
-- restore_support_fee_assessment
-- ---------------------------------------------------------------------------

create or replace function public.restore_support_fee_assessment(
  p_assessment_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_expected_property_id bigint
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
  v_void public.support_fee_ledger;
  v_existing public.support_fee_ledger;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_restore numeric;
  v_restore_id bigint;
  v_pay_alloc numeric;
  v_credit_alloc numeric;
  v_sibling int;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'restore_support_fee_assessment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'restore_support_fee_assessment: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'restore_support_fee_assessment: idempotency key is required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'restore_support_fee_assessment: reason required'
      using errcode = '22023';
  end if;

  if p_assessment_id is null then
    raise exception 'restore_support_fee_assessment: assessment id required'
      using errcode = '22023';
  end if;

  if p_expected_property_id is null then
    raise exception 'restore_support_fee_assessment: expected property id required'
      using errcode = '22023';
  end if;

  select a.* into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'restore_support_fee_assessment: not found'
      using errcode = 'P0002';
  end if;

  if v_a.property_id is distinct from p_expected_property_id then
    raise exception
      'restore_support_fee_assessment: property mismatch — assessment belongs to property % but expected %',
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
    raise exception 'restore_support_fee_assessment: property not found'
      using errcode = '22023';
  end if;

  -- Idempotent replay via idempotency key.
  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'assessment_restore'
       or v_existing.property_id is distinct from v_a.property_id then
      raise exception 'restore_support_fee_assessment: idempotency key conflict'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'restore_ledger_id', v_existing.id,
      'assessment_id', p_assessment_id,
      'status', 'open',
      'idempotent', true,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after,
      'property_id', v_a.property_id,
      'restored_remaining_due', v_existing.amount
    );
  end if;

  if v_a.status is distinct from 'void' then
    raise exception 'restore_support_fee_assessment: assessment is not void'
      using errcode = '22023';
  end if;

  if v_a.restored_at is not null or v_a.restore_ledger_id is not null then
    raise exception 'restore_support_fee_assessment: already restored'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(al.amount) filter (where al.allocation_type = 'payment'), 0),
    coalesce(sum(al.amount) filter (where al.allocation_type = 'credit'), 0)
    into v_pay_alloc, v_credit_alloc
  from public.support_fee_allocations as al
  where al.assessment_id = p_assessment_id;

  if coalesce(v_a.applied_payment_amount, 0) > 0
     or coalesce(v_a.applied_credit_amount, 0) > 0
     or v_pay_alloc > 0
     or v_credit_alloc > 0 then
    raise exception
      'restore_support_fee_assessment: blocked — assessment has payments or credits; restore rule not defined'
      using errcode = '22023';
  end if;

  -- Competing active assessment for same apartment/year would violate active-year uidx.
  select count(*)::int into v_sibling
  from public.support_fee_assessments as s
  where s.property_id = v_a.property_id
    and s.billing_year = v_a.billing_year
    and s.id is distinct from p_assessment_id
    and s.status is distinct from 'void'
    and s.status is distinct from 'corrected';

  if coalesce(v_sibling, 0) > 0 then
    raise exception
      'restore_support_fee_assessment: blocked — another active assessment exists for this apartment/year'
      using errcode = '22023';
  end if;

  select l.* into v_void
  from public.support_fee_ledger as l
  where l.property_id = v_a.property_id
    and l.kind = 'assessment_void'
    and l.note like ('VOID assessment ' || p_assessment_id::text || '%')
  order by l.id desc
  limit 1
  for update;

  if not found then
    raise exception 'restore_support_fee_assessment: void ledger not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.support_fee_ledger as r
    where r.reverses_ledger_id = v_void.id
  ) then
    raise exception 'restore_support_fee_assessment: void already restored'
      using errcode = '22023';
  end if;

  v_restore := greatest(0, round(coalesce(v_void.amount, 0), 2));
  if v_restore <= 0 then
    raise exception 'restore_support_fee_assessment: nothing to restore'
      using errcode = '22023';
  end if;

  -- Inverse of unpaid void: put outstanding back onto portal debt cache.
  v_new_debt := round(v_debt + v_restore, 2);
  v_new_over := v_over;
  if v_new_debt < 0 or v_new_over < 0 then
    raise exception 'restore_support_fee_assessment: invalid balance result'
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
      v_a.property_id,
      'assessment_restore',
      v_restore,
      v_a.billing_year::text,
      'RESTORE assessment ' || p_assessment_id::text
        || ' (void ledger ' || v_void.id::text || '): ' || v_reason,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key,
      v_void.id,
      v_reason
    )
    returning id into v_restore_id;
  exception
    when unique_violation then
      -- Concurrent restore of the same void ledger (reverses_ledger_id uidx) or key race.
      select l.* into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key
         or l.reverses_ledger_id = v_void.id
      order by l.id
      limit 1;

      if not found or v_existing.kind is distinct from 'assessment_restore' then
        raise exception 'restore_support_fee_assessment: concurrent restore conflict'
          using errcode = '22023';
      end if;

      return jsonb_build_object(
        'restore_ledger_id', v_existing.id,
        'assessment_id', p_assessment_id,
        'status', 'open',
        'idempotent', true,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after,
        'property_id', v_a.property_id,
        'restored_remaining_due', v_existing.amount,
        'void_ledger_id', v_void.id
      );
  end;

  update public.support_fee_assessments
     set remaining_due = v_restore,
         status = 'open',
         restore_reason = v_reason,
         restored_at = now(),
         restored_by_email = btrim(v_email),
         restore_ledger_id = v_restore_id
   where id = p_assessment_id
     and property_id = p_expected_property_id
     and status = 'void'
     and restored_at is null;

  if not found then
    raise exception 'restore_support_fee_assessment: concurrent status change'
      using errcode = '22023';
  end if;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'restore_ledger_id', v_restore_id,
    'void_ledger_id', v_void.id,
    'assessment_id', p_assessment_id,
    'status', 'open',
    'restored_remaining_due', v_restore,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false,
    'property_id', v_a.property_id
  );
end;
$fn$;

revoke all on function public.restore_support_fee_assessment(uuid, text, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.restore_support_fee_assessment(uuid, text, uuid, bigint)
  to authenticated;

commit;
