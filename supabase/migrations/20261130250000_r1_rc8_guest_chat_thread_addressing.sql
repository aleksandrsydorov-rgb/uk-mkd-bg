-- =============================================================================
-- R1-RC8 — Guest chat thread addressing + owner isolation
-- =============================================================================
-- UK replies must target an explicit guest_access_id (or owner thread null).
-- Owners never see other guests' threads; guests see only their own access id.
-- Server validates guest_access_id belongs to the same property on UK insert.
-- =============================================================================

begin;

-- Owners: only owner thread (guest_access_id is null). Guests: own access only.
drop policy if exists chat_messages_admin_owner_select on public.chat_messages;
create policy chat_messages_admin_owner_select
on public.chat_messages
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or (
    public.owns_property(property_id)
    and guest_access_id is null
  )
  or (
    public.guest_has_action(property_id, 'chat.with_uk')
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
  )
);

drop policy if exists chat_messages_admin_owner_update on public.chat_messages;
create policy chat_messages_admin_owner_update
on public.chat_messages
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or (
    public.owns_property(property_id)
    and guest_access_id is null
  )
  or (
    public.guest_has_action(property_id, 'chat.with_uk')
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
  )
)
with check (
  public.has_staff_role('администрация')
  or (
    public.owns_property(property_id)
    and guest_access_id is null
  )
  or (
    public.guest_has_action(property_id, 'chat.with_uk')
    and guest_access_id is not null
    and guest_access_id = public.guest_caller_access_id(property_id)
  )
);

-- UK insert: guest_access_id must be null (owner thread) or a real access on this property.
drop policy if exists chat_messages_admin_insert on public.chat_messages;
create policy chat_messages_admin_insert
on public.chat_messages
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  and sender = 'uk'
  and coalesce(read_by_owner, false) = false
  and (
    guest_access_id is null
    or exists (
      select 1
      from public.property_guest_accesses as g
      where g.id = guest_access_id
        and g.property_id = chat_messages.property_id
    )
  )
);

-- Explicit staff reply RPC: refuses mismatched dialog / property / guest.
create or replace function public.admin_reply_chat_message(
  p_property_id bigint,
  p_message text,
  p_guest_access_id uuid default null,
  p_photo_url text default null,
  p_file_name text default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_msg text := btrim(coalesce(p_message, ''));
  v_row public.chat_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'admin_reply_chat_message: not authenticated' using errcode = '28000';
  end if;
  if not public.has_staff_role(
    convert_from(decode('d0b0d0b4d0bcd0b8d0bdd0b8d181d182d180d0b0d186d0b8d18f', 'hex'), 'utf8')
  ) then
    raise exception 'admin_reply_chat_message: not allowed' using errcode = '42501';
  end if;
  if p_property_id is null then
    raise exception 'admin_reply_chat_message: property required' using errcode = '22023';
  end if;
  if v_msg = '' and nullif(btrim(coalesce(p_photo_url, '')), '') is null then
    raise exception 'admin_reply_chat_message: empty message' using errcode = '22023';
  end if;

  if p_guest_access_id is not null then
    if not exists (
      select 1
      from public.property_guest_accesses as g
      where g.id = p_guest_access_id
        and g.property_id = p_property_id
    ) then
      raise exception 'admin_reply_chat_message: guest_access_id does not match property'
        using errcode = '22023';
    end if;
  end if;

  insert into public.chat_messages (
    property_id, sender, message, read_by_uk, read_by_owner,
    guest_access_id, photo_url, file_name
  ) values (
    p_property_id,
    'uk',
    v_msg,
    true,
    false,
    p_guest_access_id,
    nullif(btrim(coalesce(p_photo_url, '')), ''),
    nullif(btrim(coalesce(p_file_name, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_reply_chat_message(bigint, text, uuid, text, text) from public, anon;
grant execute on function public.admin_reply_chat_message(bigint, text, uuid, text, text) to authenticated;

commit;
