-- R1-RC8: Internet opening preview warnings — no next_charge noise for prepaid_period.
-- Monthly-only next_charge warnings keep a concrete human-facing reason code.

begin;

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
  v_billing_mode text;
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
    -- Debt and overpayment may both be present: separate opening_debit / opening_credit rows (no netting).

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
    -- Debt and overpayment may both be present: separate opening_debit / opening_credit rows (no netting).
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
    -- next_charge_on is only meaningful for legacy monthly billing.
    -- prepaid_period (package_30/day opening) never schedules monthly charges — not a warning.
    v_billing_mode := public.internet_opening_choose_billing_mode(
      nullif(v_res ->> 'billing_mode', ''),
      v_outcome = 'CREATE',
      v_today
    );
    if v_billing_mode = 'monthly'
       and v_state = 'active'
       and v_paid_through is not null
       and (v_res ->> 'next_charge_on') is null then
      if v_paid_through < v_today then
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_period_expired');
      elsif v_paid_through = v_today then
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_today');
      else
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_not_after_today');
      end if;
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
      'billing_mode', to_jsonb(v_billing_mode),
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
