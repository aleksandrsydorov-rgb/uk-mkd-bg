-- =============================================================================
-- Meeting Core foundation smoke (BEGIN / ROLLBACK)
-- Local / linked optional — do NOT treat pass as production apply permission.
--   npx supabase db query --linked -f supabase/meeting_core_foundation_smoke.sql
-- Success = result ALL CHECKS PASSED
-- =============================================================================

begin;

create or replace function pg_temp.meeting_core_smoke()
returns text
language plpgsql
security definer
set search_path = public
as $body$
declare
  staff_email text;
  staff_uid uuid;
  mid uuid;
  snap_id uuid;
  inv_id uuid;
  drift jsonb;
  proxy1 uuid;
  proxy_fail boolean := false;
  bad_tr boolean := false;
begin
  if to_regprocedure('public.gm_freeze_notice_snapshot(uuid)') is null then
    raise exception 'smoke#schema FAIL: gm_freeze_notice_snapshot missing';
  end if;
  if to_regprocedure('public.gm_transition(uuid,text,text)') is null then
    raise exception 'smoke#schema FAIL: gm_transition missing';
  end if;
  if not exists (select 1 from public.meeting_rulesets where code = 'BG_ZUES_2026_09') then
    raise exception 'smoke#schema FAIL: ruleset BG_ZUES_2026_09 missing';
  end if;

  select s.email, u.id into staff_email, staff_uid
  from public.staff as s
  join auth.users as u on lower(btrim(u.email)) = lower(btrim(s.email))
  where s.active is true and lower(btrim(s.email)) = 'admin@example.com'
  order by s.id limit 1;
  if staff_uid is null then
    raise exception 'smoke: admin@example.com missing';
  end if;

  perform set_config('request.jwt.claim.sub', staff_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.email', staff_email, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', staff_uid::text, 'role', 'authenticated', 'email', staff_email)::text,
    true
  );

  insert into public.general_meetings (
    title, meeting_date, meeting_time, location, meeting_mode, is_urgent, status, meeting_type
  ) values (
    'Meeting Core smoke', current_date + 14, '18:00', 'Lobby', 'in_person', false, 'draft', 'EXTRAORDINARY'
  )
  returning id into mid;

  if (select ruleset_id from public.general_meetings where id = mid) is null then
    raise exception 'smoke#ruleset FAIL: ruleset_id not bound';
  end if;
  if (select legal_state from public.general_meetings where id = mid) is distinct from 'DRAFT' then
    raise exception 'smoke#state FAIL: expected DRAFT';
  end if;

  select id into snap_id from public.gm_freeze_notice_snapshot(mid);
  if snap_id is null then
    raise exception 'smoke#notice FAIL';
  end if;

  -- lock invitation (also freezes notice if missing — already frozen)
  select id into inv_id
  from public.gm_lock_invitation_version(
    mid, 'Покана smoke', 'Тяло на поканата', null, null, null, null
  );
  if inv_id is null then
    raise exception 'smoke#invite FAIL';
  end if;

  perform public.gm_record_invitation_posting(mid, now(), 'Табло', null);

  -- mutate book to force drift: touch an owner email if any
  update public.property_registry_people as r
     set email = coalesce(r.email, 'x') || '.drift'
   where r.id = (
     select r2.id from public.property_registry_people as r2
     where r2.relation_type = 'owner' and r2.deregistered_at is null
     limit 1
   );

  drift := public.gm_detect_ownership_drift(mid);
  if coalesce((drift ->> 'drift')::boolean, false) is not true then
    -- if no registry people, hash may still match — skip soft
    if exists (select 1 from public.property_registry_people where relation_type = 'owner' and deregistered_at is null) then
      raise exception 'smoke#drift FAIL: expected drift %', drift;
    end if;
  end if;

  begin
    perform public.gm_transition(mid, 'CHECK_IN_OPEN', null);
  exception
    when others then
      if sqlerrm ilike '%check-in blocked%' or sqlerrm ilike '%OWNERSHIP_CHANGED%' then
        null;
      else
        raise;
      end if;
  end;

  -- invalid transition
  begin
    perform public.gm_transition(mid, 'CLOSED', null);
    bad_tr := true;
  exception
    when others then
      if sqlerrm not ilike '%invalid%' then
        raise;
      end if;
  end;
  if bad_tr then
    raise exception 'smoke#transition FAIL: invalid transition allowed';
  end if;

  -- proxy max 3
  if exists (select 1 from public.properties limit 1) then
    perform public.gm_create_proxy(
      mid, (select id from public.properties order by id limit 1),
      'Smoke Rep', null, 'admin_paper', null
    );
    perform public.gm_create_proxy(
      mid, (select id from public.properties order by id offset 1 limit 1),
      'Smoke Rep', null, 'admin_paper', null
    );
    -- third may fail if <3 properties — use same property allowed by schema
    begin
      perform public.gm_create_proxy(
        mid, (select id from public.properties order by id limit 1),
        'Smoke Rep', null, 'admin_paper', null
      );
      perform public.gm_create_proxy(
        mid, (select id from public.properties order by id limit 1),
        'Smoke Rep', null, 'admin_paper', null
      );
      proxy_fail := true;
    exception
      when others then
        if sqlerrm not ilike '%max%' then
          raise;
        end if;
    end;
    if proxy_fail then
      raise exception 'smoke#proxy FAIL: max 3 not enforced';
    end if;
  end if;

  perform public.gm_log_notification(
    mid, 'INVITATION', 'email', staff_email, '{}'::jsonb, 'sent', null, null
  );

  perform public.gm_upsert_protocol_draft(mid, 'Протокол smoke BG', null, null);

  return 'ALL CHECKS PASSED';
end;
$body$;

select pg_temp.meeting_core_smoke() as result;

rollback;
