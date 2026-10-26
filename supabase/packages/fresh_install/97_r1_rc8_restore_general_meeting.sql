-- =============================================================================
-- Fresh-install companion: R1-RC8 restore general_meeting (after 88b hide + 96 parity)
-- Mirrors supabase/migrations/20261121120000_r1_rc8_restore_general_meeting.sql
-- =============================================================================

begin;

select set_config('general_meeting.allow_mutate', '1', true);

update public.module_catalog as c
   set implemented = true,
       default_name = coalesce(nullif(btrim(c.default_name), ''), 'Общие собрания'),
       category = coalesce(nullif(btrim(c.category), ''), 'documents'),
       sort_order = coalesce(c.sort_order, 10)
 where c.module_key = 'general_meeting';

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('general_meeting', 'Общие собрания', 'documents', true, 10)
on conflict (module_key) do update
  set implemented = true,
      default_name = excluded.default_name,
      category = excluded.category,
      sort_order = excluded.sort_order;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
values ('general_meeting', false, now(), null)
on conflict (module_key) do nothing;

update public.module_catalog
   set implemented = false
 where module_key = 'rental'
   and implemented is distinct from false;

insert into public.building_modules (module_key, enabled, updated_at, updated_by)
values ('rental', false, now(), null)
on conflict (module_key) do update
  set enabled = false,
      updated_at = now()
 where public.building_modules.enabled is distinct from false;

comment on function public.general_meeting_module_available() is
  'RC8+: true only when module_catalog.implemented and building_modules.enabled for general_meeting. Fail-closed while disabled.';

select set_config('general_meeting.allow_mutate', '0', true);

commit;
