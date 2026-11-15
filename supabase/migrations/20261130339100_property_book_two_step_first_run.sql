-- Split Property Book first-run into apartments then owners stages.
insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values
  ('property_book_objects', 30, true, 'property_book', 'admin.firstRunStagePropertyBookObjects'),
  ('property_book_owners', 35, true, 'property_book', 'admin.firstRunStagePropertyBookOwners')
on conflict (stage_key) do update
set sort_order = excluded.sort_order,
    required = excluded.required,
    module_key = excluded.module_key,
    label_i18n_key = excluded.label_i18n_key;

-- Keep legacy key for old progress rows; no longer required on new installs.
update public.first_run_stage_catalog
   set required = false,
       sort_order = 29,
       label_i18n_key = 'admin.firstRunStagePropertyBook'
 where stage_key = 'property_book';

-- Resume mapping: unfinished legacy property_book → apartments step.
update public.platform_installations i
   set first_run_stage = 'property_book_objects'
 where i.first_run_status = 'in_progress'
   and i.first_run_stage = 'property_book';

-- If legacy property_book already complete, mark both new stages complete.
insert into public.first_run_stage_progress (
  installation_id, stage_key, status, draft, completed_at, updated_at
)
select p.installation_id,
       v.stage_key,
       'complete',
       coalesce(p.draft, '{}'::jsonb),
       coalesce(p.completed_at, now()),
       now()
  from public.first_run_stage_progress p
  cross join (values ('property_book_objects'), ('property_book_owners')) as v(stage_key)
 where p.stage_key = 'property_book'
   and p.status = 'complete'
on conflict (installation_id, stage_key) do update
  set status = 'complete',
      completed_at = coalesce(public.first_run_stage_progress.completed_at, excluded.completed_at),
      updated_at = now();
