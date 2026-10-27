-- =============================================================================
-- R1-RC8 — Setup adapter ↔ module_catalog implemented parity
-- =============================================================================
-- Root cause (Initial Setup):
--   module_lifecycle_block_unimplemented raises
--   'module_setup: module % not implemented in this release'
--   when leaving DISABLED unless module_catalog.implemented = true.
--
-- Wizard adapters registered in src/lib/moduleCore/bootstrap.ts include
-- property_book and uk_expenses, but catalog seeds / R1 parity never listed them.
--
-- This additive migration upserts ONLY those missing setup keys as
-- implemented=true so DISABLED → SETUP_REQUIRED / SETUP_IN_PROGRESS works.
-- Does NOT enable building_modules, Email Sending, Debt Gate, or Rental.
-- Does NOT rewrite prior migrations. Does NOT reset data.
-- example_opening_roster stays out of catalog (test stub).
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

-- Lifecycle rows for new catalog keys (idempotent; no state reset).
insert into public.module_lifecycle (installation_id, module_key, state, setup_schema_version)
select
  i.id,
  c.module_key,
  'DISABLED',
  '1.0'
from public.platform_installations as i
cross join public.module_catalog as c
where lower(i.installation_key) = 'default'
  and c.module_key in ('property_book', 'uk_expenses')
on conflict (installation_id, module_key) do nothing;

-- Rental must remain unimplemented (guard against accidental drift).
update public.module_catalog
   set implemented = false
 where module_key = 'rental'
   and implemented is distinct from false;

-- Property Book dry-run: properties.apartment_number is text (fresh-install /
-- current Book), but admin_import_property_book looked up with v_apt_num bigint
-- → "operator does not exist: text = bigint" and blocks IS-2 confirm path.
do $patch$
declare
  def text;
begin
  begin
    def := pg_get_functiondef(
      'public.admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean)'::regprocedure
    );
  exception
    when undefined_function then
      raise notice 'RC8 setup parity: admin_import_property_book(5-arg) absent — skip apt cast patch';
      return;
  end;

  if position('apartment_number = v_apt_num' in def) = 0 then
    raise notice 'RC8 setup parity: admin_import_property_book already text-safe — skip';
    return;
  end if;

  def := replace(
    def,
    'where p.apartment_number = v_apt_num',
    'where p.apartment_number = v_apt'
  );
  execute def;
end;
$patch$;

commit;
