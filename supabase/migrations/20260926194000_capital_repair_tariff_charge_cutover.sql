-- Capital repair charge cutover: amount from Tariff Core (fixed €/apartment·year).
-- Same staff roles as before (администрация | бухгалтер). Module must be enabled.
-- Does not change payment RPC. Assessment remains the charge grouping key.

begin;

-- ---------------------------------------------------------------------------
-- Resolve published capital amount for a billing year
-- ---------------------------------------------------------------------------

create or replace function public.resolve_capital_tariff_for_year(
  p_billing_year integer
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
  v_amount numeric;
begin
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'resolve_capital_tariff_for_year: invalid billing year'
      using errcode = '22023';
  end if;

  select c.id
    into v_cat_id
  from public.tariff_catalog as c
  where c.tariff_key = 'capital_repair'
    and c.active is true;

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

  select tv.valid_from
    into v_valid_from
  from public.tariff_versions as tv
  where tv.id = v_version_id
    and tv.status = 'published';

  if v_valid_from is null then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  select ri.rate
    into v_amount
  from public.tariff_rate_items as ri
  where ri.version_id = v_version_id
    and ri.component_key = 'base';

  if v_amount is null or v_amount <= 0 then
    raise exception 'resolve_capital_tariff_for_year: invalid amount'
      using errcode = '22023';
  end if;

  if (
    select count(*)::int
    from public.tariff_rate_items as ri
    where ri.version_id = v_version_id
  ) <> 1 then
    raise exception 'resolve_capital_tariff_for_year: expected exactly one rate component'
      using errcode = '22023';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  amount_eur := round(v_amount, 2);
  return next;
end;
$fn$;

revoke all on function public.resolve_capital_tariff_for_year(integer) from public;
revoke all on function public.resolve_capital_tariff_for_year(integer) from anon;
revoke all on function public.resolve_capital_tariff_for_year(integer) from authenticated;

create or replace function public.get_applicable_capital_tariff(
  p_billing_year integer default null
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  amount_eur numeric,
  billing_year integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_year integer;
  v_email text := nullif(btrim(auth.email()), '');
begin
  if v_email is null then
    raise exception 'get_applicable_capital_tariff: not authenticated'
      using errcode = '28000';
  end if;

  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'get_applicable_capital_tariff: not allowed'
      using errcode = '42501';
  end if;

  v_year := coalesce(
    p_billing_year,
    extract(year from (now() at time zone 'Europe/Sofia'))::integer
  );

  return query
  select
    r.tariff_version_id,
    r.valid_from,
    r.amount_eur,
    v_year
  from public.resolve_capital_tariff_for_year(v_year) as r;
end;
$fn$;

revoke all on function public.get_applicable_capital_tariff(integer) from public;
revoke all on function public.get_applicable_capital_tariff(integer) from anon;
grant execute on function public.get_applicable_capital_tariff(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Charge: amount from tariff for billing year (no client amount)
-- ---------------------------------------------------------------------------

drop function if exists public.charge_capital_repair(bigint, uuid, numeric, text, uuid);
drop function if exists public.charge_capital_repair_bulk(uuid, numeric, text);

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

  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year) as r;

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

create or replace function public.charge_capital_repair_bulk(
  p_assessment_id uuid,
  p_billing_year integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_amount numeric;
  v_note text;
  v_status text;
  v_id bigint;
  v_rows int;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_module_enabled boolean;
begin
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

  if p_assessment_id is null then
    raise exception 'Assessment not found.';
  end if;

  select r.amount_eur into v_amount
  from public.resolve_capital_tariff_for_year(p_billing_year) as r;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    perform 1 from public.properties as p where p.id = v_id for update;
  end loop;

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

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;
    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key
    ) values (
      v_id, p_assessment_id, 'charge', v_amount, v_note, v_email, pg_catalog.gen_random_uuid()
    )
    on conflict (property_id, assessment_id) where kind = 'charge' and assessment_id is not null
    do nothing;

    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'created', v_created,
    'skipped_existing', v_skipped,
    'not_applied', 0,
    'assessment_id', p_assessment_id,
    'billing_year', p_billing_year,
    'amount_eur', v_amount
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from public;
revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text) to authenticated;

-- Capital may publish for current Sofia year (support still requires next year+).
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
  v_keys text[];
  v_module_enabled boolean;
  v_min_year integer;
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
  from public.building_modules as bm
  where bm.module_key = v_cat.module_key;
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

  select array_agg(k order by k) into v_keys
  from jsonb_object_keys(p_rates) as k;

  if v_keys is distinct from (
    select array_agg(x order by x) from unnest(v_cat.component_keys) as x
  ) then
    raise exception 'publish_tariff_version: component keys must match catalog exactly'
      using errcode = '22023';
  end if;

  foreach v_key in array v_cat.component_keys loop
    begin
      v_rate := (p_rates ->> v_key)::numeric;
    exception when others then
      raise exception 'publish_tariff_version: invalid rate for %', v_key using errcode = '22023';
    end;
    if v_rate is null or v_rate < 0 then
      raise exception 'publish_tariff_version: rate must be >= 0' using errcode = '22023';
    end if;
    if v_cat.module_key in ('support_fee', 'capital_repair') and v_rate <= 0 then
      raise exception 'publish_tariff_version: rate must be > 0' using errcode = '22023';
    end if;
  end loop;

  v_fingerprint := md5(
    v_cat.id::text || '|' ||
    v_valid_from::text || '|' ||
    v_basis_type || '|' ||
    coalesce(p_basis_reference, '') || '|' ||
    coalesce(p_basis_date::text, '') || '|' ||
    v_note || '|' ||
    coalesce(p_decision_id::text, '') || '|' ||
    p_rates::text
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

  insert into public.tariff_rate_items (version_id, component_key, rate)
  select v_version_id, k, (p_rates ->> k)::numeric
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

revoke all on function public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid) from public;
revoke execute on function public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid) from anon;
grant execute on function public.publish_tariff_version(uuid, jsonb, text, text, uuid, integer, date, text, date, uuid) to authenticated;

commit;
