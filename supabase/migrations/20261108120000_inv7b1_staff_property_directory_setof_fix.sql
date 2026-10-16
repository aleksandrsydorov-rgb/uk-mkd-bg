-- =============================================================================
-- INV-7B.1 — list_staff_property_directory SETOF compatibility (portable)
-- =============================================================================
-- Root cause: RETURNS SETOF properties with a fixed-position column list that
-- lagged properties DDL (ownership_type / section_code / block_code / archived_at
-- on cloud; different ordinals/types on local). Callers expect properties Row[].
--
-- Fix: finance path returns p.*; engineer path rebuilds the row via
-- jsonb_populate_record keyed by column name (order/type agnostic) while
-- preserving SH-2C1 confidentiality redaction.
--
-- Role literals use UTF-8 hex decode so this file cannot mojibake under tooling.
-- Additive CREATE OR REPLACE. No DROP CASCADE. No staff/business data changes.
-- Does NOT enable Inventory. Does NOT touch finance ledgers.
-- =============================================================================

begin;

create or replace function public.list_staff_property_directory()
returns setof public.properties
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_role_admin text := convert_from(decode('d0b0d0b4d0bcd0b8d0bdd0b8d181d182d180d0b0d186d0b8d18f', 'hex'), 'utf8');
  v_role_accountant text := convert_from(decode('d0b1d183d185d0b3d0b0d0bbd182d0b5d180', 'hex'), 'utf8');
  v_role_engineer text := convert_from(decode('d0b8d0bdd0b6d0b5d0bdd0b5d180', 'hex'), 'utf8');
  v_finance boolean := public.has_staff_role(v_role_admin)
    or public.has_staff_role(v_role_accountant);
  v_engineer boolean := public.has_staff_role(v_role_engineer);
begin
  if not (v_finance or v_engineer) then
    return;
  end if;

  if v_finance then
    return query
    select p.*
    from public.properties as p
    order by p.apartment_number, p.id;
    return;
  end if;

  -- Engineer: operational fields retained; fee inputs / PII redacted by name.
  return query
  select (jsonb_populate_record(
    null::public.properties,
    to_jsonb(p) || jsonb_build_object(
      'area_sqm', null,
      'owner_name', null,
      'owner_phone', null,
      'owner_email', null,
      'debt', null,
      'overpayment', null,
      'pet_info', null,
      'owner_type', null,
      'company_name', null,
      'occupant_kind', null,
      'occupant_name', null,
      'occupant_phone', null,
      'occupant_email', null,
      'occupant_until', null,
      'purpose', null,
      'ideal_parts_percent', null,
      'ideal_parts_source', null,
      'ideal_parts_note', null,
      'ideal_parts_meeting_ref', null,
      'owner_user_management_agreement', null,
      'ownership_type', null
    )
  )).*
  from public.properties as p
  order by p.apartment_number, p.id;
end;
$fn$;

revoke all on function public.list_staff_property_directory() from public, anon;
grant execute on function public.list_staff_property_directory() to authenticated;
grant execute on function public.list_staff_property_directory() to service_role;

commit;
