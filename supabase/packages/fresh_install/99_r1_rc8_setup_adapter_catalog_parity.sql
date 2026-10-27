-- =============================================================================
-- R1-RC8 fresh-install — Setup adapter ↔ module_catalog implemented parity
-- =============================================================================
-- Catalog-only (package phase runs before chronological IS-1 creates
-- module_lifecycle). IS-1 seed then picks up property_book / uk_expenses.
-- Upgrade path: supabase/migrations/20261123120000_* also seeds lifecycle.
-- Rental stays implemented=false. No building_modules enable. No data reset.
-- =============================================================================

begin;

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values
  ('property_book', 'Книга собственности', 'documents', true, 5),
  ('uk_expenses', 'Расходы УК', 'finance', true, 40)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = true,
      sort_order = excluded.sort_order;

update public.module_catalog
   set implemented = false
 where module_key = 'rental'
   and implemented is distinct from false;

commit;
