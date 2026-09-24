import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';
const NEW_STATUS = '\u043d\u043e\u0432\u0430\u044f';
const BOOK_CAT = '\u043a\u043d\u0438\u0433\u0430';
const BOOK_SUBJECT = '\u041a\u043d\u0438\u0433\u0430 \u044d\u0442\u0430\u0436\u043d\u043e\u0439 \u0441\u043e\u0431\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u0438';
const PRIORITY_MID = '\u0441\u0440\u0435\u0434\u043d\u0438\u0439';

const hotfix = `-- =============================================================================
-- AMADEUS 11 — property registry / condominium book (ЗУЕС) foundation
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Does not alter finance, meters, polls, owns_property(), owner_email auth,
-- or occupancy_status / occupant_* residency columns.
-- Does not backfill purpose, ideal parts, people, or animals.
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'Pre-flight failed: public.has_staff_role(text) does not exist.';
  end if;
  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;
  if to_regclass('public.properties') is null then
    raise exception 'Pre-flight failed: public.properties does not exist.';
  end if;
end
$pre$;

-- -----------------------------------------------------------------------------
-- 1. OBJECT FIELDS (properties)
-- area_sqm stays the existing object area / support-fee area (not duplicated).
-- ideal_parts_percent is the only authoritative share of common parts.
-- -----------------------------------------------------------------------------
alter table public.properties
  add column if not exists purpose text;

alter table public.properties
  add column if not exists ideal_parts_percent numeric(12, 6);

alter table public.properties
  add column if not exists ideal_parts_source text;

alter table public.properties
  add column if not exists ideal_parts_note text;

alter table public.properties
  add column if not exists ideal_parts_meeting_ref text;

alter table public.properties
  add column if not exists owner_user_management_agreement text;

do $c$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_ideal_parts_percent_range'
      and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_ideal_parts_percent_range
      check (
        ideal_parts_percent is null
        or (ideal_parts_percent > 0 and ideal_parts_percent <= 100)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_ideal_parts_source_chk'
      and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_ideal_parts_source_chk
      check (
        ideal_parts_source is null
        or ideal_parts_source in (
          'document',
          'calculated',
          'general_meeting_approved',
          'unknown'
        )
      );
  end if;
end
$c$;

comment on column public.properties.purpose is
  'Intended use of the independent object (ЗУЕС). Nullable until management fills it.';
comment on column public.properties.ideal_parts_percent is
  'Authoritative ideal parts of common areas for this independent object. One value per property, never per co-owner. NULL means unknown; never treat as 0.';
comment on column public.properties.ideal_parts_source is
  'document | calculated | general_meeting_approved | unknown';
comment on column public.properties.ideal_parts_meeting_ref is
  'Optional later reference to a general-meeting decision. No Documents workflow in this hotfix.';
comment on column public.properties.area_sqm is
  'Existing object area used by support fee. Treated as built-up area in the owner book UI; not copied to a second column.';

-- -----------------------------------------------------------------------------
-- 2. ANIMALS — extend apartment_pets (do not create property_animals)
-- -----------------------------------------------------------------------------
alter table public.apartment_pets
  add column if not exists is_taken_to_public_places boolean not null default false;

alter table public.apartment_pets
  add column if not exists updated_at timestamptz not null default now();

comment on column public.apartment_pets.passport_no is
  'Veterinary medical passport number when applicable (dogs). Not a human ID.';

-- -----------------------------------------------------------------------------
-- 3. HOUSEHOLD — optional middle name on existing apartment_guests
-- -----------------------------------------------------------------------------
alter table public.apartment_guests
  add column if not exists middle_name text;

-- -----------------------------------------------------------------------------
-- 4. REGISTRY PEOPLE (owners / users of property / extra occupants)
-- Does not replace properties.owner_email or apartment_guests.
-- relation_type user_of_property = ползвател (not an auth user).
-- -----------------------------------------------------------------------------
create table if not exists public.property_registry_people (
  id bigint generated by default as identity primary key,
  property_id integer not null
    references public.properties (id) on delete cascade,
  relation_type text not null,
  entity_kind text not null default 'natural_person',
  first_name text,
  middle_name text,
  last_name text,
  entity_name text,
  eik_bulstat text,
  email text,
  registered_at date,
  deregistered_at date,
  lives_on_property boolean,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_registry_people_relation_chk
    check (relation_type in (
      'owner',
      'user_of_property',
      'household_member',
      'occupant'
    )),
  constraint property_registry_people_entity_chk
    check (entity_kind in (
      'natural_person',
      'legal_entity',
      'sole_trader'
    )),
  constraint property_registry_people_dates_chk
    check (deregistered_at is null or registered_at is null or deregistered_at >= registered_at),
  constraint property_registry_people_natural_name_chk
    check (
      entity_kind <> 'natural_person'
      or (
        btrim(coalesce(first_name, '')) <> ''
        and btrim(coalesce(last_name, '')) <> ''
      )
    ),
  constraint property_registry_people_legal_name_chk
    check (
      entity_kind = 'natural_person'
      or btrim(coalesce(entity_name, '')) <> ''
    )
);

create index if not exists property_registry_people_property_idx
  on public.property_registry_people (property_id);

create index if not exists property_registry_people_relation_idx
  on public.property_registry_people (property_id, relation_type);

comment on table public.property_registry_people is
  'Legal condominium-book persons for a property. Ideal parts stay on properties, not on people.';

-- -----------------------------------------------------------------------------
-- 5. ABSENCE PERIODS (does not replace occupancy_status)
-- -----------------------------------------------------------------------------
create table if not exists public.property_absence_periods (
  id bigint generated by default as identity primary key,
  property_id integer not null
    references public.properties (id) on delete cascade,
  person_id bigint
    references public.property_registry_people (id) on delete set null,
  from_date date not null,
  to_date date,
  note text,
  source text,
  created_at timestamptz not null default now(),
  constraint property_absence_periods_dates_chk
    check (to_date is null or to_date >= from_date)
);

create index if not exists property_absence_periods_property_idx
  on public.property_absence_periods (property_id);

-- -----------------------------------------------------------------------------
-- 6. ACCESS HELPER — owner of this property OR administration only
-- -----------------------------------------------------------------------------
create or replace function public.can_read_property_book(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.owns_property(p_property_id)
    or public.has_staff_role('${ADMIN}');
$fn$;

revoke all on function public.can_read_property_book(bigint) from public;
revoke execute on function public.can_read_property_book(bigint) from anon;
grant execute on function public.can_read_property_book(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. PROTECT LEGAL COLUMNS
-- Owner still updates only occupancy / occupant / listing / pet_info.
-- Non-administration staff cannot change purpose / ideal parts / agreement.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_properties_update()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if TG_OP = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      if coalesce(NEW.debt, 0) <> 0
         or coalesce(NEW.overpayment, 0) <> 0 then
        raise exception 'properties: initial debt and overpayment must be zero'
          using errcode = '42501';
      end if;
    end if;
    return NEW;
  end if;

  if current_user in ('anon', 'authenticated') then
    if NEW.debt is distinct from OLD.debt
       or NEW.overpayment is distinct from OLD.overpayment then
      raise exception 'properties: debt and overpayment can only change via support-fee RPC'
        using errcode = '42501';
    end if;
  end if;

  if current_user in ('anon', 'authenticated') and not public.is_staff() then
    if not public.owns_property(OLD.id) then
      raise exception 'properties: owner can update only own apartments'
        using errcode = '42501';
    end if;

    if (
      to_jsonb(NEW) - array[
        'occupant_kind',
        'occupant_name',
        'occupant_phone',
        'occupant_email',
        'occupant_until',
        'occupancy_status',
        'status',
        'pet_info'
      ]
    ) is distinct from (
      to_jsonb(OLD) - array[
        'occupant_kind',
        'occupant_name',
        'occupant_phone',
        'occupant_email',
        'occupant_until',
        'occupancy_status',
        'status',
        'pet_info'
      ]
    ) then
      raise exception 'properties: owner cannot change protected columns'
        using errcode = '42501';
    end if;
  end if;

  if current_user in ('anon', 'authenticated')
     and public.is_staff()
     and not public.has_staff_role('${ADMIN}') then
    if NEW.purpose is distinct from OLD.purpose
       or NEW.ideal_parts_percent is distinct from OLD.ideal_parts_percent
       or NEW.ideal_parts_source is distinct from OLD.ideal_parts_source
       or NEW.ideal_parts_note is distinct from OLD.ideal_parts_note
       or NEW.ideal_parts_meeting_ref is distinct from OLD.ideal_parts_meeting_ref
       or NEW.owner_user_management_agreement is distinct from OLD.owner_user_management_agreement then
      raise exception 'properties: condominium-book fields require administration'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$fn$;

revoke all on function public.enforce_properties_update() from public;
revoke execute on function public.enforce_properties_update() from anon;
revoke execute on function public.enforce_properties_update() from authenticated;

drop trigger if exists enforce_properties_update on public.properties;
create trigger enforce_properties_update
before insert or update on public.properties
for each row
execute function public.enforce_properties_update();

-- -----------------------------------------------------------------------------
-- 8. RLS — people / absences: owner own-property OR administration
-- -----------------------------------------------------------------------------
alter table public.property_registry_people enable row level security;
alter table public.property_absence_periods enable row level security;

drop policy if exists property_registry_people_select on public.property_registry_people;
drop policy if exists property_registry_people_admin_write on public.property_registry_people;
drop policy if exists property_registry_people_admin_update on public.property_registry_people;
drop policy if exists property_registry_people_admin_delete on public.property_registry_people;

drop policy if exists property_absence_periods_select on public.property_absence_periods;
drop policy if exists property_absence_periods_admin_write on public.property_absence_periods;
drop policy if exists property_absence_periods_admin_update on public.property_absence_periods;
drop policy if exists property_absence_periods_admin_delete on public.property_absence_periods;

revoke all on table public.property_registry_people from anon;
revoke all on table public.property_registry_people from authenticated;
revoke all on table public.property_absence_periods from anon;
revoke all on table public.property_absence_periods from authenticated;

grant select on table public.property_registry_people to authenticated;
grant select on table public.property_absence_periods to authenticated;
grant insert, update, delete on table public.property_registry_people to authenticated;
grant insert, update, delete on table public.property_absence_periods to authenticated;

create policy property_registry_people_select
on public.property_registry_people
for select
to authenticated
using (public.can_read_property_book(property_id));

create policy property_registry_people_admin_write
on public.property_registry_people
for insert
to authenticated
with check (public.has_staff_role('${ADMIN}'));

create policy property_registry_people_admin_update
on public.property_registry_people
for update
to authenticated
using (public.has_staff_role('${ADMIN}'))
with check (public.has_staff_role('${ADMIN}'));

create policy property_registry_people_admin_delete
on public.property_registry_people
for delete
to authenticated
using (public.has_staff_role('${ADMIN}'));

create policy property_absence_periods_select
on public.property_absence_periods
for select
to authenticated
using (public.can_read_property_book(property_id));

create policy property_absence_periods_admin_write
on public.property_absence_periods
for insert
to authenticated
with check (public.has_staff_role('${ADMIN}'));

create policy property_absence_periods_admin_update
on public.property_absence_periods
for update
to authenticated
using (public.has_staff_role('${ADMIN}'))
with check (public.has_staff_role('${ADMIN}'));

create policy property_absence_periods_admin_delete
on public.property_absence_periods
for delete
to authenticated
using (public.has_staff_role('${ADMIN}'));

-- Pets: keep owner writes for existing occupancy UI; detailed SELECT limited
-- to owner of the property or administration (not cleaner / engineer / accountant).
drop policy if exists apartment_pets_owner_staff_select on public.apartment_pets;
drop policy if exists apartment_pets_owner_staff_insert on public.apartment_pets;
drop policy if exists apartment_pets_owner_staff_delete on public.apartment_pets;

create policy apartment_pets_owner_staff_select
on public.apartment_pets
for select
to authenticated
using (public.can_read_property_book(property_id));

create policy apartment_pets_owner_staff_insert
on public.apartment_pets
for insert
to authenticated
with check (
  public.owns_property(property_id)
  or public.has_staff_role('${ADMIN}')
);

create policy apartment_pets_owner_staff_delete
on public.apartment_pets
for delete
to authenticated
using (
  public.owns_property(property_id)
  or public.has_staff_role('${ADMIN}')
);

-- -----------------------------------------------------------------------------
-- 9. DIAGNOSTIC (administration) — no silent renormalization
-- -----------------------------------------------------------------------------
create or replace function public.property_ideal_parts_overview()
returns table (
  property_count bigint,
  filled_count bigint,
  null_count bigint,
  sum_percent numeric,
  needs_review boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('${ADMIN}') then
    raise exception 'property_ideal_parts_overview: administration only'
      using errcode = '42501';
  end if;

  return query
  select
    count(*)::bigint,
    count(p.ideal_parts_percent)::bigint,
    count(*) filter (where p.ideal_parts_percent is null)::bigint,
    sum(p.ideal_parts_percent),
    (
      count(p.ideal_parts_percent) <> count(*)
      or coalesce(sum(p.ideal_parts_percent), 0) is distinct from 100
    )
  from public.properties as p;
end;
$fn$;

revoke all on function public.property_ideal_parts_overview() from public;
revoke execute on function public.property_ideal_parts_overview() from anon;
grant execute on function public.property_ideal_parts_overview() to authenticated;

-- -----------------------------------------------------------------------------
-- 10. OWNER CHANGE REQUEST — reuses public.requests (no second workflow)
-- -----------------------------------------------------------------------------
create or replace function public.submit_property_book_change(
  p_property_id bigint,
  p_message text,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id bigint;
  v_msg text;
  v_owner_name text;
  v_owner_phone text;
begin
  if not public.owns_property(p_property_id) then
    raise exception 'submit_property_book_change: owner of this property only'
      using errcode = '42501';
  end if;

  v_msg := btrim(coalesce(p_message, ''));
  if char_length(v_msg) < 8 then
    raise exception 'submit_property_book_change: message too short'
      using errcode = '22023';
  end if;

  select p.owner_name, p.owner_phone
    into v_owner_name, v_owner_phone
  from public.properties as p
  where p.id = p_property_id;

  insert into public.requests (
    property_id,
    subject,
    description,
    status,
    priority,
    category,
    owner_name,
    owner_phone
  ) values (
    p_property_id,
    '${BOOK_SUBJECT}',
    v_msg || chr(10) || chr(10) || coalesce(p_payload::text, '{}'),
    '${NEW_STATUS}',
    '${PRIORITY_MID}',
    '${BOOK_CAT}',
    v_owner_name,
    v_owner_phone
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.submit_property_book_change(bigint, text, jsonb) from public;
revoke execute on function public.submit_property_book_change(bigint, text, jsonb) from anon;
grant execute on function public.submit_property_book_change(bigint, text, jsonb) to authenticated;

commit;
`;

const verify = `-- =============================================================================
-- AMADEUS 11 — property registry verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'properties_ideal_parts_column' as check_id, 'public.properties' as item,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'ideal_parts_percent'
  ) then 'OK' else 'FAIL' end as result
union all
select 'properties_ideal_parts_numeric', 'numeric(12,6)',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name = 'ideal_parts_percent'
      and data_type = 'numeric'
      and numeric_precision = 12
      and numeric_scale = 6
  ) then 'OK' else 'FAIL' end
union all
select 'properties_ideal_parts_nullable', 'NULL allowed',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name = 'ideal_parts_percent'
      and is_nullable = 'YES'
  ) then 'OK' else 'FAIL' end
union all
select 'no_duplicate_ideal_parts_column', 'single source',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and column_name in ('ideal_parts_percent', 'ideal_share_percent', 'vote_percent')
  ) = 1 then 'OK' else 'FAIL' end
union all
select 'ideal_parts_range_constraint', 'properties_ideal_parts_percent_range',
  case when exists (
    select 1 from pg_constraint
    where conname = 'properties_ideal_parts_percent_range'
      and conrelid = 'public.properties'::regclass
  ) then 'OK' else 'FAIL' end
union all
select 'purpose_column', 'public.properties.purpose',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'purpose'
  ) then 'OK' else 'FAIL' end
union all
select 'no_built_up_duplicate', 'no built_up_area_sqm',
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'built_up_area_sqm'
  ) then 'OK' else 'FAIL' end
union all
select 'owner_email_untouched', 'properties.owner_email',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'owner_email'
  ) then 'OK' else 'FAIL' end
union all
select 'owns_property_untouched', 'uses owner_email',
  case when to_regprocedure('public.owns_property(bigint)') is not null
    and pg_get_functiondef('public.owns_property(bigint)'::regprocedure) like '%owner_email%'
    and pg_get_functiondef('public.owns_property(bigint)'::regprocedure) not like '%property_registry_people%'
    then 'OK' else 'FAIL' end
union all
select 'occupancy_status_untouched', 'properties.occupancy_status',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'occupancy_status'
  ) then 'OK' else 'FAIL' end
union all
select 'occupant_kind_untouched', 'properties.occupant_kind',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'occupant_kind'
  ) then 'OK' else 'FAIL' end
union all
select 'registry_people_table', 'public.property_registry_people',
  case when to_regclass('public.property_registry_people') is not null then 'OK' else 'FAIL' end
union all
select 'absence_table', 'public.property_absence_periods',
  case when to_regclass('public.property_absence_periods') is not null then 'OK' else 'FAIL' end
union all
select 'animals_reuse_pets', 'public.apartment_pets',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'apartment_pets'
      and column_name = 'is_taken_to_public_places'
  ) then 'OK' else 'FAIL' end
union all
select 'no_property_animals_duplicate', 'property_animals absent',
  case when to_regclass('public.property_animals') is null then 'OK' else 'FAIL' end
union all
select 'people_rls_enabled', 'property_registry_people',
  case when exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'property_registry_people' and c.relrowsecurity
  ) then 'OK' else 'FAIL' end
union all
select 'people_select_not_is_staff', 'can_read_property_book',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'property_registry_people'
      and policyname = 'property_registry_people_select'
      and coalesce(qual, '') like '%can_read_property_book%'
      and coalesce(qual, '') not like '%is_staff()%'
  ) then 'OK' else 'FAIL' end
union all
select 'people_owner_no_insert', 'admin insert only',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'property_registry_people'
      and cmd = 'INSERT'
      and coalesce(with_check, '') like '%has_staff_role%'
      and coalesce(with_check, '') not like '%owns_property%'
  ) then 'OK' else 'FAIL' end
union all
select 'anon_no_execute_book_rpc', 'submit_property_book_change',
  case when to_regprocedure('public.submit_property_book_change(bigint, text, jsonb)') is not null
    and not has_function_privilege('anon', 'public.submit_property_book_change(bigint, text, jsonb)', 'EXECUTE')
    then 'OK' else 'FAIL' end
union all
select 'anon_no_execute_overview', 'property_ideal_parts_overview',
  case when to_regprocedure('public.property_ideal_parts_overview()') is not null
    and not has_function_privilege('anon', 'public.property_ideal_parts_overview()', 'EXECUTE')
    then 'OK' else 'FAIL' end
union all
select 'book_rpc_search_path_empty', 'submit_property_book_change',
  case when pg_get_functiondef('public.submit_property_book_change(bigint, text, jsonb)'::regprocedure)
    like '%search_path%'
    then 'OK' else 'FAIL' end
union all
select 'poll_weight_still_area_sqm', 'properties.area_sqm',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'area_sqm'
  ) then 'OK' else 'FAIL' end
union all
select 'utf8_admin_in_helper', 'can_read_property_book',
  case when convert_to(pg_get_functiondef('public.can_read_property_book(bigint)'::regprocedure), 'UTF8')
    like convert_to('${ADMIN}', 'UTF8')
    then 'OK' else 'FAIL' end
;

-- Diagnostic snapshot (administration RPC; may fail for non-admin sessions)
-- select * from public.property_ideal_parts_overview();

-- People per property (no double-count of ideal parts: percent is not on this table)
-- select property_id, relation_type, count(*)
-- from public.property_registry_people
-- group by 1, 2;
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const hotfixPath = join(dir, 'property_registry_hotfix.sql');
const verifyPath = join(dir, 'property_registry_verify.sql');
writeFileSync(hotfixPath, hotfix, { encoding: 'utf8' });
writeFileSync(verifyPath, verify, { encoding: 'utf8' });

const hotfixBuf = readFileSync(hotfixPath);
if (!hotfixBuf.includes(Buffer.from(ADMIN, 'utf8'))) {
  throw new Error('UTF-8 scan failed: administration role missing from hotfix');
}
if (hotfixBuf.includes(Buffer.from('\uFFFD')) || hotfixBuf.includes(Buffer.from('Ð°Ð´Ð¼'))) {
  throw new Error('UTF-8 scan failed: mojibake in hotfix');
}
console.log('wrote property_registry_hotfix.sql and property_registry_verify.sql');
