import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';

const hotfix = `-- =============================================================================
-- AMADEUS 11 — controlled apartment_guests UPDATE
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Does not change occupancy_status, owns_property(), owner_email, or RLS DELETE.
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.owns_property(bigint)') is null then
    raise exception 'Pre-flight failed: public.owns_property(bigint) does not exist.';
  end if;
  if to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'Pre-flight failed: public.has_staff_role(text) does not exist.';
  end if;
end
$pre$;

create or replace function public.update_apartment_guest(
  p_guest_id bigint,
  p_first_name text,
  p_last_name text,
  p_birth_year integer default null,
  p_is_child boolean default false,
  p_is_permanent boolean default true,
  p_check_in date default null,
  p_check_out date default null
)
returns public.apartment_guests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
  v_row public.apartment_guests;
  v_first text;
  v_last text;
begin
  if auth.email() is null then
    raise exception 'update_apartment_guest: not authenticated'
      using errcode = '28000';
  end if;

  select g.property_id
    into v_property_id
  from public.apartment_guests as g
  where g.id = p_guest_id;

  if not found then
    raise exception 'update_apartment_guest: guest not found'
      using errcode = 'P0002';
  end if;

  if not public.owns_property(v_property_id)
     and not public.has_staff_role('${ADMIN}') then
    raise exception 'update_apartment_guest: not allowed'
      using errcode = '42501';
  end if;

  v_first := btrim(coalesce(p_first_name, ''));
  v_last := btrim(coalesce(p_last_name, ''));
  if v_first = '' or v_last = '' then
    raise exception 'update_apartment_guest: name required'
      using errcode = '22023';
  end if;

  update public.apartment_guests as g
     set first_name = v_first,
         last_name = v_last,
         birth_year = p_birth_year,
         is_child = coalesce(p_is_child, false),
         is_permanent = coalesce(p_is_permanent, true),
         check_in = p_check_in,
         check_out = case when coalesce(p_is_permanent, true) then null else p_check_out end
   where g.id = p_guest_id
     and g.property_id = v_property_id
  returning g.* into v_row;

  if not found then
    raise exception 'update_apartment_guest: update failed'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date) from public;
revoke execute on function public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date) from anon;
grant execute on function public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date) to authenticated;

commit;
`;

const verify = `-- =============================================================================
-- AMADEUS 11 — update_apartment_guest verify (READ ONLY)
-- Encoding: UTF-8 (no BOM). Do not execute from app.
-- =============================================================================

select 'rpc_exists' as check_id, 'update_apartment_guest' as item,
  case when to_regprocedure('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)') is not null
    then 'OK' else 'FAIL' end as result
union all
select 'search_path_empty', 'update_apartment_guest',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    like '%search_path%'
    then 'OK' else 'FAIL' end
union all
select 'security_definer', 'update_apartment_guest',
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_apartment_guest' and p.prosecdef
  ) then 'OK' else 'FAIL' end
union all
select 'uses_auth_email', 'update_apartment_guest',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    like '%auth.email()%'
    then 'OK' else 'FAIL' end
union all
select 'uses_owns_property', 'update_apartment_guest',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    like '%owns_property%'
    then 'OK' else 'FAIL' end
union all
select 'no_authenticated_table_update', 'apartment_guests',
  case when not has_table_privilege('authenticated', 'public.apartment_guests', 'UPDATE')
    then 'OK' else 'FAIL' end
union all
select 'no_property_id_param', 'cannot reassign property',
  case when pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure)
    not like '%p_property_id%'
    then 'OK' else 'FAIL' end
union all
select 'anon_no_execute', 'update_apartment_guest',
  case when not has_function_privilege('anon', 'public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)', 'EXECUTE')
    then 'OK' else 'FAIL' end
union all
select 'utf8_admin_literal', 'update_apartment_guest',
  case when position(
      convert_to(U&'\\0430\\0434\\043C\\0438\\043D\\0438\\0441\\0442\\0440\\0430\\0446\\0438\\044F', 'UTF8')
      in convert_to(pg_get_functiondef('public.update_apartment_guest(bigint, text, text, integer, boolean, boolean, date, date)'::regprocedure), 'UTF8')
    ) > 0
    then 'OK' else 'FAIL' end
union all
select 'delete_rls_owns_property', 'apartment_guests delete',
  case when exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'apartment_guests' and cmd = 'DELETE'
      and coalesce(qual, '') like '%owns_property%'
  ) then 'OK' else 'FAIL' end
union all
select 'occupancy_status_untouched', 'properties.occupancy_status',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'occupancy_status'
  ) then 'OK' else 'FAIL' end
union all
select 'owns_property_untouched', 'owner_email',
  case when pg_get_functiondef('public.owns_property(bigint)'::regprocedure) like '%owner_email%'
    then 'OK' else 'FAIL' end
;
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
writeFileSync(join(dir, 'residency_guest_edit_hotfix.sql'), hotfix, { encoding: 'utf8' });
writeFileSync(join(dir, 'residency_guest_edit_verify.sql'), verify, { encoding: 'utf8' });
console.log('wrote residency_guest_edit sql');
