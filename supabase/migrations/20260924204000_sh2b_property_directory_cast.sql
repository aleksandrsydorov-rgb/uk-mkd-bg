-- Correct the SH-2B property directory cast. ideal_parts_percent is numeric(12,6).

create or replace function public.list_staff_property_directory()
returns setof public.properties
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_finance boolean := public.has_staff_role('администрация') or public.has_staff_role('бухгалтер');
  v_engineer boolean := public.has_staff_role('инженер');
begin
  if not (v_finance or v_engineer) then
    return;
  end if;

  return query
  select
    p.id,
    p.created_at,
    p.apartment_number,
    p.floor,
    p.area_sqm,
    p.status,
    case when v_finance then p.owner_name else null end,
    null::text,
    null::text,
    case when v_finance then p.debt else null end,
    case when v_finance then p.overpayment else null end,
    p.electricity_meter_number,
    p.occupancy_status,
    null::text,
    case when v_finance then p.owner_type else null end,
    case when v_finance then p.company_name else null end,
    null::text,
    null::text,
    null::text,
    null::text,
    null::date,
    case when v_finance then p.purpose else null end,
    case when v_finance then p.ideal_parts_percent else null::numeric(12,6) end,
    case when v_finance then p.ideal_parts_source else null end,
    case when v_finance then p.ideal_parts_note else null end,
    case when v_finance then p.ideal_parts_meeting_ref else null end,
    null::text
  from public.properties as p
  order by p.apartment_number, p.id;
end;
$function$;

revoke all on function public.list_staff_property_directory() from public;
revoke execute on function public.list_staff_property_directory() from anon;
grant execute on function public.list_staff_property_directory() to authenticated;
