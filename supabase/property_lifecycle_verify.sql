-- PB-1.8 post-migration verify (read-only). Expect: ALL CHECKS PASSED

do $verify$
declare
  v_fail text := '';
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'archived_at'
  ) then
    v_fail := v_fail || 'missing properties.archived_at; ';
  end if;

  if to_regprocedure('public.admin_property_lifecycle_inspect(bigint)') is null then
    v_fail := v_fail || 'missing lifecycle_inspect; ';
  end if;
  if to_regprocedure('public.admin_retire_property(bigint)') is null then
    v_fail := v_fail || 'missing retire_property; ';
  end if;

  v_def := pg_get_functiondef('public.property_book_owner_row_access_ready(public.property_registry_people)'::regprocedure);
  if position('archived_at' in coalesce(v_def, '')) = 0 then
    v_fail := v_fail || 'access_ready ignores archived_at; ';
  end if;

  v_def := pg_get_functiondef('public.admin_list_property_book(integer)'::regprocedure);
  if position('archived_at' in coalesce(v_def, '')) = 0 then
    v_fail := v_fail || 'admin_list_property_book ignores archived_at; ';
  end if;

  v_def := pg_get_functiondef('public.user_activation_owner_base()'::regprocedure);
  if position('archived_at' in coalesce(v_def, '')) = 0 then
    v_fail := v_fail || 'UA owner_base ignores archived_at; ';
  end if;

  v_def := pg_get_functiondef('public.gm_book_roster_hash()'::regprocedure);
  if position('archived_at' in coalesce(v_def, '')) = 0 then
    v_fail := v_fail || 'gm_book_roster_hash ignores archived_at; ';
  end if;

  v_def := pg_get_functiondef('public.admin_approve_owner_transfer(bigint)'::regprocedure);
  if position('archived' in lower(coalesce(v_def, ''))) = 0 then
    v_fail := v_fail || 'approve transfer missing archived guard; ';
  end if;

  -- Must not rewrite FK delete rules to blanket CASCADE
  if exists (
    select 1
    from information_schema.referential_constraints rc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = rc.constraint_name
    where ccu.table_schema = 'public'
      and ccu.table_name = 'properties'
      and rc.delete_rule = 'CASCADE'
      and ccu.constraint_name like '%capital_repair%'
  ) then
    v_fail := v_fail || 'unexpected CASCADE on capital_repair; ';
  end if;

  if v_fail <> '' then
    raise exception 'PB-1.8 VERIFY FAIL: %', v_fail;
  end if;
end;
$verify$;

select 'ALL CHECKS PASSED' as result;
