-- Support Fee tariff lifecycle (Task 07):
-- - First activation: current or next calendar year (no backfill of prior years).
-- - Working planned publish: next calendar year only (not +2/+3…).
-- - In-force amendment: current year + valid_from >= today; new charges only
--   (existing assessments keep snapshots; no auto-reprice).
-- Capital Repair year rules unchanged.

begin;

create or replace function public.publish_tariff_version(
  p_tariff_id uuid,
  p_rates jsonb,
  p_basis_type text,
  p_basis_note text,
  p_idempotency_key uuid,
  p_application_year integer default null,
  p_valid_from date default null,
  p_basis_reference text default null,
  p_basis_date date default null,
  p_decision_id uuid default null
)
returns table (
  version_id uuid,
  tariff_id uuid,
  valid_from date,
  status text,
  rates jsonb,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cat public.tariff_catalog;
  v_today date := public.tariff_sofia_today();
  v_valid_from date;
  v_basis_type text;
  v_note text;
  v_fingerprint text;
  v_existing public.tariff_versions;
  v_version_id uuid;
  v_key text;
  v_rate numeric;
  v_natural jsonb;
  v_legal jsonb;
  v_kind text;
  v_module_enabled boolean;
  v_min_year integer;
  v_keys text[];
  v_year_now integer;
  v_has_current boolean;
begin
  if auth.uid() is null then
    raise exception 'publish_tariff_version: not authenticated' using errcode = '28000';
  end if;
  if p_tariff_id is null or p_idempotency_key is null then
    raise exception 'publish_tariff_version: tariff and idempotency key required'
      using errcode = '22023';
  end if;

  select c.* into v_cat from public.tariff_catalog as c where c.id = p_tariff_id for update;
  if not found then
    raise exception 'publish_tariff_version: tariff not found' using errcode = 'P0002';
  end if;
  if v_cat.active is not true then
    raise exception 'publish_tariff_version: tariff inactive' using errcode = '22023';
  end if;
  if not public.tariff_can_publish(v_cat.module_key) then
    raise exception 'publish_tariff_version: not allowed' using errcode = '42501';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm where bm.module_key = v_cat.module_key;
  if v_module_enabled is not true then
    raise exception 'publish_tariff_version: module disabled' using errcode = '42501';
  end if;

  v_basis_type := btrim(coalesce(p_basis_type, ''));
  v_note := btrim(coalesce(p_basis_note, ''));
  if v_note = '' then
    raise exception 'publish_tariff_version: basis_note required' using errcode = '22023';
  end if;

  if v_cat.application_basis = 'billing_year' then
    if p_application_year is null then
      raise exception 'publish_tariff_version: application year required' using errcode = '22023';
    end if;

    v_year_now := extract(year from v_today)::int;
    select exists (
      select 1
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.status = 'published'
        and tv.cancelled_at is null
        and tv.valid_from <= v_today
    ) into v_has_current;

    if v_cat.module_key = 'support_fee' then
      -- In-force amendment: explicit valid_from (>= today) + current application year.
      if p_valid_from is not null then
        if not v_has_current then
          raise exception 'publish_tariff_version: support amendment requires an existing tariff'
            using errcode = '22023';
        end if;
        if p_application_year is distinct from v_year_now then
          raise exception 'publish_tariff_version: support amendment year must be current year'
            using errcode = '22023';
        end if;
        if p_valid_from < v_today then
          raise exception 'publish_tariff_version: past valid_from not allowed'
            using errcode = '22023';
        end if;
        v_valid_from := p_valid_from;
      elsif not v_has_current then
        -- First activation: current or next year only (no prior-year backfill).
        if p_application_year < v_year_now or p_application_year > v_year_now + 1 then
          raise exception
            'publish_tariff_version: support activation year must be % or %',
            v_year_now, v_year_now + 1
            using errcode = '22023';
        end if;
        v_valid_from := make_date(p_application_year, 1, 1);
      else
        -- Planned annual tariff: next calendar year only.
        if p_application_year is distinct from v_year_now + 1 then
          raise exception
            'publish_tariff_version: planned support tariff must be next calendar year (%)',
            v_year_now + 1
            using errcode = '22023';
        end if;
        v_valid_from := make_date(p_application_year, 1, 1);
      end if;
    else
      -- Capital Repair (and other billing_year): keep prior bounds, cap far future at next+1.
      v_min_year := case
        when v_cat.module_key = 'capital_repair' then v_year_now
        else v_year_now + 1
      end;
      if p_application_year < v_min_year then
        raise exception 'publish_tariff_version: application year must be % or later', v_min_year
          using errcode = '22023';
      end if;
      if p_application_year > v_year_now + 1 then
        raise exception
          'publish_tariff_version: application year cannot be beyond next calendar year'
          using errcode = '22023';
      end if;
      v_valid_from := make_date(p_application_year, 1, 1);
    end if;

    if v_basis_type not in ('general_meeting', 'external_decision') then
      raise exception 'publish_tariff_version: invalid Support basis_type' using errcode = '22023';
    end if;
    if v_basis_type = 'general_meeting' and p_decision_id is null then
      raise exception 'publish_tariff_version: decision_id required for general_meeting'
        using errcode = '22023';
    end if;
    if v_basis_type = 'external_decision'
       and nullif(btrim(coalesce(p_basis_reference, '')), '') is null then
      raise exception 'publish_tariff_version: basis_reference required for external_decision'
        using errcode = '22023';
    end if;
    if p_basis_date is null then
      raise exception 'publish_tariff_version: basis_date required for Support' using errcode = '22023';
    end if;
  else
    if p_valid_from is null then
      raise exception 'publish_tariff_version: valid_from required' using errcode = '22023';
    end if;
    if p_valid_from < v_today then
      raise exception 'publish_tariff_version: past valid_from not allowed' using errcode = '22023';
    end if;
    v_valid_from := p_valid_from;
    if v_basis_type not in ('supplier_notice', 'invoice', 'other') then
      raise exception 'publish_tariff_version: invalid utility basis_type' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_basis_reference, '')), '') is null then
      raise exception 'publish_tariff_version: basis_reference required' using errcode = '22023';
    end if;
  end if;

  if p_rates is null or jsonb_typeof(p_rates) <> 'object' then
    raise exception 'publish_tariff_version: rates object required' using errcode = '22023';
  end if;

  if p_rates ? 'natural' or p_rates ? 'legal' then
    v_natural := coalesce(p_rates -> 'natural', '{}'::jsonb);
    v_legal := coalesce(p_rates -> 'legal', v_natural);
  else
    v_natural := p_rates;
    v_legal := p_rates;
  end if;

  foreach v_kind in array array['natural', 'legal'] loop
    select array_agg(k order by k) into v_keys
    from jsonb_object_keys(case when v_kind = 'natural' then v_natural else v_legal end) as k;

    if v_keys is distinct from (
      select array_agg(x order by x) from unnest(v_cat.component_keys) as x
    ) then
      raise exception 'publish_tariff_version: component keys must match catalog exactly (% )', v_kind
        using errcode = '22023';
    end if;

    foreach v_key in array v_cat.component_keys loop
      begin
        v_rate := case when v_kind = 'natural'
          then (v_natural ->> v_key)::numeric
          else (v_legal ->> v_key)::numeric end;
      exception when others then
        raise exception 'publish_tariff_version: invalid rate for %/%', v_kind, v_key
          using errcode = '22023';
      end;
      if v_rate is null or v_rate < 0 then
        raise exception 'publish_tariff_version: rate must be >= 0' using errcode = '22023';
      end if;
      if v_cat.module_key in ('support_fee', 'capital_repair') and v_rate <= 0 then
        raise exception 'publish_tariff_version: rate must be > 0' using errcode = '22023';
      end if;
    end loop;
  end loop;

  v_fingerprint := md5(
    v_cat.id::text || '|' ||
    v_valid_from::text || '|' ||
    v_basis_type || '|' ||
    coalesce(p_basis_reference, '') || '|' ||
    coalesce(p_basis_date::text, '') || '|' ||
    v_note || '|' ||
    coalesce(p_decision_id::text, '') || '|' ||
    v_natural::text || '|' ||
    v_legal::text
  );

  select tv.* into v_existing
  from public.tariff_versions as tv
  where tv.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.payload_fingerprint is distinct from v_fingerprint then
      raise exception 'publish_tariff_version: idempotency key conflict' using errcode = '23505';
    end if;
    return query
    select
      v_existing.id,
      v_existing.tariff_id,
      v_existing.valid_from,
      v_existing.status,
      public.tariff_rates_json(v_existing.id),
      v_existing.published_at;
    return;
  end if;

  if exists (
    select 1 from public.tariff_versions as tv
    where tv.tariff_id = v_cat.id
      and tv.valid_from = v_valid_from
      and tv.status = 'published'
      and tv.cancelled_at is null
  ) then
    raise exception 'publish_tariff_version: published version already exists for date'
      using errcode = '23505';
  end if;

  if p_decision_id is not null
     and not exists (
       select 1 from public.general_meeting_decisions as d where d.id = p_decision_id
     ) then
    raise exception 'publish_tariff_version: decision not found' using errcode = 'P0002';
  end if;

  insert into public.tariff_versions (
    tariff_id, valid_from, status, basis_type, basis_reference, basis_date, basis_note,
    decision_id, published_at, published_by, idempotency_key, payload_fingerprint
  ) values (
    v_cat.id, v_valid_from, 'published', v_basis_type,
    nullif(btrim(coalesce(p_basis_reference, '')), ''),
    p_basis_date, v_note, p_decision_id, now(), auth.uid(),
    p_idempotency_key, v_fingerprint
  )
  returning id into v_version_id;

  insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
  select v_version_id, k, (v_natural ->> k)::numeric, 'natural'
  from unnest(v_cat.component_keys) as k;

  insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
  select v_version_id, k, (v_legal ->> k)::numeric, 'legal'
  from unnest(v_cat.component_keys) as k;

  return query
  select
    v_version_id,
    v_cat.id,
    v_valid_from,
    'published'::text,
    public.tariff_rates_json(v_version_id),
    now();
exception
  when unique_violation then
    raise exception 'publish_tariff_version: conflict' using errcode = '23505';
end;
$fn$;

revoke all on function public.publish_tariff_version(
  uuid, jsonb, text, text, uuid, integer, date, text, date, uuid
) from public;
revoke execute on function public.publish_tariff_version(
  uuid, jsonb, text, text, uuid, integer, date, text, date, uuid
) from anon;
grant execute on function public.publish_tariff_version(
  uuid, jsonb, text, text, uuid, integer, date, text, date, uuid
) to authenticated;

comment on function public.publish_tariff_version(
  uuid, jsonb, text, text, uuid, integer, date, text, date, uuid
) is
  'Tariff Core publish. Support Fee: activation (current/next year), planned next year only, or in-force amendment via valid_from; does not auto-reprice assessments.';

commit;
