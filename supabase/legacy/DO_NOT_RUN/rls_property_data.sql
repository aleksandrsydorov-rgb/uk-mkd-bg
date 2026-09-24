-- Restrictive RLS for property-scoped tables.
-- Apply after public.is_staff(), public.is_owner(), public.owns_property(bigint).

begin;

-- ---------------------------------------------------------------------------
-- Trigger functions (SECURITY DEFINER; execute only via triggers)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_requests_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'requests: update allowed only for active staff'
      using errcode = '42501';
  end if;

  if (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') then
    raise exception 'requests: only status may be updated'
      using errcode = '42501';
  end if;

  if NEW.status is distinct from 'новая'
     and NEW.status is distinct from 'в работе'
     and NEW.status is distinct from 'выполнена'
     and NEW.status is distinct from 'отклонена' then
    raise exception 'requests: invalid status'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

revoke all on function public.enforce_requests_update() from public;
revoke execute on function public.enforce_requests_update() from anon;
revoke execute on function public.enforce_requests_update() from authenticated;

create or replace function public.enforce_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_ack boolean;
  staff_ack boolean;
begin
  owner_ack :=
    public.owns_property(OLD.property_id)
    and OLD.sender = 'uk'
    and NEW.read_by_owner is true
    and (to_jsonb(NEW) - 'read_by_owner') = (to_jsonb(OLD) - 'read_by_owner');

  staff_ack :=
    public.is_staff()
    and OLD.sender is distinct from 'uk'
    and NEW.read_by_uk is true
    and (to_jsonb(NEW) - 'read_by_uk') = (to_jsonb(OLD) - 'read_by_uk');

  if owner_ack or staff_ack then
    return NEW;
  end if;

  raise exception 'chat_messages: only read acknowledgement is allowed'
    using errcode = '42501';
end;
$$;

revoke all on function public.enforce_chat_message_update() from public;
revoke execute on function public.enforce_chat_message_update() from anon;
revoke execute on function public.enforce_chat_message_update() from authenticated;

create or replace function public.enforce_owner_transfer_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prop_email text;
  prop_name text;
  prop_phone text;
begin
  if not public.owns_property(NEW.property_id) then
    raise exception 'owner_transfers: insert allowed only for the property owner'
      using errcode = '42501';
  end if;

  if lower(btrim(NEW.status)) is distinct from 'ожидает' then
    raise exception 'owner_transfers: insert status must be ожидает'
      using errcode = '42501';
  end if;

  if NEW.decided_at is not null
     or NEW.decided_by is not null
     or NEW.reject_reason is not null then
    raise exception 'owner_transfers: decision fields must be null on insert'
      using errcode = '42501';
  end if;

  select p.owner_email, p.owner_name, p.owner_phone
    into prop_email, prop_name, prop_phone
  from public.properties as p
  where p.id = NEW.property_id;

  if not found then
    raise exception 'owner_transfers: property not found'
      using errcode = '42501';
  end if;

  if lower(btrim(NEW.from_owner_email)) is distinct from lower(btrim(prop_email)) then
    raise exception 'owner_transfers: from_owner_email must match the property owner'
      using errcode = '42501';
  end if;

  if NEW.from_owner_name is distinct from prop_name then
    raise exception 'owner_transfers: from_owner_name must match the property owner'
      using errcode = '42501';
  end if;

  if NEW.from_owner_phone is distinct from prop_phone then
    raise exception 'owner_transfers: from_owner_phone must match the property owner'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

revoke all on function public.enforce_owner_transfer_insert() from public;
revoke execute on function public.enforce_owner_transfer_insert() from anon;
revoke execute on function public.enforce_owner_transfer_insert() from authenticated;

create or replace function public.enforce_owner_transfer_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'owner_transfers: update allowed only for active staff'
      using errcode = '42501';
  end if;

  if (
    to_jsonb(NEW) - 'status' - 'decided_at' - 'decided_by' - 'reject_reason'
  ) <> (
    to_jsonb(OLD) - 'status' - 'decided_at' - 'decided_by' - 'reject_reason'
  ) then
    raise exception 'owner_transfers: only decision fields may be updated'
      using errcode = '42501';
  end if;

  if NEW.status is distinct from 'утверждена'
     and NEW.status is distinct from 'отклонена' then
    raise exception 'owner_transfers: invalid decision status'
      using errcode = '42501';
  end if;

  if NEW.decided_at is null then
    raise exception 'owner_transfers: decided_at is required'
      using errcode = '42501';
  end if;

  if lower(btrim(NEW.decided_by)) is distinct from lower(btrim(auth.email())) then
    raise exception 'owner_transfers: decided_by must match the current user'
      using errcode = '42501';
  end if;

  if NEW.status = 'утверждена' and NEW.reject_reason is not null then
    raise exception 'owner_transfers: reject_reason must be null when approved'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

revoke all on function public.enforce_owner_transfer_update() from public;
revoke execute on function public.enforce_owner_transfer_update() from anon;
revoke execute on function public.enforce_owner_transfer_update() from authenticated;

-- ---------------------------------------------------------------------------
-- requests
-- ---------------------------------------------------------------------------

alter table public.requests enable row level security;

drop policy if exists requests_all on public.requests;

revoke all on table public.requests from anon;
revoke all on table public.requests from authenticated;

grant select, insert, update, delete
on table public.requests
to authenticated;

create policy requests_owner_staff_select
on public.requests
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy requests_owner_insert
on public.requests
for insert
to authenticated
with check (
  public.owns_property(property_id)
  and lower(btrim(coalesce(status, ''))) = 'новая'
);

create policy requests_staff_update
on public.requests
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

create policy requests_staff_delete
on public.requests
for delete
to authenticated
using (public.is_staff());

drop trigger if exists enforce_requests_update on public.requests;
create trigger enforce_requests_update
before update on public.requests
for each row
execute function public.enforce_requests_update();

-- ---------------------------------------------------------------------------
-- meter_readings
-- ---------------------------------------------------------------------------

alter table public.meter_readings enable row level security;

drop policy if exists meter_readings_all on public.meter_readings;

revoke all on table public.meter_readings from anon;
revoke all on table public.meter_readings from authenticated;

grant select, insert, delete
on table public.meter_readings
to authenticated;

create policy meter_readings_owner_staff_select
on public.meter_readings
for select
to authenticated
using (
  public.is_staff()
  or (
    property_id is not null
    and public.owns_property(property_id)
  )
);

create policy meter_readings_staff_insert
on public.meter_readings
for insert
to authenticated
with check (public.is_staff());

create policy meter_readings_staff_delete
on public.meter_readings
for delete
to authenticated
using (public.is_staff());

-- ---------------------------------------------------------------------------
-- apartment_guests
-- ---------------------------------------------------------------------------

alter table public.apartment_guests enable row level security;

drop policy if exists allow_all_guests_dev on public.apartment_guests;
drop policy if exists apartment_guests_all on public.apartment_guests;

revoke all on table public.apartment_guests from anon;
revoke all on table public.apartment_guests from authenticated;

grant select, insert, delete
on table public.apartment_guests
to authenticated;

create policy apartment_guests_owner_staff_select
on public.apartment_guests
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy apartment_guests_owner_staff_insert
on public.apartment_guests
for insert
to authenticated
with check (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy apartment_guests_owner_staff_delete
on public.apartment_guests
for delete
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

-- ---------------------------------------------------------------------------
-- apartment_pets
-- ---------------------------------------------------------------------------

alter table public.apartment_pets enable row level security;

drop policy if exists apartment_pets_all on public.apartment_pets;

revoke all on table public.apartment_pets from anon;
revoke all on table public.apartment_pets from authenticated;

grant select, insert, delete
on table public.apartment_pets
to authenticated;

create policy apartment_pets_owner_staff_select
on public.apartment_pets
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy apartment_pets_owner_staff_insert
on public.apartment_pets
for insert
to authenticated
with check (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy apartment_pets_owner_staff_delete
on public.apartment_pets
for delete
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_all on public.chat_messages;
drop policy if exists owner_insert_chat on public.chat_messages;
drop policy if exists owner_read_own_chat on public.chat_messages;

revoke all on table public.chat_messages from anon;
revoke all on table public.chat_messages from authenticated;

grant select, insert, update
on table public.chat_messages
to authenticated;

create policy chat_messages_owner_staff_select
on public.chat_messages
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy chat_messages_owner_insert
on public.chat_messages
for insert
to authenticated
with check (
  public.owns_property(property_id)
  and sender = 'owner'
  and coalesce(read_by_uk, false) = false
);

create policy chat_messages_staff_insert
on public.chat_messages
for insert
to authenticated
with check (
  public.is_staff()
  and sender = 'uk'
  and coalesce(read_by_owner, false) = false
);

create policy chat_messages_owner_staff_update
on public.chat_messages
for update
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
)
with check (
  public.is_staff()
  or public.owns_property(property_id)
);

drop trigger if exists enforce_chat_message_update on public.chat_messages;
create trigger enforce_chat_message_update
before update on public.chat_messages
for each row
execute function public.enforce_chat_message_update();

-- ---------------------------------------------------------------------------
-- owner_transfers
-- ---------------------------------------------------------------------------

alter table public.owner_transfers enable row level security;

drop policy if exists owner_transfers_all on public.owner_transfers;
drop policy if exists owner_transfers_delete on public.owner_transfers;
drop policy if exists owner_transfers_insert on public.owner_transfers;
drop policy if exists owner_transfers_select on public.owner_transfers;
drop policy if exists owner_transfers_update on public.owner_transfers;

revoke all on table public.owner_transfers from anon;
revoke all on table public.owner_transfers from authenticated;

grant select, insert, update
on table public.owner_transfers
to authenticated;

create policy owner_transfers_owner_staff_select
on public.owner_transfers
for select
to authenticated
using (
  public.is_staff()
  or public.owns_property(property_id)
);

create policy owner_transfers_owner_insert
on public.owner_transfers
for insert
to authenticated
with check (
  public.owns_property(property_id)
  and lower(btrim(status)) = 'ожидает'
  and decided_at is null
  and decided_by is null
  and reject_reason is null
);

create policy owner_transfers_staff_update
on public.owner_transfers
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop trigger if exists enforce_owner_transfer_insert on public.owner_transfers;
create trigger enforce_owner_transfer_insert
before insert on public.owner_transfers
for each row
execute function public.enforce_owner_transfer_insert();

drop trigger if exists enforce_owner_transfer_update on public.owner_transfers;
create trigger enforce_owner_transfer_update
before update on public.owner_transfers
for each row
execute function public.enforce_owner_transfer_update();

commit;
