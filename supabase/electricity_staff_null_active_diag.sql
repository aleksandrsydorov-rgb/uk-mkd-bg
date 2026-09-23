-- =============================================================================
-- AMADEUS 11 — staff.active IS NULL diagnostic (READ ONLY)
-- =============================================================================
-- Does not INSERT/UPDATE/DELETE/GRANT.
-- Run this to see which staff rows would fail has_staff_role() while still
-- entering admin UI via is_staff() / resolveAccess (active IS NOT FALSE).
-- =============================================================================

select
  s.id,
  s.email,
  s.role,
  s.active,
  s.name
from public.staff as s
where s.active is null
order by lower(btrim(coalesce(s.email, ''))), s.id;

select
  s.id,
  s.email,
  s.role,
  s.active,
  s.name
from public.staff as s
where s.active is null
  and lower(btrim(coalesce(s.role, ''))) in ('администрация', 'инженер')
order by lower(btrim(coalesce(s.email, ''))), s.id;
