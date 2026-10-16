-- =============================================================================
-- INV-7A.1 — repair public.is_staff() role-literal encoding
-- =============================================================================
-- Root cause: IS-9A companion migration rewrote is_staff() with mojibake
-- Cyrillic role literals, so is_staff() returned false while staff.role and
-- has_staff_role (INV-2 repair) remained correct. staff_select RLS requires
-- is_staff(), which blocked browser staff resolution /admin routing.
--
-- Additive. Does NOT enable inventory. Does NOT touch cloud by itself.
-- =============================================================================

begin;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where lower(btrim(s.email)) = lower(btrim(coalesce(auth.email(), '')))
      and s.active is true
      and public.is_allowed_staff_role(s.role)
  );
$$;

revoke all on function public.is_staff() from public;
revoke execute on function public.is_staff() from anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_staff() to service_role;

commit;
