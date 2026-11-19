-- =============================================================================
-- Water mode default: owner_and_staff
--
-- Keeps 20261130344100 singleton upsert. Adds server-side default for water only:
--   • NULL water_mode → owner_and_staff (explicit staff_only untouched)
--   • New singleton / insert path defaults water_mode to owner_and_staff
-- Electricity mode and support_rate are not modified.
-- =============================================================================

begin;

alter table public.building_settings
  alter column water_mode set default 'owner_and_staff';

insert into public.building_settings (id, water_mode)
values (1, 'owner_and_staff')
on conflict (id) do nothing;

update public.building_settings
   set water_mode = 'owner_and_staff',
       updated_at = now()
 where id = 1
   and (
     water_mode is null
     or nullif(btrim(water_mode), '') is null
   );

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
#variable_conflict use_column
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

  -- Singleton upsert. Water defaults to owner_and_staff when the row is first
  -- created via an electricity write; water writes use the requested mode.
  insert into public.building_settings as bs (
    id,
    water_mode,
    electricity_mode,
    updated_at,
    updated_by
  )
  values (
    1,
    case when v_utility = 'water' then v_mode else 'owner_and_staff' end,
    case when v_utility = 'electricity' then v_mode else null end,
    now(),
    v_email
  )
  on conflict (id) do update
  set
    water_mode = case
      when v_utility = 'water' then excluded.water_mode
      else bs.water_mode
    end,
    electricity_mode = case
      when v_utility = 'electricity' then excluded.electricity_mode
      else bs.electricity_mode
    end,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

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
