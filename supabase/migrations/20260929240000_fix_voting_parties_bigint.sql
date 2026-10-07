-- Fix owner/property voting party SRFs: property_id is integer in book, bigint in RETURNS TABLE.

create or replace function public.owner_voting_parties(p_email text default null)
returns table (
  registry_people_id bigint,
  property_id bigint,
  ideal_parts_percent numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, auth.email(), '')));
begin
  if v_email = '' then
    return;
  end if;

  return query
  select
    r.id::bigint,
    r.property_id::bigint,
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::numeric
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.relation_type = 'owner'
    and r.deregistered_at is null
    and lower(btrim(coalesce(r.email, ''))) = v_email
    and coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0) > 0;

  return query
  select
    null::bigint,
    p.id::bigint,
    coalesce(p.ideal_parts_percent, 0)::numeric
  from public.properties as p
  where lower(btrim(coalesce(p.owner_email, ''))) = v_email
    and coalesce(p.ideal_parts_percent, 0) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
        and lower(btrim(coalesce(r.email, ''))) = v_email
    );
end;
$fn$;

create or replace function public.property_voting_parties(p_property_id bigint)
returns table (
  registry_people_id bigint,
  property_id bigint,
  ideal_parts_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    r.id::bigint,
    r.property_id::bigint,
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::numeric
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0) > 0
  union all
  select
    null::bigint,
    p.id::bigint,
    coalesce(p.ideal_parts_percent, 0)::numeric
  from public.properties as p
  where p.id = p_property_id
    and coalesce(p.ideal_parts_percent, 0) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
    );
$fn$;

revoke all on function public.owner_voting_parties(text) from public, anon;
revoke all on function public.property_voting_parties(bigint) from public, anon;
grant execute on function public.owner_voting_parties(text) to authenticated;
grant execute on function public.property_voting_parties(bigint) to authenticated;
