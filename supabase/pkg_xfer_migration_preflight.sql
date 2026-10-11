-- =============================================================================
-- PKG-XFER migration preflight (READ-ONLY checks)
-- Run against TEST Supabase BEFORE applying 140000–140300.
-- Does not write business data. Safe to run repeatedly.
-- =============================================================================

do $body$
declare
  v_missing text[] := array[]::text[];
  v_warn text[] := array[]::text[];
begin
  -- Required PB-1 / gate dependencies
  if to_regprocedure('public.admin_assert_book_admin()') is null then
    v_missing := array_append(v_missing, 'admin_assert_book_admin()');
  end if;
  if to_regprocedure('public.property_book_set_mutating(boolean)') is null then
    v_missing := array_append(v_missing, 'property_book_set_mutating(boolean)');
  end if;
  if to_regprocedure('public.admin_replace_property_book_owners(bigint,jsonb)') is null then
    v_missing := array_append(v_missing, 'admin_replace_property_book_owners(bigint,jsonb)');
  end if;
  if to_regprocedure('public.owns_property(bigint)') is null then
    v_missing := array_append(v_missing, 'owns_property(bigint)');
  end if;
  if to_regprocedure('public.property_book_sync_portal_owner_fields(bigint)') is null then
    v_missing := array_append(v_missing, 'property_book_sync_portal_owner_fields(bigint)');
  end if;
  if to_regprocedure('public.log_property_change(bigint,text,text,text,jsonb,text)') is null then
    v_missing := array_append(v_missing, 'log_property_change(...)');
  end if;
  if to_regprocedure('public.guest_access_expire_stale()') is null then
    v_missing := array_append(v_missing, 'guest_access_expire_stale()');
  end if;
  if to_regprocedure('public.property_tariff_subject_kind(bigint)') is null then
    v_missing := array_append(v_missing, 'property_tariff_subject_kind(bigint)');
  end if;
  if to_regprocedure('public.gm_write_vote(uuid,uuid,bigint,text,text,text,bigint)') is null then
    v_missing := array_append(v_missing, 'gm_write_vote(7-arg)');
  end if;
  if to_regprocedure('public.property_voting_parties(bigint)') is null then
    v_missing := array_append(v_missing, 'property_voting_parties(bigint)');
  end if;
  if to_regclass('public.property_book_transfer_approve_gate') is null then
    v_missing := array_append(
      v_missing,
      'property_book_transfer_approve_gate (apply 20261011005000 first)'
    );
  end if;
  if to_regclass('public.property_registry_people') is null then
    v_missing := array_append(v_missing, 'property_registry_people');
  end if;
  if to_regclass('public.owner_transfers') is null then
    v_missing := array_append(v_missing, 'owner_transfers');
  end if;
  if to_regclass('public.support_fee_assessments') is null then
    v_missing := array_append(v_missing, 'support_fee_assessments');
  end if;
  if to_regclass('public.capital_repair_ledger') is null then
    v_warn := array_append(v_warn, 'capital_repair_ledger missing — capital overdue branch degraded');
  end if;
  if to_regclass('public.property_guest_accesses') is null then
    v_missing := array_append(v_missing, 'property_guest_accesses');
  end if;
  if to_regclass('public.building_documents') is null then
    v_missing := array_append(v_missing, 'building_documents');
  end if;

  -- Ensure PKG-XFER not partially applied
  if to_regclass('public.ownership_change_settings') is not null then
    v_warn := array_append(v_warn, 'ownership_change_settings already exists (partial apply?)');
  end if;
  if to_regclass('public.property_book_extracts') is not null then
    v_warn := array_append(v_warn, 'property_book_extracts already exists (partial apply?)');
  end if;

  -- Approve gate must not be writable by authenticated
  if to_regclass('public.property_book_transfer_approve_gate') is not null then
    if has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'INSERT')
       or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'UPDATE')
       or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'DELETE')
    then
      v_missing := array_append(v_missing, 'approve_gate writable by authenticated (security)');
    end if;
  end if;

  raise notice 'PKG-XFER PREFLIGHT WARNINGS: %', coalesce(array_to_string(v_warn, '; '), '(none)');

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'PKG-XFER PREFLIGHT FAIL: missing deps: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'PKG-XFER PREFLIGHT PASS — safe to consider applying 140000 after backup';
end;
$body$;
