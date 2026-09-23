-- =============================================================================
-- AMADEUS 11 — temporary electricity auth diagnostic (READ ONLY)
-- =============================================================================
-- Does not INSERT/UPDATE/DELETE business data.
-- Does not replace submit_electricity_reading / has_staff_role.
-- Returns ONLY the current JWT caller's identity + their own staff row.
-- Call from browser while logged in:
--   supabase.rpc('debug_electricity_auth')
-- Remove with electricity_auth_debug_cleanup.sql after diagnosis.
-- Encoding: UTF-8 (no BOM). Role literals must remain 'администрация' / 'инженер'.
-- =============================================================================

create or replace function public.debug_electricity_auth()
returns table (
  auth_email text,
  auth_uid uuid,
  staff_role text,
  staff_active boolean,
  is_admin boolean,
  is_engineer boolean,
  electricity_mode text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_mode text;
begin
  if v_uid is null then
    return;
  end if;

  select s.role, s.active
    into v_role, v_active
  from public.staff as s
  where v_email is not null
    and lower(btrim(s.email)) = lower(v_email)
  order by (s.active is true) desc, s.id
  limit 1;

  select coalesce(nullif(btrim(bs.electricity_mode), ''), 'owner_and_staff')
    into v_mode
  from public.building_settings as bs
  where bs.id = 1;

  if v_mode is null then
    v_mode := 'owner_and_staff';
  end if;

  return query
  select
    v_email,
    v_uid,
    v_role,
    v_active,
    public.has_staff_role('администрация'),
    public.has_staff_role('инженер'),
    v_mode;
end;
$$;

revoke all on function public.debug_electricity_auth() from public;
revoke all on function public.debug_electricity_auth() from anon;
grant execute on function public.debug_electricity_auth() to authenticated;

-- Optional: dump deployed RPC source (SQL editor). Read-only.
-- select pg_get_functiondef(
--   'public.submit_electricity_reading(bigint, numeric, numeric, date, uuid)'::regprocedure
-- ) as submit_electricity_reading_def;
