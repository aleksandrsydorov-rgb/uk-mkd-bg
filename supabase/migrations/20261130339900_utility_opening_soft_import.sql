-- Soft opening import for water / electricity / internet:
-- apartment rows may omit meter/readings/connection_state; registry shows needs_initial;
-- re-import of blanks must not wipe confirmed data; consumption gated until confirm.

-- ---------------------------------------------------------------------------
-- Pending opening slots (apartment visible before meter/state is complete)
-- ---------------------------------------------------------------------------
create table if not exists public.utility_opening_pending (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  utility text not null check (utility in ('water', 'electricity', 'internet')),
  meter_number text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'needs_initial'
    check (status in ('needs_initial', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by_email text
);

create unique index if not exists utility_opening_pending_open_uidx
  on public.utility_opening_pending (
    property_id,
    utility,
    coalesce(nullif(btrim(meter_number), ''), '')
  )
  where status = 'needs_initial';

create index if not exists utility_opening_pending_property_idx
  on public.utility_opening_pending (property_id, utility);

alter table public.utility_opening_pending enable row level security;
revoke all on table public.utility_opening_pending from public, anon;
grant select, insert, update, delete on table public.utility_opening_pending to authenticated;

drop policy if exists utility_opening_pending_staff on public.utility_opening_pending;
create policy utility_opening_pending_staff on public.utility_opening_pending
  for all to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер')
    or public.has_staff_role('бухгалтер')
  )
  with check (
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер')
    or public.has_staff_role('бухгалтер')
  );

-- ---------------------------------------------------------------------------
-- Baseline confirmation on meters (existing meters treated as already confirmed)
-- ---------------------------------------------------------------------------
alter table public.water_meters
  add column if not exists opening_confirmed_at timestamptz;

alter table public.electricity_meters
  add column if not exists opening_confirmed_at timestamptz;

update public.water_meters
   set opening_confirmed_at = coalesce(opening_confirmed_at, created_at, installed_at::timestamptz, now())
 where opening_confirmed_at is null;

update public.electricity_meters
   set opening_confirmed_at = coalesce(opening_confirmed_at, created_at, installed_at::timestamptz, now())
 where opening_confirmed_at is null;

comment on column public.water_meters.opening_confirmed_at is
  'When set, consumption billing from this meter may start. Null = needs initial confirmation.';
comment on column public.electricity_meters.opening_confirmed_at is
  'When set, consumption billing from this meter may start. Null = needs initial confirmation.';

-- Gate operational readings until baseline confirmed
create or replace function public.trg_assert_water_opening_confirmed()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if new.reading_kind is distinct from 'operational' then
    return new;
  end if;
  if exists (
    select 1 from public.water_meters m
    where m.id = new.meter_id
      and m.opening_confirmed_at is null
  ) then
    raise exception 'water_opening_not_confirmed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists water_readings_opening_gate_bi on public.water_readings;
create trigger water_readings_opening_gate_bi
  before insert on public.water_readings
  for each row execute function public.trg_assert_water_opening_confirmed();

create or replace function public.trg_assert_electricity_opening_confirmed()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if new.reading_kind is distinct from 'operational' then
    return new;
  end if;
  if new.electricity_meter_id is null then
    return new;
  end if;
  if exists (
    select 1 from public.electricity_meters m
    where m.id = new.electricity_meter_id
      and m.opening_confirmed_at is null
  ) then
    raise exception 'electricity_opening_not_confirmed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists electricity_readings_opening_gate_bi on public.meter_readings;
do $t$
begin
  if to_regclass('public.meter_readings') is not null then
    execute $sql$
      create trigger electricity_readings_opening_gate_bi
        before insert on public.meter_readings
        for each row execute function public.trg_assert_electricity_opening_confirmed()
    $sql$;
  end if;
end;
$t$;

-- ---------------------------------------------------------------------------
-- Helpers: empty row + section/block format
-- ---------------------------------------------------------------------------
create or replace function public.opening_import_row_is_blank(p_row jsonb, p_keys text[])
returns boolean
language sql
immutable
as $fn$
  select not exists (
    select 1
    from unnest(p_keys) as k(key)
    where nullif(btrim(coalesce(p_row ->> k.key, '')), '') is not null
  );
$fn$;

create or replace function public.opening_import_section_block_format_error(
  p_section text,
  p_block text
)
returns text
language plpgsql
immutable
as $fn$
declare
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_block text := nullif(btrim(coalesce(p_block, '')), '');
begin
  -- Numeric section + letter-like block → likely swapped columns
  if v_section is not null
     and v_section ~ '^[0-9]+$'
     and v_block is not null
     and v_block ~ '^[A-Za-zА-Яа-яЁёІіЇїЄє]$'
  then
    return 'section_block_fields_swapped';
  end if;
  -- Pure numeric section without block still suspicious for entrance letter complexes
  if v_section is not null
     and v_section ~ '^[0-9]+$'
     and (v_block is null or v_block ~ '^[0-9]+$')
  then
    -- Soft advisory only when block also numeric; keep as dedicated code for UI
    return 'section_code_looks_like_block_number';
  end if;
  return null;
end;
$fn$;

revoke all on function public.opening_import_row_is_blank(jsonb, text[]) from public, anon;
grant execute on function public.opening_import_row_is_blank(jsonb, text[]) to authenticated;
revoke all on function public.opening_import_section_block_format_error(text, text) from public, anon;
grant execute on function public.opening_import_section_block_format_error(text, text) to authenticated;

create or replace function public.upsert_utility_opening_pending(
  p_property_id bigint,
  p_utility text,
  p_meter_number text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_id uuid;
  v_meter text := nullif(btrim(coalesce(p_meter_number, '')), '');
begin
  update public.utility_opening_pending u
     set payload = coalesce(p_payload, '{}'::jsonb),
         meter_number = v_meter,
         updated_at = now(),
         status = 'needs_initial',
         confirmed_at = null,
         confirmed_by_email = null
   where u.property_id = p_property_id
     and u.utility = p_utility
     and coalesce(nullif(btrim(u.meter_number), ''), '') = coalesce(v_meter, '')
     and u.status = 'needs_initial'
  returning u.id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.utility_opening_pending (property_id, utility, meter_number, payload, status)
  values (p_property_id, p_utility, v_meter, coalesce(p_payload, '{}'::jsonb), 'needs_initial')
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.upsert_utility_opening_pending(bigint, text, text, jsonb) from public, anon;
grant execute on function public.upsert_utility_opening_pending(bigint, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Water soft import
-- ---------------------------------------------------------------------------
create or replace function public.admin_import_water_meters_opening(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_created int := 0;
  v_deferred int := 0;
  v_skipped int := 0;
  v_skipped_blank int := 0;
  v_preserved int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_section text;
  v_block text;
  v_fmt text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_reading numeric;
  v_reading_raw text;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_resolve_err text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_bal_kind_by_prop jsonb := '{}'::jsonb;
  v_bal_amt_by_prop jsonb := '{}'::jsonb;
  v_prev_kind text;
  v_prev_amt numeric;
  v_existing_meter_id uuid;
  v_existing_prop_id bigint;
  v_result jsonb;
  v_norm_amt text;
  v_incomplete boolean;
  v_has_confirmed boolean;
  v_keys text[] := array[
    'apartment_number','section_code','block_code','meter_number','initial_reading',
    'installed_at','opening_balance_kind','opening_balance_eur'
  ];
begin
  perform public.admin_assert_module_setup();
  perform public.admin_assert_module_initial_setup_writable('water');
  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('water');
  end if;
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_water_meters_opening: rows array required' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    if public.opening_import_row_is_blank(v_row, v_keys) then
      v_skipped_blank := v_skipped_blank + 1;
      continue;
    end if;

    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_section := nullif(btrim(coalesce(v_row ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_row ->> 'block_code', '')), '');
    v_bal_kind := public.normalize_meter_opening_balance_kind(v_row ->> 'opening_balance_kind');
    v_reading_raw := v_row ->> 'initial_reading';

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required',
        'expected_format', 'apartment_2_section_b_block_3'
      ));
      continue;
    end if;

    v_fmt := public.opening_import_section_block_format_error(v_section, v_block);
    if v_fmt = 'section_block_fields_swapped' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'section_code',
        'code', 'section_block_fields_swapped', 'reason', 'section_block_fields_swapped',
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'expected_format', 'apartment_2_section_b_block_3',
        'hint', 'section_must_be_entrance_letter'
      ));
      continue;
    end if;

    select r.property_id, r.error_code into v_prop_id, v_resolve_err
    from public.resolve_property_id_for_opening_import(v_apt, v_section, v_block) as r;
    if v_resolve_err is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx,
        'field', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code' else 'apartment_number' end,
        'code', v_resolve_err, 'reason', v_resolve_err,
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'expected_format', 'apartment_2_section_b_block_3',
        'hint', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'fill_section_code' else null end
      ));
      continue;
    end if;

    -- Numeric-only section advisory when letter entrances exist for this apt number
    if v_fmt = 'section_code_looks_like_block_number' and v_section is not null then
      if exists (
        select 1 from public.properties p
        where lower(btrim(coalesce(p.apartment_number::text, ''))) = lower(v_apt)
          and nullif(btrim(coalesce(p.section_code, '')), '') ~* '^[A-Za-zА-Яа-яЁёІіЇїЄє]'
      ) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'section_code',
          'code', 'section_code_looks_like_block_number',
          'reason', 'section_code_looks_like_block_number',
          'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
          'expected_format', 'apartment_2_section_b_block_3',
          'hint', 'section_must_be_entrance_letter'
        ));
        continue;
      end if;
    end if;

    begin
      v_reading := nullif(btrim(coalesce(v_reading_raw, '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if v_reading is not null and v_reading < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if v_installed is not null and v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    -- Opening balance optional on soft rows; validate only when provided
    if v_bal_kind is not null and v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if coalesce(v_bal_kind, 'zero') = 'zero' then
      v_bal_amt := 0;
      v_bal_kind := coalesce(v_bal_kind, 'zero');
    elsif v_bal_kind in ('debt', 'overpayment') and (v_bal_amt is null or v_bal_amt <= 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind is not null and v_bal_kind <> 'zero' then
      v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
      if v_prev_kind is not null then
        v_prev_amt := nullif(v_bal_amt_by_prop ->> v_prop_id::text, '')::numeric;
        if v_prev_kind is distinct from v_bal_kind
           or coalesce(v_prev_amt, 0) is distinct from coalesce(v_bal_amt, 0) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
            'code', 'opening_balance_conflict',
            'reason', 'opening_balance_conflict_same_apartment',
            'apartment_number', v_apt
          ));
          continue;
        end if;
      else
        v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
        v_norm_amt := coalesce(v_bal_amt, 0)::text;
        v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
      end if;
    end if;

    v_incomplete := (v_serial is null) or (v_reading is null);

    -- Preserve: blank meter/reading on re-import when property already has meter or confirmed pending
    if v_incomplete and v_serial is null and v_reading is null then
      select exists (
        select 1 from public.water_meters m
        where m.property_id = v_prop_id and m.retired_at is null
      ) or exists (
        select 1 from public.utility_opening_pending u
        where u.property_id = v_prop_id and u.utility = 'water' and u.status = 'confirmed'
      ) into v_has_confirmed;
      if v_has_confirmed then
        v_preserved := v_preserved + 1;
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    if v_serial is not null then
      if exists (select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
          'apartment_number', v_apt, 'meter_number', v_serial
        ));
        continue;
      end if;
      v_seen_serials := array_append(v_seen_serials, v_serial);

      select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
      from public.water_meters as m where m.meter_number = v_serial limit 1;
      if v_existing_meter_id is not null then
        if v_existing_prop_id is distinct from v_prop_id then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
            'code', 'meter_number_other_apartment',
            'reason', 'meter_number_belongs_to_other_apartment',
            'apartment_number', v_apt, 'meter_number', v_serial
          ));
          continue;
        end if;
        -- Existing meter: do not wipe; optional balance only
        v_skipped := v_skipped + 1;
        v_preserved := v_preserved + 1;
        if not coalesce(p_dry_run, true)
           and v_bal_kind is not null and v_bal_kind <> 'zero'
           and not (v_prop_id = any (v_bal_done)) then
          v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
          if coalesce((v_result ->> 'applied')::boolean, false) then
            v_balances := v_balances + 1;
          end if;
          v_bal_done := array_append(v_bal_done, v_prop_id);
        end if;
        continue;
      end if;
    end if;

    if v_incomplete then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', case when v_serial is null then 'meter_number' else 'initial_reading' end,
        'code', 'needs_initial_readings', 'reason', 'needs_initial_readings',
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'severity', 'defer'
      ));
      v_deferred := v_deferred + 1;
      if coalesce(p_dry_run, true) then
        continue;
      end if;
      perform public.upsert_utility_opening_pending(
        v_prop_id, 'water', v_serial,
        jsonb_build_object(
          'initial_reading', v_reading,
          'installed_at', v_installed,
          'opening_balance_kind', v_bal_kind,
          'opening_balance_eur', v_bal_amt,
          'section_code', v_section,
          'block_code', v_block
        )
      );
      if v_bal_kind is not null and v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    -- Complete row: create meter + opening reading + confirm baseline
    if v_installed is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_water_meter(v_prop_id, v_serial, v_reading, v_installed) as m
    limit 1;

    update public.water_meters
       set opening_confirmed_at = now()
     where id = v_meter_id and opening_confirmed_at is null;

    perform public.register_water_opening_reading(
      v_prop_id, v_reading, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    -- Clear pending slot for this property/meter
    update public.utility_opening_pending u
       set status = 'confirmed', confirmed_at = now(), updated_at = now()
     where u.property_id = v_prop_id
       and u.utility = 'water'
       and u.status = 'needs_initial'
       and coalesce(nullif(btrim(u.meter_number), ''), '') = coalesce(v_serial, '');

    if v_bal_kind is not null and v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_water_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_water_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'water',
    'errors', v_errors,
    'warnings', v_warnings,
    'created_count', v_created,
    'deferred_count', v_deferred,
    'skipped_existing_count', v_skipped,
    'skipped_blank_count', v_skipped_blank,
    'preserved_count', v_preserved,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$function$;

-- >>> SOFT_IMPORT_GENERATED_BELOW

-- Electricity soft import (derived)
create or replace function public.admin_import_electricity_meters_opening(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_created int := 0;
  v_deferred int := 0;
  v_skipped int := 0;
  v_skipped_blank int := 0;
  v_preserved int := 0;
  v_balances int := 0;
  v_idx int := 0;
  v_apt text;
  v_serial text;
  v_section text;
  v_block text;
  v_fmt text;
  v_prop_id bigint;
  v_meter_id uuid;
  v_day numeric;
  v_night numeric;
  v_day_raw text;
  v_night_raw text;
  v_installed date;
  v_today date;
  v_bal_kind text;
  v_resolve_err text;
  v_bal_amt numeric;
  v_seen_serials text[] := array[]::text[];
  v_bal_done bigint[] := array[]::bigint[];
  v_bal_kind_by_prop jsonb := '{}'::jsonb;
  v_bal_amt_by_prop jsonb := '{}'::jsonb;
  v_prev_kind text;
  v_prev_amt numeric;
  v_existing_meter_id uuid;
  v_existing_prop_id bigint;
  v_result jsonb;
  v_norm_amt text;
  v_incomplete boolean;
  v_has_confirmed boolean;
  v_keys text[] := array[
    'apartment_number','section_code','block_code','meter_number','initial_day_reading','initial_night_reading',
    'installed_at','opening_balance_kind','opening_balance_eur'
  ];
begin
  perform public.admin_assert_module_setup();
  perform public.admin_assert_module_initial_setup_writable('electricity');
  if not coalesce(p_dry_run, true) then
    perform public.first_run_assert_prepared_tariff_for_opening('electricity');
  end if;
  v_today := (now() at time zone 'Europe/Sofia')::date;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_import_electricity_meters_opening: rows array required' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value)
  loop
    v_idx := v_idx + 1;
    if public.opening_import_row_is_blank(v_row, v_keys) then
      v_skipped_blank := v_skipped_blank + 1;
      continue;
    end if;

    v_apt := nullif(btrim(coalesce(v_row ->> 'apartment_number', '')), '');
    v_serial := nullif(btrim(coalesce(v_row ->> 'meter_number', '')), '');
    v_section := nullif(btrim(coalesce(v_row ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_row ->> 'block_code', '')), '');
    v_bal_kind := public.normalize_meter_opening_balance_kind(v_row ->> 'opening_balance_kind');
    v_day_raw := v_row ->> 'initial_day_reading';
    v_night_raw := v_row ->> 'initial_night_reading';

    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'apartment_number',
        'code', 'required', 'reason', 'apartment_number_required',
        'expected_format', 'apartment_2_section_b_block_3'
      ));
      continue;
    end if;

    v_fmt := public.opening_import_section_block_format_error(v_section, v_block);
    if v_fmt = 'section_block_fields_swapped' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'section_code',
        'code', 'section_block_fields_swapped', 'reason', 'section_block_fields_swapped',
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'expected_format', 'apartment_2_section_b_block_3',
        'hint', 'section_must_be_entrance_letter'
      ));
      continue;
    end if;

    select r.property_id, r.error_code into v_prop_id, v_resolve_err
    from public.resolve_property_id_for_opening_import(v_apt, v_section, v_block) as r;
    if v_resolve_err is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx,
        'field', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'section_code' else 'apartment_number' end,
        'code', v_resolve_err, 'reason', v_resolve_err,
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'expected_format', 'apartment_2_section_b_block_3',
        'hint', case when v_resolve_err = 'section_code_required_for_disambiguation' then 'fill_section_code' else null end
      ));
      continue;
    end if;

    -- Numeric-only section advisory when letter entrances exist for this apt number
    if v_fmt = 'section_code_looks_like_block_number' and v_section is not null then
      if exists (
        select 1 from public.properties p
        where lower(btrim(coalesce(p.apartment_number::text, ''))) = lower(v_apt)
          and nullif(btrim(coalesce(p.section_code, '')), '') ~* '^[A-Za-zА-Яа-яЁёІіЇїЄє]'
      ) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'section_code',
          'code', 'section_code_looks_like_block_number',
          'reason', 'section_code_looks_like_block_number',
          'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
          'expected_format', 'apartment_2_section_b_block_3',
          'hint', 'section_must_be_entrance_letter'
        ));
        continue;
      end if;
    end if;

    begin
      v_day := nullif(btrim(coalesce(v_day_raw, '')), '')::numeric;
      v_night := nullif(btrim(coalesce(v_night_raw, '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_day_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if (v_day is not null and v_day < 0) or (v_night is not null and v_night < 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'initial_day_reading',
        'code', 'invalid', 'reason', 'initial_reading_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    begin
      v_installed := nullif(btrim(coalesce(v_row ->> 'installed_at', '')), '')::date;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;
    if v_installed is not null and v_installed > v_today then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    -- Opening balance optional on soft rows; validate only when provided
    if v_bal_kind is not null and v_bal_kind not in ('zero', 'debt', 'overpayment') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
        'code', 'invalid', 'reason', 'opening_balance_kind_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    begin
      v_bal_amt := nullif(btrim(coalesce(v_row ->> 'opening_balance_eur', '')), '')::numeric;
    exception when others then
      v_bal_amt := null;
    end;
    if coalesce(v_bal_kind, 'zero') = 'zero' then
      v_bal_amt := 0;
      v_bal_kind := coalesce(v_bal_kind, 'zero');
    elsif v_bal_kind in ('debt', 'overpayment') and (v_bal_amt is null or v_bal_amt <= 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_eur',
        'code', 'invalid', 'reason', 'opening_balance_eur_required',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if v_bal_kind is not null and v_bal_kind <> 'zero' then
      v_prev_kind := nullif(v_bal_kind_by_prop ->> v_prop_id::text, '');
      if v_prev_kind is not null then
        v_prev_amt := nullif(v_bal_amt_by_prop ->> v_prop_id::text, '')::numeric;
        if v_prev_kind is distinct from v_bal_kind
           or coalesce(v_prev_amt, 0) is distinct from coalesce(v_bal_amt, 0) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'opening_balance_kind',
            'code', 'opening_balance_conflict',
            'reason', 'opening_balance_conflict_same_apartment',
            'apartment_number', v_apt
          ));
          continue;
        end if;
      else
        v_bal_kind_by_prop := jsonb_set(v_bal_kind_by_prop, array[v_prop_id::text], to_jsonb(v_bal_kind));
        v_norm_amt := coalesce(v_bal_amt, 0)::text;
        v_bal_amt_by_prop := jsonb_set(v_bal_amt_by_prop, array[v_prop_id::text], to_jsonb(v_norm_amt));
      end if;
    end if;

    v_incomplete := (v_serial is null) or (v_day is null) or (v_night is null);

    -- Preserve: blank meter/reading on re-import when property already has meter or confirmed pending
    if v_incomplete and v_serial is null and v_day is null and v_night is null then
      select exists (
        select 1 from public.electricity_meters m
        where m.property_id = v_prop_id and m.retired_at is null
      ) or exists (
        select 1 from public.utility_opening_pending u
        where u.property_id = v_prop_id and u.utility = 'electricity' and u.status = 'confirmed'
      ) into v_has_confirmed;
      if v_has_confirmed then
        v_preserved := v_preserved + 1;
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    if v_serial is not null then
      if exists (select 1 from unnest(v_seen_serials) as u(x) where lower(u.x) = lower(v_serial)) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
          'code', 'duplicate_in_file', 'reason', 'duplicate_meter_number_in_file',
          'apartment_number', v_apt, 'meter_number', v_serial
        ));
        continue;
      end if;
      v_seen_serials := array_append(v_seen_serials, v_serial);

      select m.id, m.property_id into v_existing_meter_id, v_existing_prop_id
      from public.electricity_meters as m where m.meter_number = v_serial limit 1;
      if v_existing_meter_id is not null then
        if v_existing_prop_id is distinct from v_prop_id then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'sheet', 'meters', 'row', v_idx, 'field', 'meter_number',
            'code', 'meter_number_other_apartment',
            'reason', 'meter_number_belongs_to_other_apartment',
            'apartment_number', v_apt, 'meter_number', v_serial
          ));
          continue;
        end if;
        -- Existing meter: do not wipe; optional balance only
        v_skipped := v_skipped + 1;
        v_preserved := v_preserved + 1;
        if not coalesce(p_dry_run, true)
           and v_bal_kind is not null and v_bal_kind <> 'zero'
           and not (v_prop_id = any (v_bal_done)) then
          v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
          if coalesce((v_result ->> 'applied')::boolean, false) then
            v_balances := v_balances + 1;
          end if;
          v_bal_done := array_append(v_bal_done, v_prop_id);
        end if;
        continue;
      end if;
    end if;

    if v_incomplete then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', case
          when v_serial is null then 'meter_number'
          when v_day is null then 'initial_day_reading'
          else 'initial_night_reading'
        end,
        'code', 'needs_initial_readings', 'reason', 'needs_initial_readings',
        'apartment_number', v_apt, 'section_code', v_section, 'block_code', v_block,
        'severity', 'defer'
      ));
      v_deferred := v_deferred + 1;
      if coalesce(p_dry_run, true) then
        continue;
      end if;
      perform public.upsert_utility_opening_pending(
        v_prop_id, 'electricity', v_serial,
        jsonb_build_object(
          'initial_day_reading', v_day,
          'initial_night_reading', v_night,
          'installed_at', v_installed,
          'opening_balance_kind', v_bal_kind,
          'opening_balance_eur', v_bal_amt,
          'section_code', v_section,
          'block_code', v_block
        )
      );
      if v_bal_kind is not null and v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
        v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
        if coalesce((v_result ->> 'applied')::boolean, false) then
          v_balances := v_balances + 1;
        end if;
        v_bal_done := array_append(v_bal_done, v_prop_id);
      end if;
      continue;
    end if;

    -- Complete row: create meter + opening reading + confirm baseline
    if v_installed is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'meters', 'row', v_idx, 'field', 'installed_at',
        'code', 'invalid', 'reason', 'installed_at_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    select m.id into v_meter_id
    from public.assign_electricity_meter(v_prop_id, v_serial, v_day, v_night, v_installed) as m
    limit 1;

    update public.electricity_meters
       set opening_confirmed_at = now()
     where id = v_meter_id and opening_confirmed_at is null;

    perform public.register_electricity_opening_reading(
      v_prop_id, v_day, v_night, v_installed, 'first_run_opening', gen_random_uuid(), v_meter_id
    );
    v_created := v_created + 1;

    -- Clear pending slot for this property/meter
    update public.utility_opening_pending u
       set status = 'confirmed', confirmed_at = now(), updated_at = now()
     where u.property_id = v_prop_id
       and u.utility = 'electricity'
       and u.status = 'needs_initial'
       and coalesce(nullif(btrim(u.meter_number), ''), '') = coalesce(v_serial, '');

    if v_bal_kind is not null and v_bal_kind <> 'zero' and not (v_prop_id = any (v_bal_done)) then
      v_result := public.register_electricity_opening_balance(v_prop_id, v_bal_kind, v_bal_amt, null);
      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_balances := v_balances + 1;
      end if;
      v_bal_done := array_append(v_bal_done, v_prop_id);
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_electricity_meters_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'utility', 'electricity',
    'errors', v_errors,
    'warnings', v_warnings,
    'created_count', v_created,
    'deferred_count', v_deferred,
    'skipped_existing_count', v_skipped,
    'skipped_blank_count', v_skipped_blank,
    'preserved_count', v_preserved,
    'opening_balances_applied', v_balances,
    'charges_generated', false
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- Confirm baseline (admin card)
-- ---------------------------------------------------------------------------
alter table public.internet_subscriptions
  add column if not exists opening_confirmed_at timestamptz;

update public.internet_subscriptions
   set opening_confirmed_at = coalesce(opening_confirmed_at, created_at, now())
 where opening_confirmed_at is null;

comment on column public.internet_subscriptions.opening_confirmed_at is
  'When set, automatic internet billing may start. Null = needs initial state confirmation.';

create or replace function public.admin_confirm_water_opening(
  p_property_id bigint,
  p_meter_number text,
  p_initial_reading numeric,
  p_installed_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_email text := auth.email();
  v_meter_id uuid;
  v_installed date := coalesce(p_installed_at, (now() at time zone 'Europe/Sofia')::date);
  v_serial text := nullif(btrim(coalesce(p_meter_number, '')), '');
begin
  if auth.uid() is null then
    raise exception 'admin_confirm_water_opening: authentication required' using errcode = '42501';
  end if;
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'admin_confirm_water_opening: not allowed' using errcode = '42501';
  end if;
  if v_serial is null then
    raise exception 'admin_confirm_water_opening: meter_number required' using errcode = '22023';
  end if;
  if p_initial_reading is null or p_initial_reading < 0 then
    raise exception 'admin_confirm_water_opening: initial_reading invalid' using errcode = '22023';
  end if;

  select m.id into v_meter_id
  from public.assign_water_meter(p_property_id, v_serial, p_initial_reading, v_installed) as m
  limit 1;

  update public.water_meters
     set opening_confirmed_at = now()
   where id = v_meter_id;

  -- Ensure opening reading exists (idempotent register)
  perform public.register_water_opening_reading(
    p_property_id, p_initial_reading, v_installed,
    'admin_confirm_opening', gen_random_uuid(), v_meter_id
  );

  update public.utility_opening_pending u
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_email = v_email,
         updated_at = now(),
         meter_number = v_serial,
         payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
           'initial_reading', p_initial_reading,
           'installed_at', v_installed
         )
   where u.property_id = p_property_id
     and u.utility = 'water'
     and u.status = 'needs_initial';

  return jsonb_build_object(
    'ok', true,
    'utility', 'water',
    'property_id', p_property_id,
    'meter_id', v_meter_id,
    'opening_confirmed_at', now(),
    'charges_generated', false
  );
end;
$fn$;

create or replace function public.admin_confirm_electricity_opening(
  p_property_id bigint,
  p_meter_number text,
  p_initial_day_reading numeric,
  p_initial_night_reading numeric,
  p_installed_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_email text := auth.email();
  v_meter_id uuid;
  v_installed date := coalesce(p_installed_at, (now() at time zone 'Europe/Sofia')::date);
  v_serial text := nullif(btrim(coalesce(p_meter_number, '')), '');
begin
  if auth.uid() is null then
    raise exception 'admin_confirm_electricity_opening: authentication required' using errcode = '42501';
  end if;
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('инженер')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'admin_confirm_electricity_opening: not allowed' using errcode = '42501';
  end if;
  if v_serial is null then
    raise exception 'admin_confirm_electricity_opening: meter_number required' using errcode = '22023';
  end if;
  if p_initial_day_reading is null or p_initial_day_reading < 0
     or p_initial_night_reading is null or p_initial_night_reading < 0 then
    raise exception 'admin_confirm_electricity_opening: initial readings invalid' using errcode = '22023';
  end if;

  select m.id into v_meter_id
  from public.assign_electricity_meter(
    p_property_id, v_serial, p_initial_day_reading, p_initial_night_reading, v_installed
  ) as m
  limit 1;

  update public.electricity_meters
     set opening_confirmed_at = now()
   where id = v_meter_id;

  perform public.register_electricity_opening_reading(
    p_property_id, p_initial_day_reading, p_initial_night_reading, v_installed,
    'admin_confirm_opening', gen_random_uuid(), v_meter_id
  );

  update public.utility_opening_pending u
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_email = v_email,
         updated_at = now(),
         meter_number = v_serial,
         payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
           'initial_day_reading', p_initial_day_reading,
           'initial_night_reading', p_initial_night_reading,
           'installed_at', v_installed
         )
   where u.property_id = p_property_id
     and u.utility = 'electricity'
     and u.status = 'needs_initial';

  return jsonb_build_object(
    'ok', true,
    'utility', 'electricity',
    'property_id', p_property_id,
    'meter_id', v_meter_id,
    'opening_confirmed_at', now(),
    'charges_generated', false
  );
end;
$fn$;

create or replace function public.admin_confirm_internet_opening(
  p_property_id bigint,
  p_connection_state text,
  p_connection_date date default null,
  p_transition_date date default null,
  p_paid_through date default null,
  p_opening_debt numeric default 0,
  p_opening_credit numeric default 0,
  p_source_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_email text := auth.email();
  v_state text;
  v_res jsonb;
  v_raw text := lower(btrim(coalesce(p_connection_state, '')));
begin
  if auth.uid() is null then
    raise exception 'admin_confirm_internet_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_confirm_internet_opening: not allowed' using errcode = '42501';
  end if;

  if v_raw in ('active', 'connected', 'подключён', 'подключен', 'активен', 'включен') then
    v_state := 'active';
  elsif v_raw in (
    'inactive', 'disconnected', 'отключён', 'отключен', 'неактивен', 'изключен',
    'не подключён', 'не подключен', 'not connected', 'не е свързан', 'несвързан'
  ) then
    v_state := 'inactive';
  else
    raise exception 'admin_confirm_internet_opening: invalid connection_state' using errcode = '22023';
  end if;

  v_res := public.internet_opening_apply(
    p_property_id, v_state, 'internet', p_connection_date, p_transition_date,
    p_paid_through, '[]'::jsonb,
    coalesce(p_opening_debt, 0), coalesce(p_opening_credit, 0),
    p_source_reference, p_notes, gen_random_uuid(), gen_random_uuid(), true, false
  );

  update public.internet_subscriptions s
     set opening_confirmed_at = coalesce(s.opening_confirmed_at, now())
   where s.property_id = p_property_id;

  update public.utility_opening_pending u
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_email = v_email,
         updated_at = now(),
         payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
           'connection_state', v_state,
           'connection_date', p_connection_date
         )
   where u.property_id = p_property_id
     and u.utility = 'internet'
     and u.status = 'needs_initial';

  return jsonb_build_object(
    'ok', true,
    'utility', 'internet',
    'property_id', p_property_id,
    'connection_state', v_state,
    'opening_confirmed_at', now(),
    'apply', v_res,
    'charges_generated', false
  );
end;
$fn$;

revoke all on function public.admin_confirm_water_opening(bigint, text, numeric, date) from public, anon;
grant execute on function public.admin_confirm_water_opening(bigint, text, numeric, date) to authenticated;
revoke all on function public.admin_confirm_electricity_opening(bigint, text, numeric, numeric, date) from public, anon;
grant execute on function public.admin_confirm_electricity_opening(bigint, text, numeric, numeric, date) to authenticated;
revoke all on function public.admin_confirm_internet_opening(bigint, text, date, date, date, numeric, numeric, text, text) from public, anon;
grant execute on function public.admin_confirm_internet_opening(bigint, text, date, date, date, numeric, numeric, text, text) to authenticated;

-- Gate automatic internet charges until opening confirmed
create or replace function public.internet_opening_is_billing_ready(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path to public
as $fn$
  select exists (
    select 1
    from public.internet_subscriptions s
    where s.property_id = p_property_id
      and s.opening_confirmed_at is not null
  )
  and not exists (
    select 1
    from public.utility_opening_pending u
    where u.property_id = p_property_id
      and u.utility = 'internet'
      and u.status = 'needs_initial'
  );
$fn$;

revoke all on function public.internet_opening_is_billing_ready(bigint) from public, anon;
grant execute on function public.internet_opening_is_billing_ready(bigint) to authenticated;

create or replace function public.list_utility_opening_pending(p_utility text default null)
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  section_code text,
  block_code text,
  utility text,
  meter_number text,
  payload jsonb,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to public
as $fn$
  select
    u.id,
    u.property_id,
    p.apartment_number::text,
    p.section_code,
    p.block_code,
    u.utility,
    u.meter_number,
    u.payload,
    u.status,
    u.created_at,
    u.updated_at
  from public.utility_opening_pending u
  join public.properties p on p.id = u.property_id
  where u.status = 'needs_initial'
    and (p_utility is null or u.utility = p_utility)
    and (
      public.has_staff_role('администрация')
      or public.has_staff_role('инженер')
      or public.has_staff_role('бухгалтер')
    )
  order by p.apartment_number, p.section_code, p.block_code, u.utility;
$fn$;

revoke all on function public.list_utility_opening_pending(text) from public, anon;
grant execute on function public.list_utility_opening_pending(text) to authenticated;


-- Internet soft import
CREATE OR REPLACE FUNCTION public.admin_import_internet_opening(p_rows jsonb, p_dry_run boolean DEFAULT true, p_confirm_corrections boolean DEFAULT false, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := auth.email();
  v_dry boolean := coalesce(p_dry_run, true);
  v_confirm boolean := coalesce(p_confirm_corrections, false);
  v_batch uuid := coalesce(p_batch_id, gen_random_uuid());
  v_today date := public.tariff_sofia_today();
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_parsed jsonb := '[]'::jsonb;
  v_tainted bigint[] := '{}';
  v_elem jsonb;
  v_idx integer := 0;
  v_row_num integer;
  v_codes text[];
  v_apt text;
  v_property_id bigint;
  v_resolve_err text;
  v_raw text;
  v_state text;
  v_conn date;
  v_pstart date;
  v_pend date;
  v_trans date;
  v_debt numeric;
  v_credit numeric;
  v_src text;
  v_notes text;
  v_idem uuid;
  v_g record;
  v_n_state integer;
  v_n_conn integer;
  v_n_trans integer;
  v_n_debt integer;
  v_n_credit integer;
  v_n_idem integer;
  v_n_full integer;
  v_n_only integer;
  v_n_only_distinct integer;
  v_periods jsonb;
  v_paid_through date;
  v_min_start date;
  v_max_end date;
  v_has_gap boolean;
  v_covers_today boolean;
  v_pay_status text;
  v_warnings text[];
  v_billing_mode text;
  v_res jsonb;
  v_outcome text;
  v_failed boolean;
  v_reason text;
  v_msg text;
  v_row jsonb;
  v_pid bigint;
  v_summary jsonb;
begin

  perform public.admin_assert_module_initial_setup_writable('internet');  if auth.uid() is null or v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'admin_import_internet_opening: authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_import_internet_opening: not allowed' using errcode = '42501';
  end if;

  if not v_dry then
    perform public.first_run_assert_prepared_tariff_for_opening('internet');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'admin_import_internet_opening: rows array required' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    if v_dry then
      return jsonb_build_object(
        'ok', false,
        'dry_run', true,
        'batch_id', v_batch,
        'row_count', 0,
        'errors', jsonb_build_array(jsonb_build_object(
          'row', 0, 'field', 'rows', 'reason', 'empty_batch',
          'codes', jsonb_build_array('empty_batch')
        )),
        'rows', '[]'::jsonb,
        'summary', jsonb_build_object(
          'as_of', v_today, 'total', 0, 'active', 0, 'inactive', 0,
          'paid_active', 0, 'paid_expired', 0, 'paid_unknown', 0, 'paid_future', 0,
          'debt_sum', 0, 'credit_sum', 0,
          'create_count', 0, 'skip_count', 0, 'correct_count', 0, 'error_count', 1
        ),
        'synthetic_payments', false,
        'charges_generated', false,
        'work_orders_created', false
      );
    end if;
    raise exception 'admin_import_internet_opening: empty batch not allowed' using errcode = '22023';
  end if;

  -- -------------------------------------------------------------------------
  -- Pass 1: parse and validate each input row
  -- -------------------------------------------------------------------------
  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_codes := '{}';
    v_property_id := null;
    v_state := null;
    v_conn := null;
    v_pstart := null;
    v_pend := null;
    v_trans := null;
    v_debt := null;
    v_credit := null;
    v_idem := null;

    if jsonb_typeof(v_elem) is distinct from 'object' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_idx + 1,
        'apartment_number', '',
        'codes', jsonb_build_array('invalid:row_not_object'),
        'reason', 'invalid:row_not_object',
        'field', 'internet_opening'
      ));
      continue;
    end if;

    if public.opening_import_row_is_blank(v_elem, array[
      'apartment_number','apartmentNumber','apartment','apt',
      'section_code','sectionCode','section','entrance',
      'block_code','blockCode','block',
      'connection_state','connectionState','status',
      'connection_date','connectionDate',
      'paid_period_start','paidPeriodStart',
      'paid_period_end','paidPeriodEnd','paid_through','paidThrough',
      'transition_date','transitionDate',
      'opening_debt','openingDebt','debt',
      'opening_credit','openingCredit','opening_overpayment','openingOverpayment','overpayment'
    ]) then
      continue;
    end if;

    v_row_num := coalesce(
      public.internet_opening_try_numeric(
        public.internet_opening_pick(v_elem, array['rowNumber', 'row_number', 'row'])
      )::integer,
      v_idx + 1
    );

    v_apt := public.internet_opening_pick(
      v_elem, array['apartment_number', 'apartmentNumber', 'apartment', 'apt']
    );
    if v_apt is null then
      v_codes := array_append(v_codes, 'required:apartment_number');
    else
      select r.property_id, r.error_code into v_property_id, v_resolve_err
      from public.resolve_property_id_for_opening_import(
        v_apt,
        public.internet_opening_pick(v_elem, array['section_code', 'sectionCode', 'section', 'entrance']),
        public.internet_opening_pick(v_elem, array['block_code', 'blockCode', 'block'])
      ) as r;
      if v_resolve_err is not null then
        v_codes := array_append(v_codes, v_resolve_err);
      end if;
    end if;

    -- connection state (aliases; anything else is rejected)
    v_raw := public.internet_opening_pick(
      v_elem, array['connection_state', 'connectionState', 'status']
    );
    if v_raw is not null then
      if lower(v_raw) in ('active', 'connected', 'подключён', 'подключен', 'активен', 'включен')
         or v_raw in ('Подключён', 'Подключен') then
        v_state := 'active';
      elsif lower(v_raw) in (
           'inactive', 'disconnected', 'отключён', 'отключен', 'неактивен', 'изключен',
           'не подключён', 'не подключен', 'not connected', 'не е свързан', 'несвързан'
         )
         or v_raw in ('Отключён', 'Отключен', 'Не подключён', 'Не подключен') then
        v_state := 'inactive';
      else
        v_codes := array_append(v_codes, 'invalid:connection_state');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['tariff_code', 'tariffCode', 'tariff_key']);
    if v_raw is not null and lower(v_raw) is distinct from 'internet' then
      v_codes := array_append(v_codes, 'unsupported:tariff_code');
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['connection_date', 'connectionDate']);
    if v_raw is not null then
      v_conn := public.internet_opening_try_date(v_raw);
      if v_conn is null then
        v_codes := array_append(v_codes, 'invalid:connection_date');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['paid_period_start', 'paidPeriodStart']);
    if v_raw is not null then
      v_pstart := public.internet_opening_try_date(v_raw);
      if v_pstart is null then
        v_codes := array_append(v_codes, 'invalid:paid_period_start');
      end if;
    end if;

    v_raw := public.internet_opening_pick(
      v_elem, array['paid_period_end', 'paidPeriodEnd', 'paid_through', 'paidThrough']
    );
    if v_raw is not null then
      v_pend := public.internet_opening_try_date(v_raw);
      if v_pend is null then
        v_codes := array_append(v_codes, 'invalid:paid_period_end');
      end if;
    end if;

    if v_pstart is not null and v_pend is null
       and public.internet_opening_pick(
         v_elem, array['paid_period_end', 'paidPeriodEnd', 'paid_through', 'paidThrough']
       ) is null then
      v_codes := array_append(v_codes, 'incomplete:paid_period_end');
    end if;
    if v_pstart is not null and v_pend is not null and v_pstart > v_pend then
      v_codes := array_append(v_codes, 'invalid:paid_period_range');
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['transition_date', 'transitionDate']);
    if v_raw is not null then
      v_trans := public.internet_opening_try_date(v_raw);
      if v_trans is null then
        v_codes := array_append(v_codes, 'invalid:transition_date');
      elsif v_trans > v_today then
        v_codes := array_append(v_codes, 'invalid:transition_date_future');
      end if;
    end if;

    v_raw := public.internet_opening_pick(v_elem, array['opening_debt', 'openingDebt', 'debt']);
    if v_raw is not null then
      v_debt := public.internet_opening_try_numeric(v_raw);
      if v_debt is null then
        v_codes := array_append(v_codes, 'invalid:opening_debt');
      elsif v_debt < 0 then
        v_codes := array_append(v_codes, 'negative:opening_debt');
      else
        v_debt := round(v_debt, 2);
      end if;
    end if;

    v_raw := public.internet_opening_pick(
      v_elem,
      array['opening_credit', 'openingCredit', 'opening_overpayment', 'openingOverpayment', 'overpayment']
    );
    if v_raw is not null then
      v_credit := public.internet_opening_try_numeric(v_raw);
      if v_credit is null then
        v_codes := array_append(v_codes, 'invalid:opening_credit');
      elsif v_credit < 0 then
        v_codes := array_append(v_codes, 'negative:opening_credit');
      else
        v_credit := round(v_credit, 2);
      end if;
    end if;
    -- Debt and overpayment may both be present: separate opening_debit / opening_credit rows (no netting).

    v_src := public.internet_opening_pick(v_elem, array['source_reference', 'sourceReference']);
    v_notes := public.internet_opening_pick(v_elem, array['comment', 'notes', 'note']);

    v_raw := public.internet_opening_pick(v_elem, array['idempotency_key', 'idempotencyKey']);
    if v_raw is not null then
      begin
        v_idem := v_raw::uuid;
      exception
        when others then
          v_codes := array_append(v_codes, 'invalid:idempotency_key');
      end;
    end if;

    if coalesce(array_length(v_codes, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'apartment_number', coalesce(v_apt, ''),
        'property_id', v_property_id,
        'codes', to_jsonb(v_codes),
        'reason', v_codes[1],
        'field', 'internet_opening'
      ));
      if v_property_id is not null then
        v_tainted := array_append(v_tainted, v_property_id);
      end if;
      continue;
    end if;

    v_parsed := v_parsed || jsonb_build_array(jsonb_build_object(
      'row', v_row_num,
      'property_id', v_property_id,
      'state', v_state,
      'conn', v_conn,
      'pstart', v_pstart,
      'pend', v_pend,
      'trans', v_trans,
      'debt', v_debt,
      'credit', v_credit,
      'src', v_src,
      'notes', v_notes,
      'idem', v_idem
    ));
  end loop;

  -- -------------------------------------------------------------------------
  -- Pass 2: merge rows per apartment, classify, optionally apply
  -- -------------------------------------------------------------------------
  for v_g in
    select
      (r ->> 'property_id')::bigint as pid,
      min((r ->> 'row')::integer) as first_row,
      jsonb_agg(r order by (r ->> 'row')::integer) as grp_rows
    from jsonb_array_elements(v_parsed) as r
    group by 1
    order by 2
  loop
    if v_g.pid = any (v_tainted) then
      continue;
    end if;

    v_codes := '{}';
    v_failed := false;
    v_warnings := '{}';
    v_apt := (select p.apartment_number from public.properties as p where p.id = v_g.pid);

    select
      count(distinct r ->> 'state'),
      count(distinct r ->> 'conn'),
      count(distinct r ->> 'trans'),
      count(distinct (r ->> 'debt')::numeric),
      count(distinct (r ->> 'credit')::numeric),
      count(distinct r ->> 'idem'),
      min(r ->> 'state'),
      min(r ->> 'conn')::date,
      min(r ->> 'trans')::date,
      min((r ->> 'debt')::numeric),
      min((r ->> 'credit')::numeric),
      min(r ->> 'idem')::uuid,
      (array_agg(r ->> 'src' order by (r ->> 'row')::integer)
         filter (where r ->> 'src' is not null))[1],
      string_agg(distinct r ->> 'notes', ' | ') filter (where r ->> 'notes' is not null),
      count(*) filter (where r ->> 'pstart' is not null),
      count(*) filter (where r ->> 'pstart' is null and r ->> 'pend' is not null),
      count(distinct r ->> 'pend') filter (where r ->> 'pstart' is null),
      max(r ->> 'pend') filter (where r ->> 'pstart' is null)
    into
      v_n_state, v_n_conn, v_n_trans, v_n_debt, v_n_credit, v_n_idem,
      v_state, v_conn, v_trans, v_debt, v_credit, v_idem,
      v_src, v_notes,
      v_n_full, v_n_only, v_n_only_distinct, v_raw
    from jsonb_array_elements(v_g.grp_rows) as r;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object('start', r ->> 'pstart', 'end', r ->> 'pend')
          order by (r ->> 'pstart')::date
        ) filter (where r ->> 'pstart' is not null),
        '[]'::jsonb
      )
    into v_periods
    from jsonb_array_elements(v_g.grp_rows) as r;

    if v_n_state > 1 then
      v_codes := array_append(v_codes, 'inconsistent:connection_state');
    elsif v_state is null then
      if exists (
        select 1 from public.internet_subscriptions s
        where s.property_id = v_g.pid and s.opening_confirmed_at is not null
      ) or exists (
        select 1 from public.utility_opening_pending u
        where u.property_id = v_g.pid and u.utility = 'internet' and u.status = 'confirmed'
      ) then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'property_id', v_g.pid,
          'outcome', 'SKIP',
          'status', null,
          'warnings', jsonb_build_array('preserved_confirmed_internet_state'),
          'applied', false
        ));
        continue;
      end if;

      v_warnings := array_append(v_warnings, 'needs_initial_internet_state');
      if not v_dry then
        perform public.upsert_utility_opening_pending(
          v_g.pid, 'internet', null,
          jsonb_build_object(
            'debt', v_debt,
            'credit', v_credit,
            'conn', v_conn,
            'trans', v_trans,
            'periods', v_periods
          )
        );
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'DEFER',
        'status', null,
        'warnings', to_jsonb(v_warnings),
        'applied', not v_dry
      ));
      continue;
    end if;
    if v_n_conn > 1 then
      v_codes := array_append(v_codes, 'inconsistent:connection_date');
    end if;
    if v_n_trans > 1 then
      v_codes := array_append(v_codes, 'inconsistent:transition_date');
    end if;
    if v_n_debt > 1 then
      v_codes := array_append(v_codes, 'inconsistent:opening_debt');
    end if;
    if v_n_credit > 1 then
      v_codes := array_append(v_codes, 'inconsistent:opening_credit');
    end if;
    if v_n_idem > 1 then
      v_codes := array_append(v_codes, 'inconsistent:idempotency_key');
    end if;
    -- Debt and overpayment may both be present: separate opening_debit / opening_credit rows (no netting).
    if v_n_full > 0 and v_n_only > 0 then
      v_codes := array_append(v_codes, 'mixed:paid_through_only_and_periods');
    end if;
    if v_n_only_distinct > 1 then
      v_codes := array_append(v_codes, 'inconsistent:paid_through');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_periods) with ordinality as a(v, n)
      join jsonb_array_elements(v_periods) with ordinality as b(v, n) on a.n < b.n
      where daterange((a.v ->> 'start')::date, (a.v ->> 'end')::date, '[]')
            && daterange((b.v ->> 'start')::date, (b.v ->> 'end')::date, '[]')
    ) then
      v_codes := array_append(v_codes, 'overlapping_paid_periods');
    end if;

    if coalesce(array_length(v_codes, 1), 0) > 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', to_jsonb(v_codes),
        'reason', v_codes[1],
        'field', 'internet_opening'
      ));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'ERROR',
        'reasons', to_jsonb(v_codes)
      ));
      continue;
    end if;

    v_debt := coalesce(v_debt, 0);
    v_credit := coalesce(v_credit, 0);

    if jsonb_array_length(v_periods) > 0 then
      select min((x ->> 'start')::date), max((x ->> 'end')::date)
        into v_min_start, v_max_end
      from jsonb_array_elements(v_periods) as x;
      v_paid_through := v_max_end;
    else
      v_min_start := null;
      v_max_end := null;
      v_paid_through := nullif(v_raw, '')::date;
    end if;

    v_idem := coalesce(v_idem, gen_random_uuid());

    -- Classification (no writes). allow_correction = true so CORRECT is detectable.
    begin
      v_res := public.internet_opening_apply(
        v_g.pid, v_state, 'internet', v_conn, v_trans, v_paid_through, v_periods,
        v_debt, v_credit, v_src, v_notes, v_idem, v_batch, true, true
      );
      v_outcome := v_res ->> 'outcome';
    exception
      when others then
        v_failed := true;
        v_msg := SQLERRM;
        v_reason := btrim(
          regexp_replace(
            lower(regexp_replace(v_msg, '^[a-z_]+:\s*', '')),
            '[^a-z0-9]+', '_', 'g'
          ),
          '_'
        );
    end;

    if v_failed then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', jsonb_build_array(v_reason),
        'reason', v_reason,
        'message', v_msg,
        'field', 'internet_opening'
      ));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'property_id', v_g.pid,
        'outcome', 'ERROR',
        'reasons', jsonb_build_array(v_reason)
      ));
      continue;
    end if;

    -- Payment status as of Sofia today
    if jsonb_array_length(v_periods) > 0 then
      select exists (
        select 1
        from jsonb_array_elements(v_periods) as x
        where (x ->> 'start')::date <= v_today and (x ->> 'end')::date >= v_today
      ) into v_covers_today;
      select exists (
        select 1
        from (
          select (t.v ->> 'start')::date as s,
                 lag((t.v ->> 'end')::date) over (order by (t.v ->> 'start')::date) as pe
          from jsonb_array_elements(v_periods) as t(v)
        ) as q
        where q.pe is not null and q.s > q.pe + 1
      ) into v_has_gap;

      if v_covers_today then
        v_pay_status := 'active_paid';
      elsif v_max_end < v_today then
        v_pay_status := 'expired';
      elsif v_min_start > v_today then
        v_pay_status := 'future';
      else
        v_pay_status := 'expired';
        v_warnings := array_append(v_warnings, 'paid_period_gap_today');
      end if;
      if v_has_gap then
        v_warnings := array_append(v_warnings, 'paid_period_gap');
      end if;
    elsif v_paid_through is not null then
      v_pay_status := case when v_today <= v_paid_through then 'active_paid' else 'expired' end;
      v_warnings := array_append(v_warnings, 'paid_through_only_no_period_start');
    else
      v_pay_status := 'unknown';
      v_warnings := array_append(v_warnings, 'payment_unknown');
    end if;

    if v_conn is null then
      v_warnings := array_append(v_warnings, 'connection_date_unknown');
    end if;
    -- next_charge_on is only meaningful for legacy monthly billing.
    -- prepaid_period (package_30/day opening) never schedules monthly charges — not a warning.
    v_billing_mode := public.internet_opening_choose_billing_mode(
      nullif(v_res ->> 'billing_mode', ''),
      v_outcome = 'CREATE',
      v_today
    );
    if v_billing_mode = 'monthly'
       and v_state = 'active'
       and v_paid_through is not null
       and (v_res ->> 'next_charge_on') is null then
      if v_paid_through < v_today then
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_period_expired');
      elsif v_paid_through = v_today then
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_today');
      else
        v_warnings := array_append(v_warnings, 'next_charge_not_scheduled_paid_through_not_after_today');
      end if;
    end if;
    if v_state = 'inactive' and v_pay_status = 'active_paid' then
      v_warnings := array_append(v_warnings, 'inactive_with_active_paid_period');
    end if;

    -- Corrections need explicit confirmation (dry-run previews the apply result).
    if v_outcome = 'CORRECT' and not v_confirm then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_g.first_row,
        'apartment_number', v_apt,
        'codes', jsonb_build_array('opening_correction_requires_confirm'),
        'reason', 'opening_correction_requires_confirm',
        'field', 'internet_opening'
      ));
    elsif not v_dry and v_outcome in ('CREATE', 'CORRECT') then
      begin
        v_res := public.internet_opening_apply(
          v_g.pid, v_state, 'internet', v_conn, v_trans, v_paid_through, v_periods,
          v_debt, v_credit, v_src, v_notes, v_idem, v_batch, v_confirm, false
        );
        update public.internet_subscriptions s
           set opening_confirmed_at = coalesce(s.opening_confirmed_at, now())
         where s.property_id = v_g.pid;
        update public.utility_opening_pending u
           set status = 'confirmed', confirmed_at = now(), updated_at = now()
         where u.property_id = v_g.pid and u.utility = 'internet' and u.status = 'needs_initial';
      exception
        when others then
          v_failed := true;
          v_msg := SQLERRM;
          v_reason := btrim(
            regexp_replace(
              lower(regexp_replace(v_msg, '^[a-z_]+:\s*', '')),
              '[^a-z0-9]+', '_', 'g'
            ),
            '_'
          );
      end;
      if v_failed then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'codes', jsonb_build_array(v_reason),
          'reason', v_reason,
          'message', v_msg,
          'field', 'internet_opening'
        ));
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'row', v_g.first_row,
          'apartment_number', v_apt,
          'property_id', v_g.pid,
          'outcome', 'ERROR',
          'reasons', jsonb_build_array(v_reason)
        ));
        continue;
      end if;
    end if;

    v_row := jsonb_build_object(
      'row', v_g.first_row,
      'apartment_number', v_apt,
      'property_id', v_g.pid,
      'outcome', v_outcome,
      'status', v_state,
      'connection_date', v_conn,
      'paid_period_start', v_min_start,
      'paid_period_end', v_paid_through,
      'periods', v_periods,
      'payment_status', v_pay_status,
      'payment_status_as_of', v_today,
      'opening_debt', v_debt,
      'opening_credit', v_credit,
      'next_charge_on', v_res -> 'next_charge_on',
      'billing_mode', to_jsonb(v_billing_mode),
      'warnings', to_jsonb(v_warnings),
      'applied', coalesce((v_res ->> 'applied')::boolean, false),
      'import_id', v_res -> 'import_id'
    );
    if v_outcome = 'CORRECT' then
      v_row := v_row || jsonb_build_object('was', v_res -> 'was', 'will', v_res -> 'will');
    end if;
    v_results := v_results || jsonb_build_array(v_row);
  end loop;

  -- Apartments whose input rows were invalid get an ERROR row each.
  for v_pid in select distinct t from unnest(v_tainted) as t
  loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', (
        select min((e ->> 'row')::integer)
        from jsonb_array_elements(v_errors) as e
        where (e ->> 'property_id')::bigint = v_pid
      ),
      'apartment_number', (select p.apartment_number from public.properties as p where p.id = v_pid),
      'property_id', v_pid,
      'outcome', 'ERROR',
      'reasons', coalesce((
        select jsonb_agg(distinct e ->> 'reason')
        from jsonb_array_elements(v_errors) as e
        where (e ->> 'property_id')::bigint = v_pid
      ), '[]'::jsonb)
    ));
  end loop;

  select jsonb_build_object(
    'as_of', v_today,
    'total', count(*),
    'active', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'status' = 'active'),
    'inactive', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'status' = 'inactive'),
    'paid_active', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'active_paid'),
    'paid_expired', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'expired'),
    'paid_unknown', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'unknown'),
    'paid_future', count(*) filter (where r ->> 'outcome' <> 'ERROR' and r ->> 'payment_status' = 'future'),
    'debt_sum', coalesce(sum((r ->> 'opening_debt')::numeric) filter (where r ->> 'outcome' <> 'ERROR'), 0),
    'credit_sum', coalesce(sum((r ->> 'opening_credit')::numeric) filter (where r ->> 'outcome' <> 'ERROR'), 0),
    'create_count', count(*) filter (where r ->> 'outcome' = 'CREATE'),
    'skip_count', count(*) filter (where r ->> 'outcome' = 'SKIP'),
    'correct_count', count(*) filter (where r ->> 'outcome' = 'CORRECT'),
    'defer_count', count(*) filter (where r ->> 'outcome' = 'DEFER'),
    'error_count', jsonb_array_length(v_errors)
  )
  into v_summary
  from jsonb_array_elements(v_results) as r;

  if not v_dry and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_internet_opening: apply aborted - % errors',
      jsonb_array_length(v_errors)
      using errcode = 'P0001', detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'dry_run', v_dry,
    'batch_id', v_batch,
    'row_count', jsonb_array_length(p_rows),
    'errors', v_errors,
    'rows', v_results,
    'summary', v_summary,
    'synthetic_payments', false,
    'charges_generated', false,
    'work_orders_created', false
  );
end;
$function$;
-- Gate automatic internet charges until opening confirmed
create or replace function public.internet_insert_charge(
  p_property_id bigint,
  p_days integer,
  p_amount numeric,
  p_tariff_version_id uuid,
  p_note text,
  p_email text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.internet_ledger%rowtype;
  v_amount numeric;
  v_note text;
begin
  if not public.internet_opening_is_billing_ready(p_property_id) then
    raise exception 'internet_opening_not_confirmed'
      using errcode = 'P0001';
  end if;

  v_amount := round(p_amount, 2);
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  if p_idempotency_key is not null then
    select l.* into v_row
    from public.internet_ledger as l
    where l.idempotency_key = p_idempotency_key;
    if found then
      if v_row.property_id is distinct from p_property_id
         or v_row.kind is distinct from 'charge'
         or v_row.amount_eur is distinct from v_amount then
        raise exception 'Idempotency key conflict.';
      end if;
      return v_row.id;
    end if;
  end if;

  insert into public.internet_ledger (
    property_id, kind, amount_eur, period_days, tariff_version_id,
    note, recorded_by_email, idempotency_key
  ) values (
    p_property_id, 'charge', v_amount, p_days, p_tariff_version_id,
    v_note, p_email, coalesce(p_idempotency_key, gen_random_uuid())
  )
  returning id into v_row.id;

  return v_row.id;
end;
$fn$;
