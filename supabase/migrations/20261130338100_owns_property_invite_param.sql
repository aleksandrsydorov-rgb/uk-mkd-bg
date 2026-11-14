-- owns_property invite fallback compared the property_id parameter with the
-- invites.property_id column. PL/pgSQL treats that name as ambiguous, so the
-- check raised 42702 instead of returning false or true. Incomplete invited
-- owners then failed every RLS policy that calls owns_property.
-- Access-ready owners never reached this query and were unaffected.

create or replace function public.owns_property(property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
  v_property_id bigint := property_id;
begin
  if v_email is null or auth.uid() is null then
    return false;
  end if;

  v_owner := public.property_book_active_owner_by_email(v_property_id, v_email);
  if v_owner.id is null then
    return false;
  end if;
  if public.property_book_owner_row_access_ready(v_owner) then
    return true;
  end if;

  return exists (
    select 1
    from public.property_access_invites as i
    where i.property_id = v_property_id
      and i.registry_people_id = v_owner.id
      and i.status = 'accepted'
      and lower(btrim(coalesce(i.email, ''))) = v_email
  );
end;
$fn$;

revoke all on function public.owns_property(bigint) from public, anon;
grant execute on function public.owns_property(bigint) to authenticated;
