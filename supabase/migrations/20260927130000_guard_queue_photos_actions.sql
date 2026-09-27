-- Guard queue UX: optional photos on accept/handover; kind-aware actions stay on same statuses.

begin;

alter table public.security_requests
  add column if not exists accepted_photo_path text null,
  add column if not exists handed_over_photo_path text null;

create or replace function public.can_upload_request_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_property_id bigint;
begin
  if public.private_object_name_ok(p_name, 'security') then
    v_property_id := split_part(p_name, '/', 2)::bigint;
    if not exists (select 1 from public.properties as p where p.id = v_property_id) then
      return false;
    end if;
    return public.has_staff_role('охрана')
      or public.has_staff_role('администрация');
  end if;

  if not public.private_object_name_ok(p_name, 'requests') then
    return false;
  end if;
  v_property_id := split_part(p_name, '/', 2)::bigint;
  if not exists (select 1 from public.properties as p where p.id = v_property_id) then
    return false;
  end if;
  return public.has_staff_role('администрация')
    or public.owns_property(v_property_id);
end;
$fn$;

create or replace function public.can_read_request_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    exists (
      select 1
      from public.requests as r
      where r.photo_url = p_name
        and p_name like 'requests/' || r.property_id::text || '/%'
        and (
          public.has_staff_role('администрация')
          or public.owns_property(r.property_id)
        )
    )
    or exists (
      select 1
      from public.security_requests as sr
      where p_name in (sr.accepted_photo_path, sr.handed_over_photo_path)
        and p_name like 'security/' || sr.property_id::text || '/%'
        and (
          public.has_staff_role('администрация')
          or public.has_staff_role('охрана')
          or public.owns_property(sr.property_id)
        )
    );
$fn$;

drop function if exists public.guard_list_post_queue();
create or replace function public.guard_list_post_queue()
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  post_id uuid,
  kind text,
  status text,
  guest_name text,
  expected_at timestamptz,
  courier_name text,
  delivery_note text,
  handover_item text,
  note text,
  created_at timestamptz,
  accepted_at timestamptz,
  accepted_photo_path text,
  handed_over_photo_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_shift public.security_shifts%rowtype;
begin
  if not public.has_staff_role('охрана') then
    raise exception 'guard_list_post_queue: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    return;
  end if;

  return query
  select
    r.id,
    r.property_id,
    p.apartment_number::text,
    r.post_id,
    r.kind,
    r.status,
    r.guest_name,
    r.expected_at,
    r.courier_name,
    r.delivery_note,
    r.handover_item,
    r.note,
    r.created_at,
    r.accepted_at,
    r.accepted_photo_path,
    r.handed_over_photo_path
  from public.security_requests as r
  join public.properties as p on p.id = r.property_id
  where r.post_id = v_shift.post_id
    and r.status in ('pending', 'accepted')
  order by
    case r.kind
      when 'delivery' then 0
      when 'handover' then 1
      when 'guest_pass' then 2
      else 3
    end,
    case when r.status = 'pending' then 0 else 1 end,
    r.created_at asc;
end;
$fn$;

revoke all on function public.guard_list_post_queue() from public;
revoke all on function public.guard_list_post_queue() from anon;
grant execute on function public.guard_list_post_queue() to authenticated;

drop function if exists public.guard_accept_request(uuid);
drop function if exists public.guard_accept_request(uuid, text);
create or replace function public.guard_accept_request(
  p_request_id uuid,
  p_photo_path text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_shift public.security_shifts%rowtype;
  v_row public.security_requests%rowtype;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard_accept_request: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    raise exception 'guard_accept_request: no active shift'
      using errcode = 'P0001';
  end if;
  select r.* into v_row
  from public.security_requests as r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'guard_accept_request: not found'
      using errcode = 'P0002';
  end if;
  if v_row.post_id <> v_shift.post_id then
    raise exception 'guard_accept_request: wrong post'
      using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'guard_accept_request: not pending'
      using errcode = 'P0001';
  end if;
  if v_photo is not null then
    if v_photo not like 'security/' || v_row.property_id::text || '/%' then
      raise exception 'guard_accept_request: invalid photo'
        using errcode = '22023';
    end if;
    if v_row.kind = 'guest_pass' then
      raise exception 'guard_accept_request: photo not used for guest pass'
        using errcode = '22023';
    end if;
  end if;

  update public.security_requests as r
     set status = 'accepted',
         accepted_by = v_staff,
         accepted_at = now(),
         accepted_photo_path = coalesce(v_photo, r.accepted_photo_path),
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_accept_request(uuid, text) from public;
revoke all on function public.guard_accept_request(uuid, text) from anon;
grant execute on function public.guard_accept_request(uuid, text) to authenticated;

drop function if exists public.guard_handover_request(uuid);
drop function if exists public.guard_handover_request(uuid, text);
create or replace function public.guard_handover_request(
  p_request_id uuid,
  p_photo_path text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_shift public.security_shifts%rowtype;
  v_row public.security_requests%rowtype;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard_handover_request: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    raise exception 'guard_handover_request: no active shift'
      using errcode = 'P0001';
  end if;
  select r.* into v_row
  from public.security_requests as r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'guard_handover_request: not found'
      using errcode = 'P0002';
  end if;
  if v_row.post_id <> v_shift.post_id then
    raise exception 'guard_handover_request: wrong post'
      using errcode = '42501';
  end if;
  if v_row.status not in ('pending', 'accepted') then
    raise exception 'guard_handover_request: invalid status'
      using errcode = 'P0001';
  end if;
  -- Guest pass / info flow: must acknowledge (accepted) before complete.
  if v_row.kind = 'guest_pass' and v_row.status <> 'accepted' then
    raise exception 'guard_handover_request: acknowledge first'
      using errcode = 'P0001';
  end if;
  if v_photo is not null then
    if v_photo not like 'security/' || v_row.property_id::text || '/%' then
      raise exception 'guard_handover_request: invalid photo'
        using errcode = '22023';
    end if;
    if v_row.kind = 'guest_pass' then
      raise exception 'guard_handover_request: photo not used for guest pass'
        using errcode = '22023';
    end if;
  end if;

  update public.security_requests as r
     set status = 'handed_over',
         accepted_by = coalesce(r.accepted_by, v_staff),
         accepted_at = coalesce(r.accepted_at, now()),
         handed_over_by = v_staff,
         handed_over_at = now(),
         handed_over_photo_path = coalesce(v_photo, r.handed_over_photo_path),
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_handover_request(uuid, text) from public;
revoke all on function public.guard_handover_request(uuid, text) from anon;
grant execute on function public.guard_handover_request(uuid, text) to authenticated;

commit;
