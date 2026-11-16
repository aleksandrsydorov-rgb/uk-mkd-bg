-- meter_readings column is electricity_meter_id (not meter_id).
create or replace function public.trg_assert_electricity_opening_confirmed()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if new.reading_kind is distinct from 'operational' then
    return new;
  end if;
  if new.electricity_meter_id is null then
    return new;
  end if;
  if exists (
    select 1 from public.electricity_meters m
    where m.id = new.electricity_meter_id
      and m.opening_confirmed_at is null
  ) then
    raise exception 'electricity_opening_not_confirmed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;
