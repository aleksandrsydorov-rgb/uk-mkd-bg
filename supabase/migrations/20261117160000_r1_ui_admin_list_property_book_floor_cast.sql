-- R1-UI FINAL: cast properties.floor (integer) to bigint in admin_list_property_book.
-- Symptom: PostgREST 42804 "Returned type integer does not match expected type bigint
-- in column 3" → Property Book empty state + generic UI error for admins.

begin;

create or replace function public.admin_list_property_book(p_limit integer default 500)
returns table (
  property_id bigint,
  apartment_number text,
  floor bigint,
  section_code text,
  block_code text,
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
    p.floor::bigint,
    p.section_code,
    p.block_code,
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
  where p.archived_at is null
  order by
    lower(coalesce(nullif(btrim(p.block_code), ''), '')),
    lower(coalesce(nullif(btrim(p.section_code), ''), '')),
    p.floor nulls last,
    p.apartment_number asc,
    p.id asc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_property_book(integer) from public;
revoke all on function public.admin_list_property_book(integer) from anon;
grant execute on function public.admin_list_property_book(integer) to authenticated;
grant execute on function public.admin_list_property_book(integer) to service_role;

commit;
