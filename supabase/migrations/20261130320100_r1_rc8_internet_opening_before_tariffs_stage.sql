-- R1-RC8: Internet opening (tariff prep + inventarisation) comes before the
-- final tariffs checklist stage.

begin;

update public.first_run_stage_catalog
   set sort_order = 85
 where stage_key = 'internet_opening';

update public.first_run_stage_catalog
   set sort_order = 90
 where stage_key = 'tariffs';

commit;
