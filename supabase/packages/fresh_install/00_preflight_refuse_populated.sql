-- =============================================================================
-- IS-9b — Preflight: refuse accidental apply on populated production databases
-- =============================================================================
-- Empty-project package ONLY. NOT included in companion migrations.
-- Fails closed when core business tables already contain rows.
-- =============================================================================

do $$
declare
  v_n bigint;
begin
  if to_regclass('public.properties') is not null then
    execute 'select count(*)::bigint from public.properties' into v_n;
    if v_n > 0 then
      raise exception
        'fresh_install_preflight: refuse apply — public.properties already has % row(s)',
        v_n
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.staff') is not null then
    execute 'select count(*)::bigint from public.staff' into v_n;
    if v_n > 0 then
      raise exception
        'fresh_install_preflight: refuse apply — public.staff already has % row(s)',
        v_n
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.capital_repair_ledger') is not null then
    execute 'select count(*)::bigint from public.capital_repair_ledger' into v_n;
    if v_n > 0 then
      raise exception
        'fresh_install_preflight: refuse apply — capital_repair_ledger already has % row(s)',
        v_n
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.water_ledger') is not null then
    execute 'select count(*)::bigint from public.water_ledger' into v_n;
    if v_n > 0 then
      raise exception
        'fresh_install_preflight: refuse apply — water_ledger already has % row(s)',
        v_n
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.electricity_ledger') is not null then
    execute 'select count(*)::bigint from public.electricity_ledger' into v_n;
    if v_n > 0 then
      raise exception
        'fresh_install_preflight: refuse apply — electricity_ledger already has % row(s)',
        v_n
        using errcode = 'P0001';
    end if;
  end if;
end $$;
