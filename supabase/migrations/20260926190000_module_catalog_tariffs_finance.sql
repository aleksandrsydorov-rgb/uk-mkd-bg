-- Finance category: single live module "Тарифы" (UX gate for Admin → Тарифы).
-- Does not change tariff_catalog.module_key (still support_fee / water / electricity).
-- Does not alter publish/resolve RPC billing checks.

begin;

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('tariffs', 'Тарифы', 'finance', true, 10)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
values ('tariffs', true, now(), null)
on conflict (module_key) do update
  set enabled = true,
      updated_at = now();

commit;
