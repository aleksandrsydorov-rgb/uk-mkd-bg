-- Fix admin_list_property_book: properties.area_sqm is float8, RETURNS numeric.

begin;

drop function if exists public._tmp_book_list_cast_test(integer);

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
  order by p.apartment_number::text
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_property_book(integer) from public;
revoke all on function public.admin_list_property_book(integer) from anon;
grant execute on function public.admin_list_property_book(integer) to authenticated;

commit;
