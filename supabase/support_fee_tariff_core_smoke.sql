-- =============================================================================
-- AMADEUS 11 — Support Fee Tariff Core smoke (BEGIN / ROLLBACK)
-- =============================================================================
-- Prerequisites:
--   - 20260926060000_support_fee_tariff_core_cutover.sql applied
--     (includes 2026-01-01 / 8.0000 Core baseline bootstrap)
--   - admin@example.com active in public.staff and linked to auth.users
--   - support_fee catalog seeded
-- Smoke publishes only FUTURE years and rolls back; does not assume empty history.
-- Automatically skips years that already have published/closed policies or
-- published Support tariff versions on that Jan-1.
-- =============================================================================

begin;

do $smoke$
declare
  v_staff_email text;
  v_uid uuid;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_y1 integer;
  v_y2 integer;
  v_y3 integer;
  v_cat uuid;
  v_ver1 uuid;
  v_ver2 uuid;
  v_ver_cancel uuid;
  v_resolved record;
  v_prop bigint;
  v_prop2 bigint;
  v_prop3 bigint;
  v_prop4 bigint;
  v_apt bigint;
  v_area numeric := 50.0;
  v_rate1 numeric := 9.00;
  v_rate2 numeric := 10.00;
  v_base1 numeric;
  v_base3 numeric;
  v_fin jsonb;
  v_fin2 jsonb;
  v_charge jsonb;
  v_assess public.support_fee_assessments%rowtype;
  v_ledger_count int;
  v_bound boolean;
  v_year_res jsonb;
  v_assess_id uuid;
begin
  select s.email, u.id
    into v_staff_email, v_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true
    and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id
  limit 1;

  if v_uid is null then
    raise exception 'smoke: admin@example.com is not active or not linked to auth.users';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', v_staff_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'email', v_staff_email)::text,
    true
  );

  select c.id into v_cat from public.tariff_catalog as c where c.tariff_key = 'support_fee';
  if v_cat is null then
    raise exception 'smoke: support_fee catalog missing';
  end if;

  -- Baseline compatibility (post-cutover): 2026 resolves to confirmed 8.0000
  select * into v_resolved from public.resolve_support_tariff_for_year(2026);
  if v_resolved.valid_from is distinct from date '2026-01-01'
     or v_resolved.rate is distinct from 8.0000 then
    raise exception 'smoke#baseline FAIL: expected 2026-01-01 / 8.0000 got % / %',
      v_resolved.valid_from, v_resolved.rate;
  end if;

  -- Pick a free future 3-year window (do not assume next calendar years are empty).
  -- Needs: no published/closed annual policy; no published Support tariff on those Jan-1 dates.
  v_y1 := extract(year from v_today)::integer + 1;
  loop
    v_y2 := v_y1 + 1;
    v_y3 := v_y1 + 2;
    exit when
      not exists (
        select 1
        from public.support_fee_annual_policies as p
        where p.billing_year in (v_y1, v_y2, v_y3)
          and p.status in ('published', 'closed')
      )
      and not exists (
        select 1
        from public.tariff_versions as tv
        where tv.tariff_id = v_cat
          and tv.status = 'published'
          and tv.valid_from in (
            make_date(v_y1, 1, 1),
            make_date(v_y2, 1, 1),
            make_date(v_y3, 1, 1)
          )
      );
    v_y1 := v_y1 + 1;
    if v_y1 > extract(year from v_today)::integer + 40 then
      raise exception 'smoke: no free future year window for policies/tariffs';
    end if;
  end loop;

  -- Publish Y1 = 9 EUR/m2
  select version_id into v_ver1
  from public.publish_tariff_version(
    v_cat, jsonb_build_object('base', v_rate1), 'external_decision',
    'Support Fee Core smoke Y1', gen_random_uuid(), v_y1, null,
    'SMOKE-SF-Y1-' || v_y1::text, v_today, null
  );

  -- 1 resolver for Y1
  select * into v_resolved from public.resolve_support_tariff_for_year(v_y1);
  if v_resolved.tariff_version_id is distinct from v_ver1
     or v_resolved.rate is distinct from v_rate1 then
    raise exception 'smoke#1 FAIL: resolver Y1';
  end if;

  -- 2 carry-forward: no Y2 version => Y1 rate
  select * into v_resolved from public.resolve_support_tariff_for_year(v_y2);
  if v_resolved.tariff_version_id is distinct from v_ver1 then
    raise exception 'smoke#2 FAIL: carry-forward';
  end if;

  -- Publish Y3 = 10 (skip Y2)
  select version_id into v_ver2
  from public.publish_tariff_version(
    v_cat, jsonb_build_object('base', v_rate2), 'external_decision',
    'Support Fee Core smoke Y3', gen_random_uuid(), v_y3, null,
    'SMOKE-SF-Y3-' || v_y3::text, v_today, null
  );

  -- 3 future does not affect earlier year
  select * into v_resolved from public.resolve_support_tariff_for_year(v_y1);
  if v_resolved.tariff_version_id is distinct from v_ver1
     or v_resolved.rate is distinct from v_rate1 then
    raise exception 'smoke#3 FAIL: future leaked into earlier year';
  end if;

  -- 4 cancelled future not selected
  select version_id into v_ver_cancel
  from public.publish_tariff_version(
    v_cat, jsonb_build_object('base', 99.99), 'external_decision',
    'Support Fee Core smoke cancel bait', gen_random_uuid(), v_y2, null,
    'SMOKE-SF-CANCEL-' || v_y2::text, v_today, null
  );
  perform public.cancel_future_tariff_version(v_ver_cancel, 'smoke cancel', gen_random_uuid());
  select * into v_resolved from public.resolve_support_tariff_for_year(v_y2);
  if v_resolved.tariff_version_id is not distinct from v_ver_cancel then
    raise exception 'smoke#4 FAIL: cancelled version selected';
  end if;
  if v_resolved.tariff_version_id is distinct from v_ver1 then
    raise exception 'smoke#4 FAIL: expected carry-forward after cancel';
  end if;

  -- 5 legacy setter blocked
  begin
    perform public.set_support_rate_eur_per_sqm_year(1);
    raise exception 'smoke#5 FAIL: legacy setter should raise';
  exception
    when others then
      if SQLERRM ilike 'smoke#5 FAIL%' then raise; end if;
      if SQLERRM not ilike '%Legacy Support Fee tariff publication disabled%' then
        raise exception 'smoke#5 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- Fixtures
  select coalesce(max(apartment_number), 0) + 910000 into v_apt from public.properties;
  insert into public.properties (apartment_number, floor, owner_name, area_sqm, debt, overpayment)
  values (v_apt, 1, 'Smoke SF Core A', v_area, 0, 1000)
  returning id into v_prop;
  insert into public.properties (apartment_number, floor, owner_name, area_sqm, debt, overpayment)
  values (v_apt + 1, 1, 'Smoke SF Core B', v_area, 0, 0)
  returning id into v_prop2;
  insert into public.properties (apartment_number, floor, owner_name, area_sqm, debt, overpayment)
  values (v_apt + 2, 1, 'Smoke SF Core C', v_area, 0, 0)
  returning id into v_prop3;
  insert into public.properties (apartment_number, floor, owner_name, area_sqm, debt, overpayment)
  values (v_apt + 3, 1, 'Smoke SF Core D Standard', v_area, 0, 0)
  returning id into v_prop4;

  -- Poison legacy building_settings rate
  update public.building_settings
     set support_rate_eur_per_sqm_year = 1.11
   where id = 1;

  -- Policies: Y1 early window (future deadline), Y2 late (past deadline)
  perform public.upsert_support_fee_annual_policy(
    v_y1, true, 10, 10, (now() + interval '30 days')
  );
  perform public.publish_support_fee_annual_policy(v_y1);

  perform public.upsert_support_fee_annual_policy(
    v_y2, true, 10, 10, (now() - interval '30 days')
  );
  perform public.publish_support_fee_annual_policy(v_y2);

  v_base1 := round(round(v_area, 3) * v_rate1, 2);

  -- 6/7/8/9/10 finalize with Core snapshot; legacy rate must not influence
  v_fin := public.finalize_support_fee_assessment(v_prop, v_y1);
  if coalesce((v_fin->>'applied')::boolean, false) is not true then
    raise exception 'smoke#6 FAIL: finalize not applied: %', v_fin;
  end if;

  select * into v_assess
  from public.support_fee_assessments
  where id = (v_fin->>'assessment_id')::uuid;

  if v_assess.tariff_version_id is distinct from v_ver1 then
    raise exception 'smoke#7 FAIL: tariff_version_id';
  end if;
  if v_assess.area_sqm_snapshot is distinct from round(v_area, 3) then
    raise exception 'smoke#8 FAIL: area snapshot';
  end if;
  if v_assess.rate_eur_per_sqm_year_snapshot is distinct from v_rate1 then
    raise exception 'smoke#9 FAIL: rate snapshot (legacy influenced?)';
  end if;
  if v_assess.base_amount is distinct from v_base1 then
    raise exception 'smoke#10 FAIL: base_amount % vs %', v_assess.base_amount, v_base1;
  end if;

  -- 17 early discount uses base snapshot
  if v_assess.pricing_rule is distinct from 'early_full_payment'
     or v_assess.final_amount is distinct from round(v_base1 * 0.9, 2) then
    raise exception 'smoke#17 FAIL: early discount';
  end if;

  -- 11/12/13/14 idempotent retry ignores area + new tariff
  update public.properties set area_sqm = 999 where id = v_prop;
  -- bait publish would need free year; instead mutate building_settings again
  update public.building_settings set support_rate_eur_per_sqm_year = 77.77 where id = 1;

  v_fin2 := public.finalize_support_fee_assessment(v_prop, v_y1);
  if coalesce((v_fin2->>'idempotent')::boolean, false) is not true then
    raise exception 'smoke#11 FAIL: retry not idempotent';
  end if;
  if (v_fin2->>'assessment_id') is distinct from (v_fin->>'assessment_id') then
    raise exception 'smoke#12 FAIL: different assessment on retry';
  end if;
  if (v_fin2->>'base_amount')::numeric is distinct from v_base1 then
    raise exception 'smoke#13 FAIL: retry used new area';
  end if;
  if (v_fin2->>'rate_eur_per_sqm_year_snapshot')::numeric is distinct from v_rate1 then
    raise exception 'smoke#14 FAIL: retry used live/legacy rate';
  end if;

  -- 15 one assessment
  if (
    select count(*) from public.support_fee_assessments
    where property_id = v_prop and billing_year = v_y1
  ) <> 1 then
    raise exception 'smoke#15 FAIL: duplicate assessment';
  end if;

  -- 16 no duplicate ledger charge
  select count(*) into v_ledger_count
  from public.support_fee_ledger
  where property_id = v_prop and kind = 'charge' and period = v_y1::text;
  if v_ledger_count <> 1 then
    raise exception 'smoke#16 FAIL: ledger charge count %', v_ledger_count;
  end if;

  -- 18 late increase uses base snapshot
  v_fin := public.finalize_support_fee_assessment(v_prop2, v_y2);
  if coalesce((v_fin->>'applied')::boolean, false) is not true then
    raise exception 'smoke#18 FAIL: late finalize: %', v_fin;
  end if;
  select * into v_assess
  from public.support_fee_assessments
  where id = (v_fin->>'assessment_id')::uuid;
  if v_assess.pricing_rule is distinct from 'late'
     or v_assess.final_amount is distinct from round(v_base1 * 1.1, 2)
     or v_assess.base_amount is distinct from v_base1 then
    raise exception 'smoke#18 FAIL: late amounts';
  end if;

  -- 19 correction does not mutate pricing snapshot
  begin
    update public.support_fee_assessments
       set base_amount = base_amount + 1
     where id = v_assess.id;
    raise exception 'smoke#19 FAIL: base_amount mutation allowed';
  exception
    when others then
      if SQLERRM ilike 'smoke#19 FAIL%' then raise; end if;
      if SQLERRM not ilike '%pricing snapshot is immutable%' then
        raise exception 'smoke#19 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  perform public.record_support_fee_assessment_correction(
    v_assess.id, 5.00, 'smoke correction'
  );
  select * into v_assess from public.support_fee_assessments where id = v_assess.id;
  if v_assess.base_amount is distinct from v_base1
     or v_assess.tariff_version_id is distinct from v_ver1
     or v_assess.rate_eur_per_sqm_year_snapshot is distinct from v_rate1 then
    raise exception 'smoke#19 FAIL: correction mutated snapshot';
  end if;

  -- 20/21 binding
  v_bound := public.tariff_version_bound_to_support_usage(v_ver1);
  if v_bound is not true then
    raise exception 'smoke#20 FAIL: binding false';
  end if;

  begin
    perform public.cancel_future_tariff_version(v_ver1, 'should fail bound', gen_random_uuid());
    raise exception 'smoke#21 FAIL: bound version cancelled';
  exception
    when others then
      if SQLERRM ilike 'smoke#21 FAIL%' then raise; end if;
      if SQLERRM not ilike '%bound to Support usage%'
         and SQLERRM not ilike '%effective or past%'
         and SQLERRM not ilike '%cannot be cancelled%' then
        raise exception 'smoke#21 FAIL: unexpected: %', SQLERRM;
      end if;
  end;

  -- 22 legacy charge without assessment not double-charged
  insert into public.support_fee_ledger (
    property_id, kind, amount, period, note, recorded_by, debt_after, overpayment_after
  ) values (
    v_prop3, 'charge', 12.34, v_y1::text, 'legacy charge', v_staff_email, 12.34, 0
  );
  update public.properties set debt = 12.34 where id = v_prop3;
  v_fin := public.finalize_support_fee_assessment(v_prop3, v_y1);
  if v_fin->>'reason' is distinct from 'charge_already_exists' then
    raise exception 'smoke#22 FAIL: expected charge_already_exists got %', v_fin;
  end if;
  if exists (
    select 1 from public.support_fee_assessments
    where property_id = v_prop3 and billing_year = v_y1
  ) then
    raise exception 'smoke#22 FAIL: assessment created over legacy charge';
  end if;

  -- ------------------------------------------------------------------
  -- STANDARD YEAR (Core tariff present, NO published enabled policy)
  -- Y3 has published tariff v_ver2; no annual policy for Y3.
  -- ------------------------------------------------------------------
  v_base3 := round(round(v_area, 3) * v_rate2, 2);

  -- Ensure no policy for Y3
  if exists (
    select 1 from public.support_fee_annual_policies
    where billing_year = v_y3 and enabled is true and status in ('published','closed')
  ) then
    raise exception 'smoke#24 setup FAIL: unexpected enabled policy for Y3';
  end if;

  -- 24/25/26/27/28/29/30 finalize creates standard assessment
  v_fin := public.finalize_support_fee_assessment(v_prop4, v_y3);
  if coalesce((v_fin->>'applied')::boolean, false) is not true then
    raise exception 'smoke#24 FAIL: standard finalize not applied: %', v_fin;
  end if;
  v_assess_id := (v_fin->>'assessment_id')::uuid;
  select * into v_assess from public.support_fee_assessments where id = v_assess_id;
  if v_assess.policy_id is not null then
    raise exception 'smoke#25 FAIL: policy_id should be null';
  end if;
  if v_assess.tariff_version_id is distinct from v_ver2 then
    raise exception 'smoke#26 FAIL: tariff_version_id';
  end if;
  if v_assess.area_sqm_snapshot is distinct from round(v_area, 3) then
    raise exception 'smoke#27 FAIL: area snapshot';
  end if;
  if v_assess.rate_eur_per_sqm_year_snapshot is distinct from v_rate2 then
    raise exception 'smoke#28 FAIL: rate snapshot';
  end if;
  if v_assess.base_amount is distinct from v_base3 then
    raise exception 'smoke#29 FAIL: base_amount';
  end if;
  if v_assess.final_amount is distinct from v_base3
     or v_assess.pricing_rule is distinct from 'standard'
     or v_assess.discount_percent is distinct from 0
     or v_assess.increase_percent is distinct from 0
     or v_assess.pricing_reason_code is distinct from 'policy_disabled'
     or v_assess.qualification_status is distinct from 'not_checked' then
    raise exception 'smoke#30 FAIL: standard semantics';
  end if;

  -- 31 exactly one ledger charge
  select count(*) into v_ledger_count
  from public.support_fee_ledger
  where property_id = v_prop4 and kind = 'charge' and period = v_y3::text;
  if v_ledger_count <> 1 then
    raise exception 'smoke#31 FAIL: ledger count %', v_ledger_count;
  end if;

  -- 32/33 retry same assessment; ignore area change
  update public.properties set area_sqm = 777 where id = v_prop4;
  v_fin2 := public.finalize_support_fee_assessment(v_prop4, v_y3);
  if coalesce((v_fin2->>'idempotent')::boolean, false) is not true
     or (v_fin2->>'assessment_id') is distinct from v_assess_id::text then
    raise exception 'smoke#32 FAIL: retry identity';
  end if;
  if (v_fin2->>'base_amount')::numeric is distinct from v_base3
     or (v_fin2->>'area_sqm_snapshot')::numeric is distinct from round(v_area, 3) then
    raise exception 'smoke#33 FAIL: retry repriced after area change';
  end if;

  -- 34 binding true for standard assessment
  if public.tariff_version_bound_to_support_usage(v_ver2) is not true then
    raise exception 'smoke#34 FAIL: standard binding false';
  end if;

  -- 35/36 charge_support_fee canonical path (idempotent, no second ledger)
  v_charge := public.charge_support_fee(v_prop4, v_y3::text);
  if coalesce((v_charge->>'idempotent')::boolean, false) is not true
     or (v_charge->>'assessment_id') is distinct from v_assess_id::text then
    raise exception 'smoke#35 FAIL: charge_support_fee not canonical: %', v_charge;
  end if;
  select count(*) into v_ledger_count
  from public.support_fee_ledger
  where property_id = v_prop4 and kind = 'charge' and period = v_y3::text;
  if v_ledger_count <> 1 then
    raise exception 'smoke#36 FAIL: second ledger charge created';
  end if;

  -- 37 correction preserves pricing snapshot on standard
  perform public.record_support_fee_assessment_correction(
    v_assess_id, 3.00, 'smoke standard correction'
  );
  select * into v_assess from public.support_fee_assessments where id = v_assess_id;
  if v_assess.base_amount is distinct from v_base3
     or v_assess.tariff_version_id is distinct from v_ver2
     or v_assess.rate_eur_per_sqm_year_snapshot is distinct from v_rate2
     or v_assess.pricing_rule is distinct from 'standard' then
    raise exception 'smoke#37 FAIL: standard correction mutated snapshot';
  end if;

  -- 38 finalize year uses canonical per-property logic
  v_year_res := public.finalize_support_fee_year(v_y2);
  if (v_year_res->>'billing_year')::int is distinct from v_y2 then
    raise exception 'smoke#38 FAIL: year result';
  end if;

  raise notice 'support_fee_tariff_core_smoke: ALL CHECKS PASSED';
end;
$smoke$;

rollback;
