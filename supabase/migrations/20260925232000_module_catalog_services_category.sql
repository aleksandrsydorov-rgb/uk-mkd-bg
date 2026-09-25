-- AMADEUS 11 Module Core v2 polish: commercial/service category metadata only.
-- Does not change module keys, implemented/enabled, RPCs, or gating.

begin;

update public.module_catalog
   set category = 'services'
 where module_key in ('internet', 'parking', 'cleaning')
   and category is distinct from 'services';

commit;
