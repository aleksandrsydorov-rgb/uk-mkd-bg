-- =============================================================================
-- R1-RC8 — First-run tariff readiness is period-scoped.
-- Annual tariffs (support_fee / capital_repair) must have a published version
-- whose valid_from is exactly Jan 1 of the required Sofia calendar year.
-- A published tariff for a different year must not satisfy the gate.
-- Utility tariffs still require any published version applicable as of today.
-- =============================================================================

begin;

-- Drop prior overloads so (text) vs (text, integer) stay unambiguous
-- (no DEFAULT on the second arg — that would collide with the one-arg call).
drop function if exists public.first_run_tariff_has_published(text, integer);
drop function if exists public.first_run_tariff_has_published(text);

create or replace function public.first_run_tariff_has_published(
  p_tariff_key text,
  p_billing_year integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_tariff_key, '')));
  v_today date := public.tariff_sofia_today();
  v_year integer;
  v_from date;
begin
  if v_key = '' then
    return false;
  end if;

  if v_key in ('support_fee', 'capital_repair') then
    v_year := p_billing_year;
    if v_year is null then
      if v_key = 'support_fee' then
        v_year := extract(year from v_today)::integer + 1;
      else
        v_year := extract(year from v_today)::integer;
      end if;
    end if;
    if v_year < 2000 or v_year > 2100 then
      return false;
    end if;
    v_from := make_date(v_year, 1, 1);
    return exists (
      select 1
      from public.tariff_catalog as c
      join public.tariff_versions as tv
        on tv.tariff_id = c.id
       and tv.status = 'published'
       and tv.valid_from = v_from
      where c.tariff_key = v_key
        and c.active is true
    );
  end if;

  -- Calendar-date utilities: any published version with valid_from <= today.
  return exists (
    select 1
    from public.tariff_catalog as c
    join public.tariff_versions as tv
      on tv.tariff_id = c.id
     and tv.status = 'published'
     and tv.valid_from <= v_today
    where c.tariff_key = v_key
      and c.active is true
  );
end;
$fn$;

revoke all on function public.first_run_tariff_has_published(text, integer) from public, anon;
grant execute on function public.first_run_tariff_has_published(text, integer) to authenticated;

-- Keep single-arg overload for callers / older grants.
create or replace function public.first_run_tariff_has_published(p_tariff_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.first_run_tariff_has_published(p_tariff_key, null::integer);
$fn$;

revoke all on function public.first_run_tariff_has_published(text) from public, anon;
grant execute on function public.first_run_tariff_has_published(text) to authenticated;

create or replace function public.first_run_assert_tariffs_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_today date := public.tariff_sofia_today();
  v_sf_year integer := extract(year from v_today)::integer + 1;
  v_cr_year integer := extract(year from v_today)::integer;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb)
  into v_selected;

  v_need_water := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) = 'water'
  );
  v_need_elec := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  );

  if v_need_water and not public.first_run_tariff_has_published('water') then
    raise exception 'first_run: published water tariff required' using errcode = 'P0001';
  end if;
  if v_need_elec and not public.first_run_tariff_has_published('electricity') then
    raise exception 'first_run: published electricity tariff required' using errcode = 'P0001';
  end if;
  if not public.first_run_tariff_has_published('support_fee', v_sf_year) then
    raise exception 'first_run: published support_fee tariff for year % required', v_sf_year
      using errcode = 'P0001';
  end if;
  if not public.first_run_tariff_has_published('capital_repair', v_cr_year) then
    raise exception 'first_run: published capital_repair tariff for year % required', v_cr_year
      using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_tariffs_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_tariffs_ready(uuid) to authenticated;

commit;
