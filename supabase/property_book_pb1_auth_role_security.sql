-- =============================================================================
-- PKG-PB1 authenticated-role security regression (BEGIN / ROLLBACK)
--
-- Real role switch at top-level SQL:
--   SET LOCAL ROLE authenticated;
-- Never SET ROLE inside SECURITY DEFINER.
--
-- Fixture IDs live in transaction-local session settings (pb1_auth_test.*).
-- Those settings NEVER authorize ownership or transfer approval.
--
-- Prefer:
--   npx supabase db query --linked -f supabase/property_book_pb1_auth_role_security.sql
--
-- Success = one row: result = AUTH ROLE CHECKS PASSED (then ROLLBACK).
-- Requires: 20261011005000_owner_transfers_transfer_approve_guard applied.
-- Companion: property_book_pb1_smoke.sql
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Privilege matrix (real role ACL — not JWT simulation)
-- ---------------------------------------------------------------------------
do $acl$
begin
  if to_regclass('public.property_book_transfer_approve_gate') is null then
    raise exception 'auth_role: gate migration not applied';
  end if;

  if has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'SELECT')
     or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'INSERT')
     or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'UPDATE')
     or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'DELETE')
  then
    raise exception 'auth_role#gate_acl FAIL: authenticated has gate privileges';
  end if;

  if has_table_privilege('anon', 'public.property_book_transfer_approve_gate', 'SELECT')
     or has_table_privilege('anon', 'public.property_book_transfer_approve_gate', 'INSERT')
     or has_table_privilege('anon', 'public.property_book_transfer_approve_gate', 'UPDATE')
     or has_table_privilege('anon', 'public.property_book_transfer_approve_gate', 'DELETE')
  then
    raise exception 'auth_role#gate_acl FAIL: anon has gate privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.owner_transfers', 'UPDATE') then
    raise exception 'auth_role#transfers_acl FAIL: expected authenticated UPDATE on owner_transfers';
  end if;
end;
$acl$;

-- ---------------------------------------------------------------------------
-- B. Privileged fixture (login role). IDs stored in LOCAL session settings only.
-- ---------------------------------------------------------------------------
do $fixture$
declare
  v_staff_email text;
  v_staff_uid uuid;
  v_apt bigint := 99301;
  v_prop bigint;
  v_tr bigint;
  v_book jsonb;
begin
  select s.email, u.id
    into v_staff_email, v_staff_uid
  from public.staff as s
  join auth.users as u
    on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true
    and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id
  limit 1;

  if v_staff_uid is null then
    raise exception 'auth_role: admin@example.com missing in staff/auth.users';
  end if;

  -- Do not delete existing apartments — collide and stop
  if exists (
    select 1 from public.properties as p where p.apartment_number = v_apt
  ) then
    raise exception 'auth_role: fixture collision apartment_number=%', v_apt;
  end if;

  insert into public.properties (
    apartment_number, floor, area_sqm, purpose, ideal_parts_percent,
    ownership_type, status, owner_email, owner_name
  ) values (
    v_apt, 1, 30, 'апартамент', 0.5, 'sole', 'vacant',
    'smoke.auth.owner@example.com', 'Auth Owner'
  )
  returning id into v_prop;

  -- Staff JWT for Book RPCs
  perform set_config('request.jwt.claim.sub', v_staff_uid::text, true);
  perform set_config('request.jwt.claim.email', v_staff_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_staff_uid::text,
      'role', 'authenticated',
      'email', v_staff_email
    )::text,
    true
  );

  perform public.admin_upsert_property_book_object(
    v_prop::bigint,
    'апартамент'::text,
    30::numeric,
    0.5::numeric,
    'sole'::text,
    'document'::text,
    null::bigint,
    null::bigint,
    null::text,
    null::text,
    null::text,
    null::text
  );

  v_book := public.admin_replace_property_book_owners(
    v_prop,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', 'Auth',
      'last_name', 'Owner',
      'email', 'smoke.auth.owner@example.com',
      'ownership_share_percent', 100,
      'ideal_parts_percent', 0.5
    ))
  );
  if coalesce((v_book -> 'validation' ->> 'ok')::boolean, false) is not true then
    raise exception 'auth_role#fixture FAIL: book validation %', v_book -> 'validation';
  end if;

  -- Owner JWT for transfer insert (enforce_owner_transfer_insert → owns_property)
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  perform set_config('request.jwt.claim.email', 'smoke.auth.owner@example.com', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-0000-4000-8000-0000000000a1',
      'role', 'authenticated',
      'email', 'smoke.auth.owner@example.com'
    )::text,
    true
  );

  if public.owns_property(v_prop) is not true then
    raise exception 'auth_role#fixture FAIL: owner cannot owns_property';
  end if;

  insert into public.owner_transfers (
    property_id,
    from_owner_name, from_owner_email, from_owner_phone,
    to_owner_name, to_owner_email, status
  )
  select
    v_prop,
    p.owner_name, p.owner_email, p.owner_phone,
    'New Person', 'smoke.auth.new@example.com', 'ожидает'
  from public.properties as p
  where p.id = v_prop
  returning id into v_tr;

  if v_tr is null then
    raise exception 'auth_role#fixture FAIL: transfer not created';
  end if;

  -- Fixture IDs only (never consulted by owns_property / approve gate)
  perform set_config('pb1_auth_test.staff_email', v_staff_email, true);
  perform set_config('pb1_auth_test.staff_uid', v_staff_uid::text, true);
  perform set_config('pb1_auth_test.prop_id', v_prop::text, true);
  perform set_config('pb1_auth_test.transfer_id', v_tr::text, true);
  perform set_config('pb1_auth_test.fixture_ok', '1', true);
end;
$fixture$;

-- ---------------------------------------------------------------------------
-- C. Top-level authenticated role (real DB privileges)
-- ---------------------------------------------------------------------------
set local role authenticated;

do $as_auth$
declare
  v_staff_email text := current_setting('pb1_auth_test.staff_email', true);
  v_staff_uid text := current_setting('pb1_auth_test.staff_uid', true);
  v_prop bigint := nullif(current_setting('pb1_auth_test.prop_id', true), '')::bigint;
  v_tr bigint := nullif(current_setting('pb1_auth_test.transfer_id', true), '')::bigint;
  v_denied boolean;
  v_rowcount integer;
begin
  if current_setting('pb1_auth_test.fixture_ok', true) is distinct from '1'
     or v_staff_email is null
     or v_staff_uid is null
     or v_prop is null
     or v_tr is null
  then
    raise exception 'auth_role: fixture settings missing after SET ROLE';
  end if;

  if current_user is distinct from 'authenticated' then
    raise exception 'auth_role: expected current_user=authenticated, got %', current_user;
  end if;

  -- Staff JWT under authenticated role (for administration checks on UPDATE)
  perform set_config('request.jwt.claim.sub', v_staff_uid, true);
  perform set_config('request.jwt.claim.email', v_staff_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_staff_uid,
      'role', 'authenticated',
      'email', v_staff_email
    )::text,
    true
  );

  -- Spoof GUCs that previously authorized approve (must NOT open the gate)
  perform set_config('property_book.transfer_approve', '1', true);
  perform set_config('property_book.mutating', '1', true);

  -- 1) Gate INSERT denied
  v_denied := false;
  begin
    insert into public.property_book_transfer_approve_gate (transfer_id)
    values (v_tr);
  exception when others then
    v_denied := true;
    if sqlerrm not like '%permission denied%'
       and sqlerrm not like '%row-level security%' then
      raise exception 'auth_role#gate_insert FAIL unexpected: %', sqlerrm;
    end if;
  end;
  if not v_denied then
    raise exception 'auth_role#gate_insert FAIL: INSERT allowed';
  end if;

  -- 2) Gate UPDATE denied
  v_denied := false;
  begin
    update public.property_book_transfer_approve_gate
       set created_at = now()
     where transfer_id = v_tr;
    get diagnostics v_rowcount = row_count;
    if v_rowcount > 0 then
      raise exception 'auth_role#gate_update FAIL: UPDATE affected % rows', v_rowcount;
    end if;
  exception when others then
    v_denied := true;
    if sqlerrm like '%UPDATE affected%' then
      raise;
    end if;
    if sqlerrm not like '%permission denied%'
       and sqlerrm not like '%row-level security%' then
      raise exception 'auth_role#gate_update FAIL unexpected: %', sqlerrm;
    end if;
  end;
  -- Either exception (privilege/RLS) or zero-row no-op is acceptable;
  -- silent success with row changes is not.
  if not v_denied then
    -- zero-row path: confirm still no ticket
    if exists (
      select 1 from public.property_book_transfer_approve_gate as g
      where g.transfer_id = v_tr
    ) then
      raise exception 'auth_role#gate_update FAIL: ticket visible/writable';
    end if;
  end if;

  -- 3) Gate DELETE denied
  v_denied := false;
  begin
    delete from public.property_book_transfer_approve_gate
     where transfer_id = v_tr;
    get diagnostics v_rowcount = row_count;
    if v_rowcount > 0 then
      raise exception 'auth_role#gate_delete FAIL: DELETE affected % rows', v_rowcount;
    end if;
  exception when others then
    v_denied := true;
    if sqlerrm like '%DELETE affected%' then
      raise;
    end if;
    if sqlerrm not like '%permission denied%'
       and sqlerrm not like '%row-level security%' then
      raise exception 'auth_role#gate_delete FAIL unexpected: %', sqlerrm;
    end if;
  end;

  -- 4) Direct approve with spoofed GUCs + valid decision columns → blocked by gate
  v_denied := false;
  begin
    update public.owner_transfers as t
       set status = 'утверждена',
           decided_at = now(),
           decided_by = v_staff_email,
           reject_reason = null
     where t.id = v_tr;
  exception when others then
    v_denied := true;
    if sqlerrm not like '%approve only via admin_approve_owner_transfer%' then
      raise exception 'auth_role#direct_approve FAIL unexpected: %', sqlerrm;
    end if;
  end;
  if not v_denied then
    raise exception 'auth_role#direct_approve FAIL: SECURITY DEFECT (update succeeded)';
  end if;

  if exists (
    select 1 from public.owner_transfers as t
    where t.id = v_tr and t.status = 'утверждена'
  ) then
    raise exception 'auth_role#direct_approve FAIL: row marked approved';
  end if;

  -- Mark that authenticated-phase assertions actually ran
  perform set_config('pb1_auth_test.auth_phase_ok', '1', true);
end;
$as_auth$;

reset role;

-- ---------------------------------------------------------------------------
-- D. Post-checks as privileged role (Book unchanged; auth phase ran)
-- ---------------------------------------------------------------------------
do $post$
declare
  v_prop bigint := nullif(current_setting('pb1_auth_test.prop_id', true), '')::bigint;
  v_tr bigint := nullif(current_setting('pb1_auth_test.transfer_id', true), '')::bigint;
begin
  if current_setting('pb1_auth_test.auth_phase_ok', true) is distinct from '1' then
    raise exception 'auth_role: authenticated phase did not complete';
  end if;

  if current_user = 'authenticated' then
    raise exception 'auth_role: role not reset after authenticated phase';
  end if;

  if v_prop is null or v_tr is null then
    raise exception 'auth_role: fixture ids lost after RESET ROLE';
  end if;

  if exists (
    select 1 from public.property_book_transfer_approve_gate as g
    where g.transfer_id = v_tr
  ) then
    raise exception 'auth_role#gate FAIL: ticket row exists without RPC';
  end if;

  if exists (
    select 1 from public.property_registry_people as r
    where r.property_id = v_prop
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and lower(btrim(r.email)) = 'smoke.auth.new@example.com'
  ) then
    raise exception 'auth_role#book FAIL: ownership changed without RPC';
  end if;

  if not exists (
    select 1 from public.property_registry_people as r
    where r.property_id = v_prop
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and lower(btrim(r.email)) = 'smoke.auth.owner@example.com'
  ) then
    raise exception 'auth_role#book FAIL: original Book owner missing';
  end if;

  if (
    select t.status from public.owner_transfers as t where t.id = v_tr
  ) is distinct from 'ожидает' then
    raise exception 'auth_role#transfer FAIL: status changed without RPC';
  end if;
end;
$post$;

select 'AUTH ROLE CHECKS PASSED' as result;

rollback;
