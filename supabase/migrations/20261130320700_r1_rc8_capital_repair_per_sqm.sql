-- R1-RC8: Capital repair annual charge = round(properties.area_sqm × rate, 2).
-- Corrects catalog unit from fixed/item (€/apartment) to per_unit/m2 (€/m²·year).
-- Existing published rates (e.g. 2.00) keep numeric values; meaning is now €/m²·year.
-- Does not rewrite opening ledger rows or confirmed charges; adds charge snapshots.
-- Applied migrations are not edited.

begin;

-- ---------------------------------------------------------------------------
-- Catalog unit correction (current + greenfield semantics)
-- ---------------------------------------------------------------------------

alter table public.tariff_catalog disable trigger tariff_catalog_lock;
update public.tariff_catalog
set
  unit_code = 'm2',
  calculation_type = 'per_unit'
where tariff_key = 'capital_repair'
  and (
    unit_code is distinct from 'm2'
    or calculation_type is distinct from 'per_unit'
  );
alter table public.tariff_catalog enable trigger tariff_catalog_lock;

comment on column public.tariff_catalog.unit_code is
  'Display/billing unit. capital_repair uses m2 (€/m²·year); amount = area_sqm × rate.';

-- ---------------------------------------------------------------------------
-- Charge snapshots on ledger (nullable for opening / historical rows)
-- ---------------------------------------------------------------------------

alter table public.capital_repair_ledger
  add column if not exists area_sqm_snapshot numeric(12, 3);

alter table public.capital_repair_ledger
  add column if not exists rate_eur_per_sqm_year_snapshot numeric(12, 6);

alter table public.capital_repair_ledger
  add column if not exists tariff_version_id uuid;

alter table public.capital_repair_ledger
  add column if not exists subject_kind text;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'capital_repair_ledger_tariff_version_id_fkey'
  ) then
    alter table public.capital_repair_ledger
      add constraint capital_repair_ledger_tariff_version_id_fkey
      foreign key (tariff_version_id)
      references public.tariff_versions (id)
      on delete restrict;
  end if;
end;
$fk$;

alter table public.capital_repair_ledger
  drop constraint if exists capital_repair_ledger_subject_kind_check;

alter table public.capital_repair_ledger
  add constraint capital_repair_ledger_subject_kind_check
  check (
    subject_kind is null
    or subject_kind in ('natural', 'legal')
  );

alter table public.capital_repair_ledger
  drop constraint if exists capital_repair_ledger_charge_snapshot_chk;

alter table public.capital_repair_ledger
  add constraint capital_repair_ledger_charge_snapshot_chk
  check (
    kind is distinct from 'charge'
    or (
      area_sqm_snapshot is not null
      and area_sqm_snapshot > 0
      and rate_eur_per_sqm_year_snapshot is not null
      and rate_eur_per_sqm_year_snapshot > 0
      and tariff_version_id is not null
      and subject_kind is not null
    )
  );

comment on column public.capital_repair_ledger.area_sqm_snapshot is
  'Apartment area (m²) snapshotted at charge time; later area edits do not rewrite history.';
comment on column public.capital_repair_ledger.rate_eur_per_sqm_year_snapshot is
  'Published €/m²·year rate snapshotted at charge time.';
comment on column public.capital_repair_ledger.tariff_version_id is
  'Published capital_repair tariff version used for this charge.';
comment on column public.capital_repair_ledger.subject_kind is
  'natural|legal subject rate applied for this charge.';

-- ---------------------------------------------------------------------------
-- Shared amount helper (preview + charge use the same formula)
-- ---------------------------------------------------------------------------

create or replace function public.capital_repair_charge_amount_for_year(
  p_property_id bigint,
  p_billing_year integer
)
returns table (
  tariff_version_id uuid,
  valid_from date,
  subject_kind text,
  area_sqm numeric,
  rate_eur_per_sqm_year numeric,
  amount_eur numeric,
  apartment_number text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_subject text;
  v_version_id uuid;
  v_valid_from date;
  v_rate numeric;
  v_area numeric;
  v_apt text;
begin
  if p_property_id is null then
    raise exception 'capital_repair: property required' using errcode = '22023';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'capital_repair: invalid billing year' using errcode = '22023';
  end if;

  select
    nullif(btrim(coalesce(p.apartment_number::text, '')), ''),
    p.area_sqm
  into v_apt, v_area
  from public.properties as p
  where p.id = p_property_id;

  if not found then
    raise exception 'capital_repair: property not found' using errcode = 'P0002';
  end if;

  if v_area is null or v_area <= 0 then
    raise exception 'capital_repair: apartment % has no valid area_sqm', coalesce(v_apt, p_property_id::text)
      using errcode = 'P0001';
  end if;

  v_subject := coalesce(public.property_tariff_subject_kind(p_property_id), 'natural');

  select r.tariff_version_id, r.valid_from, r.amount_eur
    into v_version_id, v_valid_from, v_rate
  from public.resolve_capital_tariff_for_year(p_billing_year, v_subject) as r;

  if v_version_id is null or v_rate is null or v_rate <= 0 then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  tariff_version_id := v_version_id;
  valid_from := v_valid_from;
  subject_kind := v_subject;
  area_sqm := round(v_area, 3);
  rate_eur_per_sqm_year := v_rate;
  amount_eur := round(round(v_area, 3) * v_rate, 2);
  apartment_number := v_apt;
  return next;
end;
$fn$;

revoke all on function public.capital_repair_charge_amount_for_year(bigint, integer)
  from public, anon;
grant execute on function public.capital_repair_charge_amount_for_year(bigint, integer)
  to authenticated;

comment on function public.capital_repair_charge_amount_for_year(bigint, integer) is
  'Capital repair annual amount: round(properties.area_sqm × subject rate €/m²·year, 2). Blocks missing/invalid area.';

-- resolve_* still returns the published RATE in amount_eur (€/m²·year), not charged total.
comment on function public.resolve_capital_tariff_for_year(integer, text) is
  'Returns published capital_repair rate (€/m²·year) for billing year + subject. Charge multiplies by area_sqm.';

-- ---------------------------------------------------------------------------
-- charge_capital_repair — area × rate + snapshots
-- ---------------------------------------------------------------------------

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
  v_note text;
  v_status text;
  v_row public.capital_repair_ledger%rowtype;
  v_module_enabled boolean;
  v_calc record;
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

  if exists (
    select 1 from public.capital_repair_opening_imports as i
    where i.property_id = p_property_id
      and (
        i.assessment_id = p_assessment_id
        or i.billing_year = p_billing_year
      )
  ) then
    raise exception 'charge_capital_repair: opening_import_blocks_charge'
      using errcode = 'P0001';
  end if;

  select * into v_calc
  from public.capital_repair_charge_amount_for_year(p_property_id, p_billing_year);

  if v_calc.amount_eur is null or v_calc.amount_eur <= 0 then
    raise exception 'No capital repair tariff configured for billing year %', p_billing_year
      using errcode = 'P0002';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select l.* into v_row
  from public.capital_repair_ledger as l
  where l.idempotency_key = p_idempotency_key;

  if found then
    if v_row.property_id is distinct from p_property_id
       or v_row.assessment_id is distinct from p_assessment_id
       or v_row.kind is distinct from 'charge'
       or v_row.amount_eur is distinct from v_calc.amount_eur
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
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key,
      area_sqm_snapshot, rate_eur_per_sqm_year_snapshot, tariff_version_id, subject_kind
    ) values (
      p_property_id, p_assessment_id, 'charge', v_calc.amount_eur, v_note, v_email, p_idempotency_key,
      v_calc.area_sqm, v_calc.rate_eur_per_sqm_year, v_calc.tariff_version_id, v_calc.subject_kind
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
           or v_row.amount_eur is distinct from v_calc.amount_eur
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

revoke all on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) from public, anon;
grant execute on function public.charge_capital_repair(bigint, uuid, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bulk charge — same helper per property
-- ---------------------------------------------------------------------------

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
  v_note text;
  v_status text;
  v_id bigint;
  v_rows int;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_blocked int := 0;
  v_module_enabled boolean;
  v_calc record;
  v_apt text;
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

  -- Ensure a published year tariff exists before locking properties.
  perform 1
  from public.resolve_capital_tariff_for_year(p_billing_year, 'natural') as r;

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

    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = v_id
        and (i.assessment_id = p_assessment_id or i.billing_year = p_billing_year)
    ) then
      v_blocked := v_blocked + 1;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (
      select 1 from public.capital_repair_ledger as l
      where l.property_id = v_id
        and l.assessment_id = p_assessment_id
        and l.kind = 'charge'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      select * into v_calc
      from public.capital_repair_charge_amount_for_year(v_id, p_billing_year);
    exception
      when others then
        select nullif(btrim(coalesce(p.apartment_number::text, '')), '') into v_apt
        from public.properties as p where p.id = v_id;
        raise exception 'capital_repair bulk: apartment % — %',
          coalesce(v_apt, v_id::text), SQLERRM
          using errcode = 'P0001';
    end;

    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key,
      area_sqm_snapshot, rate_eur_per_sqm_year_snapshot, tariff_version_id, subject_kind
    ) values (
      v_id, p_assessment_id, 'charge', v_calc.amount_eur, v_note, v_email, pg_catalog.gen_random_uuid(),
      v_calc.area_sqm, v_calc.rate_eur_per_sqm_year, v_calc.tariff_version_id, v_calc.subject_kind
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
    'skipped', v_skipped,
    'opening_import_blocked', v_blocked,
    'assessment_id', p_assessment_id,
    'billing_year', p_billing_year
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from public, anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text) to authenticated;

-- Overview RPC: keep amount_eur = natural rate (€/m²); unit_code from catalog after update.
comment on function public.get_applicable_capital_tariff(integer) is
  'Published capital_repair tariff for a billing year. amount_eur / rate_* are €/m²·year rates (not charged totals).';

commit;
