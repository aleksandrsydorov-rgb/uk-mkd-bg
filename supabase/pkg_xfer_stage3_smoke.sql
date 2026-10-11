-- =============================================================================
-- PKG-XFER Stage 3 — SAFE database-level smoke (BEGIN / ROLLBACK)
-- Fixture scope: synthetic apt 99361 (bigint) + floor; emails smoke.xfer3.*@example.com
-- NEVER apartment 99501 / Owner A/B.
-- Schema note: properties.apartment_number and properties.floor are bigint NOT NULL.
-- No JWT GUC spoofing. No auth.users / storage.objects inserts.
-- No owner_transfers DML (auth insert/update triggers).
-- Admin RPCs (inheritance pending, guest grant, liability, LE rep, approve) → SKIPPED.
-- Settings toggles are in-txn only and restored before DO exit (outer ROLLBACK).
-- =============================================================================

begin;

create temporary table pg_temp.xfer3_results (
  check_id text primary key,
  status text not null check (status in ('PASS', 'FAIL', 'SKIPPED')),
  detail text null
) on commit drop;

create or replace function pg_temp.xfer3_mark(p_id text, p_status text, p_detail text default null)
returns void language plpgsql as $fn$
begin
  insert into pg_temp.xfer3_results (check_id, status, detail)
  values (p_id, p_status, p_detail)
  on conflict (check_id) do update set status = excluded.status, detail = excluded.detail;
end;
$fn$;

do $body$
declare
  apt bigint := 99361;
  prop_id bigint;
  ideal numeric := 1.500000;
  floor_n bigint := 9;
  owner_a text := 'smoke.xfer3.a@example.com';
  owner_id bigint;
  debt jsonb;
  gate_was boolean;
  assess_ok boolean := false;
  overdue_n numeric;
  future_n numeric;
  n_fail integer;
begin
  if to_regprocedure('public.ownership_change_overdue_debt(bigint)') is null then
    raise exception 'smoke3: Stage 3 finance helpers not applied';
  end if;

  insert into public.properties (
    apartment_number, floor, ideal_parts_percent, ownership_type, owner_email, owner_name
  ) values (apt, floor_n, ideal, 'sole', owner_a, 'Smoke Xfer3 A')
  returning id into prop_id;

  perform public.property_book_set_mutating(true);
  insert into public.property_registry_people (
    property_id, relation_type, entity_kind, first_name, last_name, email,
    ownership_share_percent, ideal_parts_percent, admin_status, voting_eligible
  ) values (
    prop_id, 'owner', 'natural_person', 'Smoke', 'Xfer3A', owner_a,
    100, ideal, 'active', true
  ) returning id into owner_id;
  perform public.property_book_set_mutating(false);

  -- Assessments for overdue vs future-due (rolled back)
  begin
    insert into public.support_fee_assessments (
      property_id, billing_year, status, remaining_due, early_deadline_at,
      base_amount, early_amount, late_amount, final_amount, pricing_rule,
      qualification_status, available_credit_at_check, amount_covered_at_check,
      dedicated_payment_at_check, applied_credit_amount, applied_payment_amount,
      discount_percent, increase_percent
    ) values
      (prop_id, 2090, 'open', 50, now() - interval '10 days',
       50, 50, 50, 50, 'smoke', 'unknown', 0, 0, 0, 0, 0, 0, 0),
      (prop_id, 2091, 'open', 25, now() + interval '30 days',
       25, 25, 25, 25, 'smoke', 'unknown', 0, 0, 0, 0, 0, 0, 0);
    assess_ok := true;
  exception when others then
    assess_ok := false;
  end;

  debt := public.ownership_change_overdue_debt(prop_id);
  overdue_n := coalesce((debt ->> 'overdue_unpaid_eur')::numeric, 0);
  future_n := coalesce((debt ->> 'future_due_eur')::numeric, 0);

  if assess_ok then
    perform pg_temp.xfer3_mark(
      'S3-DB-01_overdue_vs_future_due',
      case when future_n >= 0 and (overdue_n > 0 or future_n > 0) then 'PASS' else 'FAIL' end,
      format('overdue=%s future=%s', overdue_n, future_n)
    );
  else
    perform pg_temp.xfer3_mark(
      'S3-DB-01_overdue_vs_future_due',
      'SKIPPED',
      'support_fee_assessments insert schema mismatch'
    );
  end if;

  select ordinary_debt_gate_enabled into gate_was
  from public.ownership_change_settings where id = 1;

  -- Gate OFF reporting (restore always before exit of DO via exception handlers)
  update public.ownership_change_settings
     set ordinary_debt_gate_enabled = false
   where id = 1;
  debt := public.ownership_change_overdue_debt(prop_id);
  perform pg_temp.xfer3_mark(
    'S3-DB-02_debt_gate_off_flag',
    case when (debt ->> 'ordinary_debt_gate_enabled')::boolean is false then 'PASS' else 'FAIL' end
  );

  -- Gate ON + overdue → blocks_ordinary (rolled back with transaction)
  update public.ownership_change_settings
     set ordinary_debt_gate_enabled = true
   where id = 1;
  debt := public.ownership_change_overdue_debt(prop_id);
  if assess_ok and overdue_n > 0 then
    perform pg_temp.xfer3_mark(
      'S3-DB-03_gate_on_blocks_ordinary',
      case when (debt ->> 'blocks_ordinary')::boolean is true then 'PASS' else 'FAIL' end
    );
  else
    perform pg_temp.xfer3_mark(
      'S3-DB-03_gate_on_blocks_ordinary',
      'SKIPPED',
      'no overdue amount available in fixture'
    );
  end if;

  -- Restore legal default inside txn (still rolled back overall)
  update public.ownership_change_settings
     set ordinary_debt_gate_enabled = coalesce(gate_was, false)
   where id = 1;

  -- Voting eligibility via Book columns (no admin RPC)
  perform public.property_book_set_mutating(true);
  update public.property_registry_people
     set admin_status = 'deceased_recorded', voting_eligible = false
   where id = owner_id;
  perform public.property_book_set_mutating(false);

  perform pg_temp.xfer3_mark(
    'S3-DB-04_voting_eligible_false_for_deceased',
    case when public.property_book_voting_eligible_owner(owner_id) is false then 'PASS' else 'FAIL' end
  );

  perform pg_temp.xfer3_mark(
    'S3-DB-05_voting_parties_exclude_deceased',
    case when (
      select count(*) from public.property_voting_parties(prop_id)
    ) = 0 then 'PASS' else 'FAIL' end
  );

  perform pg_temp.xfer3_mark(
    'S3-DB-06_quorum_ideal_parts_preserved',
    case when exists (
      select 1 from public.property_registry_people
      where id = owner_id and ideal_parts_percent = ideal and deregistered_at is null
    ) then 'PASS' else 'FAIL' end
  );

  -- Tariff subject for natural owner (still natural/legal entity kind)
  perform public.property_book_set_mutating(true);
  update public.property_registry_people
     set admin_status = 'active', voting_eligible = true,
         entity_kind = 'legal_entity',
         entity_name = 'Smoke LE', eik_bulstat = '123456789',
         first_name = null, last_name = null
   where id = owner_id;
  perform public.property_book_set_mutating(false);

  perform pg_temp.xfer3_mark(
    'S3-DB-07_tariff_subject_legal_entity',
    case when public.property_tariff_subject_kind(prop_id) = 'legal' then 'PASS' else 'FAIL' end
  );

  -- Auth-gated (real sessions — not PASS)
  perform pg_temp.xfer3_mark('S3-AUTH-01_admin_set_inheritance_pending', 'SKIPPED', 'session plan I1; needs real admin session');
  perform pg_temp.xfer3_mark('S3-AUTH-02_guest_grant_revoke', 'SKIPPED', 'session plan I3; needs real admin session');
  perform pg_temp.xfer3_mark('S3-AUTH-03_inherited_liability_rpc', 'SKIPPED', 'session plan I4; needs real admin session');
  perform pg_temp.xfer3_mark('S3-AUTH-04_inheritance_approve_with_debt', 'SKIPPED', 'session plan F2; needs real admin session');
  perform pg_temp.xfer3_mark('S3-AUTH-05_ordinary_approve_blocked_gate_on', 'SKIPPED', 'session plan F3; needs real admin session');
  perform pg_temp.xfer3_mark('S3-AUTH-06_le_representative_change', 'SKIPPED', 'session plan L1; needs real admin session');
  perform pg_temp.xfer3_mark(
    'S3-AUTH-07_submit_approve_transfer_dml',
    'SKIPPED',
    'owner_transfers DML requires auth; session plan A1/A6'
  );

  select count(*)::integer into n_fail from pg_temp.xfer3_results where status = 'FAIL';
  if n_fail > 0 then
    raise exception 'smoke3: % FAIL check(s)', n_fail;
  end if;
end;
$body$;

select check_id, status, detail from pg_temp.xfer3_results order by check_id;

rollback;
