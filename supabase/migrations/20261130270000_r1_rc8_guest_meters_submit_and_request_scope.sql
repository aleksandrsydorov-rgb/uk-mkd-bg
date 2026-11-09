-- =============================================================================
-- R1-RC8 — Guest meter submit list (real schema) + request/security access scope
-- =============================================================================
-- guest_list_meters_for_submit must use retired_at (no is_active on meters).
-- Requests/security rows created by guests bind to guest_access_id so one email
-- cannot open another guest access or another apartment's rows.
-- =============================================================================

begin;

-- Bind guest-created requests to a concrete guest_access row.
alter table public.requests
  add column if not exists guest_access_id uuid
  references public.property_guest_accesses (id) on delete set null;

create index if not exists requests_guest_access_id_idx
  on public.requests (guest_access_id)
  where guest_access_id is not null;

alter table public.security_requests
  add column if not exists guest_access_id uuid
  references public.property_guest_accesses (id) on delete set null;

create index if not exists security_requests_guest_access_id_idx
  on public.security_requests (guest_access_id)
  where guest_access_id is not null;

create or replace function public.guest_list_meters_for_submit(p_property_id bigint, p_utility text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_util text := lower(btrim(coalesce(p_utility, '')));
  v_action text;
  v_out jsonb := '[]'::jsonb;
begin
  if v_util = 'water' then
    v_action := 'water.submit_readings';
  elsif v_util = 'electricity' then
    v_action := 'electricity.submit_readings';
  else
    raise exception 'guest_list_meters_for_submit: utility invalid' using errcode = '22023';
  end if;
  if not public.guest_has_action(p_property_id, v_action) then
    raise exception 'Not authorized.';
  end if;
  if v_util = 'water' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'meter_id', m.id,
      'meter_number', m.meter_number,
      'unit', 'm3',
      'initial_reading', m.initial_reading,
      'last_value', (
        select r.current_value
        from public.water_readings as r
        where r.meter_id = m.id
          and coalesce(r.status, 'active') = 'active'
        order by r.reading_date desc, r.created_at desc
        limit 1
      )
    ) order by m.meter_number), '[]'::jsonb)
    into v_out
    from public.water_meters as m
    where m.property_id = p_property_id
      and m.retired_at is null;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'meter_id', m.id,
      'meter_number', m.meter_number,
      'has_day_night', true,
      'initial_day_reading', m.initial_day_reading,
      'initial_night_reading', m.initial_night_reading,
      'last_day_value', (
        select r.value
        from public.meter_readings as r
        where r.electricity_meter_id = m.id
          and r.meter_type = 'electricity_day'
          and coalesce(r.status, 'active') = 'active'
        order by r.reading_date desc, r.created_at desc
        limit 1
      ),
      'last_night_value', (
        select r.value
        from public.meter_readings as r
        where r.electricity_meter_id = m.id
          and r.meter_type = 'electricity_night'
          and coalesce(r.status, 'active') = 'active'
        order by r.reading_date desc, r.created_at desc
        limit 1
      )
    ) order by m.meter_number), '[]'::jsonb)
    into v_out
    from public.electricity_meters as m
    where m.property_id = p_property_id
      and m.retired_at is null;
  end if;
  return coalesce(v_out, '[]'::jsonb);
end;
$fn$;

revoke all on function public.guest_list_meters_for_submit(bigint, text) from public, anon;
grant execute on function public.guest_list_meters_for_submit(bigint, text) to authenticated;

-- Guest select/insert must bind guest_access_id (not email alone across accesses).
drop policy if exists requests_admin_owner_select on public.requests;
create policy requests_admin_owner_select
on public.requests
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
  or (
    public.guest_has_action(property_id, 'requests.own')
    and created_by_role = 'guest'
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
    and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
  )
);

drop policy if exists requests_owner_guest_insert on public.requests;
create policy requests_owner_guest_insert
on public.requests
for insert
to authenticated
with check (
  (
    (
      public.owns_property(property_id)
      and coalesce(created_by_role, 'owner') = 'owner'
      and guest_access_id is null
    )
    or (
      public.guest_has_action(property_id, 'requests.own')
      and created_by_role = 'guest'
      and guest_access_id is not null
      and public.guest_access_matches_caller(guest_access_id, property_id)
      and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
    )
  )
  and lower(btrim(coalesce(status, ''))) = 'новая'
);

drop policy if exists security_requests_select on public.security_requests;
create policy security_requests_select on public.security_requests
  for select to authenticated
  using (
    public.has_staff_role('администрация')
    or public.has_staff_role('охрана')
    or public.owns_property(property_id)
    or (
      public.guest_has_action(property_id, 'security.own')
      and created_by_role = 'guest'
      and guest_access_id is not null
      and guest_access_id = public.guest_caller_access_id(property_id)
      and lower(btrim(coalesce(created_by_email, ''))) = lower(btrim(coalesce(auth.email(), '')))
    )
  );

-- Ensure security_request insert path stamps guest_access_id for guests.
create or replace function public.guest_stamp_security_request_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_access uuid;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if coalesce(new.created_by_role, '') <> 'guest' then
    new.guest_access_id := null;
    return new;
  end if;
  v_access := public.guest_caller_access_id(new.property_id);
  if v_access is null then
    raise exception 'Not authorized.';
  end if;
  if new.guest_access_id is null then
    new.guest_access_id := v_access;
  elsif new.guest_access_id is distinct from v_access then
    raise exception 'Not authorized.';
  end if;
  if not public.guest_has_action(new.property_id, 'security.own') then
    raise exception 'Not authorized.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists security_requests_guest_access_trg on public.security_requests;
create trigger security_requests_guest_access_trg
  before insert on public.security_requests
  for each row
  execute function public.guest_stamp_security_request_access();

create or replace function public.guest_stamp_request_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_access uuid;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if coalesce(new.created_by_role, '') <> 'guest' then
    new.guest_access_id := null;
    return new;
  end if;
  v_access := public.guest_caller_access_id(new.property_id);
  if v_access is null then
    raise exception 'Not authorized.';
  end if;
  if new.guest_access_id is null then
    new.guest_access_id := v_access;
  elsif new.guest_access_id is distinct from v_access then
    raise exception 'Not authorized.';
  end if;
  if not public.guest_has_action(new.property_id, 'requests.own') then
    raise exception 'Not authorized.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists requests_guest_access_trg on public.requests;
create trigger requests_guest_access_trg
  before insert on public.requests
  for each row
  execute function public.guest_stamp_request_access();

-- Finance balance RPCs already require owns_property or staff; guests are refused server-side.
-- services.overview therefore cannot obtain protected ledger totals via those RPCs.

commit;
