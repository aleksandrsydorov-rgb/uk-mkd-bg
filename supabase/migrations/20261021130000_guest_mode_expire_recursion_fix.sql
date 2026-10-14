-- Guest Mode hotfix: stop expire_stale recursion / read-only list failure.
-- 1) BEFORE trigger must not call guest_access_expire_stale (nested UPDATE re-matches
--    the same active row → stack depth exceeded).
-- 2) owner_list_guest_accesses must be VOLATILE if it expires, or not UPDATE at all.
--    Prefer list without side effects; expiry remains in create/revoke.

begin;

create or replace function public.trg_property_guest_accesses_enforce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_active_count integer;
begin
  -- Do NOT call guest_access_expire_stale() here — it UPDATEs status and re-enters
  -- this BEFORE UPDATE trigger until stack depth is exceeded.

  if NEW.status = 'active'
     and NEW.valid_until is not null
     and NEW.valid_until < now() then
    NEW.status := 'expired';
  end if;

  if NEW.status = 'active' then
    select count(*)::integer into v_active_count
    from public.property_guest_accesses as g
    where g.property_id = NEW.property_id
      and g.status = 'active'
      and (TG_OP = 'INSERT' or g.id is distinct from NEW.id);

    if v_active_count >= 2 then
      raise exception 'property_guest_accesses: max 2 active guests per property'
        using errcode = '23505';
    end if;
  end if;

  return NEW;
end;
$fn$;

create or replace function public.owner_list_guest_accesses(p_property_id bigint)
returns setof public.property_guest_accesses
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_list_guest_accesses: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_list_guest_accesses: not allowed'
      using errcode = '42501';
  end if;
  -- No expire_stale here: STABLE RPCs run in read-only transactions.
  return query
  select g.*
  from public.property_guest_accesses as g
  where g.property_id = p_property_id
  order by g.created_at desc
  limit 50;
end;
$fn$;

revoke all on function public.owner_list_guest_accesses(bigint) from public, anon;
grant execute on function public.owner_list_guest_accesses(bigint) to authenticated;

commit;
