-- =============================================================================
-- R1-RC8 — Guest security list must not expose other access rows on the apartment
-- =============================================================================
-- owner_list_my_security_requests previously returned every security_requests row
-- for any property where the caller has_active_guest_access. Scope guests to their
-- own guest_access_id + email, matching RLS on security_requests.
-- Also ensure authenticated has INSERT/SELECT needed for guest chat/requests paths.
-- =============================================================================

begin;

grant select, insert, update on table public.chat_messages to authenticated;
grant select, insert, update on table public.requests to authenticated;
grant select, insert, update on table public.security_requests to authenticated;
grant select on table public.property_guest_accesses to authenticated;

create or replace function public.owner_list_my_security_requests(p_property_id bigint default null)
returns setof public.security_requests
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_list_my_security_requests: not authenticated'
      using errcode = '28000';
  end if;

  return query
  select r.*
  from public.security_requests as r
  where (p_property_id is null or r.property_id = p_property_id)
    and (
      public.owns_property(r.property_id)
      or (
        public.guest_has_action(r.property_id, 'security.own')
        and r.created_by_role = 'guest'
        and r.guest_access_id is not null
        and r.guest_access_id = public.guest_caller_access_id(r.property_id)
        and lower(btrim(coalesce(r.created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
      )
    )
  order by r.created_at desc
  limit 200;
end;
$fn$;

revoke all on function public.owner_list_my_security_requests(bigint) from public, anon;
grant execute on function public.owner_list_my_security_requests(bigint) to authenticated;

commit;
