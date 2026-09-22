-- =============================================================================
-- AMADEUS 11 — harden water/capital SELECT policies (role-aware)
-- =============================================================================
-- Table GRANT unchanged (SELECT only for authenticated).
-- Writes remain RPC-only. No INSERT/UPDATE/DELETE policies.
-- Requires public.has_staff_role(text).
-- This file has no BEGIN/COMMIT.
--
-- TARGET MATRIX
-- OWNER A: own meters/readings/water ledger/capital ledger; tariffs if owner;
--   assessments only via own capital_repair_ledger row.
-- ADMIN / ACCOUNTANT: all six SELECT (assessments: all rows).
-- ENGINEER: meters, tariffs, readings SELECT. ledger + capital DENY.
-- CLEANER: all six DENY.
-- =============================================================================

drop policy if exists water_meters_select on public.water_meters;
drop policy if exists water_tariffs_select on public.water_tariffs;
drop policy if exists water_readings_select on public.water_readings;
drop policy if exists water_ledger_select on public.water_ledger;
drop policy if exists capital_repair_assessments_select on public.capital_repair_assessments;
drop policy if exists capital_repair_ledger_select on public.capital_repair_ledger;

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

create policy water_tariffs_select
on public.water_tariffs
for select
to authenticated
using (
  public.is_owner()
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.has_staff_role('инженер')
);

create policy water_readings_select
on public.water_readings
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.has_staff_role('инженер')
);

create policy water_ledger_select
on public.water_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
);

create policy capital_repair_assessments_select
on public.capital_repair_assessments
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or exists (
    select 1
    from public.capital_repair_ledger as l
    where l.assessment_id = capital_repair_assessments.id
      and public.owns_property(l.property_id)
  )
);

create policy capital_repair_ledger_select
on public.capital_repair_ledger
for select
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
);
