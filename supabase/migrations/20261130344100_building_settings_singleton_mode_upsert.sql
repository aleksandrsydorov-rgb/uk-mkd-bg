-- =============================================================================
-- Fix: set_utility_information_mode P0002 «settings row not found»
--
-- Cause on fresh / firstrun DBs: public.building_settings is a singleton
-- (CHECK id = 1) but fresh-install DDL never inserts the shell row. Admin RPCs
-- only UPDATE where id = 1, so water/electricity mode save fails. UI still
-- shows parseWaterMode(null) → owner_and_staff (client default), which is not
-- a persisted value.
--
-- This migration:
--   1) Ensures the singleton shell row exists (id=1 only), without inventing
--      water_mode / electricity_mode / support_rate (NULL preserved / unchanged).
--   2) Restores upsert in set_utility_information_mode so the first authorized
--      admin write can create the shell if still missing, without overwriting
--      the other utility's mode or the support rate.
--
-- Does NOT weaken RLS / has_staff_role('администрация').
-- Does NOT add a third mode. Does NOT change tariffs, readings, or ledgers.
-- =============================================================================

begin;

insert into public.building_settings (id)
values (1)
on conflict (id) do nothing;

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

  insert into public.building_settings as bs (
    id,
    water_mode,
    electricity_mode,
    updated_at,
    updated_by
  )
  values (
    1,
    case when v_utility = 'water' then v_mode else null end,
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
