-- =============================================================================
-- INV-2 companion — inventory_is_admin direct role check
-- =============================================================================
-- Additive. Repairs admin detection when has_staff_role role-literal encoding
-- is corrupted (mojibake) while staff.role stores canonical Cyrillic.
-- Does NOT enable inventory module. Does NOT touch cloud.
-- =============================================================================

begin;

create or replace function public.inventory_is_admin()
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
      and s.role = 'администрация'
  );
$$;

revoke all on function public.inventory_is_admin() from public;
revoke execute on function public.inventory_is_admin() from anon;
grant execute on function public.inventory_is_admin() to authenticated;

-- Repair canonical has_staff_role whitelist to match staff_role_canonical_chk /
-- production role strings (администрация, бухгалтер, инженер, уборщик).
create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_role in ('администрация', 'бухгалтер', 'инженер', 'уборщик')
    and exists (
      select 1
      from public.staff as s
      where lower(btrim(s.email)) = lower(btrim(auth.email()))
        and s.active is true
        and s.role = p_role
    );
$$;

revoke all on function public.has_staff_role(text) from public;
revoke execute on function public.has_staff_role(text) from anon;
grant execute on function public.has_staff_role(text) to authenticated;

commit;
