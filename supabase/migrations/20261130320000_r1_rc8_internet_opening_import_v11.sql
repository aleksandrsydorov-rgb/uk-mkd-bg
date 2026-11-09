-- =============================================================================
-- R1-RC8 — Internet first-run opening inventarisation, import v11
-- =============================================================================
-- Extends the existing tables only (internet_subscriptions, internet_ledger,
-- internet_paid_periods, internet_opening_imports). No parallel catalogs.
--
--  * internet_opening_imports.paid_period_start (earliest opening paid period).
--  * import_internet_opening_state: new optional args p_paid_period_start and
--    p_allow_correction (old 12-arg callers keep working through defaults).
--      - transition_date optional (defaults to Sofia today)
--      - period_start = connection_date only (never invented from transition)
--      - paid_through optional, also for active (unknown payment allowed)
--      - paid_period_start + paid_through -> one opening paid period (amount 0)
--      - paid_through only -> opening_paid_through only, no paid period row
--      - billing_mode stays 'monthly'; no work orders; no connect; no payments
--      - identical snapshot -> SKIPPED_EXISTING; different + allow_correction
--        -> CORRECTED (was/will); different otherwise -> conflict
--  * admin_import_internet_opening: batch dry-run / apply with merged paid
--    periods per apartment, atomic apply, explicit correction confirmation.
--
-- Internal worker public.internet_opening_apply holds the shared logic and is
-- not executable by API roles.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------

alter table public.internet_opening_imports
  add column if not exists paid_period_start date null;

comment on column public.internet_opening_imports.paid_period_start is
  'R1-RC8: earliest opening paid period start (null when only paid_through is known).';

-- ---------------------------------------------------------------------------
-- 2) Internal helpers (not exposed to API roles)
-- ---------------------------------------------------------------------------

create or replace function public.internet_opening_pick(p_elem jsonb, p_keys text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select s.v
  from (
    select nullif(btrim(p_elem ->> k.kname), '') as v, k.ord
    from unnest(p_keys) with ordinality as k(kname, ord)
  ) as s
  where s.v is not null
  order by s.ord
  limit 1;
$$;

revoke all on function public.internet_opening_pick(jsonb, text[]) from public, anon, authenticated;

create or replace function public.internet_opening_try_date(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if v is null then
    return null;
  end if;
  if v ~ '^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$' then
    v := split_part(split_part(v, 'T', 1), ' ', 1);
    return make_date(
      split_part(v, '-', 1)::integer,
      split_part(v, '-', 2)::integer,
      split_part(v, '-', 3)::integer
    );
  end if;
  if v ~ '^\d{1,2}\.\d{1,2}\.\d{4}$' then
    return make_date(
      split_part(v, '.', 3)::integer,
      split_part(v, '.', 2)::integer,
      split_part(v, '.', 1)::integer
    );
  end if;
  return null;
exception
  when others then
    return null;
end;
$fn$;

revoke all on function public.internet_opening_try_date(text) from public, anon, authenticated;

create or replace function public.internet_opening_try_numeric(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text := replace(replace(btrim(coalesce(p_text, '')), ' ', ''), ',', '.');
begin
  if v ~ '^-?\d+(\.\d+)?$' then
    return v::numeric;
  end if;
  return null;
exception
  when others then
    return null;
end;
$fn$;

revoke all on function public.internet_opening_try_numeric(text) from public, anon, authenticated;

-- next_charge_on from paid_through; null when the helper refuses (paid_through not
-- after Sofia today): no automatic charge is scheduled for expired inventarisation.
create or replace function public.internet_opening_next_charge(
  p_paid_through date,
  p_billing_day smallint,
  p_sofia_today date
)
returns date
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_paid_through is null or p_billing_day is null then
    return null;
  end if;
  return public.internet_next_charge_after_paid_through(
    p_paid_through, p_billing_day, p_sofia_today
  );
exception
  when sqlstate '22023' then
    return null;
end;
$fn$;

revoke all on function public.internet_opening_next_charge(date, smallint, date)
  from public, anon, authenticated;

-- Stored opening snapshot of a property (null when no opening import).
create or replace function public.internet_opening_snapshot(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_import public.internet_opening_imports;
  v_periods jsonb;
  v_min_start date;
begin
  select * into v_import
  from public.internet_opening_imports as i
  where i.property_id = p_property_id;
  if not found then
    return null;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object('start', p.period_start, 'end', p.period_end)
        order by p.period_start
      ),
      '[]'::jsonb
    ),
    min(p.period_start)
    into v_periods, v_min_start
  from public.internet_paid_periods as p
  where p.subscription_id = v_import.subscription_id
    and p.opening_import is true;

  return jsonb_build_object(
    'status', v_import.status,
    'connection_date', v_import.connection_date,
    'paid_period_start', v_min_start,
    'paid_period_end', v_import.paid_through,
    'periods', v_periods,
    'opening_debt', v_import.opening_debt::numeric(12, 2),
    'opening_credit', v_import.opening_credit::numeric(12, 2)
  );
end;
$fn$;

revoke all on function public.internet_opening_snapshot(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Internal worker shared by import_internet_opening_state and the batch RPC
-- ---------------------------------------------------------------------------
-- p_periods: jsonb array of {"start": date, "end": date}. When non-empty,
-- p_paid_through must equal the last period end.
-- p_dry_run: classification only (CREATE | SKIP | CORRECT), nothing is written.

create or replace function public.internet_opening_apply(
  p_property_id bigint,
  p_status text,
  p_tariff_key text,
  p_connection_date date,
  p_transition_date date,
  p_paid_through date,
  p_periods jsonb,
  p_opening_debt numeric,
  p_opening_credit numeric,
  p_source_reference text,
  p_notes text,
  p_idempotency_key uuid,
  p_batch_id uuid,
  p_allow_correction boolean,
  p_dry_run boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_tariff_key text := lower(btrim(coalesce(p_tariff_key, 'internet')));
  v_dry boolean := coalesce(p_dry_run, false);
  v_allow boolean := coalesce(p_allow_correction, false);
  v_debt numeric(12, 2);
  v_credit numeric(12, 2);
  v_sofia date := public.tariff_sofia_today();
  v_transition date;
  v_billing_day smallint;
  v_anchor date;
  v_next date;
  v_period_end date;
  v_version_id uuid;
  v_periods jsonb := '[]'::jsonb;
  v_period record;
  v_prev_end date;
  v_min_start date;
  v_max_end date;
  v_src text := nullif(btrim(coalesce(p_source_reference, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_sub public.internet_subscriptions;
  v_import public.internet_opening_imports;
  v_has_sub boolean;
  v_has_import boolean;
  v_sub_id uuid;
  v_import_id uuid;
  v_ledger_debt uuid;
  v_ledger_credit uuid;
  v_bal numeric(12, 2);
  v_was jsonb;
  v_will jsonb;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_internet_opening_state: authentication required' using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_internet_opening_state: not allowed' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'import_internet_opening_state: idempotency key is required' using errcode = '22023';
  end if;

  if p_property_id is null or p_property_id <= 0 then
    raise exception 'import_internet_opening_state: invalid property' using errcode = '22023';
  end if;

  if v_status not in ('active', 'inactive') then
    raise exception 'import_internet_opening_state: unsupported status' using errcode = '22023';
  end if;

  if v_tariff_key is distinct from 'internet' then
    raise exception 'import_internet_opening_state: unsupported tariff_key' using errcode = '22023';
  end if;

  v_debt := round(coalesce(p_opening_debt, 0), 2);
  v_credit := round(coalesce(p_opening_credit, 0), 2);
  if v_debt < 0 or v_credit < 0 then
    raise exception 'import_internet_opening_state: amounts must be nonnegative' using errcode = '22023';
  end if;

  v_transition := coalesce(p_transition_date, v_sofia);
  if v_transition > v_sofia then
    raise exception 'import_internet_opening_state: transition date in future' using errcode = '22023';
  end if;

  if p_connection_date is not null and p_connection_date > v_transition then
    raise exception 'import_internet_opening_state: connection_date after transition'
      using errcode = '22023';
  end if;

  if p_paid_through is not null
     and p_connection_date is not null
     and p_paid_through < p_connection_date then
    raise exception 'import_internet_opening_state: paid_through before connection'
      using errcode = '22023';
  end if;

  -- Paid periods: validate, sort, reject overlaps (gaps are fine).
  if p_periods is not null then
    if jsonb_typeof(p_periods) is distinct from 'array' then
      raise exception 'import_internet_opening_state: paid periods must be an array'
        using errcode = '22023';
    end if;
    for v_period in
      select (e ->> 'start')::date as s, (e ->> 'end')::date as en
      from jsonb_array_elements(p_periods) as e
      order by 1
    loop
      if v_period.s is null or v_period.en is null then
        raise exception 'import_internet_opening_state: incomplete paid period'
          using errcode = '22023';
      end if;
      if v_period.s > v_period.en then
        raise exception 'import_internet_opening_state: paid_period_start after paid_period_end'
          using errcode = '22023';
      end if;
      if v_prev_end is not null and v_period.s <= v_prev_end then
        raise exception 'import_internet_opening_state: overlapping paid periods'
          using errcode = '22023';
      end if;
      v_prev_end := v_period.en;
      v_max_end := v_period.en;
      v_min_start := coalesce(v_min_start, v_period.s);
      v_periods := v_periods || jsonb_build_array(
        jsonb_build_object('start', v_period.s, 'end', v_period.en)
      );
    end loop;
  end if;

  if jsonb_array_length(v_periods) > 0 and p_paid_through is distinct from v_max_end then
    raise exception 'import_internet_opening_state: paid_through must equal last paid period end'
      using errcode = '22023';
  end if;

  -- Schedule. period_start = connection_date only; never invented from transition.
  if v_status = 'active' then
    if p_connection_date is not null then
      v_billing_day := public.internet_billing_day_from_date(p_connection_date);
      v_anchor := p_connection_date;
    elsif p_paid_through is not null then
      v_billing_day := public.internet_billing_day_from_date(p_paid_through + 1);
      v_anchor := null;
    else
      v_billing_day := null;
      v_anchor := null;
    end if;
    if p_paid_through is not null then
      v_next := public.internet_opening_next_charge(p_paid_through, v_billing_day, v_sofia);
    else
      v_next := null;
    end if;
    v_period_end := null;
  else
    v_billing_day := null;
    v_anchor := null;
    v_next := null;
    v_period_end := v_transition;
  end if;

  -- Published tariff version is recorded when one exists. During first-run the tariff is
  -- only prepared (not published yet); opening rows carry zero amounts, so no version is
  -- needed then.
  begin
    select r.tariff_version_id into v_version_id
    from public.resolve_internet_tariff(v_transition) as r;
  exception
    when sqlstate 'P0002' then
      v_version_id := null;
  end;

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'import_internet_opening_state: property not found' using errcode = 'P0002';
  end if;

  -- Idempotent replay by key
  select * into v_import
  from public.internet_opening_imports as i
  where i.idempotency_key = p_idempotency_key;

  if found then
    select b.balance_eur into v_bal
    from public.get_internet_balance(v_import.property_id) as b;
    return jsonb_build_object(
      'applied', false,
      'idempotent', true,
      'outcome', case when v_dry then 'SKIP' else 'SKIPPED_EXISTING' end,
      'import_id', v_import.id,
      'subscription_id', v_import.subscription_id,
      'property_id', v_import.property_id,
      'status', v_import.status,
      'next_charge_on', v_import.next_charge_on,
      'opening_debt', v_import.opening_debt,
      'opening_credit', v_import.opening_credit,
      'balance_eur', v_bal,
      'synthetic_payments', false,
      'work_orders_created', false
    );
  end if;

  v_will := jsonb_build_object(
    'status', v_status,
    'connection_date', p_connection_date,
    'paid_period_start', v_min_start,
    'paid_period_end', p_paid_through,
    'periods', v_periods,
    'opening_debt', v_debt,
    'opening_credit', v_credit
  );

  select * into v_import
  from public.internet_opening_imports as i
  where i.property_id = p_property_id;
  v_has_import := found;

  if v_dry then
    select * into v_sub
    from public.internet_subscriptions as s
    where s.property_id = p_property_id;
  else
    select * into v_sub
    from public.internet_subscriptions as s
    where s.property_id = p_property_id
    for update;
  end if;
  v_has_sub := found;

  if v_has_import then
    v_was := public.internet_opening_snapshot(p_property_id);

    if v_was = v_will then
      select b.balance_eur into v_bal
      from public.get_internet_balance(p_property_id) as b;
      return jsonb_build_object(
        'applied', false,
        'idempotent', true,
        'outcome', case when v_dry then 'SKIP' else 'SKIPPED_EXISTING' end,
        'import_id', v_import.id,
        'subscription_id', v_import.subscription_id,
        'property_id', v_import.property_id,
        'status', v_import.status,
        'next_charge_on', v_import.next_charge_on,
        'opening_debt', v_import.opening_debt,
        'opening_credit', v_import.opening_credit,
        'balance_eur', v_bal,
        'was', v_was,
        'will', v_will,
        'synthetic_payments', false,
        'work_orders_created', false
      );
    end if;

    if not v_allow then
      raise exception 'import_internet_opening_state: conflict existing opening import'
        using errcode = '23505';
    end if;

    if not v_has_sub then
      raise exception 'import_internet_opening_state: conflict opening import without subscription'
        using errcode = '23505';
    end if;

    if v_sub.id is distinct from v_import.subscription_id
       or v_sub.status is distinct from v_import.status then
      raise exception 'import_internet_opening_state: conflict subscription changed after opening import'
        using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.work_orders as wo
      where wo.target_property_id = p_property_id
        and wo.internet_action is not null
        and wo.status in ('open', 'in_progress')
    ) then
      raise exception 'import_internet_opening_state: conflict pending internet work order'
        using errcode = '23505';
    end if;

    -- Only opening rows may exist; operational charges/payments block correction.
    if exists (
      select 1
      from public.internet_ledger as l
      where l.property_id = p_property_id
        and l.kind not in ('opening_debit', 'opening_credit')
    ) then
      raise exception 'import_internet_opening_state: conflict existing ledger'
        using errcode = '23505';
    end if;

    if v_dry then
      return jsonb_build_object(
        'applied', false,
        'idempotent', false,
        'outcome', 'CORRECT',
        'import_id', v_import.id,
        'subscription_id', v_import.subscription_id,
        'property_id', p_property_id,
        'status', v_status,
        'billing_day', v_billing_day,
        'next_charge_on', v_next,
        'paid_through', p_paid_through,
        'opening_debt', v_debt,
        'opening_credit', v_credit,
        'was', v_was,
        'will', v_will,
        'synthetic_payments', false,
        'work_orders_created', false
      );
    end if;

    v_sub_id := v_sub.id;
    v_import_id := v_import.id;

    delete from public.internet_ledger as l
    where l.property_id = p_property_id
      and l.kind in ('opening_debit', 'opening_credit');

    delete from public.internet_paid_periods as pp
    where pp.subscription_id = v_sub_id
      and pp.opening_import is true;

    update public.internet_subscriptions as s
       set status = v_status,
           period_start = p_connection_date,
           period_end = v_period_end,
           pending_days = null,
           billing_day = v_billing_day,
           billing_anchor_date = v_anchor,
           next_charge_on = v_next,
           billing_mode = 'monthly',
           opening_import = true,
           opening_transition_date = case
             when p_transition_date is null then s.opening_transition_date
             else p_transition_date
           end,
           opening_paid_through = p_paid_through,
           opening_source_reference = coalesce(v_src, s.opening_source_reference),
           opening_notes = coalesce(v_notes, s.opening_notes),
           updated_at = now()
     where s.id = v_sub_id;

  elsif v_has_sub then
    -- Never overwrite an operational subscription.
    raise exception 'import_internet_opening_state: conflict existing subscription'
      using errcode = '23505';
  else
    if exists (
      select 1
      from public.work_orders as wo
      where wo.target_property_id = p_property_id
        and wo.internet_action is not null
        and wo.status in ('open', 'in_progress')
    ) then
      raise exception 'import_internet_opening_state: conflict pending internet work order'
        using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.internet_ledger as l
      where l.property_id = p_property_id
        and l.kind in ('opening_debit', 'opening_credit')
    ) then
      raise exception 'import_internet_opening_state: conflict existing opening ledger'
        using errcode = '23505';
    end if;

    if exists (
      select 1 from public.internet_ledger as l where l.property_id = p_property_id
    ) then
      raise exception 'import_internet_opening_state: conflict existing ledger'
        using errcode = '23505';
    end if;

    if v_dry then
      return jsonb_build_object(
        'applied', false,
        'idempotent', false,
        'outcome', 'CREATE',
        'property_id', p_property_id,
        'status', v_status,
        'billing_day', v_billing_day,
        'next_charge_on', v_next,
        'paid_through', p_paid_through,
        'opening_debt', v_debt,
        'opening_credit', v_credit,
        'will', v_will,
        'synthetic_payments', false,
        'work_orders_created', false
      );
    end if;

    insert into public.internet_subscriptions (
      property_id,
      status,
      period_start,
      period_end,
      pending_days,
      billing_day,
      billing_anchor_date,
      next_charge_on,
      billing_mode,
      opening_import,
      opening_transition_date,
      opening_paid_through,
      opening_source_reference,
      opening_notes
    ) values (
      p_property_id,
      v_status,
      p_connection_date,
      v_period_end,
      null,
      v_billing_day,
      v_anchor,
      v_next,
      'monthly',
      true,
      v_transition,
      p_paid_through,
      v_src,
      v_notes
    )
    returning id into v_sub_id;
  end if;

  -- Opening ledger: opening_debit / opening_credit only (never payment / charge).
  if v_debt > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'opening_debit',
      v_debt,
      null,
      v_version_id,
      'IS-5 opening debt; source=' || coalesce(v_src, 'n/a'),
      v_email,
      p_idempotency_key
    )
    returning id into v_ledger_debt;
  end if;

  if v_credit > 0 then
    insert into public.internet_ledger (
      property_id, kind, amount_eur, period_days, tariff_version_id,
      note, recorded_by_email, idempotency_key
    ) values (
      p_property_id,
      'opening_credit',
      v_credit,
      null,
      v_version_id,
      'IS-5 opening credit; source=' || coalesce(v_src, 'n/a'),
      v_email,
      case when v_debt > 0 then gen_random_uuid() else p_idempotency_key end
    )
    returning id into v_ledger_credit;
  end if;

  -- Opening paid periods: zero-amount audit rows, no ledger link, no charge.
  for v_period in
    select (e ->> 'start')::date as s, (e ->> 'end')::date as en
    from jsonb_array_elements(v_periods) as e
    order by 1
  loop
    insert into public.internet_paid_periods (
      property_id,
      subscription_id,
      period_start,
      period_end,
      billing_method,
      calendar_days,
      package_count,
      extra_days,
      package_rate_eur,
      day_rate_eur,
      amount_eur,
      tariff_version_id,
      ledger_id,
      opening_import,
      recorded_by_email,
      idempotency_key
    ) values (
      p_property_id,
      v_sub_id,
      v_period.s,
      v_period.en,
      'daily',
      (v_period.en - v_period.s) + 1,
      0,
      (v_period.en - v_period.s) + 1,
      0,
      0,
      0,
      v_version_id,
      null,
      true,
      v_email,
      md5(
        'internet-opening-period:' || p_property_id::text || ':'
        || v_period.s::text || ':' || v_period.en::text
      )::uuid
    );
  end loop;

  if v_has_import then
    update public.internet_opening_imports as i
       set status = v_status,
           tariff_key = v_tariff_key,
           tariff_version_id = v_version_id,
           connection_date = p_connection_date,
           transition_date = case
             when p_transition_date is null then i.transition_date
             else p_transition_date
           end,
           paid_through = p_paid_through,
           paid_period_start = v_min_start,
           next_charge_on = v_next,
           billing_day = v_billing_day,
           opening_debt = v_debt,
           opening_credit = v_credit,
           source_reference = v_src,
           notes = v_notes,
           idempotency_key = p_idempotency_key,
           batch_id = p_batch_id
     where i.id = v_import_id;

    select b.balance_eur into v_bal
    from public.get_internet_balance(p_property_id) as b;

    return jsonb_build_object(
      'applied', true,
      'idempotent', false,
      'outcome', 'CORRECTED',
      'import_id', v_import_id,
      'subscription_id', v_sub_id,
      'property_id', p_property_id,
      'status', v_status,
      'tariff_key', v_tariff_key,
      'tariff_version_id', v_version_id,
      'billing_day', v_billing_day,
      'next_charge_on', v_next,
      'paid_through', p_paid_through,
      'opening_debt', v_debt,
      'opening_credit', v_credit,
      'balance_eur', v_bal,
      'was', v_was,
      'will', v_will,
      'synthetic_payments', false,
      'work_orders_created', false,
      'ledger_debt_id', v_ledger_debt,
      'ledger_credit_id', v_ledger_credit
    );
  end if;

  insert into public.internet_opening_imports (
    property_id,
    subscription_id,
    status,
    tariff_key,
    tariff_version_id,
    connection_date,
    transition_date,
    paid_through,
    paid_period_start,
    next_charge_on,
    billing_day,
    opening_debt,
    opening_credit,
    source_reference,
    notes,
    idempotency_key,
    batch_id,
    created_by_email
  ) values (
    p_property_id,
    v_sub_id,
    v_status,
    v_tariff_key,
    v_version_id,
    p_connection_date,
    v_transition,
    p_paid_through,
    v_min_start,
    v_next,
    v_billing_day,
    v_debt,
    v_credit,
    v_src,
    v_notes,
    p_idempotency_key,
    p_batch_id,
    v_email
  )
  returning id into v_import_id;

  select b.balance_eur into v_bal
  from public.get_internet_balance(p_property_id) as b;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'outcome', 'CREATED',
    'import_id', v_import_id,
    'subscription_id', v_sub_id,
    'property_id', p_property_id,
    'status', v_status,
    'tariff_key', v_tariff_key,
    'tariff_version_id', v_version_id,
    'billing_day', v_billing_day,
    'next_charge_on', v_next,
    'paid_through', p_paid_through,
    'opening_debt', v_debt,
    'opening_credit', v_credit,
    'balance_eur', v_bal,
    'will', v_will,
    'synthetic_payments', false,
    'work_orders_created', false,
    'ledger_debt_id', v_ledger_debt,
    'ledger_credit_id', v_ledger_credit
  );
end;
$fn$;

revoke all on function public.internet_opening_apply(
  bigint, text, text, date, date, date, jsonb, numeric, numeric, text, text, uuid, uuid, boolean, boolean
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) import_internet_opening_state (extended; old 12-arg callers use defaults)
-- ---------------------------------------------------------------------------
-- The old 12-argument overload is dropped: keeping it next to a 14-argument
-- function with defaults would make 12-argument calls ambiguous.

drop function if exists public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid
);

create or replace function public.import_internet_opening_state(
  p_property_id bigint,
  p_status text,
  p_tariff_key text,
  p_connection_date date,
  p_transition_date date,
  p_paid_through date,
  p_opening_debt numeric,
  p_opening_credit numeric,
  p_source_reference text,
  p_notes text,
  p_idempotency_key uuid,
  p_batch_id uuid default null,
  p_paid_period_start date default null,
  p_allow_correction boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_periods jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'import_internet_opening_state: authentication required' using errcode = '42501';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'import_internet_opening_state: not allowed' using errcode = '42501';
  end if;

  perform public.first_run_assert_prepared_tariff_for_opening('internet');

  if p_paid_period_start is not null then
    if p_paid_through is null then
      raise exception 'import_internet_opening_state: paid_period_start requires paid_through'
        using errcode = '22023';
    end if;
    if p_paid_period_start > p_paid_through then
      raise exception 'import_internet_opening_state: paid_period_start after paid_through'
        using errcode = '22023';
    end if;
    v_periods := jsonb_build_array(
      jsonb_build_object('start', p_paid_period_start, 'end', p_paid_through)
    );
  end if;

  return public.internet_opening_apply(
    p_property_id,
    p_status,
    p_tariff_key,
    p_connection_date,
    p_transition_date,
    p_paid_through,
    v_periods,
    p_opening_debt,
    p_opening_credit,
    p_source_reference,
    p_notes,
    p_idempotency_key,
    p_batch_id,
    coalesce(p_allow_correction, false),
    false
  );
end;
$fn$;

revoke all on function public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid, date, boolean
) from public, anon;

grant execute on function public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid, date, boolean
) to authenticated;

comment on function public.import_internet_opening_state(
  bigint, text, text, date, date, date, numeric, numeric, text, text, uuid, uuid, date, boolean
) is
  'R1-RC8: inventarise Internet subscription + opening AR (+ optional opening paid period) without connect WO, payments or charges. Admin only. p_allow_correction replaces a differing opening snapshot (outcome CORRECTED).';

-- ---------------------------------------------------------------------------
-- 5) admin_import_internet_opening (batch dry-run / apply)
-- ---------------------------------------------------------------------------

create or replace function public.admin_import_internet_opening(
  p_rows jsonb,
  p_dry_run boolean default true,
  p_confirm_corrections boolean default false,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_dry boolean := coalesce(p_dry_run, true);
  v_confirm boolean := coalesce(p_confirm_corrections, false);
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_today date := public.tariff_sofia_today();
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_parsed jsonb := '[]'::jsonb;
  v_tainted bigint[] := '{}';
  v_elem jsonb;
  v_idx integer := 0;
  v_row_num integer;
  v_codes text[];
  v_apt text;
  v_property_id bigint;
  v_raw text;
  v_state text;
  v_conn date;
  v_pstart date;
  v_pend date;
  v_trans date;
  v_debt numeric;
  v_credit numeric;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_g record;
  v_n_state integer;
  v_n_conn integer;
  v_n_trans integer;
  v_n_debt integer;
  v_n_credit integer;
  v_n_idem integer;
  v_n_full integer;
  v_n_only integer;
  v_n_only_distinct integer;
  v_periods jsonb;
  v_paid_through date;
  v_min_start date;
  v_max_end date;
  v_has_gap boolean;
  v_covers_today boolean;
  v_pay_status text;
  v_warnings text[];
  v_res jsonb;
  v_outcome text;
  v_failed boolean;
  v_reason text;
  v_msg text;
  v_row jsonb;
  v_pid bigint;
  v_summary jsonb;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_internet_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_internet_opening: not allowed' using errcode = '42501';
  end if;

  if not v_dry then
    perform public.first_run_assert_prepared_tariff_for_opening('internet');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_internet_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if v_dry then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'batch_id', v_batch,
        'row_count', 0,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0, 'field', 'rows', 'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch')
        )),
        'rows', '[]'::jsonb,
        'summary', jsonb_build_object(
          'as_of', v_today, 'total', 0, 'active', 0, 'inactive', 0,
          'paid_active', 0, 'paid_expired', 0, 'paid_unknown', 0, 'paid_future', 0,
          'debt_sum', 0, 'credit_sum', 0,
          'create_count', 0, 'skip_count', 0, 'correct_count', 0, 'error_count', 1
        ),
        'synthetic_payments', false,
        'charges_generated', false,
        'work_orders_created', false
      );
    end if;
    raise exception 'admin_import_internet_opening: empty batch not allowed' using errcode = '22023';
  end if;

  -- -------------------------------------------------------------------------
  -- Pass 1: parse and validate each input row
  -- -------------------------------------------------------------------------
  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_codes := '{}';
    v_property_id := null;
    v_state := null;
    v_conn := null;
    v_pstart := null;
    v_pend := null;
    v_trans := null;
    v_debt := null;
    v_credit := null;
    v_idem := null;

    if jsonb_typeof(v_elem) is distinct from 'object' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_idx + 1,
        'apartment_number', '',
        'codes', jsonb_build_array('invalid:row_not_object'),
        'reason', 'invalid:row_not_object',
        'field', 'internet_opening'
      ));
      continue;
    end if;

    v_row_num := coalesce(
      public.internet_opening_try_numeric(
        public.internet_opening_pick(v_elem, array['rowNumber', 'row_number', 'row'])
      )::integer,
      v_idx + 1
    );

    v_apt := public.internet_opening_pick(
      v_elem, array['apartment_number', 'apartmentNumber', 'apartment', 'apt']
    );
    if v_apt is null then
      v_codes := array_append(v_codes, 'required:apartment_number');
    else
      select p.id into v_property_id
      from public.properties as p
      where lower(btrim(p.apartment_number)) = lower(v_apt)
      limit 1;
      if v_property_id is null then
        v_codes := array_append(v_codes, 'unknown_apartment');
      end if;
    end if;

    -- connection state (aliases; anything else is rejected)
    v_raw := public.internet_opening_pick(
      v_elem, array['connection_state', 'connectionState', 'status']
    );
    if v_raw is not null then
      if lower(v_raw) in ('active', 'connected', 'подключён', 'подключен')
         or v_raw in ('Подключён', 'Подключен') then
        v_state := 'active';
      elsif lower(v_raw) in ('inactive', 'disconnected', 'отключён', 'отключен')
         or v_raw in ('Отключён', 'Отключен') then
        v_state := 'inactive';
      else
        v_codes := array_append(v_codes, 'invalid:connection_state');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['tariff_code', 'tariffCode', 'tariff_key']);
    if v_raw is not null and lower(v_raw) is distinct from 'internet' then
      v_codes := array_append(v_codes, 'unsupported:tariff_code');
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['connection_date', 'connectionDate']);
    if v_raw is not null then
      v_conn := public.internet_opening_try_date(v_raw);
      if v_conn is null then
        v_codes := array_append(v_codes, 'invalid:connection_date');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['paid_period_start', 'paidPeriodStart']);
    if v_raw is not null then
      v_pstart := public.internet_opening_try_date(v_raw);
      if v_pstart is null then
        v_codes := array_append(v_codes, 'invalid:paid_period_start');
      end if;
    end if;

    v_raw := public.internet_opening_pick(
      v_elem, array['paid_period_end', 'paidPeriodEnd', 'paid_through', 'paidThrough']
    );
    if v_raw is not null then
      v_pend := public.internet_opening_try_date(v_raw);
      if v_pend is null then
        v_codes := array_append(v_codes, 'invalid:paid_period_end');
      end if;
    end if;

    if v_pstart is not null and v_pend is null
       and public.internet_opening_pick(
         v_elem, array['paid_period_end', 'paidPeriodEnd', 'paid_through', 'paidThrough']
       ) is null then
      v_codes := array_append(v_codes, 'incomplete:paid_period_end');
    end if;
    if v_pstart is not null and v_pend is not null and v_pstart > v_pend then
      v_codes := array_append(v_codes, 'invalid:paid_period_range');
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['transition_date', 'transitionDate']);
    if v_raw is not null then
      v_trans := public.internet_opening_try_date(v_raw);
      if v_trans is null then
        v_codes := array_append(v_codes, 'invalid:transition_date');
      elsif v_trans > v_today then
        v_codes := array_append(v_codes, 'invalid:transition_date_future');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['opening_debt', 'openingDebt', 'debt']);
    if v_raw is not null then
      v_debt := public.internet_opening_try_numeric(v_raw);
      if v_debt is null then
        v_codes := array_append(v_codes, 'invalid:opening_debt');
      elsif v_debt < 0 then
        v_codes := array_append(v_codes, 'negative:opening_debt');
      else
        v_debt := round(v_debt, 2);
      end if;
    end if;

    v_raw := public.internet_opening_pick(
      v_elem,
      array['opening_credit', 'openingCredit', 'opening_overpayment', 'openingOverpayment', 'overpayment']
    );
    if v_raw is not null then
      v_credit := public.internet_opening_try_numeric(v_raw);
      if v_credit is null then
        v_codes := array_append(v_codes, 'invalid:opening_credit');
      elsif v_credit < 0 then
        v_codes := array_append(v_codes, 'negative:opening_credit');
      else
        v_credit := round(v_credit, 2);
      end if;
    end if;

    if coalesce(v_debt, 0) > 0 and coalesce(v_credit, 0) > 0 then
      v_codes := array_append(v_codes, 'mutually_exclusive:debt_and_overpayment');
    end if;

    v_src := public.internet_opening_pick(v_elem, array['source_reference', 'sourceReference']);
    v_notes := public.internet_opening_pick(v_elem, array['comment', 'notes', 'note']);

    v_raw := public.internet_opening_pick(v_elem, array['idempotency_key', 'idempotencyKey']);
    if v_raw is not null then
      begin
        v_idem := v_raw::uuid;
      exception
        when others then
          v_codes := array_append(v_codes, 'invalid:idempotency_key');
      end;
    end if;

    if coalesce(array_length(v_codes, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'property_id', v_property_id,
        'codes', to_jsonb(v_codes),
        'reason', v_codes[1],
        'field', 'internet_opening'
      ));
      if v_property_id is not null then
        v_tainted := array_append(v_tainted, v_property_id);
      end if;
      continue;
    end if;

    v_parsed := v_parsed || jsonb_build_array(jsonb_build_object(
      'row', v_row_num,
      'property_id', v_property_id,
      'state', v_state,
      'conn', v_conn,
      'pstart', v_pstart,
      'pend', v_pend,
      'trans', v_trans,
      'debt', v_debt,
      'credit', v_credit,
      'src', v_src,
      'notes', v_notes,
      'idem', v_idem
    ));
  end loop;

  -- -------------------------------------------------------------------------
  -- Pass 2: merge rows per apartment, classify, optionally apply
  -- -------------------------------------------------------------------------
  for v_g in
    select
      (r ->> 'property_id')::bigint as pid,
      min((r ->> 'row')::integer) as first_row,
      jsonb_agg(r order by (r ->> 'row')::integer) as grp_rows
    from jsonb_array_elements(v_parsed) as r
    group by 1
    order by 2
  loop
    if v_g.pid = any (v_tainted) then
      continue;
    end if;

    v_codes := '{}';
    v_failed := false;
    v_warnings := '{}';
    v_apt := (select p.apartment_number from public.properties as p where p.id = v_g.pid);

    select
      count(distinct r ->> 'state'),
      count(distinct r ->> 'conn'),
      count(distinct r ->> 'trans'),
      count(distinct (r ->> 'debt')::numeric),
      count(distinct (r ->> 'credit')::numeric),
      count(distinct r ->> 'idem'),
      min(r ->> 'state'),
      min(r ->> 'conn')::date,
      min(r ->> 'trans')::date,
      min((r ->> 'debt')::numeric),
      min((r ->> 'credit')::numeric),
      min(r ->> 'idem')::uuid,
      (array_agg(r ->> 'src' order by (r ->> 'row')::integer)
         filter (where r ->> 'src' is not null))[1],
      string_agg(distinct r ->> 'notes', ' | ') filter (where r ->> 'notes' is not null),
      count(*) filter (where r ->> 'pstart' is not null),
      count(*) filter (where r ->> 'pstart' is null and r ->> 'pend' is not null),
      count(distinct r ->> 'pend') filter (where r ->> 'pstart' is null),
      max(r ->> 'pend') filter (where r ->> 'pstart' is null)
    into
      v_n_state, v_n_conn, v_n_trans, v_n_debt, v_n_credit, v_n_idem,
      v_state, v_conn, v_trans, v_debt, v_credit, v_idem,
      v_src, v_notes,
      v_n_full, v_n_only, v_n_only_distinct, v_raw
    from jsonb_array_elements(v_g.grp_rows) as r;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object('start', r ->> 'pstart', 'end', r ->> 'pend')
          order by (r ->> 'pstart')::date
        ) filter (where r ->> 'pstart' is not null),
        '[]'::jsonb
      )
    into v_periods
    from jsonb_array_elements(v_g.grp_rows) as r;

    if v_n_state > 1 then
      v_codes := array_append(v_codes, 'inconsistent:connection_state');
    elsif v_state is null then
      v_codes := array_append(v_codes, 'required:connection_state');
    end if;
    if v_n_conn > 1 then
      v_codes := array_append(v_codes, 'inconsistent:connection_date');
    end if;
    if v_n_trans > 1 then
      v_codes := array_append(v_codes, 'inconsistent:transition_date');
    end if;
    if v_n_debt > 1 then
      v_codes := array_append(v_codes, 'inconsistent:opening_debt');
    end if;
    if v_n_credit > 1 then
      v_codes := array_append(v_codes, 'inconsistent:opening_credit');
    end if;
    if v_n_idem > 1 then
      v_codes := array_append(v_codes, 'inconsistent:idempotency_key');
    end if;
    if coalesce(v_debt, 0) > 0 and coalesce(v_credit, 0) > 0 then
      v_codes := array_append(v_codes, 'mutually_exclusive:debt_and_overpayment');
    end if;
    if v_n_full > 0 and v_n_only > 0 then
      v_codes := array_append(v_codes, 'mixed:paid_through_only_and_periods');
    end if;
    if v_n_only_distinct > 1 then
      v_codes := array_append(v_codes, 'inconsistent:paid_through');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_periods) with ordinality as a(v, n)
      join jsonb_array_elements(v_periods) with ordinality as b(v, n) on a.n < b.n
      where daterange((a.v ->> 'start')::date, (a.v ->> 'end')::date, '[]')
            && daterange((b.v ->> 'start')::date, (b.v ->> 'end')::date, '[]')
    ) then
      v_codes := array_append(v_codes, 'overlapping_paid_periods');
    end if;

    if coalesce(array_length(v_codes, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', to_jsonb(v_codes),
        'reason', v_codes[1],
        'field', 'internet_opening'
      ));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'ERROR',
        'reasons', to_jsonb(v_codes)
      ));
      continue;
    end if;

    v_debt := coalesce(v_debt, 0);
    v_credit := coalesce(v_credit, 0);

    if jsonb_array_length(v_periods) > 0 then
      select min((x ->> 'start')::date), max((x ->> 'end')::date)
        into v_min_start, v_max_end
      from jsonb_array_elements(v_periods) as x;
      v_paid_through := v_max_end;
    else
      v_min_start := null;
      v_max_end := null;
      v_paid_through := nullif(v_raw, '')::date;
    end if;

    v_idem := coalesce(v_idem, gen_random_uuid());

    -- Classification (no writes). allow_correction = true so CORRECT is detectable.
    begin
      v_res := public.internet_opening_apply(
        v_g.pid, v_state, 'internet', v_conn, v_trans, v_paid_through, v_periods,
        v_debt, v_credit, v_src, v_notes, v_idem, v_batch, true, true
      );
      v_outcome := v_res ->> 'outcome';
    exception
      when others then
        v_failed := true;
        v_msg := SQLERRM;
        v_reason := btrim(
          regexp_replace(
            lower(regexp_replace(v_msg, '^[a-z_]+:\s*', '')),
            '[^a-z0-9]+', '_', 'g'
          ),
          '_'
        );
    end;

    if v_failed then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', jsonb_build_array(v_reason),
        'reason', v_reason,
        'message', v_msg,
        'field', 'internet_opening'
      ));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'ERROR',
        'reasons', jsonb_build_array(v_reason)
      ));
      continue;
    end if;

    -- Payment status as of Sofia today
    if jsonb_array_length(v_periods) > 0 then
      select exists (
        select 1
        from jsonb_array_elements(v_periods) as x
        where (x ->> 'start')::date <= v_today and (x ->> 'end')::date >= v_today
      ) into v_covers_today;
      select exists (
        select 1
        from (
          select (t.v ->> 'start')::date as s,
                 lag((t.v ->> 'end')::date) over (order by (t.v ->> 'start')::date) as pe
          from jsonb_array_elements(v_periods) as t(v)
        ) as q
        where q.pe is not null and q.s > q.pe + 1
      ) into v_has_gap;

      if v_covers_today then
        v_pay_status := 'active_paid';
      elsif v_max_end < v_today then
        v_pay_status := 'expired';
      elsif v_min_start > v_today then
        v_pay_status := 'future';
      else
        v_pay_status := 'expired';
        v_warnings := array_append(v_warnings, 'paid_period_gap_today');
      end if;
      if v_has_gap then
        v_warnings := array_append(v_warnings, 'paid_period_gap');
      end if;
    elsif v_paid_through is not null then
      v_pay_status := case when v_today <= v_paid_through then 'active_paid' else 'expired' end;
      v_warnings := array_append(v_warnings, 'paid_through_only_no_period_start');
    else
      v_pay_status := 'unknown';
      v_warnings := array_append(v_warnings, 'payment_unknown');
    end if;

    if v_conn is null then
      v_warnings := array_append(v_warnings, 'connection_date_unknown');
    end if;
    if v_state = 'active' and v_paid_through is not null and (v_res ->> 'next_charge_on') is null then
      v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_not_after_today');
    end if;
    if v_state = 'inactive' and v_pay_status = 'active_paid' then
      v_warnings := array_append(v_warnings, 'inactive_with_active_paid_period');
    end if;

    -- Corrections need explicit confirmation (dry-run previews the apply result).
    if v_outcome = 'CORRECT' and not v_confirm then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('opening_correction_requires_confirm'),
        'reason', 'opening_correction_requires_confirm',
        'field', 'internet_opening'
      ));
    elsif not v_dry and v_outcome in ('CREATE', 'CORRECT') then
      begin
        v_res := public.internet_opening_apply(
          v_g.pid, v_state, 'internet', v_conn, v_trans, v_paid_through, v_periods,
          v_debt, v_credit, v_src, v_notes, v_idem, v_batch, v_confirm, false
        );
      exception
        when others then
          v_failed := true;
          v_msg := SQLERRM;
          v_reason := btrim(
            regexp_replace(
              lower(regexp_replace(v_msg, '^[a-z_]+:\s*', '')),
              '[^a-z0-9]+', '_', 'g'
            ),
            '_'
          );
      end;
      if v_failed then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'codes', jsonb_build_array(v_reason),
          'reason', v_reason,
          'message', v_msg,
          'field', 'internet_opening'
        ));
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'property_id', v_g.pid,
          'outcome', 'ERROR',
          'reasons', jsonb_build_array(v_reason)
        ));
        continue;
      end if;
    end if;

    v_row := jsonb_build_object(
      'row', v_g.first_row,
      'apartment_number', v_apt,
      'property_id', v_g.pid,
      'outcome', v_outcome,
      'status', v_state,
      'connection_date', v_conn,
      'paid_period_start', v_min_start,
      'paid_period_end', v_paid_through,
      'periods', v_periods,
      'payment_status', v_pay_status,
      'payment_status_as_of', v_today,
      'opening_debt', v_debt,
      'opening_credit', v_credit,
      'next_charge_on', v_res -> 'next_charge_on',
      'warnings', to_jsonb(v_warnings),
      'applied', coalesce((v_res ->> 'applied')::boolean, false),
      'import_id', v_res -> 'import_id'
    );
    if v_outcome = 'CORRECT' then
      v_row := v_row || jsonb_build_object('was', v_res -> 'was', 'will', v_res -> 'will');
    end if;
    v_results := v_results || jsonb_build_array(v_row);
  end loop;

  -- Apartments whose input rows were invalid get an ERROR row each.
  for v_pid in select distinct t from unnest(v_tainted) as t
  loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', (
        select min((e ->> 'row')::integer)
        from jsonb_array_elements(v_errors) as e
        where (e ->> 'property_id')::bigint = v_pid
      ),
      'apartment_number', (select p.apartment_number from public.properties as p where p.id = v_pid),
      'property_id', v_pid,
      'outcome', 'ERROR',
      'reasons', coalesce((
        select jsonb_agg(distinct e ->> 'reason')
        from jsonb_array_elements(v_errors) as e
        where (e ->> 'property_id')::bigint = v_pid
      ), '[]'::jsonb)
    ));
  end loop;

  select jsonb_build_object(
    'as_of', v_today,
    'total', count(*),
    'active', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'status' = 'active'),
    'inactive', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'status' = 'inactive'),
    'paid_active', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'active_paid'),
    'paid_expired', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'expired'),
    'paid_unknown', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'unknown'),
    'paid_future', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'future'),
    'debt_sum', coalesce(sum((r ->> 'opening_debt')::numeric) filter (where r ->> 'outcome' <> 'ERROR'), 0),
    'credit_sum', coalesce(sum((r ->> 'opening_credit')::numeric) filter (where r ->> 'outcome' <> 'ERROR'), 0),
    'create_count', count(*) filter (where r ->> 'outcome' = 'CREATE'),
    'skip_count', count(*) filter (where r ->> 'outcome' = 'SKIP'),
    'correct_count', count(*) filter (where r ->> 'outcome' = 'CORRECT'),
    'error_count', jsonb_array_length(v_errors)
  )
  into v_summary
  from jsonb_array_elements(v_results) as r;

  if not v_dry and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_internet_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'dry_run', v_dry,
    'batch_id', v_batch,
    'row_count', jsonb_array_length(p_rows),
    'errors', v_errors,
    'rows', v_results,
    'summary', v_summary,
    'synthetic_payments', false,
    'charges_generated', false,
    'work_orders_created', false
  );
end;
$fn$;

revoke all on function public.admin_import_internet_opening(jsonb, boolean, boolean, uuid)
  from public, anon;
grant execute on function public.admin_import_internet_opening(jsonb, boolean, boolean, uuid)
  to authenticated;

comment on function public.admin_import_internet_opening(jsonb, boolean, boolean, uuid) is
  'R1-RC8: batch dry-run/apply of Internet opening inventarisation. Multiple rows per apartment merge paid periods. Apply is atomic; corrections need p_confirm_corrections. No payments, charges or work orders.';

commit;
