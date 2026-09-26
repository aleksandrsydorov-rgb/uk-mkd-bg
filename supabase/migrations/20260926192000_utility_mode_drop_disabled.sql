-- Utility information modes: only owner_and_staff | staff_only.
-- Full off is Module Core (water / electricity enabled flag), not mode=disabled.

begin;

update public.building_settings
   set water_mode = 'owner_and_staff',
       updated_at = now()
 where id = 1
   and coalesce(nullif(btrim(water_mode), ''), '') = 'disabled';

update public.building_settings
   set electricity_mode = 'owner_and_staff',
       updated_at = now()
 where id = 1
   and coalesce(nullif(btrim(electricity_mode), ''), '') = 'disabled';

create or replace function public.set_utility_information_mode(
  p_utility text,
  p_mode text
)
returns table (
  id integer,
  electricity_mode text,
  water_mode text,
  updated_at timestamptz,
  updated_by text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_utility text;
  v_mode text;
  v_email text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'set_utility_information_mode: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'set_utility_information_mode: not allowed'
      using errcode = '42501';
  end if;

  v_utility := btrim(coalesce(p_utility, ''));
  if v_utility not in ('water', 'electricity') then
    raise exception 'set_utility_information_mode: invalid utility'
      using errcode = '22023';
  end if;

  v_mode := btrim(coalesce(p_mode, ''));
  if v_mode not in ('owner_and_staff', 'staff_only') then
    raise exception 'set_utility_information_mode: invalid mode'
      using errcode = '22023';
  end if;

  if v_utility = 'water' then
    update public.building_settings as bs
       set water_mode = v_mode,
           updated_at = now(),
           updated_by = v_email
     where bs.id = 1;
  else
    update public.building_settings as bs
       set electricity_mode = v_mode,
           updated_at = now(),
           updated_by = v_email
     where bs.id = 1;
  end if;

  if not found then
    raise exception 'set_utility_information_mode: settings row not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    bs.id,
    bs.electricity_mode,
    bs.water_mode,
    bs.updated_at,
    bs.updated_by
  from public.building_settings as bs
  where bs.id = 1;
end;
$fn$;

revoke all on function public.set_utility_information_mode(text, text) from public;
revoke all on function public.set_utility_information_mode(text, text) from anon;
grant execute on function public.set_utility_information_mode(text, text) to authenticated;

commit;
