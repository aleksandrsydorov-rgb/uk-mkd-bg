-- =============================================================================
-- AMADEUS 11 — Property book package smoke (BEGIN / ROLLBACK)
-- =============================================================================
-- Prefer CLI (Dashboard often breaks dollar-quoted DO blocks):
--   npx supabase db query --linked -f supabase/property_book_package_smoke.sql
--
-- If you paste into Supabase SQL Editor: paste the WHOLE file as-is.
-- Do not let the editor auto-insert "ENABLE ROW LEVEL SECURITY".
-- Success = one row: result = ALL CHECKS PASSED (then ROLLBACK).
-- =============================================================================

begin;

create or replace function pg_temp.book_package_smoke()
returns text
language plpgsql
security definer
set search_path = public
as $body$
declare
  staff_email text;
  staff_uid uuid;
  owner_uid uuid;
  owner_email text := 'smoke.book.owner@example.com';
  guest1 text := 'smoke.guest1@example.com';
  guest2 text := 'smoke.guest2@example.com';
  guest3 text := 'smoke.guest3@example.com';
  apt1 bigint := 99101;
  apt2 bigint := 99102;
  apt3 bigint := 99103;
  prop1 bigint;
  prop2 bigint;
  prop3 bigint;
  book jsonb;
  list_sec text;
  list_blk text;
  list_fl bigint;
  list_pid bigint;
  imp jsonb;
  inv jsonb;
  mass jsonb;
  kind text;
  guest_ok boolean;
  log_cnt integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'section_code'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'block_code'
  ) then
    raise exception 'smoke#schema FAIL: section_code / block_code missing';
  end if;

  if to_regprocedure('public.admin_mass_create_property_invites(bigint,text,text,boolean,boolean)') is null then
    raise exception 'smoke#schema FAIL: admin_mass_create_property_invites missing';
  end if;

  select s.email, u.id into staff_email, staff_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id limit 1;

  if staff_uid is null then
    raise exception 'smoke: admin@example.com missing in staff/auth.users';
  end if;

  perform set_config('request.jwt.claim.sub', staff_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', staff_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', staff_uid::text, 'role', 'authenticated', 'email', staff_email)::text,
    true
  );

  delete from public.properties where apartment_number in (apt1, apt2, apt3, 99104);

  insert into public.properties (
    apartment_number, floor, section_code, block_code,
    area_sqm, purpose, ideal_parts_percent, ownership_type, status, owner_email
  ) values
    (apt1, 3, 'A', '1', 48.0, 'апартамент', 1.0, 'sole', 'vacant', owner_email),
    (apt2, 3, 'A', '1', 52.0, 'апартамент', 1.1, 'sole', 'vacant', 'smoke.book.owner2@example.com'),
    (apt3, 4, 'B', '1', 60.0, 'апартамент', 1.2, 'sole', 'vacant', 'smoke.book.owner3@example.com');

  select id into prop1 from public.properties where apartment_number = apt1;
  select id into prop2 from public.properties where apartment_number = apt2;
  select id into prop3 from public.properties where apartment_number = apt3;

  book := public.admin_upsert_property_book_object(
    prop1, 'апартамент', 48.0, 1.234567, 'sole', 'document',
    apt1, 3, 'smoke note', null, 'A', '1'
  );
  if (book -> 'property' ->> 'section_code') is distinct from 'A'
     or (book -> 'property' ->> 'block_code') is distinct from '1'
     or (book -> 'property' ->> 'floor')::bigint is distinct from 3 then
    raise exception 'smoke#upsert FAIL: %', book -> 'property';
  end if;

  book := public.admin_replace_property_book_owners(
    prop1,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'Smoke', 'last_name', 'Owner',
      'email', owner_email,
      'ownership_share_percent', 100,
      'ideal_parts_percent', 1.234567
    ))
  );
  if coalesce((book -> 'validation' ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#owners FAIL: %', book -> 'validation';
  end if;

  perform public.admin_replace_property_book_owners(
    prop2,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'Smoke', 'last_name', 'Two',
      'email', 'smoke.book.owner2@example.com',
      'ownership_share_percent', 100,
      'ideal_parts_percent', 1.1
    ))
  );

  select property_id, section_code, block_code, floor
    into list_pid, list_sec, list_blk, list_fl
  from public.admin_list_property_book(2000)
  where property_id = prop1;

  if list_pid is null then
    raise exception 'smoke#list FAIL: prop1 missing';
  end if;
  if list_sec is distinct from 'A' or list_blk is distinct from '1' or list_fl is distinct from 3 then
    raise exception 'smoke#list FAIL: expected A/1/3 got %/%/%', list_sec, list_blk, list_fl;
  end if;

  update public.properties set section_code = 'A1' where id = prop1;
  select count(*)::integer into log_cnt
  from public.property_change_log as l
  where l.property_id = prop1 and l.entity = 'property' and l.changes ? 'section_code';
  if log_cnt < 1 then
    raise exception 'smoke#changelog FAIL: section_code not logged';
  end if;
  update public.properties set section_code = 'A' where id = prop1;

  imp := public.admin_import_property_book(
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99104', 'floor', '5', 'section_code', 'C', 'block_code', '2',
      'purpose', 'апартамент', 'area_sqm', '33', 'ideal_parts_percent', '0.5',
      'ownership_type', 'sole', 'ideal_parts_source', 'document'
    )),
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99104', 'entity_kind', 'natural_person',
      'first_name', 'Import', 'last_name', 'Smoke',
      'email', 'smoke.import@example.com',
      'ownership_share_percent', '100', 'ideal_parts_percent', '0.5'
    )),
    true
  );
  if coalesce((imp ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#import-dry FAIL: %', imp;
  end if;

  imp := public.admin_import_property_book(
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99104', 'floor', '5', 'section_code', 'C', 'block_code', '2',
      'purpose', 'апартамент', 'area_sqm', '33', 'ideal_parts_percent', '0.5',
      'ownership_type', 'sole', 'ideal_parts_source', 'document'
    )),
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99104', 'entity_kind', 'natural_person',
      'first_name', 'Import', 'last_name', 'Smoke',
      'email', 'smoke.import@example.com',
      'ownership_share_percent', '100', 'ideal_parts_percent', '0.5'
    )),
    false
  );
  if coalesce((imp ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#import-apply FAIL: %', imp;
  end if;
  if not exists (
    select 1 from public.properties
    where apartment_number = 99104 and section_code = 'C' and block_code = '2' and floor = 5
  ) then
    raise exception 'smoke#import-apply FAIL: 99104 fields mismatch';
  end if;

  inv := public.admin_create_property_invite(prop1, owner_email);
  if inv ->> 'token' is null or inv ->> 'status' is distinct from 'pending' then
    raise exception 'smoke#invite FAIL: %', inv;
  end if;

  mass := public.admin_mass_create_property_invites(3, 'A', '1', true, true);
  if coalesce((mass ->> 'ok')::boolean, false) is not true
     or coalesce((mass ->> 'property_count')::integer, 0) < 2 then
    raise exception 'smoke#mass-preview FAIL: %', mass;
  end if;

  mass := public.admin_mass_create_property_invites(4, 'B', null, false, true);
  if coalesce((mass ->> 'created_count')::integer, 0) < 1
     or (mass -> 'created' -> 0 ->> 'token') is null then
    raise exception 'smoke#mass-create FAIL: %', mass;
  end if;

  mass := public.admin_mass_create_property_invites(3, 'A', '1', false, true);
  if coalesce((mass ->> 'skipped_count')::integer, 0) < 1 then
    raise exception 'smoke#mass-skip FAIL: %', mass;
  end if;

  kind := public.property_tariff_subject_kind(prop1);
  if kind is distinct from 'natural' then
    raise exception 'smoke#subject FAIL: expected natural got %', kind;
  end if;

  perform public.admin_replace_property_book_owners(
    prop1,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'legal_entity',
      'entity_name', 'Smoke EOOD', 'eik_bulstat', '123456789',
      'email', owner_email,
      'ownership_share_percent', 100, 'ideal_parts_percent', 1.234567
    ))
  );
  kind := public.property_tariff_subject_kind(prop1);
  if kind is distinct from 'legal' then
    raise exception 'smoke#subject FAIL: expected legal got %', kind;
  end if;

  perform public.admin_replace_property_book_owners(
    prop1,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'Smoke', 'last_name', 'Owner',
      'email', owner_email,
      'ownership_share_percent', 100, 'ideal_parts_percent', 1.234567
    ))
  );

  owner_uid := gen_random_uuid();
  perform set_config('request.jwt.claim.sub', owner_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', owner_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_uid::text, 'role', 'authenticated', 'email', owner_email)::text,
    true
  );

  if not public.owns_property(prop1) then
    raise exception 'smoke#guest FAIL: owns_property false';
  end if;

  perform public.owner_create_guest_access(prop1, guest1, 'living_with_owner', now(), null);
  perform public.owner_create_guest_access(prop1, guest2, 'long_term_tenant', now(), null);

  begin
    perform public.owner_create_guest_access(prop1, guest3, 'living_with_owner', now(), null);
    guest_ok := false;
  exception when others then
    if sqlerrm ilike '%max 2%' then
      guest_ok := true;
    else
      raise exception 'smoke#guest FAIL: unexpected: %', sqlerrm;
    end if;
  end;
  if not guest_ok then
    raise exception 'smoke#guest FAIL: 3rd guest allowed';
  end if;

  return 'ALL CHECKS PASSED';
end;
$body$;

select pg_temp.book_package_smoke() as result;

rollback;
