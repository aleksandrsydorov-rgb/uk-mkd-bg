-- =============================================================================
-- INV-7A.1 — repair list_staff_property_directory column alignment
-- =============================================================================
-- Local schema gained section_code/block_code (and other columns) so the
-- hand-built SETOF properties projection no longer matched RETURNS SETOF
-- properties (42804 on column 5). Engineer admin loadAll aborted before
-- building_modules hydrated, hiding Staff Inventory navigation.
-- Additive. Local acceptance repair; not applied to cloud in this phase.
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
  v_finance boolean := public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер');
  v_engineer boolean := public.has_staff_role('инженер');
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

  -- Engineer: operational fields only; finance/PII redacted.
  return query
  select
    p.id,
    p.created_at,
    p.apartment_number,
    p.floor,
    null::text as section_code,
    null::text as block_code,
    null::numeric as area_sqm,
    p.status,
    null::text as owner_name,
    null::text as owner_phone,
    null::text as owner_email,
    null::numeric as debt,
    null::numeric as overpayment,
    p.electricity_meter_number,
    p.occupancy_status,
    null::text as pet_info,
    null::text as owner_type,
    null::text as company_name,
    null::text as occupant_kind,
    null::text as occupant_name,
    null::text as occupant_phone,
    null::text as occupant_email,
    null::date as occupant_until,
    null::text as purpose,
    null::numeric as ideal_parts_percent,
    null::text as ideal_parts_source,
    null::text as ideal_parts_note,
    null::text as ideal_parts_meeting_ref,
    null::text as owner_user_management_agreement,
    null::text as ownership_type,
    p.archived_at
  from public.properties as p
  order by p.apartment_number, p.id;
end;
$fn$;

revoke all on function public.list_staff_property_directory() from public, anon;
grant execute on function public.list_staff_property_directory() to authenticated;
grant execute on function public.list_staff_property_directory() to service_role;

commit;
