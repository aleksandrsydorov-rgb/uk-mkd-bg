-- Service lock: admin history RPC for property_service_lock_events

begin;

create or replace function public.list_property_service_lock_events(
  p_property_id bigint default null,
  p_limit integer default 100
)
returns table (
  event_id uuid,
  property_id bigint,
  apartment_number text,
  owner_name text,
  lock_id uuid,
  event_type text,
  reason_code text,
  admin_note text,
  actor_email text,
  created_at timestamptz,
  scopes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if auth.uid() is null then
    raise exception 'list_property_service_lock_events: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'list_property_service_lock_events: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.property_id,
    coalesce(p.apartment_number::text, ''),
    p.owner_name,
    e.lock_id,
    e.event_type,
    e.reason_code,
    e.admin_note,
    e.actor_email,
    e.created_at,
    coalesce(l.scopes, array[]::text[])
  from public.property_service_lock_events as e
  join public.properties as p on p.id = e.property_id
  left join public.property_service_locks as l on l.id = e.lock_id
  where (p_property_id is null or e.property_id = p_property_id)
  order by e.created_at desc
  limit v_limit;
end;
$fn$;

revoke all on function public.list_property_service_lock_events(bigint, integer) from public;
revoke all on function public.list_property_service_lock_events(bigint, integer) from anon;
grant execute on function public.list_property_service_lock_events(bigint, integer) to authenticated;

commit;
