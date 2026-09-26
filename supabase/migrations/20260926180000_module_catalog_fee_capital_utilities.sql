-- Move support_fee + capital_repair module catalog category to utilities
-- (admin Settings grouping: Коммунальные, not Финансы).
-- Does not change billing / Tariff Core / Module Core enable flags.

begin;

update public.module_catalog
   set category = 'utilities',
       sort_order = 5
 where module_key = 'support_fee';

update public.module_catalog
   set category = 'utilities',
       sort_order = 8
 where module_key = 'capital_repair';

commit;
