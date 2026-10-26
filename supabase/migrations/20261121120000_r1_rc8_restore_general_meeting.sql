-- =============================================================================
-- R1-RC8 — Restore Meetings (general_meeting) for Distribution RC8+
-- =============================================================================
-- Supersedes R1-MT-HIDE catalog exclusion for general_meeting ONLY.
-- Does NOT edit 20261117130000_r1_mt_hide_general_meeting.sql (history retained).
-- Does NOT enable building_modules by default (Initial Setup / Settings opt-in).
-- Does NOT enable Rental, Email Sending, or Debt Gate.
-- Keeps fail-closed mutate triggers: general_meeting_module_available() still
-- requires implemented=true AND enabled=true before DML / meeting email enqueue.
-- =============================================================================

begin;

-- Allow this upgrade migration to adjust catalog / building_modules while
-- R1-MT-HIDE mutate triggers may still see implemented=false mid-transaction.
select set_config('general_meeting.allow_mutate', '1', true);

-- Catalog: Meetings is an implemented product surface again
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

-- Ensure a building_modules row exists; do NOT force-enable (RC7 forced false).
insert into public.building_modules (module_key, enabled, updated_at, updated_by)
values ('general_meeting', false, now(), null)
on conflict (module_key) do nothing;

-- Rental must remain unimplemented / disabled
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

-- Lifecycle may stay DISABLED until Initial Setup enables the module.
-- module_lifecycle_block_unimplemented now allows leaving DISABLED because
-- general_meeting.implemented = true.

comment on function public.general_meeting_module_available() is
  'RC8+: true only when module_catalog.implemented and building_modules.enabled for general_meeting. Fail-closed while disabled.';

-- Clear session mutate bypass (local to this transaction)
select set_config('general_meeting.allow_mutate', '0', true);

commit;
