-- PKG-PB1-BOOK-ONLY: ops audit (read-only). Portal owner_* never authorize.
-- Prefer RPC: select public.property_book_ownership_audit_report();
-- This file is a staff-session-free SQL view of the same categories.

select
  'portal_email_without_book_owners' as issue,
  p.id as property_id,
  p.apartment_number,
  lower(btrim(p.owner_email)) as portal_owner_email
from public.properties as p
where nullif(btrim(coalesce(p.owner_email, '')), '') is not null
  and position('@' in p.owner_email) > 0
  and not exists (
    select 1 from public.property_registry_people as r
    where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
  )
order by p.apartment_number;

select
  'portal_email_not_in_active_book' as issue,
  p.id as property_id,
  p.apartment_number,
  lower(btrim(p.owner_email)) as portal_owner_email
from public.properties as p
where nullif(btrim(coalesce(p.owner_email, '')), '') is not null
  and position('@' in p.owner_email) > 0
  and exists (
    select 1 from public.property_registry_people as r
    where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
  )
  and not exists (
    select 1 from public.property_registry_people as r
    where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
      and lower(btrim(coalesce(r.email, ''))) = lower(btrim(p.owner_email))
  )
order by p.apartment_number;

select
  'incomplete_active_book_owner' as issue,
  r.property_id,
  r.id as registry_people_id,
  lower(btrim(r.email)) as email,
  r.entity_kind,
  r.ownership_share_percent,
  r.ideal_parts_percent
from public.property_registry_people as r
where r.relation_type = 'owner'
  and r.deregistered_at is null
  and not public.property_book_owner_row_access_ready(r)
order by r.property_id, r.id;
