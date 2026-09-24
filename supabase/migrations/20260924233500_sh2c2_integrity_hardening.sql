-- SH-2C2 integrity hardening.
-- M4: keep direct General Meeting metadata edits, but require lifecycle RPCs
--     for server-controlled state.
-- M5: make support-fee payments payload-bound and idempotent.
-- This migration does not change quorum, voting, attendance, majority,
-- ideal-parts, lifecycle-transition, or finance-calculation semantics.

begin;

-- ---------------------------------------------------------------------------
-- M4. General Meeting lifecycle writes
-- ---------------------------------------------------------------------------

-- The authenticated API may continue to edit only the metadata currently
-- written directly by AdminDocumentsDecisions. RLS still restricts UPDATE to
-- exact active administration. SECURITY DEFINER lifecycle RPCs are owned by
-- postgres and do not depend on this caller grant.
revoke update on table public.general_meetings from public, anon, authenticated;
grant update (
  title,
  description,
  meeting_date,
  meeting_time,
  location,
  meeting_mode,
  is_urgent,
  absentee_voting_enabled,
  online_meeting_url
) on table public.general_meetings to authenticated;

-- Direct client INSERT may supply only draft metadata. Table defaults plus
-- the invoker trigger below keep lifecycle columns at draft-safe values.
-- SECURITY DEFINER RPCs run as the function owner and are not rewritten.
revoke insert on table public.general_meetings from public, anon, authenticated;
grant insert (
  title,
  description,
  meeting_date,
  meeting_time,
  location,
  meeting_mode,
  is_urgent,
  absentee_voting_enabled,
  online_meeting_url
) on table public.general_meetings to authenticated;

create or replace function public.protect_general_meeting_direct_insert()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user is distinct from 'authenticated'
     and current_user is distinct from 'anon' then
    return NEW;
  end if;

  NEW.status := 'draft';
  NEW.operational_phase := 'idle';
  NEW.meeting_can_proceed := false;
  NEW.signed_document_uploaded := false;
  NEW.published_at := null;
  NEW.published_by_email := null;
  NEW.registration_opened_at := null;
  NEW.registration_opened_by_email := null;
  NEW.meeting_started_at := null;
  NEW.meeting_started_by_email := null;
  NEW.meeting_ended_at := null;
  NEW.meeting_ended_by_email := null;
  NEW.invitation_posted_at := null;
  NEW.minutes_completed_at := null;
  NEW.minutes_notice_posted_at := null;
  NEW.cancelled_at := null;
  NEW.cancelled_by_email := null;
  NEW.cancellation_reason := null;
  NEW.reschedule_reason := null;
  NEW.rescheduled_from_meeting_id := null;
  NEW.represented_ideal_parts_percent := null;
  NEW.quorum_stage := null;
  NEW.quorum_rule := 'standard_zues';
  NEW.quorum_rule_note := null;
  NEW.convoked_by := null;
  NEW.absentee_voting_deadline := null;
  NEW.external_registry_ref := null;
  return NEW;
end;
$fn$;

drop trigger if exists trg_protect_general_meeting_direct_insert
on public.general_meetings;

create trigger trg_protect_general_meeting_direct_insert
before insert on public.general_meetings
for each row
execute function public.protect_general_meeting_direct_insert();

revoke all on function public.protect_general_meeting_direct_insert() from public;
revoke execute on function public.protect_general_meeting_direct_insert()
  from anon, authenticated;

-- Restore the existing legal-field lock. It protects metadata that remains
-- column-writable; it does not inspect lifecycle fields and therefore does not
-- block the existing lifecycle RPCs.
create or replace function public.protect_published_meeting_legal_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if OLD.status is not distinct from 'draft' then
    return NEW;
  end if;

  if NEW.meeting_date is distinct from OLD.meeting_date
     or NEW.meeting_time is distinct from OLD.meeting_time
     or NEW.location is distinct from OLD.location
     or NEW.meeting_mode is distinct from OLD.meeting_mode
     or NEW.is_urgent is distinct from OLD.is_urgent then
    raise exception 'general_meetings: published invitation fields cannot be silently updated'
      using errcode = '42501';
  end if;

  if OLD.status in ('held', 'minutes_ready', 'archived', 'cancelled', 'rescheduled') then
    if NEW.title is distinct from OLD.title
       or NEW.absentee_voting_enabled is distinct from OLD.absentee_voting_enabled
       or NEW.absentee_voting_deadline is distinct from OLD.absentee_voting_deadline then
      raise exception 'general_meetings: closed meeting fields are locked'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$fn$;

drop trigger if exists trg_protect_published_meeting_legal_fields
on public.general_meetings;

create trigger trg_protect_published_meeting_legal_fields
before update on public.general_meetings
for each row
execute function public.protect_published_meeting_legal_fields();

revoke all on function public.protect_published_meeting_legal_fields() from public;
revoke execute on function public.protect_published_meeting_legal_fields()
  from anon, authenticated;

-- Preserve the legacy Information-tab action exactly: published -> held,
-- without adding finish_general_meeting's in-progress/open-vote requirements
-- or its closure timestamps.
create or replace function public.mark_general_meeting_held(p_meeting_id uuid)
returns public.general_meetings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.general_meetings;
begin
  if not public.can_manage_building_governance() then
    raise exception 'mark_general_meeting_held: not allowed'
      using errcode = '42501';
  end if;

  update public.general_meetings as m
     set status = 'held'
   where m.id = p_meeting_id
     and m.status = 'published'
  returning m.* into v_row;

  if not found then
    raise exception 'mark_general_meeting_held: published meeting not found'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.mark_general_meeting_held(uuid) from public;
revoke execute on function public.mark_general_meeting_held(uuid) from anon;
grant execute on function public.mark_general_meeting_held(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- M5. Support-payment idempotency
-- ---------------------------------------------------------------------------

alter table public.support_fee_ledger
  add column if not exists idempotency_key uuid;

create unique index if not exists support_fee_ledger_idempotency_key_uidx
  on public.support_fee_ledger (idempotency_key)
  where idempotency_key is not null;

comment on column public.support_fee_ledger.idempotency_key is
  'Caller-generated operation UUID. NULL only for legacy rows.';

-- Remove callable unkeyed paths before creating the keyed signatures.
drop function if exists public.record_support_payment_for_year(
  bigint, numeric, integer, text
);
drop function if exists public.record_support_payment(
  bigint, numeric, text
);

create or replace function public.record_support_payment_internal(
  p_property_id bigint,
  p_amount numeric,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_debt numeric;
  v_over numeric;
  v_pay numeric;
  v_new_debt numeric;
  v_new_over numeric;
  v_note text;
  v_period text;
  v_ledger_id bigint;
  v_debt_paid numeric;
  v_a public.support_fee_assessments;
  v_take numeric;
  v_left numeric;
  v_year integer;
  v_fin jsonb;
  v_existing public.support_fee_ledger;
begin
  v_email := auth.email();
  if v_email is null or btrim(v_email) = '' then
    raise exception 'record_support_payment: authentication required'
      using errcode = '42501';
  end if;

  if not public.can_manage_support_fees() then
    raise exception 'record_support_payment: not allowed'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'record_support_payment: idempotency key is required'
      using errcode = '22023';
  end if;

  if p_amount is null then
    raise exception 'record_support_payment: amount is required'
      using errcode = '22023';
  end if;

  v_pay := round(p_amount, 2);
  if v_pay <= 0 then
    raise exception 'Сумма должна быть больше нуля'
      using errcode = '22023';
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if v_note = '' then
    v_note := 'Оплата таксы поддержки';
  end if;
  v_period := case
    when p_billing_year is null then null
    else p_billing_year::text
  end;

  -- The property lock serializes all balance changes for one apartment. The
  -- idempotency lookup follows the lock, so a retry sees a committed first
  -- attempt before applying any financial effect.
  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = p_property_id
  for update;

  if not found then
    raise exception 'record_support_payment: property not found'
      using errcode = '22023';
  end if;

  select l.*
    into v_existing
  from public.support_fee_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind is distinct from 'payment'
       or v_existing.property_id is distinct from p_property_id
       or v_existing.amount is distinct from v_pay
       or v_existing.period is distinct from v_period
       or coalesce(v_existing.note, '') is distinct from v_note then
      raise exception 'record_support_payment: idempotency key conflict'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'ledger_id', v_existing.id,
      'amount', v_existing.amount,
      'debt', v_existing.debt_after,
      'overpayment', v_existing.overpayment_after,
      'idempotent', true
    );
  end if;

  v_debt_paid := least(v_pay, v_debt);

  if v_pay <= v_debt then
    v_new_debt := round(v_debt - v_pay, 2);
    v_new_over := v_over;
  else
    v_new_debt := 0;
    v_new_over := round(v_over + (v_pay - v_debt), 2);
  end if;

  -- Insert the unique operation identity before any balance, allocation, or
  -- assessment write. A cross-property UUID race fails here with no financial
  -- effect applied.
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
      idempotency_key
    )
    values (
      p_property_id,
      'payment',
      v_pay,
      null,
      v_note,
      btrim(v_email),
      v_new_debt,
      v_new_over,
      p_idempotency_key
    )
    returning id into v_ledger_id;
  exception
    when unique_violation then
      select l.*
        into v_existing
      from public.support_fee_ledger as l
      where l.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if v_existing.kind is distinct from 'payment'
         or v_existing.property_id is distinct from p_property_id
         or v_existing.amount is distinct from v_pay
         or v_existing.period is distinct from v_period
         or coalesce(v_existing.note, '') is distinct from v_note then
        raise exception 'record_support_payment: idempotency key conflict'
          using errcode = '22023';
      end if;

      return jsonb_build_object(
        'ledger_id', v_existing.id,
        'amount', v_existing.amount,
        'debt', v_existing.debt_after,
        'overpayment', v_existing.overpayment_after,
        'idempotent', true
      );
  end;

  update public.properties
     set debt = v_new_debt,
         overpayment = v_new_over
   where id = p_property_id;

  v_left := v_debt_paid;
  for v_a in
    select *
    from public.support_fee_assessments as a
    where a.property_id = p_property_id
      and a.remaining_due > 0
    order by a.billing_year, a.created_at
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_a.remaining_due, v_left);
    insert into public.support_fee_allocations (
      assessment_id,
      ledger_entry_id,
      amount,
      allocation_type,
      created_by_email
    )
    values (
      v_a.id,
      v_ledger_id,
      v_take,
      'payment',
      btrim(v_email)
    );
    update public.support_fee_assessments
       set remaining_due = round(remaining_due - v_take, 2),
           applied_payment_amount = round(applied_payment_amount + v_take, 2),
           status = case when remaining_due - v_take <= 0 then 'paid' else status end
     where id = v_a.id;
    v_left := round(v_left - v_take, 2);
  end loop;

  -- Preserve the existing ordinary-payment behavior and ordering.
  for v_year in
    select p.billing_year
    from public.support_fee_annual_policies as p
    where p.enabled is true
      and p.status = 'published'
      and now() <= p.early_payment_deadline
    order by p.billing_year
  loop
    v_fin := public.finalize_support_fee_assessment(p_property_id, v_year);
  end loop;

  -- Preserve record_support_payment_for_year's existing ordering: the base
  -- payment is applied first, then its period is attached, then that year is
  -- finalized.
  if p_billing_year is not null then
    update public.support_fee_ledger
       set period = v_period
     where id = v_ledger_id
       and kind = 'payment';
    perform public.finalize_support_fee_assessment(
      p_property_id,
      p_billing_year
    );
  end if;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'amount', v_pay,
    'debt', v_new_debt,
    'overpayment', v_new_over,
    'idempotent', false
  );
end;
$fn$;

revoke all on function public.record_support_payment_internal(
  bigint, numeric, integer, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.record_support_payment(
  p_property_id bigint,
  p_amount numeric,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select public.record_support_payment_internal(
    p_property_id,
    p_amount,
    null,
    p_note,
    p_idempotency_key
  );
$fn$;

create or replace function public.record_support_payment_for_year(
  p_property_id bigint,
  p_amount numeric,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select public.record_support_payment_internal(
    p_property_id,
    p_amount,
    p_billing_year,
    p_note,
    p_idempotency_key
  );
$fn$;

revoke all on function public.record_support_payment(
  bigint, numeric, text, uuid
) from public;
revoke execute on function public.record_support_payment(
  bigint, numeric, text, uuid
) from anon;
grant execute on function public.record_support_payment(
  bigint, numeric, text, uuid
) to authenticated, service_role;

revoke all on function public.record_support_payment_for_year(
  bigint, numeric, integer, text, uuid
) from public;
revoke execute on function public.record_support_payment_for_year(
  bigint, numeric, integer, text, uuid
) from anon;
grant execute on function public.record_support_payment_for_year(
  bigint, numeric, integer, text, uuid
) to authenticated, service_role;

commit;
