-- Fix: do not UPDATE from STABLE guest helpers (breaks login / RLS reads).

begin;

create or replace function public.has_active_guest_access(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    auth.email() is not null
    and exists (
      select 1
      from public.property_guest_accesses as g
      where g.property_id = p_property_id
        and g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(auth.email()))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
    );
$fn$;

revoke all on function public.has_active_guest_access(bigint) from public;
revoke all on function public.has_active_guest_access(bigint) from anon;
grant execute on function public.has_active_guest_access(bigint) to authenticated;

create or replace function public.list_my_guest_properties()
returns setof public.properties
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.*
  from public.properties as p
  where auth.email() is not null
    and exists (
      select 1
      from public.property_guest_accesses as g
      where g.property_id = p.id
        and g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(auth.email()))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
    )
  order by p.apartment_number::text;
$fn$;

revoke all on function public.list_my_guest_properties() from public;
revoke all on function public.list_my_guest_properties() from anon;
grant execute on function public.list_my_guest_properties() to authenticated;

-- Expire stale guests only on write paths (already called from create/revoke).
-- Soft-expire on list for owners remains optional; keep helper VOLATILE for writes.

commit;
