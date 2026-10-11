-- =============================================================================
-- PKG-PB1-BOOK-ONLY transactional smoke (BEGIN / ROLLBACK)
-- Prefer: npx supabase db query --linked -f supabase/property_book_pb1_smoke.sql
-- Success = one row: result = ALL CHECKS PASSED (then ROLLBACK).
-- Requires: 20261010120000 + 20261010120100 + 20261010233000 + 20261011005000.
--
-- Does NOT SET ROLE (cannot set role inside SECURITY DEFINER).
-- Authenticated-role privilege tests:
--   supabase/property_book_pb1_auth_role_security.sql
-- =============================================================================

begin;

-- auth.uid()/auth.email() read claim.* OR fall back to request.jwt.claims JSON.
-- Always clear/set both; never leave claims JSON from a prior scenario.
create or replace function pg_temp.smoke_clear_auth()
returns void
language plpgsql
as $fn$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

create or replace function pg_temp.smoke_set_auth(p_uid uuid, p_email text)
returns void
language plpgsql
as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.email', coalesce(p_email, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_uid::text,
      'role', 'authenticated',
      'email', coalesce(p_email, '')
    )::text,
    true
  );
end;
$fn$;

create or replace function pg_temp.pb1_smoke()
returns text
language plpgsql
security definer
set search_path = public
as $body$
declare
  staff_email text;
  staff_uid uuid;
  owner_a text := 'smoke.pb1.a@example.com';
  owner_b text := 'smoke.pb1.b@example.com';
  owner_c text := 'smoke.pb1.c@example.com';
  legacy_only text := 'smoke.pb1.legacy@example.com';
  -- Synthetic JWT subjects (hex-only UUID; not required to exist in auth.users)
  uid_a uuid := '00000000-0000-4000-8000-0000000000a1';
  uid_b uuid := '00000000-0000-4000-8000-0000000000b1';
  uid_l uuid := '00000000-0000-4000-8000-0000000000d1';
  uid_x uuid := '00000000-0000-4000-8000-0000000000e1';
  uid_i uuid := '00000000-0000-4000-8000-0000000000f1';
  apt1 bigint := 99201;
  apt2 bigint := 99202;
  apt3 bigint := 99203;
  prop1 bigint;
  prop2 bigint;
  prop3 bigint;
  reg_a bigint;
  reg_b bigint;
  reg_c1 bigint;
  reg_c2 bigint;
  inv jsonb;
  inv2 jsonb;
  tok text;
  tok2 text;
  acc jsonb;
  imp jsonb;
  tr_id bigint;
  book jsonb;
  owns boolean;
begin
  if to_regprocedure('public.admin_create_property_invite(bigint,bigint)') is null
     or to_regprocedure('public.property_book_ownership_audit_report()') is null
     or to_regclass('public.property_book_runtime_flags') is not null then
    raise exception 'smoke: PKG-PB1-BOOK-ONLY migrations not applied (or compat flags still present)';
  end if;

  if position('owner_email' in lower(pg_get_functiondef('public.owns_property(bigint)'::regprocedure))) > 0 then
    raise exception 'smoke: owns_property still references owner_email';
  end if;
  if position('p.owner_email' in pg_get_functiondef('public.user_activation_owner_base()'::regprocedure)) > 0 then
    raise exception 'smoke: UA owner_base still uses portal owner_email';
  end if;

  select s.email, u.id into staff_email, staff_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id limit 1;

  if staff_uid is null then
    raise exception 'smoke: admin@example.com missing in staff/auth.users';
  end if;

  perform pg_temp.smoke_set_auth(staff_uid, staff_email);

  delete from public.properties where apartment_number in (apt1, apt2, apt3, 99204, 99205);

  insert into public.properties (
    apartment_number, floor, area_sqm, purpose, ideal_parts_percent, ownership_type, status, owner_email
  ) values
    (apt1, 2, 40, 'апартамент', 1.0, 'sole', 'vacant', legacy_only),
    (apt2, 2, 50, 'апартамент', 2.0, 'shared', 'vacant', null),
    (apt3, 2, 45, 'апартамент', 1.5, 'sole', 'vacant', owner_a);

  select id into prop1 from public.properties where apartment_number = apt1;
  select id into prop2 from public.properties where apartment_number = apt2;
  select id into prop3 from public.properties where apartment_number = apt3;

  -- prop1: Book owner A (complete)
  -- Use full 12-arg signature with explicit casts (6-arg + 12-arg overloads both exist;
  -- short calls are ambiguous when trailing defaults apply).
  perform public.admin_upsert_property_book_object(
    prop1::bigint,
    'апартамент'::text,
    40::numeric,
    1.0::numeric,
    'sole'::text,
    'document'::text,
    apt1::bigint,
    2::bigint,
    null::text,
    null::text,
    null::text,
    null::text
  );
  book := public.admin_replace_property_book_owners(
    prop1,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'Ann', 'last_name', 'Alpha',
      'email', owner_a,
      'ownership_share_percent', 100,
      'ideal_parts_percent', 1.0
    ))
  );
  if coalesce((book -> 'validation' ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#book1 FAIL: %', book -> 'validation';
  end if;
  select id into reg_a from public.property_registry_people
  where property_id = prop1 and deregistered_at is null and relation_type = 'owner' limit 1;

  -- prop2: co-owners B + C (full 12-arg form avoids overload 42725)
  perform public.admin_upsert_property_book_object(
    prop2::bigint,
    'апартамент'::text,
    50::numeric,
    2.0::numeric,
    'shared'::text,
    'document'::text,
    null::bigint,
    null::bigint,
    null::text,
    null::text,
    null::text,
    null::text
  );
  book := public.admin_replace_property_book_owners(
    prop2,
    jsonb_build_array(
      jsonb_build_object(
        'entity_kind', 'natural_person',
        'first_name', 'Bob', 'last_name', 'Beta',
        'email', owner_b,
        'ownership_share_percent', 60,
        'ideal_parts_percent', 1.2
      ),
      jsonb_build_object(
        'entity_kind', 'natural_person',
        'first_name', 'Cara', 'last_name', 'Co',
        'email', owner_c,
        'ownership_share_percent', 40,
        'ideal_parts_percent', 0.8
      )
    )
  );
  if coalesce((book -> 'validation' ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#coowners FAIL: %', book -> 'validation';
  end if;
  select id into reg_c1 from public.property_registry_people
  where property_id = prop2 and lower(email) = owner_b and deregistered_at is null;
  select id into reg_c2 from public.property_registry_people
  where property_id = prop2 and lower(email) = owner_c and deregistered_at is null;

  -- Simulate owner JWT for owns_property checks
  perform pg_temp.smoke_set_auth(uid_a, owner_a);

  owns := public.owns_property(prop1);
  if owns is not true then
    raise exception 'smoke#owns_property FAIL: owner_a should own prop1';
  end if;
  owns := public.owns_property(prop2);
  if owns is not false then
    raise exception 'smoke#isolation FAIL: owner_a must not own prop2';
  end if;

  -- Co-owner B
  perform pg_temp.smoke_set_auth(uid_b, owner_b);
  if public.owns_property(prop2) is not true then
    raise exception 'smoke#coowner FAIL: owner_b';
  end if;

  -- Portal-only email must NEVER grant (Book populated on prop1)
  perform pg_temp.smoke_set_auth(uid_l, legacy_only);
  if public.owns_property(prop1) is not false then
    raise exception 'smoke#legacy_blocked FAIL: portal-only must not own prop1 when Book populated';
  end if;

  -- Portal-only property with NO Book owners: still denied
  insert into public.properties (
    apartment_number, floor, area_sqm, purpose, ideal_parts_percent, ownership_type, status, owner_email, owner_name
  ) values (
    99205, 1, 20, 'апартамент', 0.2, 'sole', 'vacant', legacy_only, 'Legacy Only'
  );
  if public.owns_property((select id from public.properties where apartment_number = 99205)) is not false then
    raise exception 'smoke#portal_only_empty_book FAIL: portal owner_email must never authorize';
  end if;
  if exists (
    select 1 from public.list_my_owned_properties() p where p.apartment_number = 99205
  ) then
    raise exception 'smoke#list_my_owned_portal FAIL';
  end if;

  -- Staff again for invites
  perform pg_temp.smoke_set_auth(staff_uid, staff_email);

  -- Invite non-owner email → fail
  begin
    inv := public.admin_create_property_invite(prop1::bigint, 'not.owner@example.com'::text);
    raise exception 'smoke#invite_non_owner FAIL: should have raised';
  exception when others then
    if sqlerrm not like '%not a current Book owner%' then
      raise exception 'smoke#invite_non_owner FAIL unexpected: %', sqlerrm;
    end if;
  end;

  inv := public.admin_create_property_invite(prop1::bigint, reg_a::bigint);
  tok := inv ->> 'token';
  if tok is null or (inv ->> 'email_sent')::boolean is not false then
    raise exception 'smoke#invite FAIL: %', inv;
  end if;
  if inv ->> 'delivery_status' is distinct from 'COPY_LINK' then
    raise exception 'smoke#invite delivery FAIL: %', inv;
  end if;

  -- Resend invalidates previous token
  inv2 := public.admin_resend_property_invite((inv ->> 'id')::uuid);
  tok2 := inv2 ->> 'token';
  if tok2 is null or tok2 = tok then
    raise exception 'smoke#resend FAIL: token not rotated';
  end if;

  -- Old token expired
  begin
    acc := public.accept_property_invite(tok, false);
    raise exception 'smoke#old_token FAIL: should be expired';
  exception when others then
    if sqlerrm not like '%expired%' and sqlerrm not like '%invalid%' then
      raise exception 'smoke#old_token FAIL unexpected: %', sqlerrm;
    end if;
  end;

  -- A. Peek + mark as truly unauthenticated (clear claim.* AND jwt.claims JSON)
  perform pg_temp.smoke_clear_auth();
  if auth.uid() is not null or nullif(btrim(coalesce(auth.email(), '')), '') is not null then
    raise exception 'smoke#auth_clear FAIL: uid=% email=%', auth.uid(), auth.email();
  end if;

  acc := public.accept_property_invite(tok2, false);
  if acc ->> 'email' is distinct from owner_a then
    raise exception 'smoke#peek FAIL: %', acc;
  end if;

  begin
    acc := public.accept_property_invite(tok2, true);
    raise exception 'smoke#accept_unauth FAIL';
  exception when others then
    if sqlerrm not like '%authentication%' then
      raise exception 'smoke#accept_unauth FAIL unexpected: %', sqlerrm;
    end if;
  end;

  -- B. Authenticated mismatch cannot accept
  perform pg_temp.smoke_set_auth(uid_x, owner_b);
  begin
    acc := public.accept_property_invite(tok2, true);
    raise exception 'smoke#email_mismatch FAIL';
  exception when others then
    if sqlerrm not like '%mismatch%' then
      raise exception 'smoke#email_mismatch FAIL unexpected: %', sqlerrm;
    end if;
  end;
  perform pg_temp.smoke_clear_auth();

  -- C. Authenticated matching email can accept; Book unchanged
  perform pg_temp.smoke_set_auth(uid_a, owner_a);
  acc := public.accept_property_invite(tok2, true);
  if acc ->> 'status' is distinct from 'accepted' then
    raise exception 'smoke#accept FAIL: %', acc;
  end if;
  perform pg_temp.smoke_clear_auth();

  -- Transfer ownership: A → B on prop1; active session A loses access
  -- Insert as current Book owner (trigger enforce_owner_transfer_insert → owns_property)
  perform pg_temp.smoke_set_auth(uid_a, owner_a);
  insert into public.owner_transfers (
    property_id, from_owner_name, from_owner_email, to_owner_name, to_owner_email, status
  ) values (
    prop1, 'Ann Alpha', owner_a, 'Bob Beta', owner_b, 'ожидает'
  ) returning id into tr_id;

  -- Approve as staff
  perform pg_temp.smoke_set_auth(staff_uid, staff_email);
  perform public.admin_approve_owner_transfer(tr_id);

  perform pg_temp.smoke_set_auth(uid_a, owner_a);
  if public.owns_property(prop1) is not false then
    raise exception 'smoke#revoke FAIL: former owner still has access';
  end if;

  perform pg_temp.smoke_set_auth(uid_b, owner_b);
  if public.owns_property(prop1) is not true then
    raise exception 'smoke#transfer_grant FAIL: new owner';
  end if;
  -- Other property access unchanged for co-owner B on prop2
  if public.owns_property(prop2) is not true then
    raise exception 'smoke#multi_prop FAIL: B should still own prop2';
  end if;
  if (
    select count(*)::int from public.list_my_owned_properties() p
    where p.id in (prop1, prop2)
  ) is distinct from 2 then
    raise exception 'smoke#multi_list FAIL: B should list both apartments';
  end if;

  -- History preserved: deregistered former owner row exists
  if not exists (
    select 1 from public.property_registry_people
    where property_id = prop1 and lower(email) = owner_a and deregistered_at is not null
  ) then
    raise exception 'smoke#history FAIL: former owner not retained';
  end if;

  -- Import preview
  perform pg_temp.smoke_set_auth(staff_uid, staff_email);

  imp := public.admin_import_property_book(
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99204', 'floor', '3',
      'purpose', 'апартамент', 'area_sqm', '30', 'ideal_parts_percent', '0.4',
      'ownership_type', 'sole'
    )),
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99204', 'entity_kind', 'natural_person',
      'first_name', 'New', 'last_name', 'Unit',
      'email', 'smoke.pb1.new@example.com',
      'ownership_share_percent', '100', 'ideal_parts_percent', '0.4'
    )),
    true::boolean, false::boolean, false::boolean
  );
  if coalesce((imp ->> 'requires_create_confirmation')::boolean, false) is not true then
    raise exception 'smoke#import_preview FAIL: %', imp;
  end if;

  -- Apply without create confirm → error
  begin
    imp := public.admin_import_property_book(
      jsonb_build_array(jsonb_build_object(
        'apartment_number', '99204', 'floor', '3',
        'purpose', 'апартамент', 'area_sqm', '30', 'ideal_parts_percent', '0.4',
        'ownership_type', 'sole'
      )),
      jsonb_build_array(jsonb_build_object(
        'apartment_number', '99204', 'entity_kind', 'natural_person',
        'first_name', 'New', 'last_name', 'Unit',
        'email', 'smoke.pb1.new@example.com',
        'ownership_share_percent', '100', 'ideal_parts_percent', '0.4'
      )),
      false::boolean, false::boolean, false::boolean
    );
    if coalesce((imp ->> 'ok')::boolean, true) then
      raise exception 'smoke#import_no_confirm FAIL: expected not ok or exception';
    end if;
  exception when others then
    null; -- aborted apply is OK
  end;

  if exists (select 1 from public.properties where apartment_number = 99204) then
    raise exception 'smoke#import_atomicity FAIL: 99204 created without confirm';
  end if;

  -- Apply with create confirm
  imp := public.admin_import_property_book(
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99204', 'floor', '3',
      'purpose', 'апартамент', 'area_sqm', '30', 'ideal_parts_percent', '0.4',
      'ownership_type', 'sole'
    )),
    jsonb_build_array(jsonb_build_object(
      'apartment_number', '99204', 'entity_kind', 'natural_person',
      'first_name', 'New', 'last_name', 'Unit',
      'email', 'smoke.pb1.new@example.com',
      'ownership_share_percent', '100', 'ideal_parts_percent', '0.4'
    )),
    false::boolean, true::boolean, false::boolean
  );
  if coalesce((imp ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#import_apply FAIL: %', imp;
  end if;

  -- Incomplete book blocks invite + access (prop3).
  -- Natural-person names must satisfy natural_name_chk; incompleteness is
  -- null ideal_parts_percent (allowed by DB, rejected by access_ready).
  perform public.admin_replace_property_book_owners(
    prop3,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'Inc',
      'last_name', 'Omplete',
      'email', 'smoke.pb1.inc@example.com',
      'ownership_share_percent', 100
    ))
  );
  begin
    inv := public.admin_create_property_invite(prop3::bigint, 'smoke.pb1.inc@example.com'::text);
    raise exception 'smoke#incomplete_invite FAIL';
  exception when others then
    if sqlerrm not like '%incomplete%' and sqlerrm not like '%Book incomplete%' then
      raise exception 'smoke#incomplete_invite FAIL unexpected: %', sqlerrm;
    end if;
  end;

  perform pg_temp.smoke_set_auth(uid_i, 'smoke.pb1.inc@example.com');
  if public.owns_property(prop3) is not false then
    raise exception 'smoke#incomplete_access FAIL: incomplete Book must deny owns_property';
  end if;
  perform pg_temp.smoke_clear_auth();

  -- UA: Book emails only (legacy_only / portal-only must not appear)
  if exists (
    select 1 from public.user_activation_owner_base() u where u.email = legacy_only
  ) then
    raise exception 'smoke#ua_portal_only FAIL: portal-only email must not be in UA base';
  end if;
  if not exists (
    select 1 from public.user_activation_owner_base() u where u.email = owner_b
  ) then
    raise exception 'smoke#ua_book FAIL: Book owner_b missing from UA base';
  end if;

  -- Staff helpers unaffected
  perform pg_temp.smoke_set_auth(staff_uid, staff_email);
  if public.is_staff() is not true then
    raise exception 'smoke#staff FAIL: is_staff broken for admin';
  end if;

  -- GM freeze sources must not fall back to portal owner_email
  if position('p.owner_email' in pg_get_functiondef('public.gm_freeze_notice_snapshot(uuid)'::regprocedure)) > 0
     or position('p.owner_email' in pg_get_functiondef('public.gm_freeze_voting_snapshot(uuid)'::regprocedure)) > 0 then
    raise exception 'smoke#gm_fallback FAIL: freeze still references p.owner_email';
  end if;

  -- Direct approve blocked by non-spoofable gate table (not custom GUC).
  -- Role switching is forbidden inside this SECURITY DEFINER function;
  -- authenticated-role privilege tests live in property_book_pb1_auth_role_security.sql.
  if to_regclass('public.property_book_transfer_approve_gate') is null then
    raise exception 'smoke#direct_approve FAIL: apply 20261011005000_owner_transfers_transfer_approve_guard first';
  end if;

  perform pg_temp.smoke_set_auth(uid_b, owner_b);
  insert into public.owner_transfers (
    property_id,
    from_owner_name, from_owner_email, from_owner_phone,
    to_owner_name, to_owner_email, status
  )
  select
    prop2,
    p.owner_name, p.owner_email, p.owner_phone,
    'X Y', 'smoke.pb1.x@example.com', 'ожидает'
  from public.properties as p
  where p.id = prop2
  returning id into tr_id;

  -- GUC spoof must NOT authorize approve (gate table is authoritative)
  perform public.property_book_set_mutating(true);
  perform set_config('property_book.transfer_approve', '1', true);
  perform set_config('property_book.mutating', '1', true);

  perform pg_temp.smoke_set_auth(staff_uid, staff_email);
  if public.has_staff_role('администрация') is not true then
    raise exception 'smoke#direct_approve FAIL: staff fixture is not administration';
  end if;

  begin
    update public.owner_transfers as t
       set status = 'утверждена',
           decided_at = now(),
           decided_by = staff_email,
           reject_reason = null
     where t.id = tr_id;
    raise exception 'smoke#direct_approve FAIL: direct approve succeeded (SECURITY DEFECT)';
  exception when others then
    if sqlerrm like '%SECURITY DEFECT%' then
      raise;
    end if;
    if sqlerrm not like '%approve only via admin_approve_owner_transfer%' then
      raise exception 'smoke#direct_approve FAIL unexpected: %', sqlerrm;
    end if;
  end;

  if exists (
    select 1 from public.owner_transfers as t
    where t.id = tr_id and t.status = 'утверждена'
  ) then
    raise exception 'smoke#direct_approve FAIL: row marked approved despite error';
  end if;

  if not exists (
    select 1 from public.property_registry_people as r
    where r.property_id = prop2
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and lower(btrim(r.email)) = owner_b
  ) then
    raise exception 'smoke#direct_approve FAIL: Book owners mutated without RPC';
  end if;
  if exists (
    select 1 from public.property_registry_people as r
    where r.property_id = prop2
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and lower(btrim(r.email)) = 'smoke.pb1.x@example.com'
  ) then
    raise exception 'smoke#direct_approve FAIL: bypass created new Book owner';
  end if;

  -- Unauthorized (non-admin JWT) caller rejected on decision update
  perform pg_temp.smoke_set_auth(uid_b, owner_b);
  begin
    update public.owner_transfers as t
       set status = 'утверждена',
           decided_at = now(),
           decided_by = owner_b,
           reject_reason = null
     where t.id = tr_id;
    raise exception 'smoke#direct_approve_unauth FAIL: owner decision update allowed';
  exception when others then
    if sqlerrm like '%owner decision update allowed%' then
      raise;
    end if;
    if sqlerrm not like '%administration%'
       and sqlerrm not like '%approve only via admin_approve_owner_transfer%'
       and sqlerrm not like '%decided_by%' then
      raise exception 'smoke#direct_approve_unauth FAIL unexpected: %', sqlerrm;
    end if;
  end;

  -- Legitimate RPC approval on sole property (prop1 currently owned by B)
  perform pg_temp.smoke_set_auth(uid_b, owner_b);
  insert into public.owner_transfers (
    property_id,
    from_owner_name, from_owner_email, from_owner_phone,
    to_owner_name, to_owner_email, status
  )
  select
    prop1,
    p.owner_name, p.owner_email, p.owner_phone,
    'Cara Co', owner_c, 'ожидает'
  from public.properties as p
  where p.id = prop1
  returning id into tr_id;

  perform pg_temp.smoke_set_auth(staff_uid, staff_email);
  perform public.property_book_set_mutating(false);
  book := public.admin_approve_owner_transfer(tr_id);
  if coalesce((book ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#rpc_approve FAIL: %', book;
  end if;

  if exists (
    select 1 from public.property_book_transfer_approve_gate as g
    where g.transfer_id = tr_id
  ) then
    raise exception 'smoke#ticket_cleanup FAIL: approve gate ticket left behind';
  end if;

  perform pg_temp.smoke_set_auth(uid_b, owner_b);
  if public.owns_property(prop1) is not false then
    raise exception 'smoke#rpc_approve_revoke FAIL: former owner B still has access';
  end if;
  perform pg_temp.smoke_set_auth('00000000-0000-4000-8000-0000000000c1'::uuid, owner_c);
  if public.owns_property(prop1) is not true then
    raise exception 'smoke#rpc_approve_grant FAIL: new owner C';
  end if;
  if not exists (
    select 1 from public.property_registry_people as r
    where r.property_id = prop1
      and lower(btrim(r.email)) = owner_b
      and r.deregistered_at is not null
  ) then
    raise exception 'smoke#rpc_approve_history FAIL: former owner not retained';
  end if;

  perform pg_temp.smoke_set_auth(staff_uid, staff_email);

  return 'ALL CHECKS PASSED';
end;
$body$;

select pg_temp.pb1_smoke() as result;

rollback;
