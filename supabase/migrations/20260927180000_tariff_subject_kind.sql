-- Tariff Core: subject_kind natural | legal on rate items.
-- Flat publish still works (copies rates to both kinds). Nested {natural, legal} optional.
-- Charge helpers resolve subject from property book (legal_entity → legal; else natural; ЕТ → natural).

begin;

-- ---------------------------------------------------------------------------
-- Schema: subject_kind + dual PK
-- ---------------------------------------------------------------------------

alter table public.tariff_rate_items disable trigger tariff_rate_items_immutability;

alter table public.tariff_rate_items
  add column if not exists subject_kind text;

update public.tariff_rate_items
   set subject_kind = 'natural'
 where subject_kind is null;

alter table public.tariff_rate_items
  alter column subject_kind set default 'natural';

alter table public.tariff_rate_items
  alter column subject_kind set not null;

alter table public.tariff_rate_items
  drop constraint if exists tariff_rate_items_subject_kind_check;

alter table public.tariff_rate_items
  add constraint tariff_rate_items_subject_kind_check
  check (subject_kind in ('natural', 'legal'));

alter table public.tariff_rate_items drop constraint if exists tariff_rate_items_pkey;
alter table public.tariff_rate_items
  add primary key (version_id, component_key, subject_kind);

insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
select ri.version_id, ri.component_key, ri.rate, 'legal'
from public.tariff_rate_items as ri
where ri.subject_kind = 'natural'
on conflict do nothing;

alter table public.tariff_rate_items enable trigger tariff_rate_items_immutability;

comment on column public.tariff_rate_items.subject_kind is
  'natural | legal — parallel rates per published version';

-- ---------------------------------------------------------------------------
-- Property → tariff subject
-- ---------------------------------------------------------------------------

create or replace function public.property_tariff_subject_kind(p_property_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_kind text;
  v_owner_type text;
begin
  select r.entity_kind into v_kind
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and r.entity_kind = 'legal_entity'
  limit 1;
  if v_kind is not null then
    return 'legal';
  end if;

  select nullif(btrim(coalesce(p.owner_type, '')), '') into v_owner_type
  from public.properties as p
  where p.id = p_property_id;
  if v_owner_type is not null
     and v_owner_type ~* 'юр|legal|company|ооо|еоод|ад' then
    return 'legal';
  end if;

  return 'natural';
end;
$fn$;

revoke all on function public.property_tariff_subject_kind(bigint) from public;
revoke all on function public.property_tariff_subject_kind(bigint) from anon;
grant execute on function public.property_tariff_subject_kind(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Rates JSON helpers (1-arg keeps natural-only for list/history UI)
-- ---------------------------------------------------------------------------

create or replace function public.tariff_rates_json(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(ri.component_key, ri.rate order by ri.component_key),
    '{}'::jsonb
  )
  from public.tariff_rate_items as ri
  where ri.version_id = p_version_id
    and ri.subject_kind = 'natural';
$$;

revoke all on function public.tariff_rates_json(uuid) from public;
revoke all on function public.tariff_rates_json(uuid) from anon;
revoke all on function public.tariff_rates_json(uuid) from authenticated;

create or replace function public.tariff_rates_json(
  p_version_id uuid,
  p_subject_kind text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (
      select jsonb_object_agg(ri.component_key, ri.rate order by ri.component_key)
      from public.tariff_rate_items as ri
      where ri.version_id = p_version_id
        and ri.subject_kind = coalesce(nullif(btrim(p_subject_kind), ''), 'natural')
    ),
    '{}'::jsonb
  );
$fn$;

revoke all on function public.tariff_rates_json(uuid, text) from public;
revoke all on function public.tariff_rates_json(uuid, text) from anon;
revoke all on function public.tariff_rates_json(uuid, text) from authenticated;

create or replace function public.tariff_rates_by_kind_json(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'natural', public.tariff_rates_json(p_version_id, 'natural'),
    'legal', public.tariff_rates_json(p_version_id, 'legal')
  );
$fn$;

revoke all on function public.tariff_rates_by_kind_json(uuid) from public;
revoke all on function public.tariff_rates_by_kind_json(uuid) from anon;
revoke all on function public.tariff_rates_by_kind_json(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Resolvers (2-arg + 1-arg wrappers → natural)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_support_tariff_for_year(
  p_billing_year integer,
  p_subject_kind text
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cat_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rate numeric;
  v_kind text := coalesce(nullif(btrim(p_subject_kind), ''), 'natural');
begin
  if v_kind not in ('natural', 'legal') then
    raise exception 'resolve_support_tariff_for_year: invalid subject_kind'
      using errcode = '22023';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_support_tariff_for_year: invalid billing year'
      using errcode = '22023';
  end if;

  select c.id into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'support_fee' and c.active is true;

  if v_cat_id is null then
    raise exception 'resolve_support_tariff_for_year: support_fee catalog missing'
      using errcode = 'P0002';
  end if;

  begin
    v_version_id := public.resolve_support_tariff_version_by_year(v_cat_id, p_billing_year);
  exception
    when sqlstate 'P0002' then
      raise exception 'No support fee tariff configured for billing year %', p_billing_year
        using errcode = 'P0002';
  end;

  select tv.valid_from into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id and tv.status = 'published';

  if v_valid_from is null then
    raise exception 'No support fee tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  select ri.rate into v_rate
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base'
    and ri.subject_kind = v_kind;

  if v_rate is null or v_rate <= 0 then
    raise exception 'resolve_support_tariff_for_year: invalid base rate'
      using errcode = '22023';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rate := v_rate;
  return next;
end;
$fn$;

revoke all on function public.resolve_support_tariff_for_year(integer, text) from public;
revoke all on function public.resolve_support_tariff_for_year(integer, text) from anon;
revoke all on function public.resolve_support_tariff_for_year(integer, text) from authenticated;

create or replace function public.resolve_support_tariff_for_year(p_billing_year integer)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rate numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select * from public.resolve_support_tariff_for_year(p_billing_year, 'natural');
$fn$;

revoke all on function public.resolve_support_tariff_for_year(integer) from public;
revoke all on function public.resolve_support_tariff_for_year(integer) from anon;
revoke all on function public.resolve_support_tariff_for_year(integer) from authenticated;

create or replace function public.resolve_capital_tariff_for_year(
  p_billing_year integer,
  p_subject_kind text
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cat_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rate numeric;
  v_kind text := coalesce(nullif(btrim(p_subject_kind), ''), 'natural');
begin
  if v_kind not in ('natural', 'legal') then
    raise exception 'resolve_capital_tariff_for_year: invalid subject_kind'
      using errcode = '22023';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_capital_tariff_for_year: invalid billing year'
      using errcode = '22023';
  end if;

  select c.id into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'capital_repair' and c.active is true;

  if v_cat_id is null then
    raise exception 'resolve_capital_tariff_for_year: capital_repair catalog missing'
      using errcode = 'P0002';
  end if;

  begin
    v_version_id := public.resolve_support_tariff_version_by_year(v_cat_id, p_billing_year);
  exception
    when sqlstate 'P0002' then
      raise exception 'No capital repair tariff configured for billing year %', p_billing_year
        using errcode = 'P0002';
  end;

  select tv.valid_from into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id and tv.status = 'published';

  if v_valid_from is null then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  select ri.rate into v_rate
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base'
    and ri.subject_kind = v_kind;

  if v_rate is null or v_rate <= 0 then
    raise exception 'resolve_capital_tariff_for_year: invalid amount'
      using errcode = '22023';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  amount_eur := v_rate;
  return next;
end;
$fn$;

revoke all on function public.resolve_capital_tariff_for_year(integer, text) from public;
revoke all on function public.resolve_capital_tariff_for_year(integer, text) from anon;
revoke all on function public.resolve_capital_tariff_for_year(integer, text) from authenticated;

create or replace function public.resolve_capital_tariff_for_year(p_billing_year integer)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select * from public.resolve_capital_tariff_for_year(p_billing_year, 'natural');
$fn$;

revoke all on function public.resolve_capital_tariff_for_year(integer) from public;
revoke all on function public.resolve_capital_tariff_for_year(integer) from anon;
revoke all on function public.resolve_capital_tariff_for_year(integer) from authenticated;

create or replace function public.resolve_utility_tariff(
  p_tariff_key text,
  p_on_date date,
  p_subject_kind text
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_tariff_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rates jsonb;
  v_kind text := coalesce(nullif(btrim(p_subject_kind), ''), 'natural');
begin
  v_key := btrim(coalesce(p_tariff_key, ''));
  if v_key not in ('water', 'electricity') then
    raise exception 'resolve_utility_tariff: tariff_key must be water or electricity'
      using errcode = '22023';
  end if;
  if v_kind not in ('natural', 'legal') then
    raise exception 'resolve_utility_tariff: invalid subject_kind'
      using errcode = '22023';
  end if;
  if p_on_date is null then
    raise exception 'resolve_utility_tariff: application date required' using errcode = '22023';
  end if;

  select c.id into v_tariff_id
  from public.tariff_catalog as c
  where c.tariff_key = v_key and c.active is true
  limit 1;

  if v_tariff_id is null then
    raise exception 'No % tariff configured for reading date.', v_key;
  end if;

  begin
    v_version_id := public.resolve_tariff_version_by_date(v_tariff_id, p_on_date);
  exception
    when sqlstate 'P0002' then
      raise exception 'No % tariff configured for reading date.', v_key;
  end;

  select tv.valid_from, public.tariff_rates_json(tv.id, v_kind)
    into v_valid_from, v_rates
  from public.tariff_versions as tv
  where tv.id = v_version_id;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rates := v_rates;
  return next;
end;
$fn$;

revoke all on function public.resolve_utility_tariff(text, date, text) from public;
revoke all on function public.resolve_utility_tariff(text, date, text) from anon;
revoke all on function public.resolve_utility_tariff(text, date, text) from authenticated;

create or replace function public.resolve_utility_tariff(
  p_tariff_key text,
  p_on_date date
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rates jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select * from public.resolve_utility_tariff(p_tariff_key, p_on_date, 'natural');
$fn$;

revoke all on function public.resolve_utility_tariff(text, date) from public;
revoke all on function public.resolve_utility_tariff(text, date) from anon;
revoke all on function public.resolve_utility_tariff(text, date) from authenticated;

create or replace function public.resolve_internet_tariff(
  p_on_date date,
  p_subject_kind text
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tariff_id uuid;
  v_version_id uuid;
  v_valid_from date;
  v_rates jsonb;
  v_kind text := coalesce(nullif(btrim(p_subject_kind), ''), 'natural');
begin
  if v_kind not in ('natural', 'legal') then
    raise exception 'resolve_internet_tariff: invalid subject_kind'
      using errcode = '22023';
  end if;
  if p_on_date is null then
    raise exception 'resolve_internet_tariff: application date required'
      using errcode = '22023';
  end if;

  select c.id into v_tariff_id
  from public.tariff_catalog as c
  where c.tariff_key = 'internet' and c.active is true
  limit 1;

  if v_tariff_id is null then
    raise exception 'resolve_internet_tariff: catalog missing' using errcode = 'P0002';
  end if;

  v_version_id := public.resolve_tariff_version_by_date(v_tariff_id, p_on_date);

  select tv.valid_from, public.tariff_rates_json(tv.id, v_kind)
    into v_valid_from, v_rates
  from public.tariff_versions as tv
  where tv.id = v_version_id;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  rates := v_rates;
  return next;
end;
$fn$;

revoke all on function public.resolve_internet_tariff(date, text) from public;
revoke all on function public.resolve_internet_tariff(date, text) from anon;
revoke all on function public.resolve_internet_tariff(date, text) from authenticated;

create or replace function public.resolve_internet_tariff(p_on_date date)
returns table (
  tariff_version_id uuid,
  valid_from date,
  rates jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select * from public.resolve_internet_tariff(p_on_date, 'natural');
$fn$;

revoke all on function public.resolve_internet_tariff(date) from public;
revoke all on function public.resolve_internet_tariff(date) from anon;
revoke all on function public.resolve_internet_tariff(date) from authenticated;

-- ---------------------------------------------------------------------------
-- Charge helpers: use property subject
-- ---------------------------------------------------------------------------

create or replace function public.support_fee_base_amount_for_year(
  p_property_id bigint,
  p_billing_year integer
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_area numeric;
  v_rate numeric;
  v_kind text;
begin
  if not (
    public.owns_property(p_property_id)
    or public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'support_fee_base_amount_for_year: not allowed'
      using errcode = '42501';
  end if;

  if p_property_id is null then
    raise exception 'support_fee_base_amount_for_year: property required'
      using errcode = '22023';
  end if;

  select coalesce(p.area_sqm, 0)::numeric
    into v_area
  from public.properties as p
  where p.id = p_property_id;

  if not found then
    return 0;
  end if;

  v_kind := public.property_tariff_subject_kind(p_property_id);

  select r.rate
    into v_rate
  from public.resolve_support_tariff_for_year(p_billing_year, v_kind) as r;

  return round(round(coalesce(v_area, 0), 3) * v_rate, 2);
end;
$fn$;

revoke all on function public.support_fee_base_amount_for_year(bigint, integer) from public;
revoke all on function public.support_fee_base_amount_for_year(bigint, integer) from anon;
grant execute on function public.support_fee_base_amount_for_year(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- publish: flat rates → both kinds; nested {natural, legal} supported
-- ---------------------------------------------------------------------------

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
    v_min_year := case
      when v_cat.module_key = 'capital_repair' then extract(year from v_today)::int
      else extract(year from v_today)::int + 1
    end;
    if p_application_year < v_min_year then
      raise exception 'publish_tariff_version: application year must be % or later', v_min_year
        using errcode = '22023';
    end if;
    v_valid_from := make_date(p_application_year, 1, 1);
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

-- Capital charge: subject from property book
create or replace function public.charge_capital_repair(
  p_property_id bigint,
  p_assessment_id uuid,
  p_billing_year integer,
  p_note text,
  p_idempotency_key uuid
)
returns table (
  ledger_id uuid,
  property_id bigint,
  assessment_id uuid,
  amount_eur numeric,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_amount numeric;
  v_note text;
  v_status text;
  v_row public.capital_repair_ledger%rowtype;
  v_module_enabled boolean;
  v_kind text;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'Not authorized.';
  end if;

  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'capital_repair';
  if v_module_enabled is not true then
    raise exception 'Capital repair module is disabled.';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  if p_property_id is null then
    raise exception 'Property not found.';
  end if;
  if p_assessment_id is null then
    raise exception 'Assessment not found.';
  end if;

  v_kind := public.property_tariff_subject_kind(p_property_id);
  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year, v_kind) as r;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.* into v_row
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is distinct from p_assessment_id
       or v_row.kind is distinct from 'charge'
       or v_row.amount_eur is distinct from v_amount
       or v_row.note is distinct from v_note then
      raise exception 'Idempotency key conflict.';
    end if;
    return query
    select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
    return;
  end if;

  perform 1 from public.properties as p where p.id = p_property_id for update;
  if not found then
    raise exception 'Property not found.';
  end if;

  select a.status into v_status
  from public.capital_repair_assessments as a
  where a.id = p_assessment_id
  for update;
  if not found then
    raise exception 'Assessment not found.';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Assessment is not active.';
  end if;

  if exists (
    select 1 from public.capital_repair_ledger as l
    where l.property_id = p_property_id
      and l.assessment_id = p_assessment_id
      and l.kind = 'charge'
  ) then
    raise exception 'Capital repair charge already exists for this property and assessment.';
  end if;

  begin
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      p_property_id, p_assessment_id, 'charge', v_amount, v_note, v_email, p_idempotency_key
    )
    returning * into v_row;
  exception
    when unique_violation then
      select l.* into v_row
      from public.capital_repair_ledger as l
      where l.idempotency_key = p_idempotency_key;
      if found then
        if v_row.property_id is distinct from p_property_id
           or v_row.assessment_id is distinct from p_assessment_id
           or v_row.kind is distinct from 'charge'
           or v_row.amount_eur is distinct from v_amount
           or v_row.note is distinct from v_note then
          raise exception 'Idempotency key conflict.';
        end if;
      else
        raise exception 'Capital repair charge already exists for this property and assessment.';
      end if;
  end;

  return query
  select v_row.id, v_row.property_id, v_row.assessment_id, v_row.amount_eur, v_row.note, v_row.created_at;
end;
$fn$;

revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from public;
revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from anon;
grant execute on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) to authenticated;

commit;
