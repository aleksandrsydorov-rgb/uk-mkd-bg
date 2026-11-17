-- Soft-defer capital-repair opening inventarisation (mirrors 20261130340200 support fee):
-- empty amounts (apartment found) → needs_initial pending, non-blocking;
-- explicit 0 € remains a normal CREATE; fully blank Excel rows are skipped;
-- late confirm via admin_confirm_capital_repair_opening → import_capital_repair_opening_state.

-- ---------------------------------------------------------------------------
-- Pending opening slots
-- ---------------------------------------------------------------------------
create table if not exists public.capital_repair_opening_pending (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  billing_year integer,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'needs_initial'
    check (status in ('needs_initial', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by_email text
);

create unique index if not exists capital_repair_opening_pending_open_uidx
  on public.capital_repair_opening_pending (property_id)
  where status = 'needs_initial';

create index if not exists capital_repair_opening_pending_property_idx
  on public.capital_repair_opening_pending (property_id, status);

alter table public.capital_repair_opening_pending enable row level security;
revoke all on table public.capital_repair_opening_pending from public, anon;
grant select, insert, update, delete on table public.capital_repair_opening_pending to authenticated;

drop policy if exists capital_repair_opening_pending_staff on public.capital_repair_opening_pending;
create policy capital_repair_opening_pending_staff on public.capital_repair_opening_pending
  for all to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  )
  with check (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  );

create or replace function public.upsert_capital_repair_opening_pending(
  p_property_id bigint,
  p_billing_year integer,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_id uuid;
begin
  if p_property_id is null or p_property_id <= 0 then
    raise exception 'upsert_capital_repair_opening_pending: property required' using errcode = '22023';
  end if;

  update public.capital_repair_opening_pending as u
     set billing_year = coalesce(p_billing_year, u.billing_year),
         payload = coalesce(p_payload, '{}'::jsonb),
         status = 'needs_initial',
         updated_at = now(),
         confirmed_at = null,
         confirmed_by_email = null
   where u.property_id = p_property_id
     and u.status = 'needs_initial'
  returning u.id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.capital_repair_opening_pending (
    property_id, billing_year, payload, status
  ) values (
    p_property_id, p_billing_year, coalesce(p_payload, '{}'::jsonb), 'needs_initial'
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.upsert_capital_repair_opening_pending(bigint, integer, jsonb) from public, anon;
grant execute on function public.upsert_capital_repair_opening_pending(bigint, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Soft import: empty amounts → DEFER; explicit 0 → CREATE; blank rows skipped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_import_capital_repair_opening(
  p_rows jsonb,
  p_dry_run boolean DEFAULT true,
  p_batch_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := auth.email();
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_idx int := 0;
  v_row_num int;
  v_apt text;
  v_property_id bigint;
  v_resolve_err text;
  v_year int;
  v_obl text;
  v_title text;
  v_assessed numeric(12, 2);
  v_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_over numeric(12, 2);
  v_assessed_raw text;
  v_paid_raw text;
  v_remaining_raw text;
  v_over_raw text;
  v_amounts_blank boolean;
  v_transition date;
  v_transition_raw text;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_res jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_deferred int := 0;
  v_blank_skipped int := 0;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_years int[];
  v_year_one int;
  v_missing text;
  v_scope text;
  v_scopes text[] := '{}';
  v_deferred_pids bigint[] := '{}';
  v_row_errors text[];
  v_outcome text;
  v_field text;
  v_has_any_field boolean;
  v_assessment_id uuid;
begin
  -- Dry-run (preview / reimport check) stays available after initial setup.
  -- Apply still requires writable initial-setup (wizard).
  if not coalesce(p_dry_run, true) then
    perform public.admin_assert_module_initial_setup_writable('capital_repair');
  end if;

  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_capital_repair_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_capital_repair_opening: not allowed' using errcode = '42501';
  end if;

  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('capital_repair');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_capital_repair_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if coalesce(p_dry_run, true) then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'batch_id', v_batch,
        'row_count', 0,
        'created_count', 0,
        'skipped_existing_count', 0,
        'deferred_count', 0,
        'blank_skipped_count', 0,
        'error_count', 1,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0, 'field', 'rows', 'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch')
        )),
        'rows', '[]'::jsonb,
        'synthetic_payments', false,
        'charges_generated', false,
        'tariff_required', false,
        'reason', 'empty_batch'
      );
    end if;
    raise exception 'admin_import_capital_repair_opening: empty batch not allowed'
      using errcode = '22023';
  end if;

  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_row_num := coalesce(nullif(btrim(coalesce(v_elem->>'rowNumber', v_elem->>'row', '')), '')::int, v_idx + 1);
    v_row_errors := '{}';
    v_field := 'capital_repair_opening';
    v_apt := nullif(btrim(coalesce(v_elem->>'apartment_number', '')), '');
    v_property_id := null;
    v_year := null;
    v_assessed := null;
    v_paid := null;
    v_remaining := null;
    v_over := null;
    v_transition := null;
    v_src := nullif(btrim(coalesce(v_elem->>'source_reference', '')), '');
    v_notes := nullif(btrim(coalesce(v_elem->>'notes', '')), '');
    v_title := nullif(btrim(coalesce(v_elem->>'assessment_title', '')), '');
    v_obl := lower(btrim(coalesce(v_elem->>'obligation_type', 'capital_repair')));
    v_assessed_raw := nullif(btrim(coalesce(v_elem->>'assessed_amount', '')), '');
    v_paid_raw := nullif(btrim(coalesce(v_elem->>'historically_paid_amount', '')), '');
    v_remaining_raw := nullif(btrim(coalesce(v_elem->>'remaining_debt', '')), '');
    v_over_raw := nullif(btrim(coalesce(v_elem->>'opening_overpayment', '')), '');
    v_transition_raw := nullif(btrim(coalesce(v_elem->>'transition_date', '')), '');

    v_has_any_field :=
      v_apt is not null
      or nullif(btrim(coalesce(v_elem->>'section_code', '')), '') is not null
      or nullif(btrim(coalesce(v_elem->>'block_code', '')), '') is not null
      or nullif(btrim(coalesce(v_elem->>'billing_year', '')), '') is not null
      or v_assessed_raw is not null
      or v_paid_raw is not null
      or v_remaining_raw is not null
      or v_over_raw is not null
      or v_transition_raw is not null
      or v_src is not null
      or v_notes is not null
      or v_title is not null
      or (
        nullif(btrim(coalesce(v_elem->>'obligation_type', '')), '') is not null
        and lower(btrim(coalesce(v_elem->>'obligation_type', ''))) is distinct from 'capital_repair'
      );

    -- Fully blank Excel row → silent skip (do not block).
    if not v_has_any_field then
      v_blank_skipped := v_blank_skipped + 1;
      continue;
    end if;

    if v_apt is null then
      v_row_errors := array_append(v_row_errors, 'required:apartment_number');
      v_field := 'apartment_number';
    else
      select r.property_id, r.error_code into v_property_id, v_resolve_err
      from public.resolve_property_id_for_opening_import(
        v_apt,
        v_elem->>'section_code',
        v_elem->>'block_code'
      ) as r;
      if v_resolve_err is not null then
        v_row_errors := array_append(v_row_errors, v_resolve_err);
        v_field := case
          when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code'
          else 'apartment_number'
        end;
      end if;
    end if;

    begin
      v_year := nullif(btrim(coalesce(v_elem->>'billing_year', '')), '')::int;
    exception when others then
      v_year := null;
      v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
      v_field := 'billing_year';
    end;

    if v_obl is distinct from 'capital_repair' then
      v_row_errors := array_append(v_row_errors, 'unsupported:obligation_type');
      v_field := 'obligation_type';
    end if;

    -- Parse amounts without substituting zeros for blanks.
    begin
      if v_assessed_raw is not null then
        v_assessed := round(v_assessed_raw::numeric, 2);
      end if;
      if v_paid_raw is not null then
        v_paid := round(v_paid_raw::numeric, 2);
      end if;
      if v_remaining_raw is not null then
        v_remaining := round(v_remaining_raw::numeric, 2);
      end if;
      if v_over_raw is not null then
        v_over := round(v_over_raw::numeric, 2);
      end if;
    exception when others then
      v_row_errors := array_append(v_row_errors, 'invalid:amounts');
      v_field := 'assessed_amount';
      v_assessed := null;
      v_paid := null;
      v_remaining := null;
      v_over := null;
    end;

    v_amounts_blank :=
      v_assessed_raw is null
      and v_paid_raw is null
      and v_remaining_raw is null
      and v_over_raw is null;

    if not v_amounts_blank then
      if v_assessed_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:assessed_amount');
        v_field := 'assessed_amount';
      elsif v_assessed is null or v_assessed < 0 then
        v_row_errors := array_append(v_row_errors, 'invalid:assessed_amount');
        v_field := 'assessed_amount';
      end if;

      if v_paid_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:historically_paid_amount');
        if v_field = 'capital_repair_opening' then v_field := 'historically_paid_amount'; end if;
      elsif v_paid is null or v_paid < 0 then
        v_row_errors := array_append(v_row_errors, 'invalid:historically_paid_amount');
        if v_field = 'capital_repair_opening' then v_field := 'historically_paid_amount'; end if;
      end if;

      if v_remaining_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:remaining_debt');
        if v_field = 'capital_repair_opening' then v_field := 'remaining_debt'; end if;
      elsif v_remaining is null or v_remaining < 0 then
        v_row_errors := array_append(v_row_errors, 'invalid:remaining_debt');
        if v_field = 'capital_repair_opening' then v_field := 'remaining_debt'; end if;
      end if;

      if v_over_raw is not null and (v_over is null or v_over < 0) then
        v_row_errors := array_append(v_row_errors, 'invalid:opening_overpayment');
        if v_field = 'capital_repair_opening' then v_field := 'opening_overpayment'; end if;
      end if;

      if v_assessed is not null and v_paid is not null and v_remaining is not null
         and v_assessed <> round(v_paid + v_remaining, 2) then
        v_row_errors := array_append(v_row_errors, 'inconsistent:assessed_ne_paid_plus_remaining');
        v_field := 'assessed_amount';
      end if;

      if coalesce(v_remaining, 0) > 0 and coalesce(v_over, 0) > 0 then
        v_row_errors := array_append(v_row_errors, 'mutually_exclusive:debt_and_overpayment');
        v_field := 'opening_overpayment';
      end if;

      -- Complete amounts require year / transition / source.
      if v_year is null or v_year < 2000 or v_year > 2100 then
        if not ('invalid:billing_year' = any (v_row_errors)) then
          v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
        end if;
        if v_field = 'capital_repair_opening' then v_field := 'billing_year'; end if;
      end if;

      begin
        v_transition := v_transition_raw::date;
      exception when others then
        v_transition := null;
      end;
      if v_transition_raw is null then
        v_row_errors := array_append(v_row_errors, 'required:transition_date');
        if v_field = 'capital_repair_opening' then v_field := 'transition_date'; end if;
      elsif v_transition is null then
        v_row_errors := array_append(v_row_errors, 'invalid:transition_date');
        if v_field = 'capital_repair_opening' then v_field := 'transition_date'; end if;
      elsif v_transition > v_today then
        v_row_errors := array_append(v_row_errors, 'invalid:transition_date_future');
        if v_field = 'capital_repair_opening' then v_field := 'transition_date'; end if;
      end if;

      if v_src is null then
        v_row_errors := array_append(v_row_errors, 'required:source_reference');
        if v_field = 'capital_repair_opening' then v_field := 'source_reference'; end if;
      end if;
    else
      -- Soft-defer path: optional year/transition/source stored in payload.
      if nullif(btrim(coalesce(v_elem->>'billing_year', '')), '') is not null
         and (v_year is null or v_year < 2000 or v_year > 2100) then
        if not ('invalid:billing_year' = any (v_row_errors)) then
          v_row_errors := array_append(v_row_errors, 'invalid:billing_year');
        end if;
        v_field := 'billing_year';
      end if;
      if v_transition_raw is not null then
        begin
          v_transition := v_transition_raw::date;
        exception when others then
          v_transition := null;
          v_row_errors := array_append(v_row_errors, 'invalid:transition_date');
          v_field := 'transition_date';
        end;
        if v_transition is not null and v_transition > v_today then
          v_row_errors := array_append(v_row_errors, 'invalid:transition_date_future');
          v_field := 'transition_date';
        end if;
      end if;
    end if;

    -- Deferred apt|year counts as covered; deferred apt without year covers every year in batch.
    if v_property_id is not null and v_year is not null and v_year >= 2000 and v_year <= 2100 then
      v_scope := v_property_id::text || '|' || v_year::text;
      if v_scope = any (v_scopes) then
        v_row_errors := array_append(v_row_errors, 'duplicate_in_file:apartment_year');
        v_field := 'billing_year';
      else
        v_scopes := array_append(v_scopes, v_scope);
      end if;
    elsif v_property_id is not null and v_amounts_blank then
      if not (v_property_id = any (v_deferred_pids)) then
        v_deferred_pids := array_append(v_deferred_pids, v_property_id);
      end if;
    end if;

    if coalesce(array_length(v_row_errors, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'codes', to_jsonb(v_row_errors),
        'reason', v_row_errors[1],
        'field', v_field,
        'action', 'fix_field_and_reupload'
      ));
      continue;
    end if;

    -- Soft defer: apartment resolved, amounts omitted.
    if v_amounts_blank then
      -- Already confirmed opening for this year → preserve, do not re-defer.
      if v_year is not null and exists (
        select 1 from public.capital_repair_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
      ) then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'apartment_number', v_apt,
          'property_id', v_property_id,
          'billing_year', v_year,
          'outcome', 'SKIP',
          'warnings', jsonb_build_array('preserved_confirmed_opening'),
          'remaining_debt', null,
          'opening_overpayment', null,
          'assessed_amount', null
        ));
        continue;
      end if;

      -- Any confirmed opening on property without year in file → preserve.
      if v_year is null and exists (
        select 1 from public.capital_repair_opening_imports as i
        where i.property_id = v_property_id
      ) then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'apartment_number', v_apt,
          'property_id', v_property_id,
          'billing_year', v_year,
          'outcome', 'SKIP',
          'warnings', jsonb_build_array('preserved_confirmed_opening'),
          'remaining_debt', null,
          'opening_overpayment', null,
          'assessed_amount', null
        ));
        continue;
      end if;

      if not coalesce(p_dry_run, true) then
        perform public.upsert_capital_repair_opening_pending(
          v_property_id,
          v_year,
          jsonb_build_object(
            'transition_date', v_transition,
            'source_reference', v_src,
            'notes', v_notes,
            'assessment_title', v_title,
            'excel_row', v_row_num
          )
        );
      end if;

      v_deferred := v_deferred + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'property_id', v_property_id,
        'billing_year', v_year,
        'outcome', 'DEFER',
        'status', 'needs_initial',
        'warnings', jsonb_build_array('can_enter_later'),
        'remaining_debt', null,
        'opening_overpayment', null,
        'assessed_amount', null,
        'applied', not coalesce(p_dry_run, true)
      ));
      continue;
    end if;

    -- Complete amounts: conflict / skip classification.
    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = v_property_id
        and i.billing_year = v_year
        and (
          i.assessed_amount is distinct from v_assessed
          or i.historically_paid_amount is distinct from v_paid
          or i.remaining_debt is distinct from v_remaining
          or i.opening_overpayment is distinct from coalesce(v_over, 0)
        )
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_opening_import_mismatch'),
        'reason', 'conflict:existing_opening_import_mismatch',
        'field', 'capital_repair_opening',
        'action', 'keep_existing_or_correct_file'
      ));
      continue;
    end if;

    -- Resolve assessment title for operational-charge conflict checks.
    v_assessment_id := null;
    if v_title is not null then
      select a.id into v_assessment_id
      from public.capital_repair_assessments as a
      where a.title = v_title
        and coalesce(a.status, 'active') is distinct from 'cancelled'
      order by a.created_at asc
      limit 1;
    else
      select a.id into v_assessment_id
      from public.capital_repair_assessments as a
      where a.title = 'Капитальный ремонт ' || v_year::text
        and coalesce(a.status, 'active') is distinct from 'cancelled'
      order by a.created_at asc
      limit 1;
    end if;

    if v_assessment_id is not null and exists (
      select 1 from public.capital_repair_ledger as l
      where l.property_id = v_property_id
        and l.assessment_id = v_assessment_id
        and l.kind = 'charge'
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('conflict:existing_operational_charge'),
        'reason', 'conflict:existing_operational_charge',
        'field', 'capital_repair_opening',
        'action', 'choose_other_year_or_void_existing'
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      if exists (
        select 1 from public.capital_repair_opening_imports as i
        where i.property_id = v_property_id
          and i.billing_year = v_year
          and i.assessed_amount = v_assessed
          and i.historically_paid_amount = v_paid
          and i.remaining_debt = v_remaining
          and i.opening_overpayment = coalesce(v_over, 0)
      ) then
        v_skipped := v_skipped + 1;
        v_outcome := 'SKIP';
      else
        v_outcome := 'CREATE';
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', v_apt,
        'property_id', v_property_id,
        'billing_year', v_year,
        'outcome', v_outcome,
        'remaining_debt', v_remaining,
        'opening_overpayment', coalesce(v_over, 0),
        'assessed_amount', v_assessed
      ));
      continue;
    end if;

    -- Commit path for complete amounts
    v_idem := coalesce(
      nullif(btrim(coalesce(v_elem->>'idempotency_key', '')), '')::uuid,
      gen_random_uuid()
    );
    v_res := public.import_capital_repair_opening_state(
      v_property_id,
      v_year,
      'capital_repair',
      v_assessed,
      v_paid,
      v_remaining,
      coalesce(v_over, 0),
      v_transition,
      v_src,
      v_notes,
      v_idem,
      v_title,
      v_batch
    );
    v_outcome := coalesce(v_res->>'outcome', 'CREATED');
    if v_outcome = 'CREATED' then
      v_created := v_created + 1;
      update public.capital_repair_opening_pending as u
         set status = 'confirmed',
             confirmed_at = now(),
             confirmed_by_email = v_email,
             updated_at = now(),
             billing_year = coalesce(u.billing_year, v_year)
       where u.property_id = v_property_id
         and u.status = 'needs_initial';
    else
      v_skipped := v_skipped + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', v_row_num,
      'apartment_number', v_apt,
      'property_id', v_property_id,
      'billing_year', v_year,
      'outcome', v_outcome,
      'remaining_debt', coalesce((v_res->>'remaining_debt')::numeric, v_remaining),
      'opening_overpayment', coalesce(v_over, 0),
      'assessment_id', v_res->>'assessment_id',
      'import_id', v_res->>'import_id'
    ));
  end loop;

  -- All apartments must be covered for each billing_year present in the file.
  -- Deferred apartments (no year in file) count as covered for every year in batch.
  select array_agg(distinct (split_part(s, '|', 2))::int)
  into v_years
  from unnest(v_scopes) as s;
  if v_years is not null then
    foreach v_year_one in array v_years
    loop
      select string_agg(
               p.apartment_number || coalesce('/' || nullif(btrim(p.section_code), ''), ''),
               ', ' order by p.apartment_number, p.section_code
             )
      into v_missing
      from public.properties as p
      where p.archived_at is null
        and not exists (
          select 1
          from unnest(v_scopes) as s
          where split_part(s, '|', 1)::bigint = p.id
            and split_part(s, '|', 2)::int = v_year_one
        )
        and not (p.id = any (v_deferred_pids));
      if v_missing is not null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', 0,
          'apartment_number', '',
          'codes', jsonb_build_array('missing_apartment_coverage'),
          'reason', 'missing_apartment_coverage',
          'field', 'billing_year',
          'billing_year', v_year_one,
          'missing', v_missing,
          'action', 'add_missing_apartments_or_defer_rows'
        ));
      end if;
    end loop;
  end if;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_capital_repair_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'dry_run', coalesce(p_dry_run, true),
    'batch_id', v_batch,
    'row_count', jsonb_array_length(p_rows) - v_blank_skipped,
    'created_count', v_created,
    'skipped_existing_count', v_skipped,
    'deferred_count', v_deferred,
    'blank_skipped_count', v_blank_skipped,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'rows', v_results,
    'synthetic_payments', false,
    'charges_generated', false,
    'tariff_required', false,
    'reconcile', jsonb_build_object(
      'remaining_debt_sum', (
        select coalesce(sum((r->>'remaining_debt')::numeric), 0)
        from jsonb_array_elements(v_results) as r
        where r->>'outcome' in ('CREATE', 'CREATED', 'SKIP', 'SKIPPED_EXISTING')
      ),
      'opening_overpayment_sum', (
        select coalesce(sum((r->>'opening_overpayment')::numeric), 0)
        from jsonb_array_elements(v_results) as r
        where r->>'outcome' in ('CREATE', 'CREATED', 'SKIP', 'SKIPPED_EXISTING')
      ),
      'apartment_rows', jsonb_array_length(v_results),
      'deferred_count', v_deferred
    )
  );
end;
$function$;

revoke all on function public.admin_import_capital_repair_opening(jsonb, boolean, uuid) from public, anon;
grant execute on function public.admin_import_capital_repair_opening(jsonb, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Late confirm from apartment card
-- ---------------------------------------------------------------------------
create or replace function public.admin_confirm_capital_repair_opening(
  p_property_id bigint,
  p_billing_year integer,
  p_assessed_amount numeric,
  p_historically_paid_amount numeric,
  p_remaining_debt numeric,
  p_opening_overpayment numeric default 0,
  p_transition_date date default null,
  p_source_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default null,
  p_assessment_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email text := auth.email();
  v_pending public.capital_repair_opening_pending;
  v_idem uuid := coalesce(p_idempotency_key, gen_random_uuid());
  v_res jsonb;
  v_assessed numeric(12, 2) := round(coalesce(p_assessed_amount, -1), 2);
  v_paid numeric(12, 2) := round(coalesce(p_historically_paid_amount, -1), 2);
  v_remaining numeric(12, 2) := round(coalesce(p_remaining_debt, -1), 2);
  v_over numeric(12, 2) := round(coalesce(p_opening_overpayment, 0), 2);
  v_title text := nullif(btrim(coalesce(p_assessment_title, '')), '');
  v_assessment_id uuid;
  v_net numeric(12, 2);
  v_kind text;
begin
  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_confirm_capital_repair_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_confirm_capital_repair_opening: not allowed' using errcode = '42501';
  end if;
  if p_property_id is null or p_property_id <= 0 then
    raise exception 'admin_confirm_capital_repair_opening: property required' using errcode = '22023';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'admin_confirm_capital_repair_opening: invalid billing_year' using errcode = '22023';
  end if;
  if p_transition_date is null then
    raise exception 'admin_confirm_capital_repair_opening: transition_date required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_source_reference, '')), '') is null then
    raise exception 'admin_confirm_capital_repair_opening: source_reference required' using errcode = '22023';
  end if;
  if v_assessed < 0 or v_paid < 0 or v_remaining < 0 or v_over < 0 then
    raise exception 'admin_confirm_capital_repair_opening: amounts must be nonnegative' using errcode = '22023';
  end if;
  if v_assessed <> round(v_paid + v_remaining, 2) then
    raise exception 'admin_confirm_capital_repair_opening: assessed must equal historically_paid + remaining'
      using errcode = '22023';
  end if;
  if v_remaining > 0 and v_over > 0 then
    raise exception 'admin_confirm_capital_repair_opening: remaining_debt and opening_overpayment are mutually exclusive'
      using errcode = '22023';
  end if;

  select * into v_pending
  from public.capital_repair_opening_pending as u
  where u.property_id = p_property_id
    and u.status = 'needs_initial'
  order by u.updated_at desc
  limit 1;

  if not found then
    -- Already confirmed opening for this year → idempotent.
    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = p_property_id
        and i.billing_year = p_billing_year
        and i.assessed_amount = v_assessed
        and i.historically_paid_amount = v_paid
        and i.remaining_debt = v_remaining
        and i.opening_overpayment = v_over
    ) then
      return jsonb_build_object(
        'ok', true,
        'applied', false,
        'idempotent', true,
        'outcome', 'SKIPPED_EXISTING',
        'reason', 'already_confirmed'
      );
    end if;
    raise exception 'admin_confirm_capital_repair_opening: no pending opening for property'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and i.billing_year = p_billing_year
  ) then
    raise exception 'admin_confirm_capital_repair_opening: conflict:existing_opening_import for billing_year %',
      p_billing_year
      using errcode = 'P0001';
  end if;

  if v_title is null then
    v_title := nullif(btrim(coalesce(v_pending.payload->>'assessment_title', '')), '');
  end if;
  if v_title is null then
    v_title := 'Капитальный ремонт ' || p_billing_year::text;
  end if;

  select a.id into v_assessment_id
  from public.capital_repair_assessments as a
  where a.title = v_title
    and coalesce(a.status, 'active') is distinct from 'cancelled'
  order by a.created_at asc
  limit 1;

  if v_assessment_id is not null and exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = v_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'admin_confirm_capital_repair_opening: conflict:existing_operational_charge for billing_year %',
      p_billing_year
      using errcode = 'P0001';
  end if;

  begin
    v_res := public.import_capital_repair_opening_state(
      p_property_id,
      p_billing_year,
      'capital_repair',
      v_assessed,
      v_paid,
      v_remaining,
      v_over,
      p_transition_date,
      p_source_reference,
      p_notes,
      v_idem,
      v_title,
      null
    );
  exception
    when others then
      raise exception 'admin_confirm_capital_repair_opening: %', sqlerrm
        using errcode = sqlstate;
  end;

  update public.capital_repair_opening_pending as u
     set status = 'confirmed',
         billing_year = p_billing_year,
         payload = coalesce(u.payload, '{}'::jsonb) || jsonb_build_object(
           'assessed_amount', v_assessed,
           'historically_paid_amount', v_paid,
           'remaining_debt', v_remaining,
           'opening_overpayment', v_over,
           'transition_date', p_transition_date,
           'source_reference', p_source_reference
         ),
         confirmed_at = now(),
         confirmed_by_email = v_email,
         updated_at = now()
   where u.id = v_pending.id;

  v_net := round(v_remaining - v_over, 2);
  v_kind := case
    when v_remaining > 0 then 'debt'
    when v_over > 0 then 'credit'
    else 'zero'
  end;

  return jsonb_build_object(
    'ok', true,
    'applied', coalesce((v_res->>'applied')::boolean, true),
    'idempotent', coalesce((v_res->>'idempotent')::boolean, false),
    'outcome', coalesce(v_res->>'outcome', 'CREATED'),
    'import_id', v_res->>'import_id',
    'assessment_id', v_res->>'assessment_id',
    'remaining_due', v_remaining,
    'opening_overpayment', v_over,
    'balance_kind', v_kind,
    'balance_net', v_net,
    'synthetic_payments', false,
    'charges_generated', false
  );
end;
$fn$;

revoke all on function public.admin_confirm_capital_repair_opening(
  bigint, integer, numeric, numeric, numeric, numeric, date, text, text, uuid, text
) from public, anon;
grant execute on function public.admin_confirm_capital_repair_opening(
  bigint, integer, numeric, numeric, numeric, numeric, date, text, text, uuid, text
) to authenticated;

-- Card confirm after wizard: import_capital_repair_opening_state must not require
-- initial-setup writability when a needs_initial pending slot exists (mirrors
-- the support-fee soft-defer patch in 20261130340200).
do $patch_cr_soft$
declare
  def text;
  newdef text;
  needle text := 'perform public.admin_assert_module_initial_setup_writable(''capital_repair'');';
  replacement text := $b$if not exists (
    select 1 from public.capital_repair_opening_pending as u
    where u.property_id = p_property_id
      and u.status = 'needs_initial'
  ) then
    perform public.admin_assert_module_initial_setup_writable('capital_repair');
  end if;$b$;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'import_capital_repair_opening_state'
  order by p.oid
  limit 1;

  if def is null then
    raise exception 'patch: import_capital_repair_opening_state missing';
  end if;
  if position('capital_repair_opening_pending' in def) > 0
     and position('needs_initial' in def) > 0
     and position('admin_assert_module_initial_setup_writable' in def) > 0 then
    raise notice 'import_capital_repair_opening_state already soft-confirm aware';
    return;
  end if;
  if position('admin_assert_module_initial_setup_writable' in def) = 0 then
    raise notice 'import_capital_repair_opening_state has no initial-setup gate; nothing to patch';
    return;
  end if;
  if position(needle in def) = 0 then
    raise exception 'patch: expected setup gate not found in import_capital_repair_opening_state';
  end if;
  newdef := replace(def, needle, replacement);
  if newdef = def then
    raise exception 'patch: replace produced no change';
  end if;
  execute newdef;
  raise notice 'patched import_capital_repair_opening_state for soft-defer card confirm';
end;
$patch_cr_soft$;
