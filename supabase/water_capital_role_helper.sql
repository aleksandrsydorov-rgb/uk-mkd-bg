-- =============================================================================
-- AMADEUS 11 — staff role helper for water/capital RLS
-- =============================================================================
-- SECURITY DEFINER, JWT-only: checks the caller's own staff row.
-- Empty staff.role is not администрация.
-- Active only when s.active IS TRUE.
-- GRANT EXECUTE to authenticated so RLS policies can call it.
-- This file has no BEGIN/COMMIT.
-- =============================================================================

create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.email() is not null
    and length(btrim(coalesce(p_role, ''))) > 0
    and exists (
      select 1
      from public.staff as s
      where lower(btrim(s.email)) = lower(btrim(auth.email()))
        and s.active is true
        and lower(btrim(s.role)) = lower(btrim(p_role))
    );
$$;

revoke all on function public.has_staff_role(text) from public;
revoke all on function public.has_staff_role(text) from anon;
grant execute on function public.has_staff_role(text) to authenticated;
