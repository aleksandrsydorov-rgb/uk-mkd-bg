-- =============================================================================
-- Fix: admin_get_email_settings referenced s.delivery_status, but
-- public.complex_email_settings has never had a delivery_status column.
-- Phase A / prior admin_get used public.email_core_config_delivery_status().
--
-- Root cause (42703): d517f4d migration 20261130343000 replaced admin_get with
--   'delivery_status', s.delivery_status
-- where s is complex_email_settings%rowtype from SELECT * — field does not exist.
--
-- This corrective migration is required wherever 43000 was already applied with
-- the buggy body. Fresh installs that use the corrected 43000 still get this
-- REPLACE for idempotency (same body).
-- Does NOT add a delivery_status column. Does NOT hide the error in UI.
-- =============================================================================

begin;

create or replace function public.admin_get_email_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s public.complex_email_settings%rowtype;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_get_email_settings: not allowed' using errcode = '42501';
  end if;

  select * into s from public.complex_email_settings where id = 1;
  if not found then
    raise exception 'admin_get_email_settings: missing settings';
  end if;

  return jsonb_build_object(
    'mail_provider', s.mail_provider,
    'sender_name', s.sender_name,
    'sender_email', s.sender_email,
    'reply_to_email', s.reply_to_email,
    'verified_domain', s.verified_domain,
    'provider_domain_id', s.provider_domain_id,
    'domain_status', s.domain_status,
    'email_enabled', s.email_enabled,
    'template_locale', s.template_locale,
    'platform_disabled', s.platform_disabled,
    -- Computed config status (never a table column on complex_email_settings)
    'delivery_status', public.email_core_config_delivery_status(),
    'sending_ready', public.email_core_is_ready(),
    'phase', 'D',
    'secrets_in_database', false,
    'has_provider_token', coalesce(s.provider_token_present, false),
    'connection_status', coalesce(s.connection_status, 'not_configured'),
    'sending_enabled_at', s.sending_enabled_at,
    'send_probe_accepted_at', s.send_probe_accepted_at,
    'updated_at', s.updated_at,
    'updated_by_email', s.updated_by_email,
    'verified_senders', public.admin_list_verified_email_senders()
  );
end;
$fn$;

revoke all on function public.admin_get_email_settings() from public, anon;
grant execute on function public.admin_get_email_settings() to authenticated;

comment on function public.admin_get_email_settings() is
  'Admin email settings JSON. delivery_status from email_core_config_delivery_status(); never reads a non-existent column.';

commit;
