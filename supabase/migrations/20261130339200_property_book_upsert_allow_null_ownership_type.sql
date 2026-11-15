-- Allow null ownership_type on object upsert so apartments-step import can save
-- clarifications (type filled later). Invalid non-null values still rejected.
create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null,
  p_apartment_number text default null,
  p_floor bigint default null,
  p_ideal_parts_note text default null,
  p_ideal_parts_meeting_ref text default null,
  p_section_code text default null,
  p_block_code text default null,
  p_living_area_sqm numeric default null,
  p_touch_living_area boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text := nullif(btrim(coalesce(p_ownership_type, '')), '');
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);
  if v_type is not null and v_type not in ('sole', 'shared') then
    raise exception 'admin_upsert_property_book_object: invalid ownership_type'
      using errcode = '22023';
  end if;

  update public.properties as p
     set purpose = nullif(btrim(coalesce(p_purpose, '')), ''),
         area_sqm = p_area_sqm,
         ideal_parts_percent = p_ideal_parts_percent,
         ownership_type = v_type,
         ideal_parts_source = coalesce(
           nullif(btrim(coalesce(p_ideal_parts_source, '')), ''),
           p.ideal_parts_source
         ),
         ideal_parts_note = case
           when p_ideal_parts_note is null then p.ideal_parts_note
           else nullif(btrim(p_ideal_parts_note), '')
         end,
         ideal_parts_meeting_ref = case
           when p_ideal_parts_meeting_ref is null then p.ideal_parts_meeting_ref
           else nullif(btrim(p_ideal_parts_meeting_ref), '')
         end,
         apartment_number = coalesce(nullif(btrim(p_apartment_number), ''), p.apartment_number),
         floor = coalesce(p_floor, p.floor),
         section_code = case
           when p_section_code is null then p.section_code
           else nullif(btrim(p_section_code), '')
         end,
         block_code = case
           when p_block_code is null then p.block_code
           else nullif(btrim(p_block_code), '')
         end,
         living_area_sqm = case
           when p_touch_living_area then p_living_area_sqm
           else p.living_area_sqm
         end
   where p.id = p_property_id;

  if not found then
    raise exception 'admin_upsert_property_book_object: not found'
      using errcode = 'P0002';
  end if;

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, text, bigint, text, text, text, text, numeric, boolean
) from public, anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, text, bigint, text, text, text, text, numeric, boolean
) to authenticated;
