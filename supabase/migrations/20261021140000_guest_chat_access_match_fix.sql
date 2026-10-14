-- Guest chat 42501 fix: chat_messages_owner_guest_insert WITH CHECK used a direct
-- EXISTS on property_guest_accesses, which requires SELECT for authenticated.
-- Table SELECT is intentionally revoked; replace with a narrow SECURITY DEFINER
-- matcher that validates (access_id, property_id, auth.email()) without exposing
-- other guest assignments. No GRANT SELECT/UPDATE/DELETE on the table.
-- Does not touch expire_stale, enforce trigger, or owner_list_guest_accesses.

begin;

create or replace function public.guest_access_matches_caller(
  p_access_id uuid,
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    p_access_id is not null
    and p_property_id is not null
    and auth.email() is not null
    and exists (
      select 1
      from public.property_guest_accesses as g
      where g.id = p_access_id
        and g.property_id = p_property_id
        and g.status = 'active'
        and lower(btrim(g.email)) = lower(btrim(auth.email()))
        and g.valid_from <= now()
        and (g.valid_until is null or g.valid_until >= now())
    );
$fn$;

revoke all on function public.guest_access_matches_caller(uuid, bigint) from public;
revoke all on function public.guest_access_matches_caller(uuid, bigint) from anon;
grant execute on function public.guest_access_matches_caller(uuid, bigint) to authenticated;

-- Reaffirm: authenticated must not read guest assignment rows directly.
revoke all on table public.property_guest_accesses from public;
revoke all on table public.property_guest_accesses from anon;
revoke all on table public.property_guest_accesses from authenticated;

drop policy if exists chat_messages_owner_guest_insert on public.chat_messages;
create policy chat_messages_owner_guest_insert
on public.chat_messages
for insert
to authenticated
with check (
  (
    (
      public.owns_property(property_id)
      and sender = 'owner'
      and guest_access_id is null
    )
    or (
      public.has_active_guest_access(property_id)
      and sender = 'guest'
      and guest_access_id is not null
      and public.guest_access_matches_caller(guest_access_id, property_id)
    )
  )
  and coalesce(read_by_uk, false) = false
);

commit;
