-- Add capital_repair to Tariff Core catalog (admin Tariffs card).
-- Publish/cancel use existing billing_year + internal_decision path (same as support_fee).
-- Does NOT cut over charge_capital_repair / assessments to Core rates yet
-- (charges still take operator amounts; rate is reference / future cutover).

begin;

insert into public.tariff_catalog (
  tariff_key, module_key, default_name, unit_code, currency,
  calculation_type, billing_period, application_basis, governance_type, component_keys, active
) values (
  'capital_repair', 'capital_repair', 'Капитальный ремонт', 'm2', 'EUR',
  'per_unit', 'year', 'billing_year', 'internal_decision', array['base']::text[], true
)
on conflict (tariff_key) do update
  set default_name = excluded.default_name,
      module_key = excluded.module_key,
      unit_code = excluded.unit_code,
      currency = excluded.currency,
      calculation_type = excluded.calculation_type,
      billing_period = excluded.billing_period,
      application_basis = excluded.application_basis,
      governance_type = excluded.governance_type,
      component_keys = excluded.component_keys,
      active = excluded.active;

create or replace function public.tariff_can_publish(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case btrim(coalesce(p_module_key, ''))
    when 'support_fee' then public.has_staff_role('администрация')
    when 'capital_repair' then public.has_staff_role('администрация')
    when 'water' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    when 'electricity' then public.has_staff_role('администрация') or public.has_staff_role('бухгалтер')
    else false
  end;
$$;

revoke all on function public.tariff_can_publish(text) from public;
revoke all on function public.tariff_can_publish(text) from anon;
grant execute on function public.tariff_can_publish(text) to authenticated;

commit;
