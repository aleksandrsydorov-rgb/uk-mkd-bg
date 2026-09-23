-- =============================================================================
-- AMADEUS 11 — controlled apartment_guests UPDATE
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Does not change occupancy_status, owns_property(), owner_email, or RLS DELETE.
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'Pre-flight failed: public.has_staff_role(text) does not exist.';
  end if;
end
$pre$;

create or replace function public.update_apartment_guest(
  p_guest_id bigint,
  p_first_name text,
  p_last_name text,
  p_birth_year integer default null,
  p_is_child boolean default false,
  p_is_permanent boolean default true,
  p_check_in date default null,
  p_check_out date default null
)
returns public.apartment_guests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
  v_row public.apartment_guests;
  v_first text;
  v_last text;
begin
  if auth.email() is null then
    raise exception 'update_apartment_guest: not authenticated'
      using errcode = '28000';
  end if;

  select g.property_id
    into v_property_id
  from public.apartment_guests as g
  where g.id = p_guest_id;

  if not found then
    raise exception 'update_apartment_guest: guest not found'
      using errcode = 'P0002';
  end if;

  if not public.owns_property(v_property_id)
     and not public.has_staff_role('администрация') then
    raise exception 'update_apartment_guest: not allowed'
      using errcode = '42501';
  end if;

  v_first := btrim(coalesce(p_first_name, ''));
  v_last := btrim(coalesce(p_last_name, ''));
  if v_first = '' or v_last = '' then
    raise exception 'update_apartment_guest: name required'
      using errcode = '22023';
  end if;

  update public.apartment_guests as g
     set first_name = v_first,
         last_name = v_last,
         birth_year = p_birth_year,
         is_child = coalesce(p_is_child, false),
         is_permanent = coalesce(p_is_permanent, true),
         check_in = p_check_in,
         check_out = case when coalesce(p_is_permanent, true) then null else p_check_out end
   where g.id = p_guest_id
     and g.property_id = v_property_id
  returning g.* into v_row;

  if not found then
    raise exception 'update_apartment_guest: update failed'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date) from public;
revoke execute on function public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date) from anon;
grant execute on function public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date) to authenticated;

commit;
