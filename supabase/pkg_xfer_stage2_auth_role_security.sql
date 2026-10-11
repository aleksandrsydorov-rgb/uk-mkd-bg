-- =============================================================================
-- PKG-XFER Stage 2 authenticated-role ACL checks (BEGIN / ROLLBACK)
-- SAFE: catalog privilege checks only — no JWT GUC spoofing, no fixtures,
-- no auth.users / storage.objects, no business DML.
-- Companion to pkg_xfer_stage2_smoke.sql (DB-level) and the authenticated
-- session test plan (real logins).
-- =============================================================================

begin;

do $body$
declare
  v_can_exec_submit boolean;
  v_can_exec_approve boolean;
  v_can_exec_reject boolean;
  v_can_exec_corr boolean;
  v_can_exec_verify boolean;
begin
  if to_regprocedure('public.submit_ownership_change(bigint,jsonb,text,text,text,date,text,text,date,text,text,bigint,boolean,text)') is null then
    raise exception 'auth_role: PKG-XFER migration not applied';
  end if;

  v_can_exec_submit := has_function_privilege(
    'authenticated',
    'public.submit_ownership_change(bigint,jsonb,text,text,text,date,text,text,date,text,text,bigint,boolean,text)',
    'execute'
  );
  v_can_exec_approve := has_function_privilege(
    'authenticated',
    'public.admin_approve_owner_transfer(bigint,jsonb,text,text,date,text,date,jsonb)',
    'execute'
  );
  v_can_exec_reject := has_function_privilege(
    'authenticated',
    'public.admin_reject_owner_transfer(bigint,text)',
    'execute'
  );
  v_can_exec_corr := has_function_privilege(
    'authenticated',
    'public.admin_record_ownership_correction(bigint,jsonb,text,text,text)',
    'execute'
  );
  v_can_exec_verify := has_function_privilege(
    'authenticated',
    'public.owner_verify_and_attach_extract_pdf(bigint,uuid,text,boolean)',
    'execute'
  );

  if not v_can_exec_submit then
    raise exception 'auth_role: authenticated missing execute on submit_ownership_change';
  end if;
  if not v_can_exec_approve then
    raise exception 'auth_role: authenticated missing execute on admin_approve_owner_transfer';
  end if;
  if not v_can_exec_reject then
    raise exception 'auth_role: authenticated missing execute on admin_reject_owner_transfer';
  end if;
  if not v_can_exec_corr then
    raise exception 'auth_role: authenticated missing execute on admin_record_ownership_correction';
  end if;
  if not v_can_exec_verify then
    raise exception 'auth_role: authenticated missing execute on owner_verify_and_attach_extract_pdf';
  end if;

  if has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'INSERT')
     or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'UPDATE')
     or has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'DELETE')
  then
    raise exception 'auth_role: transfer approve gate must not be writable by authenticated';
  end if;

  if has_table_privilege('authenticated', 'public.property_book_extracts', 'INSERT')
     or has_table_privilege('authenticated', 'public.ownership_tariff_transitions', 'INSERT')
  then
    raise exception 'auth_role: authenticated must not INSERT extracts or tariff transitions';
  end if;

  if has_function_privilege(
    'anon',
    'public.submit_ownership_change(bigint,jsonb,text,text,text,date,text,text,date,text,text,bigint,boolean,text)',
    'execute'
  ) then
    raise exception 'auth_role: anon must not execute submit_ownership_change';
  end if;

  raise notice 'PKG-XFER Stage 2 auth_role ACL checks PASSED';
end;
$body$;

rollback;
