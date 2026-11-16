-- Soft-opening card confirm must work after meters_* stages are already complete.
-- admin_confirm_*_opening → register_*_opening_reading previously always asserted
-- initial-setup writability and blocked the normal admin card path.

do $patch$
declare
  r record;
  def text;
  newdef text;
  needle text;
  utility_key text;
  replacement text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'register_water_opening_reading',
        'register_electricity_opening_reading'
      )
  loop
    def := pg_get_functiondef(r.oid);
    if position('soft_opening_confirm' in def) > 0 then
      raise notice '% already soft-confirm aware', r.proname;
      continue;
    end if;

    utility_key := case
      when r.proname like '%water%' then 'water'
      else 'electricity'
    end;

    needle := format(
      'perform public.admin_assert_module_initial_setup_writable(%L);',
      utility_key
    );

    if position(needle in def) = 0 then
      raise exception '%: expected gate % not found', r.proname, needle;
    end if;

    replacement := format(
      $b$if not (
    lower(btrim(coalesce(p_source_reference, ''))) in ('admin_confirm_opening', 'soft_opening_confirm')
    or exists (
      select 1 from public.utility_opening_pending u
      where u.property_id = p_property_id
        and u.utility = %L
        and u.status = 'needs_initial'
    )
  ) then
    perform public.admin_assert_module_initial_setup_writable(%L);
  end if;$b$,
      utility_key,
      utility_key
    );

    newdef := replace(def, needle, replacement);
    if newdef = def then
      raise exception '%: gate replace produced no change', r.proname;
    end if;
    execute newdef;
    raise notice 'patched % for soft-opening confirm', r.proname;
  end loop;
end;
$patch$;
