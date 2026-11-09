-- =============================================================================
-- R1-RC8 — Tariffs prepared in the wizard take effect on activation.
-- Activation is the first successful completion: platform_installations.first_run_completed_at.
-- The calendar date is that timestamp in Europe/Sofia.
-- Publication and completion share one server timestamp. A failed completion
-- rolls the publication back. Repeat completion does not change the date
-- or insert another version. Preparation and publication do not create charges.
-- Already completed installations are not rewritten.
-- =============================================================================

begin;

-- The annual amount is not prorated. A version may therefore start on the
-- activation date rather than 1 January. Later publication still chooses
-- 1 January inside publish_tariff_version.
create or replace function public.tariff_versions_support_jan1_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return new;
end;
$fn$;

create or replace function public.tariff_version_for_billing_year(
  p_tariff_id uuid,
  p_billing_year integer
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_jan1 date;
  v_next date;
  v_id uuid;
begin
  if p_tariff_id is null or p_billing_year is null then
    return null;
  end if;
  if p_billing_year < 2000 or p_billing_year > 2100 then
    return null;
  end if;
  v_jan1 := make_date(p_billing_year, 1, 1);
  v_next := make_date(p_billing_year + 1, 1, 1);

  select tv.id
    into v_id
  from public.tariff_versions as tv
  where tv.tariff_id = p_tariff_id
    and tv.status = 'published'
    and tv.cancelled_at is null
    and tv.valid_from <= v_jan1
  order by tv.valid_from desc, tv.id desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- A version that starts during the year still covers that billing year
  -- at the full annual amount. Later versions in the same year stay the
  -- next period and are not selected here.
  select tv.id
    into v_id
  from public.tariff_versions as tv
  where tv.tariff_id = p_tariff_id
    and tv.status = 'published'
    and tv.cancelled_at is null
    and tv.valid_from >= v_jan1
    and tv.valid_from < v_next
  order by tv.valid_from asc, tv.id asc
  limit 1;

  return v_id;
end;
$fn$;

revoke all on function public.tariff_version_for_billing_year(uuid, integer) from public, anon, authenticated;

create or replace function public.resolve_support_tariff_version_by_year(
  p_tariff_id uuid,
  p_billing_year integer
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_tariff_id is null or p_billing_year is null then
    raise exception 'resolve_support_tariff_version_by_year: arguments required'
      using errcode = '22023';
  end if;
  if p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_support_tariff_version_by_year: invalid year' using errcode = '22023';
  end if;
  v_id := public.tariff_version_for_billing_year(p_tariff_id, p_billing_year);
  if v_id is null then
    raise exception 'resolve_tariff_version_by_date: no matching version'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.resolve_support_tariff_version_by_year(uuid, integer) from public, anon, authenticated;

create or replace function public.first_run_tariff_prep_ok(p_key text, p_item jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_rate numeric;
  v_legal numeric;
  v_day numeric;
  v_night numeric;
  v_basis text;
  v_note text;
  v_ref text;
  v_decision text;
  v_date date;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    return false;
  end if;
  begin
    v_basis := lower(btrim(coalesce(p_item ->> 'basis_type', '')));
    v_note := btrim(coalesce(p_item ->> 'basis_note', ''));
    v_ref := nullif(btrim(coalesce(p_item ->> 'basis_reference', '')), '');
    v_decision := nullif(btrim(coalesce(p_item ->> 'decision_id', '')), '');
    if nullif(btrim(coalesce(p_item ->> 'basis_date', '')), '') is null then
      v_date := null;
    else
      v_date := (p_item ->> 'basis_date')::date;
    end if;
    if v_key in ('support_fee', 'capital_repair') then
      v_rate := (p_item ->> 'rate_natural')::numeric;
      v_legal := coalesce((p_item ->> 'rate_legal')::numeric, v_rate);
      return v_rate > 0
        and v_legal > 0
        and v_note <> ''
        and v_date is not null
        and (
          (v_basis = 'external_decision' and v_ref is not null)
          or (v_basis = 'general_meeting' and v_decision is not null)
        );
    elsif v_key = 'water' then
      v_rate := (p_item ->> 'rate')::numeric;
      return v_rate >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other')
        and v_ref is not null
        and v_note <> '';
    elsif v_key = 'electricity' then
      v_day := (p_item ->> 'day')::numeric;
      v_night := (p_item ->> 'night')::numeric;
      return v_day >= 0
        and v_night >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other')
        and v_ref is not null
        and v_note <> '';
    end if;
  exception
    when others then
      return false;
  end;
  return false;
end;
$fn$;

revoke all on function public.first_run_tariff_prep_ok(text, jsonb) from public, anon;
grant execute on function public.first_run_tariff_prep_ok(text, jsonb) to authenticated;

create or replace function public.first_run_tariff_step_satisfied(
  p_installation_id uuid,
  p_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_draft jsonb;
  v_item jsonb;
  v_cat_id uuid;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_version uuid;
begin
  select i.first_run_draft
    into v_draft
  from public.platform_installations as i
  where i.id = p_installation_id;
  v_item := coalesce(v_draft, '{}'::jsonb) -> 'tariff_prep' -> v_key;
  if public.first_run_tariff_prep_ok(v_key, v_item) then
    return true;
  end if;

  select c.id
    into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = v_key
    and c.active is true;

  if v_cat_id is null then
    return false;
  end if;

  if v_key in ('support_fee', 'capital_repair') then
    v_version := public.tariff_version_for_billing_year(v_cat_id, extract(year from v_today)::integer);
    return exists (
      select 1
      from public.tariff_versions as tv
      where tv.id = v_version
        and tv.valid_from <= v_today
    );
  end if;

  return exists (
    select 1
    from public.tariff_versions as tv
    where tv.tariff_id = v_cat_id
      and tv.status = 'published'
      and tv.cancelled_at is null
      and tv.valid_from <= v_today
  );
end;
$fn$;

revoke all on function public.first_run_tariff_step_satisfied(uuid, text) from public, anon;
grant execute on function public.first_run_tariff_step_satisfied(uuid, text) to authenticated;

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

  if not public.first_run_tariff_step_satisfied(p_installation_id, 'support_fee') then
    raise exception 'first_run: tariff prep missing support_fee' using errcode = 'P0001';
  end if;
  if not public.first_run_tariff_step_satisfied(p_installation_id, 'capital_repair') then
    raise exception 'first_run: tariff prep missing capital_repair' using errcode = 'P0001';
  end if;
  if v_need_water and not public.first_run_tariff_step_satisfied(p_installation_id, 'water') then
    raise exception 'first_run: tariff prep missing water' using errcode = 'P0001';
  end if;
  if v_need_elec and not public.first_run_tariff_step_satisfied(p_installation_id, 'electricity') then
    raise exception 'first_run: tariff prep missing electricity' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_tariffs_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_tariffs_ready(uuid) to authenticated;

create or replace function public.first_run_activation_tariff_key(p_installation_id uuid, p_key text)
returns uuid
language sql
immutable
as $fn$
  select (
    substr(md5(p_installation_id::text || ':activation:' || p_key), 1, 8) || '-' ||
    substr(md5(p_installation_id::text || ':activation:' || p_key), 9, 4) || '-' ||
    '4' || substr(md5(p_installation_id::text || ':activation:' || p_key), 14, 3) || '-' ||
    '8' || substr(md5(p_installation_id::text || ':activation:' || p_key), 18, 3) || '-' ||
    substr(md5(p_installation_id::text || ':activation:' || p_key), 21, 12)
  )::uuid;
$fn$;

revoke all on function public.first_run_activation_tariff_key(uuid, text) from public, anon, authenticated;

create or replace function public.first_run_publish_activation_tariffs(
  p_installation_id uuid,
  p_activated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_at timestamptz := coalesce(p_activated_at, now());
  v_date date := (coalesce(p_activated_at, now()) at time zone 'Europe/Sofia')::date;
  v_year integer := extract(year from (coalesce(p_activated_at, now()) at time zone 'Europe/Sofia'))::integer;
  v_selected jsonb;
  v_keys text[];
  v_key text;
  v_item jsonb;
  v_cat public.tariff_catalog%rowtype;
  v_cover uuid;
  v_cover_from date;
  v_natural jsonb;
  v_legal jsonb;
  v_rate numeric;
  v_legal_rate numeric;
  v_day numeric;
  v_night numeric;
  v_basis text;
  v_note text;
  v_ref text;
  v_decision uuid;
  v_basis_date date;
  v_fingerprint text;
  v_existing public.tariff_versions%rowtype;
  v_idem uuid;
  v_version_id uuid;
  v_match boolean;
  v_component text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id
  for update;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  if v_inst.first_run_status = 'complete' then
    return;
  end if;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb) into v_selected;
  v_keys := array['support_fee', 'capital_repair'];
  if exists (
    select 1 from jsonb_array_elements_text(v_selected) as t(v) where lower(btrim(t.v)) = 'water'
  ) then
    v_keys := v_keys || array['water'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_selected) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  ) then
    v_keys := v_keys || array['electricity'];
  end if;

  foreach v_key in array v_keys loop
    v_item := coalesce(v_inst.first_run_draft, '{}'::jsonb) -> 'tariff_prep' -> v_key;
    select c.* into v_cat
    from public.tariff_catalog as c
    where c.tariff_key = v_key
      and c.active is true;
    if not found then
      raise exception 'first_run: tariff catalog missing %', v_key using errcode = 'P0001';
    end if;

    v_cover := null;
    if v_key in ('support_fee', 'capital_repair') then
      v_cover := public.tariff_version_for_billing_year(v_cat.id, v_year);
    else
      select tv.id
        into v_cover
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.status = 'published'
        and tv.cancelled_at is null
        and tv.valid_from <= v_date
      order by tv.valid_from desc, tv.id desc
      limit 1;
    end if;

    if v_cover is not null then
      select tv.valid_from into v_cover_from
      from public.tariff_versions as tv
      where tv.id = v_cover;
      if v_cover_from > v_date then
        v_cover := null;
      end if;
    end if;

    if v_cover is not null and not public.first_run_tariff_prep_ok(v_key, v_item) then
      continue;
    end if;

    if not public.first_run_tariff_prep_ok(v_key, v_item) then
      raise exception 'first_run: tariff prep missing %', v_key using errcode = 'P0001';
    end if;

    v_basis := lower(btrim(v_item ->> 'basis_type'));
    v_note := btrim(v_item ->> 'basis_note');
    v_ref := nullif(btrim(coalesce(v_item ->> 'basis_reference', '')), '');
    if nullif(btrim(coalesce(v_item ->> 'decision_id', '')), '') is null then
      v_decision := null;
    else
      v_decision := (v_item ->> 'decision_id')::uuid;
    end if;
    if nullif(btrim(coalesce(v_item ->> 'basis_date', '')), '') is null then
      v_basis_date := null;
    else
      v_basis_date := (v_item ->> 'basis_date')::date;
    end if;

    if v_key in ('support_fee', 'capital_repair') then
      v_rate := (v_item ->> 'rate_natural')::numeric;
      v_legal_rate := coalesce((v_item ->> 'rate_legal')::numeric, v_rate);
      v_natural := jsonb_build_object('base', v_rate);
      v_legal := jsonb_build_object('base', v_legal_rate);
    elsif v_key = 'water' then
      v_rate := (v_item ->> 'rate')::numeric;
      v_natural := jsonb_build_object('base', v_rate);
      v_legal := v_natural;
    else
      v_day := (v_item ->> 'day')::numeric;
      v_night := (v_item ->> 'night')::numeric;
      v_natural := jsonb_build_object('day', v_day, 'night', v_night);
      v_legal := v_natural;
    end if;

    if v_cover is not null then
      v_match := true;
      foreach v_component in array v_cat.component_keys loop
        if (
          select ri.rate
          from public.tariff_rate_items as ri
          where ri.version_id = v_cover
            and ri.component_key = v_component
            and ri.subject_kind = 'natural'
        ) is distinct from (v_natural ->> v_component)::numeric
        or (
          select ri.rate
          from public.tariff_rate_items as ri
          where ri.version_id = v_cover
            and ri.component_key = v_component
            and ri.subject_kind = 'legal'
        ) is distinct from (v_legal ->> v_component)::numeric then
          v_match := false;
        end if;
      end loop;
      if not v_match then
        raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
      end if;
      continue;
    end if;

    v_idem := public.first_run_activation_tariff_key(p_installation_id, v_key);
    v_fingerprint := md5(
      v_cat.id::text || '|' || v_date::text || '|' || v_basis || '|' ||
      coalesce(v_ref, '') || '|' || coalesce(v_basis_date::text, '') || '|' ||
      v_note || '|' || coalesce(v_decision::text, '') || '|' ||
      v_natural::text || '|' || v_legal::text
    );

    select tv.* into v_existing
    from public.tariff_versions as tv
    where tv.idempotency_key = v_idem;

    if found then
      if v_existing.payload_fingerprint is distinct from v_fingerprint then
        raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
      end if;
      continue;
    end if;

    if exists (
      select 1
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.valid_from = v_date
        and tv.status = 'published'
        and tv.cancelled_at is null
    ) then
      raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
    end if;

    insert into public.tariff_versions (
      tariff_id, valid_from, status, basis_type, basis_reference, basis_date, basis_note,
      decision_id, published_at, published_by, idempotency_key, payload_fingerprint
    ) values (
      v_cat.id, v_date, 'published', v_basis, v_ref, v_basis_date, v_note,
      v_decision, v_at, auth.uid(), v_idem, v_fingerprint
    )
    returning id into v_version_id;

    insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
    select v_version_id, k, (v_natural ->> k)::numeric, 'natural'
    from unnest(v_cat.component_keys) as k;

    insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
    select v_version_id, k, (v_legal ->> k)::numeric, 'legal'
    from unnest(v_cat.component_keys) as k;
  end loop;
end;
$fn$;

revoke all on function public.first_run_publish_activation_tariffs(uuid, timestamptz) from public, anon, authenticated;


create or replace function public.list_tariffs(
  p_module_key text default null,
  p_active_only boolean default true,
  p_limit integer default 50
)
returns table (
  tariff_id uuid,
  tariff_key text,
  module_key text,
  default_name text,
  unit_code text,
  currency text,
  calculation_type text,
  billing_period text,
  application_basis text,
  governance_type text,
  component_keys text[],
  active boolean,
  current_version_id uuid,
  current_valid_from date,
  current_rates jsonb,
  current_basis_type text,
  current_basis_note text,
  current_basis_date date,
  current_published_at timestamptz,
  current_legacy_author text,
  nearest_future_version_id uuid,
  nearest_future_valid_from date,
  nearest_future_rates jsonb,
  nearest_future_basis_type text,
  nearest_future_basis_note text,
  nearest_future_basis_date date,
  nearest_future_published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_today date := public.tariff_sofia_today();
  v_year_start date := make_date(extract(year from public.tariff_sofia_today())::int, 1, 1);
begin
  if auth.uid() is null then
    raise exception 'list_tariffs: not authenticated' using errcode = '28000';
  end if;
  if not public.tariff_can_view() then
    raise exception 'list_tariffs: not allowed' using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  return query
  select
    c.id,
    c.tariff_key,
    c.module_key,
    c.default_name,
    c.unit_code,
    c.currency,
    c.calculation_type,
    c.billing_period,
    c.application_basis,
    c.governance_type,
    c.component_keys,
    c.active,
    cur.id,
    cur.valid_from,
    case when cur.id is null then null else public.tariff_rates_json(cur.id) end,
    cur.basis_type,
    cur.basis_note,
    cur.basis_date,
    cur.published_at,
    cur.legacy_author,
    fut.id,
    fut.valid_from,
    case when fut.id is null then null else public.tariff_rates_json(fut.id) end,
    fut.basis_type,
    fut.basis_note,
    fut.basis_date,
    fut.published_at
  from public.tariff_catalog as c
  left join lateral (
    select tv.*
    from public.tariff_versions as tv
    where tv.tariff_id = c.id
      and tv.status = 'published'
      and tv.id = case
        when c.application_basis = 'billing_year' then public.tariff_version_for_billing_year(
          c.id,
          extract(year from v_today)::integer
        )
        else (
          select tv2.id
          from public.tariff_versions as tv2
          where tv2.tariff_id = c.id
            and tv2.status = 'published'
            and tv2.cancelled_at is null
            and tv2.valid_from <= v_today
          order by tv2.valid_from desc, tv2.id desc
          limit 1
        )
      end
  ) as cur on true
  left join lateral (
    select tv.*
    from public.tariff_versions as tv
    where tv.tariff_id = c.id
      and tv.status = 'published'
      and tv.valid_from > coalesce(
        cur.valid_from,
        case
          when c.application_basis = 'billing_year' then v_year_start
          else v_today
        end
      )
    order by tv.valid_from asc, tv.id asc
    limit 1
  ) as fut on true
  where (p_module_key is null or c.module_key = btrim(p_module_key))
    and (not coalesce(p_active_only, true) or c.active is true)
  order by c.module_key, c.tariff_key
  limit v_limit;
end;
$fn$;

revoke all on function public.list_tariffs(text, boolean, integer) from public;
revoke execute on function public.list_tariffs(text, boolean, integer) from anon;
grant execute on function public.list_tariffs(text, boolean, integer) to authenticated;

create or replace function public.admin_complete_first_run_stage(
  p_stage text,
  p_next_stage text default null,
  p_draft jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_budget boolean := false;
  v_draft jsonb;
  v_key text;
  v_stage_done text;
  v_activated_at timestamptz;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.platform_installations as i
    where i.id = v_id and i.first_run_status = 'complete'
  ) then
    return public.admin_get_first_run_state();
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');
  v_draft := coalesce(p_draft, '{}'::jsonb);

  if v_stage = 'modules_select' then
    if not (v_draft ? 'modules_selected') or jsonb_typeof(v_draft -> 'modules_selected') is distinct from 'array' then
      raise exception 'first_run: modules_selected required' using errcode = '22023';
    end if;

    foreach v_key in array array['property_book', 'support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode']
    loop
      if not exists (
        select 1
        from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
        where lower(btrim(t.v)) = v_key
      ) then
        raise exception 'first_run: required module % missing', v_key using errcode = '22023';
      end if;
    end loop;

    for v_key in
      select lower(btrim(t.v))
      from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
    loop
      if v_key in ('property_book', 'support_fee', 'capital_repair', 'water', 'electricity', 'budget', 'uk_expenses', 'guest_mode', 'tariffs') then
        continue;
      end if;
      if v_key in ('platform_support', 'user_activation', 'residence_status') then
        raise exception 'first_run: module % is not optional', v_key using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.module_catalog as c
        where c.module_key = v_key and c.implemented is true
      ) then
        raise exception 'first_run: module % is not available', v_key using errcode = '22023';
      end if;
    end loop;

    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_water' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'water') then
      raise exception 'first_run: water setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'electricity') then
      raise exception 'first_run: electricity setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'budget' and p.status = 'complete'
    ) and not public.first_run_draft_has_module(v_draft, 'budget') then
      raise exception 'first_run: budget setup is already complete and cannot be turned off here'
        using errcode = 'P0001';
    end if;

    v_need_water := public.first_run_draft_has_module(v_draft, 'water');
    v_need_elec := public.first_run_draft_has_module(v_draft, 'electricity');
    v_selected := '[]'::jsonb;
    if v_need_water then
      v_selected := v_selected || jsonb_build_array('water');
    end if;
    if v_need_elec then
      v_selected := v_selected || jsonb_build_array('electricity');
    end if;
    v_draft := v_draft || jsonb_build_object('meters_selected', v_selected);

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;

    -- Connect selected catalog modules. This does not create charges or openings.
    for v_key in
      select distinct lower(btrim(t.v))
      from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
      union
      select unnest(array['support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'tariffs'])
    loop
      if exists (
        select 1 from public.module_catalog as c
        where c.module_key = v_key and c.implemented is true
      ) then
        perform public.set_building_module_enabled(v_key, true);
      end if;
    end loop;

    for v_key in
      select c.module_key
      from public.module_catalog as c
      where c.implemented is true
        and c.module_key not in ('support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'tariffs', 'platform_support', 'user_activation', 'residence_status')
        and not exists (
          select 1
          from jsonb_array_elements_text(v_draft -> 'modules_selected') as t(v)
          where lower(btrim(t.v)) = c.module_key
        )
    loop
      v_stage_done := case v_key
        when 'water' then 'meters_water'
        when 'electricity' then 'meters_electricity'
        when 'budget' then 'budget'
        else null
      end;
      if v_stage_done is not null and exists (
        select 1 from public.first_run_stage_progress p
        where p.installation_id = v_id and p.stage_key = v_stage_done and p.status = 'complete'
      ) then
        continue;
      end if;
      perform public.set_building_module_enabled(v_key, false);
    end loop;

    perform public.first_run_skip_stage(v_id, 'meters_select');
    if not v_need_water then
      perform public.first_run_skip_stage(v_id, 'meters_water');
    end if;
    if not v_need_elec then
      perform public.first_run_skip_stage(v_id, 'meters_electricity');
    end if;
    if not public.first_run_draft_has_module(v_draft, 'budget') then
      perform public.first_run_skip_stage(v_id, 'budget');
    end if;

    if v_next is null then
      v_next := 'complex_card';
    end if;
  end if;

  if v_stage = 'support_fee_opening' then
    perform public.first_run_assert_support_fee_opening_ready(v_id);
    if v_next is null then
      v_next := 'capital_repair_opening';
    end if;
  end if;

  if v_stage = 'capital_repair_opening' then
    perform public.first_run_assert_capital_repair_opening_ready(v_id);
    if v_next is null then
      v_next := 'tariffs';
    end if;
  end if;

  if v_stage = 'tariffs' then
    perform public.first_run_assert_tariffs_ready(v_id);
    if v_next is null then
      select public.first_run_draft_has_module(i.first_run_draft, 'budget')
      into v_need_budget
      from public.platform_installations as i
      where i.id = v_id;
      v_next := case when v_need_budget then 'budget' else 'complete' end;
    end if;
  end if;

  if v_stage = 'budget' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_budget_ready(v_id);
    if v_next is null then
      v_next := 'complete';
    end if;
  end if;

  if v_stage = 'complete' then
    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft
    where i.id = v_id;
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', v_draft, now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', v_draft -> 'meters_selected', '[]'::jsonb)
    into v_selected
    from public.platform_installations as i
    where i.id = v_id;

    v_need_water := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    );
    v_need_elec := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    );

    update public.platform_installations as i
    set first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || jsonb_build_object('meters_selected', coalesce(v_selected, '[]'::jsonb))
      || v_draft
    where i.id = v_id;

    if not v_need_water then
      perform public.first_run_skip_stage(v_id, 'meters_water');
    end if;
    if not v_need_elec then
      perform public.first_run_skip_stage(v_id, 'meters_electricity');
    end if;

    if v_next is null then
      v_next := case
        when v_need_water then 'meters_water'
        when v_need_elec then 'meters_electricity'
        else 'support_fee_opening'
      end;
    end if;
  end if;

  if v_stage = 'meters_water' and v_next is null then
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status in ('skipped', 'complete')
    ) or not exists (
      select 1 from public.platform_installations as i
      where i.id = v_id and public.first_run_draft_has_module(i.first_run_draft, 'electricity')
    ) then
      v_next := 'support_fee_opening';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'support_fee_opening';
  end if;

  if v_next = 'complete' and v_stage is distinct from 'complete' then
    perform public.first_run_assert_ready_to_complete(v_id);
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    v_activated_at := now();
    perform public.first_run_publish_activation_tariffs(v_id, v_activated_at);
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, v_activated_at),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', v_activated_at, v_activated_at, auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, v_activated_at), updated_at = v_activated_at;
  elsif v_next is not null then
    update public.platform_installations as i
    set
      first_run_status = case when i.first_run_status = 'complete' then 'complete' else 'in_progress' end,
      first_run_stage = case when i.first_run_status = 'complete' then i.first_run_stage else v_next end,
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || v_draft,
      updated_at = now()
    where i.id = v_id
      and i.first_run_status is distinct from 'complete';

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, updated_at, updated_by
    ) values (v_id, v_next, 'in_progress', now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set
      status = case when p.status in ('complete', 'skipped') then p.status else 'in_progress' end,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  return public.admin_get_first_run_state();
end;
$fn$;


revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;

commit;
