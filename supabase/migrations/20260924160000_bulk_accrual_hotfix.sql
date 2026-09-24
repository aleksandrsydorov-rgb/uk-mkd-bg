-- AMADEUS 11 — idempotent bulk accrual
-- Support fee: one charge per property per billing year.
--   Business key: support_fee_ledger (property_id, period) WHERE kind = 'charge'
--   and support_fee_assessments (property_id, billing_year).
--   Amount comes from public.charge_support_fee / finalize_support_fee_assessment.
-- Capital repair: one charge per property per assessment.
--   Business key: capital_repair_ledger (property_id, assessment_id) WHERE kind = 'charge'.
--   Amount is the same operator amount passed to charge_capital_repair.
--   Existing rows are not updated.
-- No RLS, role, or formula changes.
-- The migration runner owns the transaction. Do not add BEGIN/COMMIT here.

create unique index if not exists support_fee_ledger_charge_period_idx
  on public.support_fee_ledger (property_id, period)
  where kind = 'charge' and period is not null;

create unique index if not exists capital_repair_ledger_one_charge_per_property_assessment_idx
  on public.capital_repair_ledger (property_id, assessment_id)
  where kind = 'charge' and assessment_id is not null;

-- -----------------------------------------------------------------------------
-- charge_support_fee_bulk
-- Calls the existing per-apartment charge. A repeat call creates nothing.
-- unique_violation and idempotent finalize results count as skipped_existing.
-- Early-window / zero-base refusals count as not_applied, not as duplicates.
-- -----------------------------------------------------------------------------

create or replace function public.charge_support_fee_bulk(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_period text;
  v_id bigint;
  v_res jsonb;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_not int := 0;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'charge_support_fee_bulk: authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'charge_support_fee_bulk: not allowed' using errcode = '42501';
  end if;

  v_period := btrim(coalesce(p_period, ''));
  if v_period !~ '^[0-9]{4}$' then
    raise exception 'charge_support_fee_bulk: period must be YYYY' using errcode = '22023';
  end if;

  -- Lock apartments before the assessment row inside charge_support_fee,
  -- in id order, so a parallel single charge cannot deadlock this batch.
  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    perform 1 from public.properties as p where p.id = v_id for update;
  end loop;

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;
    begin
      v_res := public.charge_support_fee(v_id, v_period);
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
        continue;
    end;

    if coalesce((v_res->>'applied')::boolean, false) then
      v_created := v_created + 1;
    elsif coalesce((v_res->>'idempotent')::boolean, false)
       or v_res->>'reason' = 'charge_already_exists' then
      v_skipped := v_skipped + 1;
    else
      v_not := v_not + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'created', v_created,
    'skipped_existing', v_skipped,
    'not_applied', v_not,
    'period', v_period
  );
end;
$fn$;

revoke all on function public.charge_support_fee_bulk(text) from public;
revoke all on function public.charge_support_fee_bulk(text) from anon;
grant execute on function public.charge_support_fee_bulk(text) to authenticated;

-- -----------------------------------------------------------------------------
-- charge_capital_repair_bulk
-- Same authorization and amount rules as charge_capital_repair.
-- ON CONFLICT DO NOTHING on the property+assessment charge key.
-- A second call for the same assessment returns created = 0.
-- -----------------------------------------------------------------------------

create or replace function public.charge_capital_repair_bulk(
  p_assessment_id uuid,
  p_amount_eur numeric,
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
begin
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
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

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    perform 1 from public.properties as p where p.id = v_id for update;
  end loop;

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

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;
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
      v_id,
      p_assessment_id,
      'charge',
      v_amount,
      v_note,
      v_email,
      pg_catalog.gen_random_uuid()
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
    'assessment_id', p_assessment_id
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, numeric, text) from public;
revoke all on function public.charge_capital_repair_bulk(uuid, numeric, text) from anon;
grant execute on function public.charge_capital_repair_bulk(uuid, numeric, text) to authenticated;
