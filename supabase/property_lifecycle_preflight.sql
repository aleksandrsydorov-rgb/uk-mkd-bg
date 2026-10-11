-- PB-1.8 preflight (read-only). Run before applying 20261011120000.
-- Expect: one row ready = true (or listed blockers).

select
  (to_regclass('public.properties') is not null) as properties_ok,
  (to_regprocedure('public.admin_assert_book_admin()') is not null) as assert_admin_ok,
  (to_regprocedure('public.log_property_change(bigint,text,text,text,jsonb,text)') is not null) as change_log_ok,
  (to_regprocedure('public.property_book_owner_row_access_ready(public.property_registry_people)') is not null) as access_ready_ok,
  (to_regprocedure('public.admin_approve_owner_transfer(bigint)') is not null) as transfer_ok,
  (to_regclass('public.property_book_transfer_approve_gate') is not null) as gate_ok,
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'archived_at'
  ) as archived_at_not_yet_applied,
  (
    select count(*)::int
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_schema = 'public'
      and ccu.table_name = 'properties'
  ) as fk_refs_to_properties;
