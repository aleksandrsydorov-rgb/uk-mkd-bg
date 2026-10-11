-- =============================================================================
-- PKG-XFER cross-stage — SAFE database-level integration smoke (BEGIN / ROLLBACK)
-- Fixture scope: synthetic apt 99383 (bigint) + floor; avoids clash with 99381
-- NEVER apartment 99501 / Owner A/B.
-- Schema note: properties.apartment_number and properties.floor are bigint NOT NULL.
-- No JWT GUC spoofing. No auth.users / storage.objects inserts.
-- No owner_transfers DML. Surface presence checks only for auth RPCs.
-- End-to-end submit→approve→history→extract paths → SKIPPED (real sessions).
-- =============================================================================

begin;

create temporary table pg_temp.xferx_results (
  check_id text primary key,
  status text not null check (status in ('PASS', 'FAIL', 'SKIPPED')),
  detail text null
) on commit drop;

create or replace function pg_temp.xferx_mark(p_id text, p_status text, p_detail text default null)
returns void language plpgsql as $fn$
begin
  insert into pg_temp.xferx_results (check_id, status, detail)
  values (p_id, p_status, p_detail)
  on conflict (check_id) do update set status = excluded.status, detail = excluded.detail;
end;
$fn$;

do $body$
declare
  apt bigint := 99383;
  prop_id bigint;
  ideal numeric := 2.000000;
  floor_n bigint := 9;
  owner_a text := 'smoke.xfer.x.a@example.com';
  debt jsonb;
  n_fail integer;
begin
  if to_regprocedure('public.ownership_change_overdue_debt(bigint)') is null
     or to_regclass('public.property_book_extracts') is null
     or to_regclass('public.ownership_tariff_transitions') is null
  then
    raise exception 'cross: PKG-XFER chain incomplete';
  end if;

  insert into public.properties (
    apartment_number, floor, ideal_parts_percent, ownership_type, owner_email, owner_name
  ) values (apt, floor_n, ideal, 'sole', owner_a, 'Smoke Cross A')
  returning id into prop_id;

  perform public.property_book_set_mutating(true);
  insert into public.property_registry_people (
    property_id, relation_type, entity_kind, first_name, last_name, email,
    ownership_share_percent, ideal_parts_percent, admin_status, voting_eligible
  ) values (
    prop_id, 'owner', 'natural_person', 'Smoke', 'CrossA', owner_a,
    100, ideal, 'active', true
  );
  perform public.property_book_set_mutating(false);

  debt := public.ownership_change_overdue_debt(prop_id);
  perform pg_temp.xferx_mark(
    'SX-DB-01_debt_gate_default_off',
    case when (debt ->> 'ordinary_debt_gate_enabled')::boolean is false then 'PASS' else 'FAIL' end
  );

  perform pg_temp.xferx_mark(
    'SX-DB-02_book_owner_present',
    case when exists (
      select 1 from public.property_registry_people
      where property_id = prop_id and relation_type = 'owner' and deregistered_at is null
    ) then 'PASS' else 'FAIL' end
  );

  perform pg_temp.xferx_mark(
    'SX-DB-03_core_rpc_surface',
    case when to_regprocedure(
           'public.submit_ownership_change(bigint,jsonb,text,text,text,date,text,text,date,text,text,bigint,boolean,text)'
         ) is not null
         and to_regprocedure('public.owner_generate_property_book_extract(bigint,text[])') is not null
         and to_regprocedure('public.owner_verify_and_attach_extract_pdf(bigint,uuid,text,boolean)') is not null
         and to_regprocedure('public.admin_submit_linked_ownership_correction(bigint,jsonb,text,text,date,text,date,text)') is not null
      then 'PASS' else 'FAIL' end
  );

  perform pg_temp.xferx_mark(
    'SX-DB-04_migrations_recorded_5',
    case when (
      select count(*) from supabase_migrations.schema_migrations
      where version in (
        '20261011140000','20261011140100','20261011140200','20261011140300','20261011140400'
      )
    ) = 5 then 'PASS' else 'FAIL' end
  );

  -- Auth-gated end-to-end (real sessions — not PASS)
  perform pg_temp.xferx_mark('SX-AUTH-01_submit_approve_history', 'SKIPPED', 'session plan A1/A6/N4; needs real admin/owner sessions');
  perform pg_temp.xferx_mark('SX-AUTH-02_generate_extracts', 'SKIPPED', 'session plan D2; needs real owner session');
  perform pg_temp.xferx_mark('SX-AUTH-03_pending_counter', 'SKIPPED', 'session plan N1; needs real admin session');
  perform pg_temp.xferx_mark('SX-AUTH-04_pdf_attach_path', 'SKIPPED', 'session plan D3; needs real session + API deploy');
  perform pg_temp.xferx_mark(
    'SX-AUTH-05_owner_transfers_dml',
    'SKIPPED',
    'direct owner_transfers insert/update blocked without auth; session plan A1/A8/A10'
  );

  select count(*)::integer into n_fail from pg_temp.xferx_results where status = 'FAIL';
  if n_fail > 0 then
    raise exception 'cross: % FAIL check(s)', n_fail;
  end if;
end;
$body$;

select check_id, status, detail from pg_temp.xferx_results order by check_id;

rollback;

-- Post-rollback residual (read-only)
do $residual$
begin
  if exists (
    select 1 from public.properties
    where apartment_number in (99351, 99361, 99371, 99381, 99382, 99383)
      and coalesce(owner_email, '') like 'smoke.xfer%@example.com'
  ) then
    raise exception 'RESIDUAL FAIL: smoke properties remain after rollback';
  end if;
end;
$residual$;
