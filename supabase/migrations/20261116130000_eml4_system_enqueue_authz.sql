-- =============================================================================
-- EML-4 — Allow book-admin / property-owner enqueue for allowlisted system templates
-- Does NOT enable sending. Does NOT change debt gate.
-- =============================================================================

begin;

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
  v_to text := public.email_core_normalize_email(p_to_email);
  v_caller text := public.email_core_normalize_email(auth.jwt() ->> 'email');
  v_system_ok boolean := false;
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

  if v_tpl is null then
    raise exception 'email_core_enqueue: template_key required'
      using errcode = '22023';
  end if;

  if v_module = 'pb1_invite' and v_tpl not like 'pb1_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'user_activation' and v_tpl not like 'ua_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'pkg_xfer' and v_tpl not like 'ownership_change_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'meeting' and v_tpl not like 'meeting_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'email_test' and v_tpl not like 'email_test%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;

  if v_module = 'system' then
    v_system_ok :=
      v_tpl like 'meters_%'
      or v_tpl like 'uk_%'
      or v_tpl like 'internet_%'
      or v_tpl like 'ticket_%'
      or v_tpl like 'residence_%'
      or v_tpl like 'cleaning_%'
      or v_tpl like 'support_fee_%'
      or v_tpl like 'capital_repair_%'
      or v_tpl like 'inventory_%'
      or v_tpl like 'email_digest%';
    if not v_system_ok then
      raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    -- Book admin may enqueue allowlisted system notices (owner fan-out, staff assign).
    if v_is_admin then
      return;
    end if;

    -- Owner may enqueue for own property to any active Book owner of that property
    -- (self + co-owners). Never cross-apartment.
    if v_property_id is not null
       and v_to is not null
       and public.owns_property(v_property_id)
       and public.property_book_active_owner_by_email(v_property_id, v_to) then
      return;
    end if;

    raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
  end if;

  if v_module in ('pb1_invite', 'user_activation', 'email_test', 'meeting') then
    if not v_is_admin then
      raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
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

    raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
  end if;

  raise exception 'email_core_enqueue: invalid module_key' using errcode = '22023';
end;
$fn$;

-- Keep grants
revoke all on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to service_role;

commit;
