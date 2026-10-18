-- R1-CLOSE: Residence Status as first-class module_catalog identity.
-- Occupancy remains properties.occupancy_* — no parallel ownership SoT.
-- Not a toggleable gate for the occupancy UI (platform-adjacent metadata).

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('residence_status', 'Статус проживания', 'services', true, 15)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

comment on table public.module_catalog is
  'Release-controlled module catalog. One complex = one database; no tenant_id. Includes residence_status (occupancy fields, not ownership).';
