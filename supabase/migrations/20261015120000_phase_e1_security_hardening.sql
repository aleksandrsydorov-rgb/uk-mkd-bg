-- Phase E1 — SEC-P1-1 / SEC-P1-2 security hardening
-- Do not enable email sending. Do not flip ordinary_debt_gate.
-- Authz only: Property Book active-owners PII + email_core_enqueue caller checks.

begin;

-- ---------------------------------------------------------------------------
-- SEC-P1-1: property_book_active_owners — scoped PII
-- Allow: service_role, book admin (администрация), Book owners/co-owners (owns_property).
-- Deny: anon, guests (no owns_property), unrelated authenticated users.
-- Nested SECURITY DEFINER admin/validate callers keep working via session auth.uid().
-- ---------------------------------------------------------------------------

create or replace function public.property_book_active_owners(p_property_id bigint)
returns setof public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.role() is not distinct from 'service_role' then
    null; -- ops / workers
  elsif public.has_staff_role('администрация') then
    null; -- UK administrators
  elsif auth.uid() is not null and public.owns_property(p_property_id) then
    null; -- active Book owner / co-owner on this property
  else
    raise exception 'property_book_active_owners: forbidden'
      using errcode = '42501';
  end if;

  return query
  select r.*
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id;
end;
$fn$;

revoke all on function public.property_book_active_owners(bigint) from public;
revoke all on function public.property_book_active_owners(bigint) from anon;
grant execute on function public.property_book_active_owners(bigint) to authenticated;
grant execute on function public.property_book_active_owners(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- SEC-P1-2: email_core_enqueue — caller + module/template authorization
-- ---------------------------------------------------------------------------

create or replace function public.email_core_assert_can_enqueue(
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_module text := nullif(btrim(coalesce(p_module_key, '')), '');
  v_tpl text := lower(nullif(btrim(coalesce(p_template_key, '')), ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_property_id bigint := null;
  v_transfer_id bigint := null;
  v_is_admin boolean := false;
  v_raw text;
begin
  if v_module is null then
    raise exception 'email_core_enqueue: invalid module_key'
      using errcode = '22023';
  end if;

  if auth.role() is not distinct from 'service_role' then
    return;
  end if;

  if auth.uid() is null then
    raise exception 'email_core_enqueue: not authenticated'
      using errcode = '28000';
  end if;

  v_is_admin := public.has_staff_role('администрация');

  -- Template prefix must match module (blocks module/template spoofing).
  if v_tpl is null then
    raise exception 'email_core_enqueue: template_key required'
      using errcode = '22023';
  end if;

  if v_module = 'pb1_invite' and v_tpl not like 'pb1_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'user_activation' and v_tpl not like 'ua_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'pkg_xfer' and v_tpl not like 'ownership_change_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'meeting' and v_tpl not like 'meeting_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'email_test' and v_tpl not like 'email_test%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;
  if v_module = 'system' and v_tpl not like 'system_%' then
    raise exception 'email_core_enqueue: template_key mismatch'
      using errcode = '22023';
  end if;

  -- Module authorization
  if v_module = 'system' then
    raise exception 'email_core_enqueue: forbidden'
      using errcode = '42501';
  end if;

  if v_module in ('pb1_invite', 'user_activation', 'email_test', 'meeting') then
    if not v_is_admin then
      raise exception 'email_core_enqueue: forbidden'
        using errcode = '42501';
    end if;
    return;
  end if;

  if v_module = 'pkg_xfer' then
    if v_is_admin then
      return;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'transfer_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_transfer_id := v_raw::bigint;
    end if;

    if v_property_id is null and v_transfer_id is not null then
      select t.property_id
        into v_property_id
      from public.owner_transfers as t
      where t.id = v_transfer_id;
    end if;

    if v_property_id is not null and public.owns_property(v_property_id) then
      return;
    end if;

    raise exception 'email_core_enqueue: forbidden'
      using errcode = '42501';
  end if;

  raise exception 'email_core_enqueue: invalid module_key'
    using errcode = '22023';
end;
$fn$;

revoke all on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to service_role;

create or replace function public.email_core_enqueue(
  p_idempotency_key text,
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_locale text default null,
  p_subject text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to text := public.email_core_normalize_email(p_to_email);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_locale text;
  v_status text;
  v_id bigint;
  v_existing public.email_outbox%rowtype;
  s public.complex_email_settings%rowtype;
begin
  if v_key is null then
    raise exception 'email_core_enqueue: idempotency_key required';
  end if;
  if p_module_key not in ('pb1_invite', 'user_activation', 'pkg_xfer', 'meeting', 'email_test', 'system') then
    raise exception 'email_core_enqueue: invalid module_key';
  end if;
  if v_to is null or position('@' in v_to) < 2 then
    raise exception 'email_core_enqueue: invalid to_email';
  end if;

  -- Authorize before duplicate probe / insert (no outbox oracle for strangers).
  perform public.email_core_assert_can_enqueue(
    p_module_key,
    p_template_key,
    p_to_email,
    coalesce(p_payload, '{}'::jsonb)
  );

  select * into s from public.complex_email_settings where id = 1;
  v_locale := coalesce(
    nullif(btrim(coalesce(p_locale, '')), ''),
    s.template_locale,
    'bg'
  );
  if v_locale not in ('bg', 'ru', 'en') then
    v_locale := 'bg';
  end if;

  select * into v_existing
  from public.email_outbox as o
  where o.idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'outbox_id', v_existing.id,
      'status', v_existing.status,
      'fallback_status', public.email_core_module_fallback_status(),
      'queued', v_existing.status in ('queued', 'held', 'sending'),
      'sent', v_existing.status = 'sent'
    );
  end if;

  if public.email_core_is_ready() then
    v_status := 'queued';
  else
    v_status := 'blocked_not_ready';
  end if;

  insert into public.email_outbox (
    idempotency_key, module_key, template_key, locale, to_email, to_email_hash,
    subject, payload, status, attempts, next_attempt_at, created_by_email
  ) values (
    v_key,
    p_module_key,
    coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), 'untitled'),
    v_locale,
    v_to,
    public.email_core_email_hash(v_to),
    p_subject,
    coalesce(p_payload, '{}'::jsonb),
    v_status,
    0,
    case when v_status = 'queued' then now() else null end,
    nullif(btrim(coalesce(auth.email(), '')), '')
  )
  returning id into v_id;

  insert into public.email_delivery_attempts (outbox_id, attempt_no, result, error_code)
  values (
    v_id,
    1,
    'awaiting_worker',
    case when v_status = 'queued' then 'awaiting_worker' else 'not_ready' end
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'outbox_id', v_id,
    'status', v_status,
    'fallback_status', public.email_core_module_fallback_status(),
    'queued', v_status = 'queued',
    'sent', false
  );
end;
$fn$;

revoke all on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_enqueue(text, text, text, text, text, text, jsonb)
  to service_role;

-- Explicitly leave email + debt gates unchanged (no writes to settings tables).

commit;
