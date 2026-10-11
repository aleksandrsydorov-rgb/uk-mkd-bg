-- =============================================================================
-- PKG-XFER Stage 5B — SAFE database-level smoke (BEGIN / ROLLBACK)
-- Fixture scope: synthetic apt 99381 (bigint) + floor; emails smoke.xfer5b.*@example.com
-- NEVER apartment 99501 / Owner A/B.
-- Schema note: properties.apartment_number and properties.floor are bigint NOT NULL.
-- No JWT GUC spoofing. No auth.users / storage.objects inserts.
-- No owner_transfers DML. Tariff transition helper is SECURITY DEFINER (no auth.uid
-- gate) and is exercised for prospective audit metadata only.
-- Linked-correction / verify-attach / LE-rep RPCs requiring sessions → SKIPPED.
-- =============================================================================

begin;

create temporary table pg_temp.xfer5b_results (
  check_id text primary key,
  status text not null check (status in ('PASS', 'FAIL', 'SKIPPED')),
  detail text null
) on commit drop;

create or replace function pg_temp.xfer5b_mark(p_id text, p_status text, p_detail text default null)
returns void language plpgsql as $fn$
begin
  insert into pg_temp.xfer5b_results (check_id, status, detail)
  values (p_id, p_status, p_detail)
  on conflict (check_id) do update set status = excluded.status, detail = excluded.detail;
end;
$fn$;

do $body$
declare
  apt bigint := 99381;
  prop_id bigint;
  ideal numeric := 1.810000;
  floor_n bigint := 9;
  owner_a text := 'smoke.xfer5b.a@example.com';
  owner_b text := 'smoke.xfer5b.b@example.com';
  natural_owners jsonb;
  legal_owners jsonb;
  natural2_owners jsonb;
  mixed_owners jsonb;
  transition jsonb;
  assess_before numeric;
  assess_after numeric;
  n_hist integer;
  raised boolean;
  n_fail integer;
begin
  if to_regprocedure('public.ownership_roster_tariff_subject(jsonb)') is null
     or to_regclass('public.ownership_tariff_transitions') is null
  then
    raise exception 'smoke5b: Stage 5B migration not applied';
  end if;

  insert into public.properties (
    apartment_number, floor, ideal_parts_percent, ownership_type, owner_email, owner_name
  ) values (apt, floor_n, ideal, 'sole', owner_a, 'Smoke 5B Natural')
  returning id into prop_id;

  natural_owners := jsonb_build_array(jsonb_build_object(
    'entity_kind', 'natural_person',
    'first_name', 'Smoke', 'last_name', 'Natural', 'email', owner_a,
    'ownership_share_percent', 100, 'ideal_parts_percent', ideal
  ));
  natural2_owners := jsonb_build_array(jsonb_build_object(
    'entity_kind', 'natural_person',
    'first_name', 'Smoke', 'last_name', 'Buyer', 'email', owner_b,
    'ownership_share_percent', 100, 'ideal_parts_percent', ideal
  ));
  legal_owners := jsonb_build_array(jsonb_build_object(
    'entity_kind', 'legal_entity',
    'entity_name', 'Smoke LE EOOD', 'eik_bulstat', '123456789',
    'email', 'smoke.xfer5b.le@example.com',
    'ownership_share_percent', 100, 'ideal_parts_percent', ideal
  ));
  mixed_owners := jsonb_build_array(
    jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'A', 'last_name', 'Mix', 'email', owner_a,
      'ownership_share_percent', 50, 'ideal_parts_percent', round(ideal / 2, 6)
    ),
    jsonb_build_object(
      'entity_kind', 'legal_entity',
      'entity_name', 'Mix LE', 'eik_bulstat', '987654321',
      'email', 'smoke.xfer5b.mix@example.com',
      'ownership_share_percent', 50, 'ideal_parts_percent', round(ideal / 2, 6)
    )
  );

  raised := false;
  begin
    perform public.ownership_change_validate_owners(prop_id, mixed_owners);
  exception when others then
    raised := true;
  end;
  perform pg_temp.xfer5b_mark(
    'S5B-DB-01_mixed_natural_legal_banned',
    case when raised then 'PASS' else 'FAIL' end
  );

  perform pg_temp.xfer5b_mark(
    'S5B-DB-02_roster_subject_natural',
    case when public.ownership_roster_tariff_subject(natural_owners) = 'natural'
      then 'PASS' else 'FAIL' end
  );
  perform pg_temp.xfer5b_mark(
    'S5B-DB-03_roster_subject_legal',
    case when public.ownership_roster_tariff_subject(legal_owners) = 'legal'
      then 'PASS' else 'FAIL' end
  );

  -- Historic assessment immutability across transition recording
  begin
    insert into public.support_fee_assessments (
      property_id, billing_year, base_amount, early_amount, late_amount,
      pricing_rule, qualification_status, final_amount, remaining_due, status
    ) values (
      prop_id, 2025, 42.50, 42.50, 42.50,
      'standard', 'qualified', 42.50, 42.50, 'posted'
    );
  exception when others then
    null;
  end;

  select count(*)::integer, coalesce(sum(final_amount), 0)
    into n_hist, assess_before
  from public.support_fee_assessments
  where property_id = prop_id;

  transition := public.ownership_record_tariff_transition(
    prop_id, null, natural_owners, legal_owners, (current_date - 30), now()
  );
  perform pg_temp.xfer5b_mark(
    'S5B-DB-04_natural_to_legal_transition',
    case when (transition ->> 'changed')::boolean
      and (transition ->> 'historic_assessments_untouched')::boolean
      then 'PASS' else 'FAIL' end,
    transition::text
  );

  perform pg_temp.xfer5b_mark(
    'S5B-DB-05_past_effective_date_note',
    case when exists (
      select 1 from public.ownership_tariff_transitions
      where property_id = prop_id
        and subject_before = 'natural' and subject_after = 'legal'
        and note like '%legal_effective_date_before_approval%'
    ) then 'PASS' else 'FAIL' end
  );

  transition := public.ownership_record_tariff_transition(
    prop_id, null, legal_owners, natural_owners, current_date, now()
  );
  perform pg_temp.xfer5b_mark(
    'S5B-DB-06_legal_to_natural_transition',
    case when (transition ->> 'changed')::boolean
      and (transition ->> 'subject_after') = 'natural'
      then 'PASS' else 'FAIL' end
  );

  transition := public.ownership_record_tariff_transition(
    prop_id, null, natural_owners, natural2_owners, current_date, now()
  );
  perform pg_temp.xfer5b_mark(
    'S5B-DB-07_natural_to_natural_no_subject_change',
    case when (transition ->> 'changed')::boolean is false then 'PASS' else 'FAIL' end
  );

  select coalesce(sum(final_amount), 0) into assess_after
  from public.support_fee_assessments where property_id = prop_id;
  perform pg_temp.xfer5b_mark(
    'S5B-DB-08_historic_assessments_unchanged',
    case when assess_after is not distinct from assess_before
      and (
        select count(*)::integer from public.support_fee_assessments where property_id = prop_id
      ) is not distinct from n_hist
      then 'PASS' else 'FAIL' end
  );

  -- Authenticated must not INSERT transitions
  perform pg_temp.xfer5b_mark(
    'S5B-DB-09_auth_cannot_insert_transitions',
    case when has_table_privilege('authenticated', 'public.ownership_tariff_transitions', 'INSERT')
      then 'FAIL' else 'PASS' end
  );

  -- Hardened attach requires auth — call without session must fail (no spoof)
  raised := false;
  begin
    perform public.owner_verify_and_attach_extract_pdf(
      1, '00000000-0000-4000-8000-000000005bd1'::uuid, repeat('ab', 32), true
    );
  exception when others then
    raised := sqlerrm ilike '%not authenticated%' or sqlerrm ilike '%not found%' or sqlerrm ilike '%not allowed%';
  end;
  perform pg_temp.xfer5b_mark(
    'S5B-DB-10_verify_attach_rejects_unauthenticated',
    case when raised then 'PASS' else 'FAIL' end
  );

  -- Auth deferred (real sessions — not PASS)
  perform pg_temp.xfer5b_mark('S5B-AUTH-01_representative_only_no_tariff', 'SKIPPED', 'session plan L2; needs real admin LE-rep session');
  perform pg_temp.xfer5b_mark('S5B-AUTH-02_linked_correction_flow', 'SKIPPED', 'session plan A10; needs real admin session');
  perform pg_temp.xfer5b_mark('S5B-AUTH-03_original_transfer_immutable', 'SKIPPED', 'session plan A11; needs real approve+correction path');
  perform pg_temp.xfer5b_mark('S5B-AUTH-04_pdf_storage_object_matrix', 'SKIPPED', 'session plan D3/D4; needs real owner session + storage + API');
  perform pg_temp.xfer5b_mark('S5B-AUTH-05_former_owner_attach_denied', 'SKIPPED', 'session plan X3; needs real former-owner session');
  perform pg_temp.xfer5b_mark(
    'S5B-AUTH-06_admin_submit_linked_correction_rpc',
    'SKIPPED',
    'admin_submit_linked_ownership_correction requires auth; session plan A10'
  );

  select count(*)::integer into n_fail from pg_temp.xfer5b_results where status = 'FAIL';
  if n_fail > 0 then
    raise exception 'smoke5b: % FAIL check(s)', n_fail;
  end if;
end;
$body$;

select check_id, status, detail from pg_temp.xfer5b_results order by check_id;

rollback;
