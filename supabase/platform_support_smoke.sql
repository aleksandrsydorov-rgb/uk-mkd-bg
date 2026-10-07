-- =============================================================================
-- Platform Support SMOKE — BEGIN/ROLLBACK (no lasting writes)
-- Structural insert/delete checks only; does not impersonate staff auth.
-- =============================================================================

begin;

do $$
declare
  v_installation_id uuid;
  v_thread_id uuid;
  v_msg_id uuid;
  v_ctx jsonb;
  v_disabled_blocked boolean := false;
begin
  if to_regclass('public.platform_installations') is null then
    raise exception 'smoke: platform_installations missing';
  end if;

  insert into public.platform_installations (complex_name, deployment_id)
  values ('smoke-complex', 'smoke-deploy')
  returning installation_id into v_installation_id;

  insert into public.platform_account_state (installation_id, status, currency)
  values (v_installation_id, 'SUSPENDED_NONPAYMENT', 'EUR');

  insert into public.platform_support_threads (installation_id, subject)
  values (v_installation_id, 'Platform support')
  returning id into v_thread_id;

  v_ctx := public.platform_support_sanitize_tech_context(
    jsonb_build_object(
      'app_version', '0.1.0',
      'password', 'must-strip',
      'access_token', 'must-strip',
      'service_role_key', 'must-strip',
      'page_path', '/admin'
    )
  );

  if v_ctx ? 'password' or v_ctx ? 'access_token' or v_ctx ? 'service_role_key' then
    raise exception 'smoke: sanitize failed to strip secrets';
  end if;
  if not (v_ctx ? 'app_version' and v_ctx ? 'page_path') then
    raise exception 'smoke: sanitize dropped safe keys';
  end if;

  insert into public.platform_support_messages (
    thread_id, sender_role, body, tech_context, read_by_complex_admin
  )
  values (v_thread_id, 'complex_admin', 'smoke local queue note', v_ctx, true)
  returning id into v_msg_id;

  if v_msg_id is null then
    raise exception 'smoke: message insert failed';
  end if;

  -- Shape check only; rolled back — not a production seed / fake billing history.
  insert into public.platform_billing_invoices (
    installation_id, invoice_number, issue_date, amount, currency, status
  )
  values (v_installation_id, 'SMOKE-001', current_date, 0, 'EUR', 'CANCELLED');

  -- Platform-core cannot be disabled via direct row update (trigger).
  begin
    update public.building_modules
       set enabled = false
     where module_key = 'platform_support';
  exception
    when others then
      v_disabled_blocked := true;
  end;

  if not v_disabled_blocked then
    raise exception 'smoke: platform_support disable was not blocked';
  end if;

  if exists (
    select 1 from public.building_modules
    where module_key = 'platform_support' and enabled is distinct from true
  ) then
    raise exception 'smoke: platform_support left disabled';
  end if;

  raise notice 'platform_support smoke OK installation=% thread=% suspended_account_ok',
    v_installation_id, v_thread_id;
end;
$$;

rollback;
