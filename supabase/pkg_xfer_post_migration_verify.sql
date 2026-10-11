-- =============================================================================
-- PKG-XFER post-migration verification (READ-MOSTLY)
-- Run after EACH migration step and after full 140000–140400 chain.
-- Avoids business writes. Distinguishes step via p_after parameter comment.
-- =============================================================================

-- After 140000
do $step140000$
begin
  if to_regclass('public.ownership_change_settings') is null then
    raise exception 'verify140000: ownership_change_settings missing';
  end if;
  if not exists (
    select 1 from public.ownership_change_settings
    where id = 1 and ordinary_debt_gate_enabled = false
  ) then
    raise exception 'verify140000: ordinary_debt_gate_enabled must default false';
  end if;
  if to_regprocedure(
    'public.submit_ownership_change(bigint,jsonb,text,text,text,date,text,text,date,text,text,bigint,boolean,text)'
  ) is null then
    raise exception 'verify140000: submit_ownership_change missing';
  end if;
  if to_regprocedure(
    'public.admin_approve_owner_transfer(bigint,jsonb,text,text,date,text,date,jsonb)'
  ) is null then
    raise exception 'verify140000: admin_approve_owner_transfer(8-arg) missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'owner_transfers_one_pending_per_property_uidx'
  ) then
    raise exception 'verify140000: one-pending unique index missing';
  end if;
  raise notice 'VERIFY 140000 PASS';
end;
$step140000$;

-- After 140100
do $step140100$
begin
  if to_regclass('public.property_book_extracts') is null then
    raise exception 'verify140100: property_book_extracts missing';
  end if;
  if to_regprocedure('public.owner_generate_property_book_extract(bigint,text[])') is null then
    raise exception 'verify140100: owner_generate_property_book_extract missing';
  end if;
  if to_regprocedure('public.owner_list_ownership_history(bigint)') is null then
    raise exception 'verify140100: owner_list_ownership_history missing';
  end if;
  raise notice 'VERIFY 140100 PASS';
end;
$step140100$;

-- After 140200
do $step140200$
begin
  if to_regprocedure('public.admin_get_ownership_debt_status(bigint)') is null then
    raise exception 'verify140200: admin_get_ownership_debt_status missing';
  end if;
  if to_regprocedure('public.admin_confirm_inherited_liability(bigint,text,numeric,text,boolean,text)') is null then
    raise exception 'verify140200: admin_confirm_inherited_liability missing';
  end if;
  if to_regprocedure('public.property_book_voting_eligible_owner(bigint)') is null then
    raise exception 'verify140200: property_book_voting_eligible_owner missing';
  end if;
  -- Gate still off
  if exists (
    select 1 from public.ownership_change_settings where id = 1 and ordinary_debt_gate_enabled
  ) then
    raise exception 'verify140200: debt gate must remain OFF after Stage 3 apply';
  end if;
  raise notice 'VERIFY 140200 PASS';
end;
$step140200$;

-- After 140300
do $step140300$
begin
  if to_regprocedure('public.owner_attach_property_book_extract_pdf(bigint,text,text,uuid)') is null then
    raise exception 'verify140300: owner_attach_property_book_extract_pdf missing';
  end if;
  if to_regprocedure('public.admin_fulfill_certified_extract(bigint,text)') is null then
    raise exception 'verify140300: admin_fulfill_certified_extract missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'property_book_extracts'
      and column_name = 'has_pdf'
  ) then
    raise exception 'verify140300: has_pdf column missing';
  end if;
  raise notice 'VERIFY 140300 PASS';
end;
$step140300$;

-- After 140400 (Stage 5B)
do $step140400$
begin
  if to_regclass('public.ownership_tariff_transitions') is null then
    raise exception 'verify140400: ownership_tariff_transitions missing';
  end if;
  if to_regprocedure('public.ownership_roster_tariff_subject(jsonb)') is null then
    raise exception 'verify140400: ownership_roster_tariff_subject missing';
  end if;
  if to_regprocedure('public.owner_verify_and_attach_extract_pdf(bigint,uuid,text,boolean)') is null then
    raise exception 'verify140400: owner_verify_and_attach_extract_pdf missing';
  end if;
  if has_table_privilege('authenticated', 'public.ownership_tariff_transitions', 'INSERT') then
    raise exception 'verify140400: authenticated must not INSERT tariff transitions';
  end if;
  raise notice 'VERIFY 140400 PASS';
end;
$step140400$;

-- Authenticated privilege sanity (no JWT spoofing)
do $acl$
begin
  if not has_function_privilege(
    'authenticated',
    'public.submit_ownership_change(bigint,jsonb,text,text,text,date,text,text,date,text,text,bigint,boolean,text)',
    'execute'
  ) then
    raise exception 'acl: authenticated cannot execute submit_ownership_change';
  end if;
  if has_table_privilege('authenticated', 'public.property_book_transfer_approve_gate', 'INSERT') then
    raise exception 'acl: authenticated must not INSERT approve gate';
  end if;
  if has_table_privilege('authenticated', 'public.ownership_inherited_liabilities', 'INSERT') then
    raise exception 'acl: authenticated must not INSERT inherited liabilities directly';
  end if;
  if has_table_privilege('authenticated', 'public.property_book_extracts', 'INSERT') then
    raise exception 'acl: authenticated must not INSERT extracts directly';
  end if;
  raise notice 'ACL SANITY PASS';
end;
$acl$;
