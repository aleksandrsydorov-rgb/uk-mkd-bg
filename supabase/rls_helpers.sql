-- RLS helpers. Apply this file before replacing open policies with restrictive ones.

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
    where lower(btrim(s.email)) = lower(btrim(auth.email()))
      and s.active is not false
  );
$$;

create or replace function public.owns_property(property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties as p
    where p.id = $1
      and lower(btrim(p.owner_email)) = lower(btrim(auth.email()))
  );
$$;

revoke all on function public.is_staff() from public;
revoke execute on function public.is_staff() from anon;
grant execute on function public.is_staff() to authenticated;

revoke all on function public.owns_property(bigint) from public;
revoke execute on function public.owns_property(bigint) from anon;
grant execute on function public.owns_property(bigint) to authenticated;
