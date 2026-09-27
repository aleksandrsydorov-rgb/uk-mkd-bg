-- Sort property book list by numeric apartment_number (not text).

begin;

create or replace function public.admin_list_property_book(p_limit integer default 500)
returns table (
  property_id bigint,
  apartment_number text,
  purpose text,
  area_sqm numeric,
  ideal_parts_percent numeric,
  ownership_type text,
  owner_count integer,
  book_complete boolean,
  validation jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  perform public.admin_assert_book_admin();
  return query
  select
    p.id,
    p.apartment_number::text,
    p.purpose,
    p.area_sqm::numeric,
    p.ideal_parts_percent,
    p.ownership_type,
    (
      select count(*)::integer
      from public.property_book_active_owners(p.id)
    ),
    public.property_book_is_complete(p.id),
    public.property_book_validate(p.id)
  from public.properties as p
  order by p.apartment_number asc, p.id asc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_property_book(integer) from public;
revoke all on function public.admin_list_property_book(integer) from anon;
grant execute on function public.admin_list_property_book(integer) to authenticated;

create or replace function public.list_my_owned_properties()
returns setof public.properties
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.*
  from public.properties as p
  where public.owns_property(p.id)
  order by p.apartment_number asc, p.id asc;
$fn$;

revoke all on function public.list_my_owned_properties() from public;
revoke all on function public.list_my_owned_properties() from anon;
grant execute on function public.list_my_owned_properties() to authenticated;

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
  order by p.apartment_number asc, p.id asc;
$fn$;

revoke all on function public.list_my_guest_properties() from public;
revoke all on function public.list_my_guest_properties() from anon;
grant execute on function public.list_my_guest_properties() to authenticated;

commit;
