-- Security request lifecycle v2: seen → at_post → done; delivery_mode hold/pass.

begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.security_requests
  add column if not exists delivery_mode text null;

alter table public.security_requests
  add column if not exists completion_mode text null;

alter table public.security_requests
  add column if not exists accepted_photo_path text null;

alter table public.security_requests
  add column if not exists handed_over_photo_path text null;

alter table public.security_requests
  drop constraint if exists security_requests_delivery_mode_check;

alter table public.security_requests
  add constraint security_requests_delivery_mode_check
  check (
    delivery_mode is null
    or delivery_mode in ('hold_at_post', 'courier_pass')
  );

alter table public.security_requests
  drop constraint if exists security_requests_completion_mode_check;

alter table public.security_requests
  add constraint security_requests_completion_mode_check
  check (
    completion_mode is null
    or completion_mode in ('handed_to_owner', 'owner_collected', 'courier_passed', 'done')
  );

-- Default existing deliveries to hold-at-post.
update public.security_requests
   set delivery_mode = 'hold_at_post'
 where kind = 'delivery'
   and delivery_mode is null;

-- Map legacy statuses → v2.
alter table public.security_requests
  drop constraint if exists security_requests_status_check;

update public.security_requests
   set status = case
     when status = 'handed_over' then 'done'
     when status = 'accepted' and kind = 'guest_pass' then 'seen'
     when status = 'accepted' then 'at_post'
     else status
   end
 where status in ('accepted', 'handed_over');

alter table public.security_requests
  add constraint security_requests_status_check
  check (status in ('pending', 'seen', 'at_post', 'done', 'cancelled', 'expired'));

-- ---------------------------------------------------------------------------
-- Create request
-- ---------------------------------------------------------------------------

drop function if exists public.security_insert_request(
  bigint, uuid, text, text, bigint, text, timestamptz, text, text, text, text
);

create or replace function public.security_insert_request(
  p_property_id bigint,
  p_post_id uuid,
  p_kind text,
  p_created_by_role text,
  p_guest_id bigint,
  p_guest_name text,
  p_expected_at timestamptz,
  p_courier_name text,
  p_delivery_note text,
  p_handover_item text,
  p_note text,
  p_delivery_mode text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.security_requests%rowtype;
  v_post uuid;
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_email text := nullif(btrim(auth.email()), '');
  v_guest_name text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_courier text := nullif(btrim(coalesce(p_courier_name, '')), '');
  v_delivery text := nullif(btrim(coalesce(p_delivery_note, '')), '');
  v_handover text := nullif(btrim(coalesce(p_handover_item, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_mode text := nullif(btrim(coalesce(p_delivery_mode, '')), '');
begin
  if not public.security_module_enabled() then
    raise exception 'security: module disabled'
      using errcode = '42501';
  end if;
  if v_email is null then
    raise exception 'security: not authenticated'
      using errcode = '28000';
  end if;
  if p_property_id is null
     or not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'security: property required'
      using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('guest_pass', 'delivery', 'handover') then
    raise exception 'security: invalid kind'
      using errcode = '22023';
  end if;
  if p_created_by_role not in ('owner', 'admin') then
    raise exception 'security: invalid creator'
      using errcode = '22023';
  end if;

  v_post := public.security_resolve_post_id(p_post_id);

  if v_kind = 'guest_pass' and v_guest_name is null and p_guest_id is null then
    raise exception 'security: guest name required'
      using errcode = '22023';
  end if;
  if v_kind = 'delivery' then
    if v_courier is null and v_delivery is null then
      raise exception 'security: delivery details required'
        using errcode = '22023';
    end if;
    if v_mode is null then
      v_mode := 'hold_at_post';
    end if;
    if v_mode not in ('hold_at_post', 'courier_pass') then
      raise exception 'security: invalid delivery mode'
        using errcode = '22023';
    end if;
  else
    v_mode := null;
  end if;
  if v_kind = 'handover' and (
       v_handover is null
       or v_handover not in ('documents', 'keys', 'parcel')
     ) then
    raise exception 'security: handover item required'
      using errcode = '22023';
  end if;

  if p_guest_id is not null then
    if not exists (
      select 1 from public.apartment_guests as g
      where g.id = p_guest_id and g.property_id = p_property_id
    ) then
      raise exception 'security: guest not found'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.security_requests (
    property_id, post_id, kind, status, created_by_role, created_by_email,
    guest_id, guest_name, expected_at, courier_name, delivery_note,
    handover_item, note, delivery_mode
  ) values (
    p_property_id, v_post, v_kind, 'pending', p_created_by_role, v_email,
    p_guest_id, v_guest_name, p_expected_at, v_courier, v_delivery,
    case when v_kind = 'handover' then v_handover else null end,
    v_note, v_mode
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.security_insert_request(
  bigint, uuid, text, text, bigint, text, timestamptz, text, text, text, text, text
) from public;
revoke all on function public.security_insert_request(
  bigint, uuid, text, text, bigint, text, timestamptz, text, text, text, text, text
) from anon;

drop function if exists public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
);
create or replace function public.owner_create_security_request(
  p_property_id bigint,
  p_kind text,
  p_post_id uuid default null,
  p_guest_id bigint default null,
  p_guest_name text default null,
  p_expected_at timestamptz default null,
  p_courier_name text default null,
  p_delivery_note text default null,
  p_handover_item text default null,
  p_note text default null,
  p_delivery_mode text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'owner_create_security_request: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_create_security_request: not allowed'
      using errcode = '42501';
  end if;
  perform public.assert_property_not_service_locked(p_property_id, 'security');
  return public.security_insert_request(
    p_property_id, p_post_id, p_kind, 'owner',
    p_guest_id, p_guest_name, p_expected_at,
    p_courier_name, p_delivery_note, p_handover_item, p_note, p_delivery_mode
  );
end;
$fn$;

revoke all on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) from public;
revoke all on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) from anon;
grant execute on function public.owner_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) to authenticated;

drop function if exists public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text
);
create or replace function public.admin_create_security_request(
  p_property_id bigint,
  p_kind text,
  p_post_id uuid default null,
  p_guest_id bigint default null,
  p_guest_name text default null,
  p_expected_at timestamptz default null,
  p_courier_name text default null,
  p_delivery_note text default null,
  p_handover_item text default null,
  p_note text default null,
  p_delivery_mode text default null
)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_create_security_request: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_create_security_request: not allowed'
      using errcode = '42501';
  end if;
  return public.security_insert_request(
    p_property_id, p_post_id, p_kind, 'admin',
    p_guest_id, p_guest_name, p_expected_at,
    p_courier_name, p_delivery_note, p_handover_item, p_note, p_delivery_mode
  );
end;
$fn$;

revoke all on function public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) from public;
revoke all on function public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) from anon;
grant execute on function public.admin_create_security_request(
  bigint, text, uuid, bigint, text, timestamptz, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Guard queue + actions
-- ---------------------------------------------------------------------------

drop function if exists public.guard_list_post_queue();
create or replace function public.guard_list_post_queue()
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  post_id uuid,
  kind text,
  status text,
  delivery_mode text,
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
    r.delivery_mode,
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
    and r.status in ('pending', 'seen', 'at_post')
  order by
    case r.kind
      when 'delivery' then 0
      when 'handover' then 1
      when 'guest_pass' then 2
      else 3
    end,
    case r.status
      when 'pending' then 0
      when 'seen' then 1
      when 'at_post' then 2
      else 3
    end,
    r.created_at asc;
end;
$fn$;

revoke all on function public.guard_list_post_queue() from public;
revoke all on function public.guard_list_post_queue() from anon;
grant execute on function public.guard_list_post_queue() to authenticated;

create or replace function public.guard_assert_request_on_shift(p_request_id uuid)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_shift public.security_shifts%rowtype;
  v_row public.security_requests%rowtype;
begin
  if v_staff is null or not public.has_staff_role('охрана') then
    raise exception 'guard: not allowed'
      using errcode = '42501';
  end if;
  v_shift := public.guard_active_shift();
  if v_shift.id is null then
    raise exception 'guard: no active shift'
      using errcode = 'P0001';
  end if;
  select r.* into v_row
  from public.security_requests as r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'guard: not found'
      using errcode = 'P0002';
  end if;
  if v_row.post_id <> v_shift.post_id then
    raise exception 'guard: wrong post'
      using errcode = '42501';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.guard_assert_request_on_shift(uuid) from public;
revoke all on function public.guard_assert_request_on_shift(uuid) from anon;

drop function if exists public.guard_accept_request(uuid);
drop function if exists public.guard_accept_request(uuid, text);
create or replace function public.guard_mark_seen(p_request_id uuid)
returns public.security_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff integer := public.current_staff_id();
  v_row public.security_requests%rowtype;
begin
  v_row := public.guard_assert_request_on_shift(p_request_id);
  if v_row.status <> 'pending' then
    raise exception 'guard_mark_seen: not pending'
      using errcode = 'P0001';
  end if;
  update public.security_requests as r
     set status = 'seen',
         accepted_by = v_staff,
         accepted_at = now(),
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_mark_seen(uuid) from public;
revoke all on function public.guard_mark_seen(uuid) from anon;
grant execute on function public.guard_mark_seen(uuid) to authenticated;

create or replace function public.guard_receive_at_post(
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
  v_row public.security_requests%rowtype;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
begin
  v_row := public.guard_assert_request_on_shift(p_request_id);
  if v_row.status <> 'seen' then
    raise exception 'guard_receive_at_post: mark seen first'
      using errcode = 'P0001';
  end if;
  if not (
    v_row.kind = 'handover'
    or (v_row.kind = 'delivery' and coalesce(v_row.delivery_mode, 'hold_at_post') = 'hold_at_post')
  ) then
    raise exception 'guard_receive_at_post: not a hold-at-post request'
      using errcode = 'P0001';
  end if;
  if v_photo is not null
     and v_photo not like 'security/' || v_row.property_id::text || '/%' then
    raise exception 'guard_receive_at_post: invalid photo'
      using errcode = '22023';
  end if;

  update public.security_requests as r
     set status = 'at_post',
         accepted_by = coalesce(r.accepted_by, v_staff),
         accepted_at = coalesce(r.accepted_at, now()),
         accepted_photo_path = coalesce(v_photo, r.accepted_photo_path),
         updated_at = now()
   where r.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.guard_receive_at_post(uuid, text) from public;
revoke all on function public.guard_receive_at_post(uuid, text) from anon;
grant execute on function public.guard_receive_at_post(uuid, text) to authenticated;

drop function if exists public.guard_handover_request(uuid);
drop function if exists public.guard_handover_request(uuid, text);
drop function if exists public.guard_handover_request(uuid, text, text);
create or replace function public.guard_complete_request(
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
  v_row public.security_requests%rowtype;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_mode text := nullif(btrim(coalesce(p_completion_mode, '')), '');
  v_delivery_mode text;
begin
  v_row := public.guard_assert_request_on_shift(p_request_id);
  v_delivery_mode := coalesce(v_row.delivery_mode, 'hold_at_post');

  if v_row.kind = 'guest_pass' then
    if v_row.status <> 'seen' then
      raise exception 'guard_complete: mark seen first'
        using errcode = 'P0001';
    end if;
    v_mode := coalesce(v_mode, 'done');
  elsif v_row.kind = 'delivery' and v_delivery_mode = 'courier_pass' then
    if v_row.status <> 'seen' then
      raise exception 'guard_complete: mark seen first'
        using errcode = 'P0001';
    end if;
    v_mode := coalesce(v_mode, 'courier_passed');
  elsif v_row.kind = 'delivery' or v_row.kind = 'handover' then
    -- hold at post
    if v_row.status <> 'at_post' then
      raise exception 'guard_complete: receive at post first'
        using errcode = 'P0001';
    end if;
    v_mode := coalesce(v_mode, 'handed_to_owner');
  else
    raise exception 'guard_complete: unsupported kind'
      using errcode = '22023';
  end if;

  if v_mode not in ('handed_to_owner', 'owner_collected', 'courier_passed', 'done') then
    raise exception 'guard_complete: invalid completion mode'
      using errcode = '22023';
  end if;

  if v_photo is not null then
    if v_photo not like 'security/' || v_row.property_id::text || '/%' then
      raise exception 'guard_complete: invalid photo'
        using errcode = '22023';
    end if;
    if v_row.kind = 'guest_pass' then
      raise exception 'guard_complete: photo not used for guest pass'
        using errcode = '22023';
    end if;
  end if;

  update public.security_requests as r
     set status = 'done',
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

revoke all on function public.guard_complete_request(uuid, text, text) from public;
revoke all on function public.guard_complete_request(uuid, text, text) from anon;
grant execute on function public.guard_complete_request(uuid, text, text) to authenticated;

-- Keep old names as thin wrappers for any cached clients (optional).
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
  v_row public.security_requests%rowtype;
begin
  v_row := public.guard_assert_request_on_shift(p_request_id);
  if v_row.status = 'pending' then
    return public.guard_mark_seen(p_request_id);
  end if;
  if v_row.status = 'seen' then
    return public.guard_receive_at_post(p_request_id, p_photo_path);
  end if;
  raise exception 'guard_accept_request: invalid status'
    using errcode = 'P0001';
end;
$fn$;

revoke all on function public.guard_accept_request(uuid, text) from public;
revoke all on function public.guard_accept_request(uuid, text) from anon;
grant execute on function public.guard_accept_request(uuid, text) to authenticated;

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
begin
  return public.guard_complete_request(p_request_id, p_photo_path, p_completion_mode);
end;
$fn$;

revoke all on function public.guard_handover_request(uuid, text, text) from public;
revoke all on function public.guard_handover_request(uuid, text, text) from anon;
grant execute on function public.guard_handover_request(uuid, text, text) to authenticated;

-- Admin list: expose delivery_mode / completion_mode via setof row (existing returns table — refresh)
drop function if exists public.admin_list_security_requests(text, integer);
create or replace function public.admin_list_security_requests(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  property_id bigint,
  apartment_number text,
  post_id uuid,
  post_name text,
  kind text,
  status text,
  delivery_mode text,
  created_by_role text,
  created_by_email text,
  guest_name text,
  expected_at timestamptz,
  courier_name text,
  delivery_note text,
  handover_item text,
  note text,
  accepted_at timestamptz,
  handed_over_at timestamptz,
  completion_mode text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if auth.uid() is null then
    raise exception 'admin_list_security_requests: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_security_requests: not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.property_id,
    p.apartment_number::text,
    r.post_id,
    sp.name,
    r.kind,
    r.status,
    r.delivery_mode,
    r.created_by_role,
    r.created_by_email,
    r.guest_name,
    r.expected_at,
    r.courier_name,
    r.delivery_note,
    r.handover_item,
    r.note,
    r.accepted_at,
    r.handed_over_at,
    r.completion_mode,
    r.created_at
  from public.security_requests as r
  join public.properties as p on p.id = r.property_id
  join public.security_posts as sp on sp.id = r.post_id
  where (v_status is null or r.status = v_status)
  order by r.created_at desc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_security_requests(text, integer) from public;
revoke all on function public.admin_list_security_requests(text, integer) from anon;
grant execute on function public.admin_list_security_requests(text, integer) to authenticated;

commit;
