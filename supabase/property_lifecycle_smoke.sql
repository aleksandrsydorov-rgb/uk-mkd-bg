-- PB-1.8 transactional smoke. Prefer:
--   npx supabase db query --linked -f supabase/property_lifecycle_smoke.sql
-- Success = one row: result = ALL CHECKS PASSED (then ROLLBACK).

begin;

create or replace function pg_temp.pb18_smoke()
returns text
language plpgsql
as $fn$
declare
  v_staff_uid uuid;
  v_staff_email text;
  v_prop bigint;
  v_apt bigint := 99480;
  v_insp jsonb;
  v_ret jsonb;
  v_book jsonb;
begin
  if to_regprocedure('public.admin_retire_property(bigint)') is null then
    raise exception 'smoke: apply 20261011120000_property_lifecycle_archive first';
  end if;

  select s.email, u.id into v_staff_email, v_staff_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id limit 1;
  if v_staff_uid is null then
    raise exception 'smoke: admin@example.com missing';
  end if;

  if exists (select 1 from public.properties where apartment_number = v_apt) then
    raise exception 'smoke: fixture collision apt %', v_apt;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_uid::text, true);
  perform set_config('request.jwt.claim.email', v_staff_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_staff_uid::text, 'role', 'authenticated', 'email', v_staff_email)::text,
    true
  );

  -- A) Empty shell → physical delete
  insert into public.properties (apartment_number, floor, area_sqm, status)
  values (v_apt, 1, 20, 'vacant')
  returning id into v_prop;

  v_insp := public.admin_property_lifecycle_inspect(v_prop);
  if coalesce((v_insp ->> 'can_delete')::boolean, false) is not true then
    raise exception 'smoke#empty_can_delete FAIL: %', v_insp;
  end if;

  v_ret := public.admin_retire_property(v_prop);
  if (v_ret ->> 'action') is distinct from 'deleted' then
    raise exception 'smoke#empty_delete FAIL: %', v_ret;
  end if;
  if exists (select 1 from public.properties where id = v_prop) then
    raise exception 'smoke#empty_delete FAIL: row still present';
  end if;

  -- B) Property with Book owners → archive (history preserved)
  insert into public.properties (apartment_number, floor, area_sqm, status, ownership_type)
  values (v_apt, 1, 20, 'vacant', 'sole')
  returning id into v_prop;

  perform public.admin_upsert_property_book_object(
    v_prop::bigint,
    'апартамент'::text,
    20::numeric,
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
      'first_name', 'Life', 'last_name', 'Cycle',
      'email', 'pb1.lifecycle@example.com',
      'ownership_share_percent', 100,
      'ideal_parts_percent', 0.5
    ))
  );
  if coalesce((v_book -> 'validation' ->> 'ok')::boolean, false) is not true then
    raise exception 'smoke#book FAIL: %', v_book;
  end if;

  v_insp := public.admin_property_lifecycle_inspect(v_prop);
  if coalesce((v_insp ->> 'must_archive')::boolean, false) is not true then
    raise exception 'smoke#must_archive FAIL: %', v_insp;
  end if;

  v_ret := public.admin_retire_property(v_prop);
  if (v_ret ->> 'action') is distinct from 'archived' then
    raise exception 'smoke#archive FAIL: %', v_ret;
  end if;

  if not exists (
    select 1 from public.properties p where p.id = v_prop and p.archived_at is not null
  ) then
    raise exception 'smoke#archive FAIL: archived_at null';
  end if;

  -- Book history retained
  if not exists (
    select 1 from public.property_registry_people r where r.property_id = v_prop
  ) then
    raise exception 'smoke#history FAIL: registry wiped';
  end if;

  -- Access denied after archive
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c001', true);
  perform set_config('request.jwt.claim.email', 'pb1.lifecycle@example.com', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-0000-4000-8000-00000000c001',
      'role', 'authenticated',
      'email', 'pb1.lifecycle@example.com'
    )::text,
    true
  );
  if public.owns_property(v_prop) is true then
    raise exception 'smoke#access FAIL: archived property still owned';
  end if;

  -- Active book list excludes archived
  perform set_config('request.jwt.claim.sub', v_staff_uid::text, true);
  perform set_config('request.jwt.claim.email', v_staff_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_staff_uid::text, 'role', 'authenticated', 'email', v_staff_email)::text,
    true
  );
  if exists (
    select 1 from public.admin_list_property_book(2000) b where b.property_id = v_prop
  ) then
    raise exception 'smoke#list FAIL: archived still in active book list';
  end if;

  -- Invite blocked on archived
  begin
    perform public.admin_create_property_invite(
      v_prop,
      (select r.id from public.property_registry_people r
        where r.property_id = v_prop and r.deregistered_at is null limit 1)
    );
    raise exception 'smoke#invite FAIL: invite allowed on archived';
  exception
    when others then
      if sqlerrm not like '%archived%' and sqlerrm not like '%incomplete%' then
        raise exception 'smoke#invite FAIL unexpected: %', sqlerrm;
      end if;
  end;

  return 'ALL CHECKS PASSED';
end;
$fn$;

select pg_temp.pb18_smoke() as result;

rollback;
