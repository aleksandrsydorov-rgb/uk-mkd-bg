import fs from 'node:fs';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';
const ENGINEER = '\u0438\u043d\u0436\u0435\u043d\u0435\u0440';
const ACCOUNTANT = '\u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440';
const CLEANER = '\u0443\u0431\u043e\u0440\u0449\u0438\u043a';

const src = fs.readFileSync('supabase/owner_only_water_reading_hotfix.sql', 'utf8');
const fnMatch = src.match(
  /create or replace function public\.submit_water_reading\([\s\S]*?grant execute on function public\.submit_water_reading\(bigint, numeric, date, uuid\) to authenticated;/,
);
if (!fnMatch) throw new Error('submit_water_reading not found');

let fn = fnMatch[0];
fn = fn.replace(
  '  v_charge_created boolean;\nbegin',
  `  v_charge_created boolean;
  v_mode text;
  v_is_owner boolean;
  v_is_water_staff boolean;
begin`,
);

const authBlock = `
  select coalesce(nullif(btrim(bs.water_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  v_is_owner := public.owns_property(p_property_id);
  v_is_water_staff :=
    public.has_staff_role('${ADMIN}')
    or public.has_staff_role('${ENGINEER}');

  if v_mode = 'disabled' then
    raise exception 'Water readings are disabled.';
  elsif v_mode = 'staff_only' then
    if not v_is_water_staff then
      raise exception 'Not authorized.';
    end if;
    v_via := 'staff';
  elsif v_mode = 'owner_and_staff' then
    if v_is_water_staff then
      v_via := 'staff';
    elsif v_is_owner then
      v_via := 'owner';
    else
      raise exception 'Not authorized.';
    end if;
  else
    raise exception 'Not authorized.';
  end if;
`;

if (!fn.includes('if not public.owns_property(p_property_id) then')) {
  throw new Error('owner-only auth block not found');
}
fn = fn.replace(
  `  if not public.owns_property(p_property_id) then
    raise exception 'Not authorized.';
  end if;

  v_via := 'owner';
`,
  authBlock,
);

if (!fn.includes('has_staff_role(\'' + ADMIN + '\')')) {
  throw new Error('UTF-8 admin literal missing in submit');
}
if (fn.includes('if not public.owns_property(p_property_id) then')) {
  throw new Error('owner-only gate still present');
}

const hotfix = `-- =============================================================================
-- AMADEUS 11 — water submission mode hotfix
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Role literals must remain '${ADMIN}' / '${ENGINEER}'.
-- Adds building_settings.water_mode and extends submit_water_reading
-- authorization. Does not change water_meters, tariffs, ledger schema,
-- assign/replace RPCs, electricity, or finance tables.
-- =============================================================================

BEGIN;

alter table public.building_settings
  add column if not exists water_mode text;

update public.building_settings
   set water_mode = 'owner_and_staff'
 where id = 1
   and (water_mode is null or btrim(water_mode) = '');

alter table public.building_settings
  alter column water_mode set default 'owner_and_staff';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'building_settings_water_mode_chk'
  ) then
    alter table public.building_settings
      add constraint building_settings_water_mode_chk
      check (water_mode in ('owner_and_staff', 'staff_only', 'disabled'));
  end if;
end $$;

${fn}

COMMIT;
`;

fs.writeFileSync('supabase/water_submission_mode_hotfix.sql', hotfix, { encoding: 'utf8' });

const verify = `-- =============================================================================
-- AMADEUS 11 — water submission mode verification (READ ONLY)
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Does not CREATE/ALTER/DROP/GRANT/DELETE/INSERT/UPDATE.
-- =============================================================================

with defs as (
  select
    to_regprocedure('public.submit_water_reading(bigint, numeric, date, uuid)') as fn_oid,
    to_regprocedure('public.has_staff_role(text)') as helper_oid
),
src as (
  select
    d.*,
    case when d.fn_oid is not null then pg_get_functiondef(d.fn_oid) else '' end as def,
    case when d.helper_oid is not null then pg_get_functiondef(d.helper_oid) else '' end as helper_def
  from defs as d
),
checks as (
  select 'column'::text as check_type, 'water_mode'::text as item,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'building_settings' and column_name = 'water_mode'
    ) then 'OK' else 'FAIL' end as result

  union all
  select 'mode_check_constraint', 'building_settings.water_mode',
    case when exists (
      select 1 from pg_constraint
      where conrelid = 'public.building_settings'::regclass
        and pg_get_constraintdef(oid) ilike '%owner_and_staff%'
        and pg_get_constraintdef(oid) ilike '%staff_only%'
        and pg_get_constraintdef(oid) ilike '%disabled%'
        and pg_get_constraintdef(oid) ilike '%water_mode%'
    ) then 'OK' else 'FAIL' end

  union all
  select 'amadeus_mode', 'owner_and_staff',
    case when exists (
      select 1 from public.building_settings
      where id = 1 and coalesce(nullif(btrim(water_mode), ''), 'owner_and_staff') = 'owner_and_staff'
    ) then 'OK' else 'FAIL' end

  union all
  select 'function', 'submit_water_reading',
    case when fn_oid is not null then 'OK' else 'FAIL' end
  from src

  union all
  select 'security_definer', 'submit_water_reading',
    case when fn_oid is not null and (select prosecdef from pg_proc where oid = fn_oid) then 'OK' else 'FAIL' end
  from src

  union all
  select 'execute_authenticated', 'submit_water_reading',
    case when fn_oid is not null and has_function_privilege('authenticated', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_anon', 'submit_water_reading',
    case when fn_oid is not null and not has_function_privilege('anon', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'no_execute_public', 'submit_water_reading',
    case when fn_oid is not null and not has_function_privilege('public', fn_oid, 'execute') then 'OK' else 'FAIL' end
  from src

  union all
  select 'mode_disabled', 'submit_water_reading',
    case when def like '%Water readings are disabled.%' then 'OK' else 'FAIL' end
  from src

  union all
  select 'mode_staff_only', 'submit_water_reading',
    case
      when def ilike '%staff_only%'
       and def ilike '%if not v_is_water_staff then%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'staff_before_owner', 'submit_water_reading',
    case
      when position('if v_is_water_staff then' in lower(def)) > 0
       and position('elsif v_is_owner then' in lower(def)) > 0
       and position('if v_is_water_staff then' in lower(def))
         < position('elsif v_is_owner then' in lower(def))
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'roles_submit', 'submit_water_reading',
    case
      when def like '%has_staff_role(''${ADMIN}'')%'
       and def like '%has_staff_role(''${ENGINEER}'')%'
       and def not like '%${ACCOUNTANT}%'
       and def not like '%${CLEANER}%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'helper_active_is_true', 'has_staff_role',
    case
      when helper_oid is not null
       and helper_def ilike '%s.active is true%'
       and helper_def not ilike '%s.active is not false%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'server_source', 'submit_water_reading',
    case
      when def like '%v_via := ''staff''%'
       and def like '%v_via := ''owner''%'
       and def not like '%p_submitted_via%'
       and def not like '%p_role%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'server_tariff_charge', 'submit_water_reading',
    case
      when def like '%water_tariffs%'
       and def like '%water_ledger%'
       and def like '%charge_amount_eur%'
       and def like '%previous_value%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'role_literals_unicode', 'submit_water_reading',
    case
      when def like '%has_staff_role(''${ADMIN}'')%'
       and def like '%has_staff_role(''${ENGINEER}'')%'
      then 'OK' else 'FAIL'
    end
  from src

  union all
  select 'no_role_mojibake', 'submit_water_reading',
    case
      when def like '%\u0420\u00b0%'
        or def like '%\u0420\u0430%'
        or def like '%Ð%'
      then 'FAIL' else 'OK'
    end
  from src
)
select check_type, item, result
from checks
order by check_type, item;
`;

fs.writeFileSync('supabase/water_submission_mode_verify.sql', verify, { encoding: 'utf8' });

function assertUtf8(p) {
  const buf = fs.readFileSync(p);
  const t = buf.toString('utf8');
  if (buf.indexOf(Buffer.from(ADMIN, 'utf8')) < 0) throw new Error(p + ' missing admin');
  if (buf.indexOf(Buffer.from(ENGINEER, 'utf8')) < 0) throw new Error(p + ' missing engineer');
  if (/has_staff_role\('(?:Р|Ð)/.test(t)) throw new Error(p + ' mojibake role');
}
assertUtf8('supabase/water_submission_mode_hotfix.sql');
assertUtf8('supabase/water_submission_mode_verify.sql');
console.log('wrote water submission mode sql utf8 ok');
