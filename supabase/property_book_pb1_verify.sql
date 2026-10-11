-- PKG-PB1-BOOK-ONLY post-migration verify (read-only). Expect all PASS.

do $verify$
declare
  v_fail text := '';
  v_def text;
begin
  -- Compat runtime must be gone
  if to_regclass('public.property_book_runtime_flags') is not null then
    v_fail := v_fail || 'property_book_runtime_flags must not exist; ';
  end if;
  if to_regprocedure('public.property_book_legacy_email_access_enabled()') is not null then
    v_fail := v_fail || 'legacy_email_access_enabled must not exist; ';
  end if;
  if to_regprocedure('public.admin_property_book_disable_legacy_email_access(text)') is not null then
    v_fail := v_fail || 'disable_legacy_email_access must not exist; ';
  end if;
  if to_regprocedure('public.property_book_legacy_reconciliation_report()') is not null then
    v_fail := v_fail || 'legacy_reconciliation_report must not exist; ';
  end if;

  if to_regprocedure('public.property_book_ownership_audit_report()') is null then
    v_fail := v_fail || 'missing ownership_audit_report; ';
  end if;
  if to_regprocedure('public.property_book_owner_row_access_ready(public.property_registry_people)') is null then
    v_fail := v_fail || 'missing access_ready; ';
  end if;
  if to_regprocedure('public.admin_create_property_invite(bigint,bigint)') is null then
    v_fail := v_fail || 'missing invite(registry_people_id); ';
  end if;
  if to_regprocedure('public.admin_resend_property_invite(uuid)') is null then
    v_fail := v_fail || 'missing resend; ';
  end if;
  if to_regprocedure('public.admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean)') is null then
    v_fail := v_fail || 'missing import 5-arg; ';
  end if;
  if to_regprocedure('public.admin_approve_owner_transfer(bigint)') is null then
    v_fail := v_fail || 'missing approve transfer; ';
  end if;
  if to_regprocedure('public.user_activation_owner_base()') is null then
    v_fail := v_fail || 'missing user_activation_owner_base; ';
  end if;
  if to_regprocedure('public.gm_freeze_notice_snapshot(uuid)') is null then
    v_fail := v_fail || 'missing gm_freeze_notice_snapshot; ';
  end if;
  if to_regprocedure('public.gm_freeze_voting_snapshot(uuid)') is null then
    v_fail := v_fail || 'missing gm_freeze_voting_snapshot; ';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'property_access_invites'
      and column_name = 'registry_people_id'
  ) then
    v_fail := v_fail || 'missing invites.registry_people_id; ';
  end if;

  -- owns_property must not reference properties.owner_email
  v_def := pg_get_functiondef('public.owns_property(bigint)'::regprocedure);
  if v_def is null then
    v_fail := v_fail || 'missing owns_property; ';
  elsif position('owner_email' in lower(v_def)) > 0 then
    v_fail := v_fail || 'owns_property still references owner_email; ';
  end if;

  -- UA base must not union portal owner_email
  v_def := pg_get_functiondef('public.user_activation_owner_base()'::regprocedure);
  if v_def is null then
    v_fail := v_fail || 'missing UA owner_base def; ';
  elsif position('from public.properties' in lower(v_def)) > 0
     and position('property_registry_people' in lower(v_def)) = 0 then
    v_fail := v_fail || 'UA owner_base not Book-based; ';
  elsif position('p.owner_email' in v_def) > 0
     or position('properties as p' in lower(v_def)) > 0
        and position('owner_email' in v_def) > 0
        and position('property_registry_people' in lower(v_def)) = 0 then
    v_fail := v_fail || 'UA owner_base still uses portal owner_email; ';
  elsif position('owner_email' in v_def) > 0
     and position('property_registry_people' in lower(v_def)) > 0
     and position('from public.properties as p' in lower(v_def)) > 0
     and position('union' in lower(v_def)) > 0 then
    v_fail := v_fail || 'UA owner_base still unions portal owner_email; ';
  end if;

  -- Stricter UA check: no properties.owner_email in body
  if v_def is not null and position('p.owner_email' in v_def) > 0 then
    v_fail := v_fail || 'UA owner_base references p.owner_email; ';
  end if;

  -- GM freeze notice must inner-join Book (no coalesce to owner_email)
  v_def := pg_get_functiondef('public.gm_freeze_notice_snapshot(uuid)'::regprocedure);
  if v_def is null then
    v_fail := v_fail || 'missing notice freeze def; ';
  elsif position('p.owner_email' in v_def) > 0
     or position('coalesce(r.email, p.owner_email' in lower(v_def)) > 0 then
    v_fail := v_fail || 'gm_freeze_notice_snapshot still falls back to owner_email; ';
  end if;

  v_def := pg_get_functiondef('public.gm_freeze_voting_snapshot(uuid)'::regprocedure);
  if v_def is null then
    v_fail := v_fail || 'missing voting freeze def; ';
  elsif position('p.owner_email' in v_def) > 0
     or position('coalesce(r.email, p.owner_email' in lower(v_def)) > 0 then
    v_fail := v_fail || 'gm_freeze_voting_snapshot still falls back to owner_email; ';
  end if;

  if v_fail <> '' then
    raise exception 'PB-1 BOOK-ONLY VERIFY FAIL: %', v_fail;
  end if;

  raise notice 'PB-1 BOOK-ONLY VERIFY PASS';
end;
$verify$;

select
  'PASS' as result,
  'book_only' as authorization,
  to_regclass('public.property_book_runtime_flags') is null as compat_flags_removed,
  to_regprocedure('public.property_book_ownership_audit_report()') is not null as has_audit_report;
