-- Email Core Phase A — SAFE smoke (BEGIN / ROLLBACK)
-- Run ONLY on an isolated database. NEVER against klowacuvufknbrkayjhz / production.
-- Validates schema presence, defaults, idempotency, and privilege posture.

begin;

do $body$
declare
  v_enabled boolean;
  v_ready boolean;
  v_status text;
  v1 jsonb;
  v2 jsonb;
  n_priv int;
begin
  if to_regclass('public.complex_email_settings') is null then
    raise exception 'email_core smoke: migration not applied';
  end if;

  select email_enabled into v_enabled from public.complex_email_settings where id = 1;
  if coalesce(v_enabled, true) is distinct from false then
    raise exception 'email_core smoke: email_enabled must default false';
  end if;

  v_ready := public.email_core_is_ready();
  if v_ready then
    raise exception 'email_core smoke: email_core_is_ready must be false in Phase A';
  end if;

  v_status := public.email_core_config_delivery_status();
  if v_status is distinct from 'not_configured' then
    raise exception 'email_core smoke: expected not_configured, got %', v_status;
  end if;

  v1 := public.email_core_enqueue(
    'smoke:idem:1',
    'system',
    'smoke_template',
    'smoke.email.core@example.com',
    'bg',
    'smoke',
    '{}'::jsonb
  );
  if coalesce(v1->>'sent', 'true') <> 'false' then
    raise exception 'email_core smoke: enqueue must not send';
  end if;
  if coalesce(v1->>'status', '') not in ('blocked_not_ready', 'held') then
    raise exception 'email_core smoke: unexpected status %', v1->>'status';
  end if;

  v2 := public.email_core_enqueue(
    'smoke:idem:1',
    'system',
    'smoke_template',
    'smoke.email.core@example.com',
    'bg',
    'smoke',
    '{}'::jsonb
  );
  if coalesce((v2->>'duplicate')::boolean, false) is not true then
    raise exception 'email_core smoke: idempotency failed';
  end if;

  -- authenticated must not have direct DML on email tables
  select count(*)::int into n_priv
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'complex_email_settings',
      'email_verified_senders',
      'email_outbox',
      'email_delivery_attempts',
      'email_delivery_events'
    )
    and grantee in ('authenticated', 'anon', 'PUBLIC')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  if n_priv > 0 then
    raise exception 'email_core smoke: unexpected DML grants to client roles (%)', n_priv;
  end if;

  raise notice 'email_core Phase A smoke PASS';
end;
$body$;

rollback;
