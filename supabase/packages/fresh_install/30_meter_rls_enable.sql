-- =============================================================================
-- IS-7a fresh-install package — meter RLS enable + grants (no policy rewrite)
-- =============================================================================
-- Enables RLS and SELECT grant for authenticated. SELECT policies that call
-- owns_property / has_staff_role are created only when those helpers exist
-- (after platform auth migrations). Avoids failing empty bootstrap.
-- Does not DROP existing production policies when re-applied.
-- =============================================================================

alter table public.water_meters enable row level security;
alter table public.electricity_meters enable row level security;

revoke all on table public.water_meters from public;
revoke all on table public.water_meters from anon;
revoke all on table public.electricity_meters from public;
revoke all on table public.electricity_meters from anon;

grant select on table public.water_meters to authenticated;
grant select on table public.electricity_meters to authenticated;

do $$
begin
  if to_regprocedure('public.has_staff_role(text)') is not null
     and to_regprocedure('public.owns_property(bigint)') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'water_meters'
        and policyname = 'water_meters_select'
    ) then
      create policy water_meters_select
      on public.water_meters
      for select
      to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
        or public.has_staff_role('инженер')
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'electricity_meters'
        and policyname = 'electricity_meters_select'
    ) then
      create policy electricity_meters_select
      on public.electricity_meters
      for select
      to authenticated
      using (
        public.owns_property(property_id)
        or public.has_staff_role('администрация')
        or public.has_staff_role('бухгалтер')
        or public.has_staff_role('инженер')
      );
    end if;
  end if;
end $$;
