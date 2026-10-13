-- Phase E2.1 — Finance security hardening
-- FIN-P0-1: ownership_change_overdue_debt caller authz
-- FIN-P1-1: list_my_guest_properties strips debt/overpayment
-- FIN-P1-2: support_fee_ledger SELECT for Book owners (owns_property)
-- Does NOT enable ordinary_debt_gate. Does NOT change billing math or amounts.

begin;

-- ---------------------------------------------------------------------------
-- FIN-P0-1: overdue debt RPC — require staff or Book owner of the property
-- Preserves: admin_get_ownership_debt_status, admin_approve (admin session),
--            owner probe for own apartment (owns_property).
-- ---------------------------------------------------------------------------

create or replace function public.ownership_change_overdue_debt(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sf_overdue numeric := 0;
  v_sf_future numeric := 0;
  v_cap_overdue numeric := 0;
  v_cap_future numeric := 0;
  v_prop_debt numeric := 0;
  v_gate boolean := false;
  v_overdue numeric := 0;
  v_future numeric := 0;
begin
  if auth.role() is not distinct from 'service_role' then
    null;
  elsif public.has_staff_role('администрация')
     or public.has_staff_role('бухгалтер') then
    null;
  elsif auth.uid() is not null and public.owns_property(p_property_id) then
    null;
  else
    raise exception 'ownership_change_overdue_debt: forbidden'
      using errcode = '42501';
  end if;

  -- Support Fee Core: remaining_due already reflects payments/credits/adjustments
  select
    coalesce(sum(case
      when a.remaining_due > 0
       and a.early_deadline_at is not null
       and a.early_deadline_at < now()
      then a.remaining_due else 0 end), 0),
    coalesce(sum(case
      when a.remaining_due > 0
       and (a.early_deadline_at is null or a.early_deadline_at >= now())
      then a.remaining_due else 0 end), 0)
  into v_sf_overdue, v_sf_future
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected';

  -- Capital repair: net remaining per assessment, classified by due_date
  select
    coalesce(sum(case
      when n.net > 0 and n.due_date is not null and n.due_date < current_date
      then n.net else 0 end), 0),
    coalesce(sum(case
      when n.net > 0 and (n.due_date is null or n.due_date >= current_date)
      then n.net else 0 end), 0)
  into v_cap_overdue, v_cap_future
  from (
    select
      a.due_date,
      coalesce(sum(
        case when l.kind = 'charge' then l.amount_eur else -l.amount_eur end
      ), 0) as net
    from public.capital_repair_ledger as l
    join public.capital_repair_assessments as a on a.id = l.assessment_id
    where l.property_id = p_property_id
      and coalesce(a.status, 'open') is distinct from 'cancelled'
      and coalesce(a.status, 'open') is distinct from 'void'
    group by a.id, a.due_date
  ) as n;

  v_overdue := v_sf_overdue + v_cap_overdue;
  v_future := v_sf_future + v_cap_future;

  select coalesce(p.debt, 0) into v_prop_debt
  from public.properties as p
  where p.id = p_property_id;

  select s.ordinary_debt_gate_enabled into v_gate
  from public.ownership_change_settings as s
  where s.id = 1;

  return jsonb_build_object(
    'overdue_unpaid_eur', v_overdue,
    'future_due_eur', v_future,
    'support_fee_overdue_eur', v_sf_overdue,
    'support_fee_future_eur', v_sf_future,
    'capital_repair_overdue_eur', v_cap_overdue,
    'capital_repair_future_eur', v_cap_future,
    'portal_debt_eur', v_prop_debt,
    'blocks_ordinary', v_overdue > 0,
    'ordinary_debt_gate_enabled', coalesce(v_gate, false),
    'reason', case
      when v_overdue > 0 then 'overdue_unpaid_obligations'
      else null
    end
  );
end;
$fn$;

revoke all on function public.ownership_change_overdue_debt(bigint) from public, anon;
grant execute on function public.ownership_change_overdue_debt(bigint) to authenticated;
grant execute on function public.ownership_change_overdue_debt(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- FIN-P1-1: guest property list — zero finance balance fields
-- Keeps setof properties for access.ts; debt/overpayment forced to 0.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_guest_properties()
returns setof public.properties
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  r public.properties%rowtype;
begin
  if auth.email() is null then
    return;
  end if;

  for r in
    select p.*
    from public.properties as p
    where exists (
      select 1
      from public.property_guest_accesses as g
      where g.property_id = p.id
        and g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(auth.email()))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
    )
    order by p.apartment_number asc, p.id asc
  loop
    r.debt := 0;
    r.overpayment := 0;
    return next r;
  end loop;
end;
$fn$;

revoke all on function public.list_my_guest_properties() from public, anon;
grant execute on function public.list_my_guest_properties() to authenticated;

-- ---------------------------------------------------------------------------
-- FIN-P1-2: owner may SELECT own apartment support_fee_ledger rows
-- Staff retain full finance SELECT. Unrelated apartments remain denied.
-- ---------------------------------------------------------------------------

drop policy if exists support_fee_ledger_finance_select on public.support_fee_ledger;
create policy support_fee_ledger_finance_select
on public.support_fee_ledger
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.owns_property(property_id)
);

-- Explicitly leave debt gate / email settings / ledger amounts untouched.

commit;
