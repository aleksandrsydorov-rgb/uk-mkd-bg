-- =============================================================================
-- AMADEUS 11 — property registry verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'properties_ideal_parts_column' as check_id, 'public.properties' as item,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'ideal_parts_percent'
  ) then 'OK' else 'FAIL' end as result
union all
select 'properties_ideal_parts_numeric', 'numeric(12,6)',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name = 'ideal_parts_percent'
      and data_type = 'numeric'
      and numeric_precision = 12
      and numeric_scale = 6
  ) then 'OK' else 'FAIL' end
union all
select 'properties_ideal_parts_nullable', 'NULL allowed',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name = 'ideal_parts_percent'
      and is_nullable = 'YES'
  ) then 'OK' else 'FAIL' end
union all
select 'no_duplicate_ideal_parts_column', 'single source',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and column_name in ('ideal_parts_percent', 'ideal_share_percent', 'vote_percent')
  ) = 1 then 'OK' else 'FAIL' end
union all
select 'ideal_parts_range_constraint', 'properties_ideal_parts_percent_range',
  case when exists (
    select 1 from pg_constraint
    where conname = 'properties_ideal_parts_percent_range'
      and conrelid = 'public.properties'::regclass
  ) then 'OK' else 'FAIL' end
union all
select 'purpose_column', 'public.properties.purpose',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'purpose'
  ) then 'OK' else 'FAIL' end
union all
select 'no_built_up_duplicate', 'no built_up_area_sqm',
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'built_up_area_sqm'
  ) then 'OK' else 'FAIL' end
union all
select 'owner_email_untouched', 'properties.owner_email',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'owner_email'
  ) then 'OK' else 'FAIL' end
union all
select 'owns_property_untouched', 'uses owner_email',
  case when to_regprocedure('public.owns_property(bigint)') is not null
    and pg_get_functiondef('public.owns_property(bigint)'::regprocedure) like '%owner_email%'
    and pg_get_functiondef('public.owns_property(bigint)'::regprocedure) not like '%property_registry_people%'
    then 'OK' else 'FAIL' end
union all
select 'occupancy_status_untouched', 'properties.occupancy_status',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'occupancy_status'
  ) then 'OK' else 'FAIL' end
union all
select 'occupant_kind_untouched', 'properties.occupant_kind',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'occupant_kind'
  ) then 'OK' else 'FAIL' end
union all
select 'registry_people_table', 'public.property_registry_people',
  case when to_regclass('public.property_registry_people') is not null then 'OK' else 'FAIL' end
union all
select 'absence_table', 'public.property_absence_periods',
  case when to_regclass('public.property_absence_periods') is not null then 'OK' else 'FAIL' end
union all
select 'animals_reuse_pets', 'public.apartment_pets',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'apartment_pets'
      and column_name = 'is_taken_to_public_places'
  ) then 'OK' else 'FAIL' end
union all
select 'no_property_animals_duplicate', 'property_animals absent',
  case when to_regclass('public.property_animals') is null then 'OK' else 'FAIL' end
union all
select 'people_rls_enabled', 'property_registry_people',
  case when exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'property_registry_people' and c.relrowsecurity
  ) then 'OK' else 'FAIL' end
union all
select 'people_select_not_is_staff', 'can_read_property_book',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'property_registry_people'
      and policyname = 'property_registry_people_select'
      and coalesce(qual, '') like '%can_read_property_book%'
      and coalesce(qual, '') not like '%is_staff()%'
  ) then 'OK' else 'FAIL' end
union all
select 'people_owner_no_insert', 'admin insert only',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'property_registry_people'
      and cmd = 'INSERT'
      and coalesce(with_check, '') like '%has_staff_role%'
      and coalesce(with_check, '') not like '%owns_property%'
  ) then 'OK' else 'FAIL' end
union all
select 'anon_no_execute_book_rpc', 'submit_property_book_change',
  case when to_regprocedure('public.submit_property_book_change(bigint, text, jsonb)') is not null
    and not has_function_privilege('anon', 'public.submit_property_book_change(bigint, text, jsonb)', 'EXECUTE')
    then 'OK' else 'FAIL' end
union all
select 'anon_no_execute_overview', 'property_ideal_parts_overview',
  case when to_regprocedure('public.property_ideal_parts_overview()') is not null
    and not has_function_privilege('anon', 'public.property_ideal_parts_overview()', 'EXECUTE')
    then 'OK' else 'FAIL' end
union all
select 'book_rpc_search_path_empty', 'submit_property_book_change',
  case when pg_get_functiondef('public.submit_property_book_change(bigint, text, jsonb)'::regprocedure)
    like '%search_path%'
    then 'OK' else 'FAIL' end
union all
select 'poll_weight_still_area_sqm', 'properties.area_sqm',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'area_sqm'
  ) then 'OK' else 'FAIL' end
union all
select 'utf8_admin_in_helper', 'can_read_property_book',
  case when to_regprocedure('public.can_read_property_book(bigint)') is not null
    and position(
      convert_to(U&'\0430\0434\043C\0438\043D\0438\0441\0442\0440\0430\0446\0438\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end
union all
select 'helper_no_mojibake', 'can_read_property_book',
  case when pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure) not like '%Ð%'
       and pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure) not like '%Р°%'
    then 'OK' else 'FAIL' end
union all
select 'helper_owner_or_admin_only', 'can_read_property_book',
  case when pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure) like '%owns_property%'
       and pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure) like '%has_staff_role%'
       and pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure) not like '%is_staff()%'
    then 'OK' else 'FAIL' end
;

-- Diagnostic snapshot (administration RPC; may fail for non-admin sessions)
-- select * from public.property_ideal_parts_overview();

-- People per property (no double-count of ideal parts: percent is not on this table)
-- select property_id, relation_type, count(*)
-- from public.property_registry_people
-- group by 1, 2;
