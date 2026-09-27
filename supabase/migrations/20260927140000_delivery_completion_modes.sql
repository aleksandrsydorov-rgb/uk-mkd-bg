-- Delivery outcomes: kept at post then handed over, or owner collected themselves.

begin;

alter table public.security_requests
  add column if not exists completion_mode text null;

alter table public.security_requests
  drop constraint if exists security_requests_completion_mode_check;

alter table public.security_requests
  add constraint security_requests_completion_mode_check
  check (
    completion_mode is null
    or completion_mode in ('handed_to_owner', 'owner_collected')
  );

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
  handed_over_photo_path text,
  completion_mode text
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
    r.handed_over_photo_path,
    r.completion_mode
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

drop function if exists public.guard_handover_request(uuid);
drop function if exists public.guard_handover_request(uuid, text);
create or replace function public.guard_handover_request(
  p_request_id uuid,
  p_photo_path text default null,
  p_completion_mode text default null
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
  v_mode text := nullif(btrim(coalesce(p_completion_mode, '')), '');
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

  -- Guest pass: acknowledge first, then complete.
  if v_row.kind = 'guest_pass' then
    if v_row.status <> 'accepted' then
      raise exception 'guard_handover_request: acknowledge first'
        using errcode = 'P0001';
    end if;
    v_mode := coalesce(v_mode, 'handed_to_owner');
  elsif v_row.kind in ('delivery', 'handover') then
    if v_mode is null then
      if v_row.status = 'accepted' then
        v_mode := 'handed_to_owner';
      else
        raise exception 'guard_handover_request: completion mode required'
          using errcode = '22023';
      end if;
    end if;
    if v_mode not in ('handed_to_owner', 'owner_collected') then
      raise exception 'guard_handover_request: invalid completion mode'
        using errcode = '22023';
    end if;
    -- Owner collected: only from pending (never sat at the desk).
    if v_mode = 'owner_collected' and v_row.status <> 'pending' then
      raise exception 'guard_handover_request: owner_collected only from pending'
        using errcode = 'P0001';
    end if;
    -- Handed to owner after desk hold: from accepted (or allow pending? no — must accept first).
    if v_mode = 'handed_to_owner' and v_row.status <> 'accepted' then
      raise exception 'guard_handover_request: accept at post first'
        using errcode = 'P0001';
    end if;
  else
    v_mode := coalesce(v_mode, 'handed_to_owner');
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
         completion_mode = v_mode,
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_handover_request(uuid, text, text) from public;
revoke all on function public.guard_handover_request(uuid, text, text) from anon;
grant execute on function public.guard_handover_request(uuid, text, text) to authenticated;

commit;
