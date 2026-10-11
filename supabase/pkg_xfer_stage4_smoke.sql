-- =============================================================================
-- PKG-XFER Stage 4 — SAFE database-level smoke (BEGIN / ROLLBACK)
-- Fixture scope: synthetic apt 99371 (bigint) + floor; emails smoke.xfer4.*@example.com
-- NEVER apartment 99501 / Owner A/B.
-- Schema note: properties.apartment_number and properties.floor are bigint NOT NULL.
-- No JWT GUC spoofing. No auth.users / storage.objects inserts.
-- No owner_transfers DML. Extract rows inserted as DB fixture for immutability only
-- (authenticated INSERT privilege remains revoked — see S4-DB-06).
-- Notify/history/generate/attach/certified RPCs requiring sessions → SKIPPED.
-- =============================================================================

begin;

create temporary table pg_temp.xfer4_results (
  check_id text primary key,
  status text not null check (status in ('PASS', 'FAIL', 'SKIPPED')),
  detail text null
) on commit drop;

create or replace function pg_temp.xfer4_mark(p_id text, p_status text, p_detail text default null)
returns void language plpgsql as $fn$
begin
  insert into pg_temp.xfer4_results (check_id, status, detail)
  values (p_id, p_status, p_detail)
  on conflict (check_id) do update set status = excluded.status, detail = excluded.detail;
end;
$fn$;

do $body$
declare
  apt bigint := 99371;
  prop_id bigint;
  ideal numeric := 1.750000;
  floor_n bigint := 9;
  owner_a text := 'smoke.xfer4.a@example.com';
  extract_id bigint;
  extract_no text := 'PB-SMOKE4-000001-BG';
  html_before text;
  raised boolean;
  n_fail integer;
begin
  if to_regclass('public.property_book_extracts') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'property_book_extracts'
         and column_name = 'has_pdf'
     )
  then
    raise exception 'smoke4: Stage 4 extract columns not applied';
  end if;

  insert into public.properties (
    apartment_number, floor, ideal_parts_percent, ownership_type, owner_email, owner_name
  ) values (apt, floor_n, ideal, 'sole', owner_a, 'Smoke Xfer4 A')
  returning id into prop_id;

  perform public.property_book_set_mutating(true);
  insert into public.property_registry_people (
    property_id, relation_type, entity_kind, first_name, last_name, email,
    ownership_share_percent, ideal_parts_percent
  ) values (
    prop_id, 'owner', 'natural_person', 'Smoke', 'Xfer4A', owner_a, 100, ideal
  );
  perform public.property_book_set_mutating(false);

  -- Honest has_pdf default + frozen HTML immutability
  insert into public.property_book_extracts (
    extract_number, property_id, generated_by_email, locale, extract_kind,
    is_signed, is_informational, content_sha256, content_html, book_snapshot,
    has_pdf, excludes_restricted_personal_data
  ) values (
    extract_no, prop_id, owner_a, 'bg', 'informational',
    false, true, repeat('aa', 32),
    '<html><body>INFORMATIONAL EXTRACT SMOKE</body></html>',
    jsonb_build_object('owners', jsonb_build_array(jsonb_build_object('email_redacted', true))),
    false, true
  ) returning id, content_html into extract_id, html_before;

  perform pg_temp.xfer4_mark(
    'S4-DB-01_has_pdf_false_until_attach',
    case when exists (
      select 1 from public.property_book_extracts where id = extract_id and has_pdf is false
    ) then 'PASS' else 'FAIL' end
  );

  raised := false;
  begin
    update public.property_book_extracts
       set content_html = '<html>MUTATED</html>'
     where id = extract_id;
  exception when others then
    raised := true;
  end;
  perform pg_temp.xfer4_mark(
    'S4-DB-02_content_html_immutable',
    case when raised
      and (select content_html from public.property_book_extracts where id = extract_id) = html_before
      then 'PASS' else 'FAIL' end
  );

  raised := false;
  begin
    delete from public.property_book_extracts where id = extract_id;
  exception when others then
    raised := true;
  end;
  perform pg_temp.xfer4_mark(
    'S4-DB-03_delete_forbidden',
    case when raised and exists (
      select 1 from public.property_book_extracts where id = extract_id
    ) then 'PASS' else 'FAIL' end
  );

  -- Unique extract_number
  raised := false;
  begin
    insert into public.property_book_extracts (
      extract_number, property_id, generated_by_email, locale, extract_kind,
      is_signed, is_informational, content_sha256, content_html, book_snapshot, has_pdf
    ) values (
      extract_no, prop_id, owner_a, 'ru', 'informational',
      false, true, repeat('bb', 32), '<html>dupe</html>', '{}'::jsonb, false
    );
  exception when unique_violation then
    raised := true;
  when others then
    raised := sqlstate = '23505';
  end;
  perform pg_temp.xfer4_mark(
    'S4-DB-04_extract_number_unique',
    case when raised then 'PASS' else 'FAIL' end
  );

  -- Notification event constraint allows expected Stage 4 kinds (insert then rollback)
  begin
    insert into public.ownership_change_notifications (
      property_id, event_kind, recipient_email, recipient_role,
      email_attempted, email_delivered, email_skip_reason, payload
    ) values (
      prop_id, 'admin_pending', 'smoke.xfer4.admin@example.com', 'admin',
      true, false, 'provider_not_configured', '{}'::jsonb
    );
    perform pg_temp.xfer4_mark('S4-DB-05_notify_event_kinds', 'PASS');
  exception when others then
    perform pg_temp.xfer4_mark('S4-DB-05_notify_event_kinds', 'FAIL', sqlerrm);
  end;

  -- Privileges: authenticated cannot INSERT extracts
  perform pg_temp.xfer4_mark(
    'S4-DB-06_auth_cannot_insert_extracts',
    case when has_table_privilege('authenticated', 'public.property_book_extracts', 'INSERT')
      then 'FAIL' else 'PASS' end
  );

  -- Auth-gated RPCs (real sessions — not PASS)
  perform pg_temp.xfer4_mark('S4-AUTH-01_generate_multi_locale', 'SKIPPED', 'session plan D2; needs real owner session');
  perform pg_temp.xfer4_mark('S4-AUTH-02_attach_pdf_via_api', 'SKIPPED', 'session plan D3/D4; needs real session + storage + API');
  perform pg_temp.xfer4_mark('S4-AUTH-03_notification_privacy', 'SKIPPED', 'session plan N2; needs real owner/admin sessions');
  perform pg_temp.xfer4_mark('S4-AUTH-04_honest_email_status', 'SKIPPED', 'session plan N3; needs real submit/approve path');
  perform pg_temp.xfer4_mark('S4-AUTH-05_history_hides_storage_paths', 'SKIPPED', 'session plan N4; needs real owner session');
  perform pg_temp.xfer4_mark('S4-AUTH-06_certified_fulfill_unsigned', 'SKIPPED', 'session plan D5; needs real admin session');
  perform pg_temp.xfer4_mark('S4-AUTH-07_former_owner_denied', 'SKIPPED', 'session plan X3; needs real former-owner session');
  perform pg_temp.xfer4_mark('S4-AUTH-08_pending_counter', 'SKIPPED', 'session plan N1; needs real admin session');
  perform pg_temp.xfer4_mark(
    'S4-AUTH-09_owner_generate_rpc',
    'SKIPPED',
    'owner_generate_property_book_extract requires auth; session plan D2'
  );

  select count(*)::integer into n_fail from pg_temp.xfer4_results where status = 'FAIL';
  if n_fail > 0 then
    raise exception 'smoke4: % FAIL check(s)', n_fail;
  end if;
end;
$body$;

select check_id, status, detail from pg_temp.xfer4_results order by check_id;

rollback;
