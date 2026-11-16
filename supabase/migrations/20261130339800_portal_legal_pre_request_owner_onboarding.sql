-- Allow owner first-login profile RPCs before terms acceptance.
-- Cabinet/data RPCs remain blocked by portal_legal_pre_request + owns_property.

create or replace function public.portal_legal_pre_request()
returns void
language plpgsql
security definer
set search_path to public
as $fn$
declare
  path text := coalesce(current_setting('request.path', true), '');
  jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  actor record;
  obligation uuid;
begin
  if jwt_role in ('', 'anon', 'service_role') then
    return;
  end if;

  -- Public legal + invite + first-login profile completion (before terms).
  if path like '%public_portal_legal%'
    or path like '%portal_legal_acceptance_status%'
    or path like '%portal_legal_record_acknowledgements%'
    or path like '%portal_legal_my_history%'
    or path like '%portal_legal_my_snapshot%'
    or path like '%accept_property_invite%'
    or path like '%owner_first_login_status%'
    or path like '%owner_update_own_registry_contact%'
    or path like '%owner_property_book_clarification_status%'
    or path like '%owner_linked_to_property%'
  then
    return;
  end if;

  select * into actor from public.portal_legal_actor();
  if actor.user_id is null or actor.member_role is distinct from 'owner' then
    return;
  end if;

  obligation := public.portal_legal_terms_obligation();
  if obligation is null then
    return;
  end if;
  if exists (
    select 1 from public.portal_legal_acknowledgements a
    where a.user_id = actor.user_id
      and a.complex_id = actor.complex_id
      and a.action = 'accept_terms'
      and a.revision_id = obligation
  ) then
    return;
  end if;

  raise exception 'portal_legal_acceptance_required' using errcode = '42501';
end;
$fn$;

revoke all on function public.portal_legal_pre_request() from public;
grant execute on function public.portal_legal_pre_request() to anon, authenticated;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant execute on function public.portal_legal_pre_request() to authenticator;
  end if;
end;
$g$;
