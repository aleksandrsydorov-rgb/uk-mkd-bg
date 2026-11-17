-- R1-RC8: first-run internet opening ready — accept soft money inventarisation.
-- New 4-col import stores balances in utility_opening_pending (needs_initial) without
-- inventing subscriptions / paid periods. Wizard continue must not require those.
-- Connection confirmation and billing unlock stay separate (card confirm / opening_confirmed_at).

create or replace function public.first_run_assert_internet_opening_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_none text;
begin
  select * into v_inst from public.platform_installations as i where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  if not public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    return;
  end if;

  v_none := lower(btrim(coalesce(v_inst.first_run_draft ->> 'internet_opening_none', '')));
  if v_none in ('true', 't', '1', 'yes') then
    return;
  end if;

  -- Legacy inventarisation: opening import snapshots / paid periods.
  if exists (select 1 from public.internet_opening_imports) then
    return;
  end if;
  if exists (
    select 1 from public.internet_paid_periods as p where p.opening_import is true
  ) then
    return;
  end if;

  -- Soft money-only import (signed balance template): pending rows without connection.
  -- needs_initial or confirmed both prove inventarisation happened; billing stays gated
  -- until internet_opening_is_billing_ready / opening_confirmed_at.
  if exists (
    select 1
    from public.utility_opening_pending as u
    where u.utility = 'internet'
      and u.status in ('needs_initial', 'confirmed')
  ) then
    return;
  end if;

  -- Card-confirmed subscriptions (opening applied) also satisfy the stage.
  if exists (
    select 1
    from public.internet_subscriptions as s
    where s.opening_confirmed_at is not null
  ) then
    return;
  end if;

  raise exception 'first_run: internet opening missing' using errcode = 'P0001';
end;
$fn$;

revoke all on function public.first_run_assert_internet_opening_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_internet_opening_ready(uuid) to authenticated;

comment on function public.first_run_assert_internet_opening_ready(uuid) is
  'Wizard gate for internet_opening stage: none flag, legacy imports/paid periods, soft utility_opening_pending, or confirmed subscriptions. Does not invent connections or unlock charges.';
