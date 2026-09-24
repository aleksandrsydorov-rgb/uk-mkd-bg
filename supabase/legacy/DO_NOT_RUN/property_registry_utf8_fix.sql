-- =============================================================================
-- AMADEUS 11 — UTF-8 fix for public.can_read_property_book
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Recreates only the helper. Does not change owns_property(), occupancy,
-- finance, meters, or polls.
-- =============================================================================

begin;

create or replace function public.can_read_property_book(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.owns_property(p_property_id)
    or public.has_staff_role('администрация');
$fn$;

revoke all on function public.can_read_property_book(bigint) from public;
revoke execute on function public.can_read_property_book(bigint) from anon;
grant execute on function public.can_read_property_book(bigint) to authenticated;

commit;
