-- Task 08 — Support Fee: waive late increase (documented exception).
-- - Keeps late pricing snapshot; reduces remaining_due by waiveable penalty portion.
-- - Requires non-empty reason; stamps admin + timestamp; append-only ledger kind.
-- - Does not reprice or rewrite historical charges.

begin;

alter table public.support_fee_assessments
  add column if not exists penalty_waive_reason text null;

alter table public.support_fee_assessments
  add column if not exists penalty_waived_at timestamptz null;

alter table public.support_fee_assessments
  add column if not exists penalty_waived_by_email text null;

alter table public.support_fee_assessments
  add column if not exists penalty_waive_ledger_id bigint null
    references public.support_fee_ledger (id);

comment on column public.support_fee_assessments.penalty_waive_reason is
  'Task 08: mandatory basis for accepting settlement without late increase.';
comment on column public.support_fee_assessments.penalty_waived_at is
  'Task 08: when late increase was waived.';
comment on column public.support_fee_assessments.penalty_waived_by_email is
  'Task 08: staff who waived late increase.';
comment on column public.support_fee_assessments.penalty_waive_ledger_id is
  'Task 08: append-only late_increase_waive ledger row.';

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
        'assessment_restore'::text,
        'opening_obligation'::text,
        'opening_historical_settlement'::text,
        'opening_credit'::text,
        'late_increase_waive'::text
      ]
    )
  );

comment on constraint support_fee_ledger_kind_chk on public.support_fee_ledger is
  'Task 08 adds late_increase_waive — documented accept-without-penalty exception.';

create or replace function public.waive_support_fee_late_increase(
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
  v_email text := auth.email();
  v_reason text;
  v_a public.support_fee_assessments;
  v_existing public.support_fee_ledger;
  v_debt numeric;
  v_over numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_waive numeric;
  v_ledger_id bigint;
  v_remaining numeric;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'waive_support_fee_late_increase: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'waive_support_fee_late_increase: not allowed' using errcode = '42501';
  end if;
  if p_assessment_id is null or p_idempotency_key is null then
    raise exception 'waive_support_fee_late_increase: assessment and idempotency key required'
      using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'waive_support_fee_late_increase: reason required' using errcode = '22023';
  end if;

  select l.* into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'late_increase_waive' then
      raise exception 'waive_support_fee_late_increase: idempotency key conflict'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'assessment_id', p_assessment_id,
      'waive_ledger_id', v_existing.id,
      'waived_amount', v_existing.amount,
      'idempotent', true,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after
    );
  end if;

  select * into v_a
  from public.support_fee_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'waive_support_fee_late_increase: assessment not found'
      using errcode = 'P0002';
  end if;
  if coalesce(v_a.opening_import, false) then
    raise exception 'waive_support_fee_late_increase: opening_import blocks waive'
      using errcode = 'P0001';
  end if;

  if v_a.penalty_waived_at is not null then
    raise exception 'waive_support_fee_late_increase: already waived' using errcode = '22023';
  end if;
  if v_a.status is distinct from 'open' then
    raise exception 'waive_support_fee_late_increase: assessment must be open'
      using errcode = '22023';
  end if;
  if v_a.pricing_rule is distinct from 'late' then
    raise exception 'waive_support_fee_late_increase: only late assessments'
      using errcode = '22023';
  end if;
  if coalesce(v_a.increase_percent, 0) <= 0 then
    raise exception 'waive_support_fee_late_increase: no late increase on assessment'
      using errcode = '22023';
  end if;

  v_remaining := greatest(0, round(coalesce(v_a.remaining_due, 0), 2));
  v_waive := least(
    v_remaining,
    greatest(0, round(coalesce(v_a.late_amount, 0) - coalesce(v_a.base_amount, 0), 2))
  );
  if v_waive <= 0 then
    raise exception 'waive_support_fee_late_increase: nothing to waive' using errcode = '22023';
  end if;

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = v_a.property_id
  for update;

  if v_waive <= v_debt then
    v_new_debt := round(v_debt - v_waive, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := v_over;
  end if;

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
  ) values (
    v_a.property_id,
    'late_increase_waive',
    v_waive,
    v_a.billing_year::text,
    'WAIVE late increase ' || p_assessment_id::text || ': ' || v_reason,
    btrim(v_email),
    v_new_debt,
    v_new_over,
    p_idempotency_key,
    v_reason
  )
  returning id into v_ledger_id;

  update public.support_fee_assessments
     set remaining_due = greatest(0, round(remaining_due - v_waive, 2)),
         status = case
           when remaining_due - v_waive <= 0 then 'paid'
           else status
         end,
         penalty_waive_reason = v_reason,
         penalty_waived_at = now(),
         penalty_waived_by_email = btrim(v_email),
         penalty_waive_ledger_id = v_ledger_id
   where id = p_assessment_id;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = v_a.property_id;

  return jsonb_build_object(
    'assessment_id', p_assessment_id,
    'waive_ledger_id', v_ledger_id,
    'waived_amount', v_waive,
    'remaining_due', greatest(0, round(v_remaining - v_waive, 2)),
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false
  );
end;
$fn$;

revoke all on function public.waive_support_fee_late_increase(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.waive_support_fee_late_increase(uuid, text, uuid)
  to authenticated;

comment on function public.waive_support_fee_late_increase(uuid, text, uuid) is
  'Task 08: accept settlement without late increase; reason required; append-only audit.';

commit;
