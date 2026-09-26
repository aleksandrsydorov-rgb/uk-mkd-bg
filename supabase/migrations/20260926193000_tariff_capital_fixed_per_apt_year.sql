-- Capital repair tariff: fixed EUR per apartment per calendar year (not €/m²).
-- Safe to reset versions: capital charges are not Core-cutover yet.

begin;

alter table public.tariff_rate_items disable trigger tariff_rate_items_immutability;
alter table public.tariff_versions disable trigger tariff_versions_immutability;

delete from public.tariff_rate_items as ri
 using public.tariff_versions as tv
 inner join public.tariff_catalog as c on c.id = tv.tariff_id
 where ri.version_id = tv.id
   and c.tariff_key = 'capital_repair';

delete from public.tariff_legacy_links as l
 where l.tariff_key = 'capital_repair';

delete from public.tariff_versions as tv
 using public.tariff_catalog as c
 where tv.tariff_id = c.id
   and c.tariff_key = 'capital_repair';

alter table public.tariff_rate_items enable trigger tariff_rate_items_immutability;
alter table public.tariff_versions enable trigger tariff_versions_immutability;

insert into public.tariff_catalog (
  tariff_key, module_key, default_name, unit_code, currency,
  calculation_type, billing_period, application_basis, governance_type, component_keys, active
) values (
  'capital_repair', 'capital_repair', 'Капитальный ремонт', 'item', 'EUR',
  'fixed', 'year', 'billing_year', 'internal_decision', array['base']::text[], true
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

commit;
