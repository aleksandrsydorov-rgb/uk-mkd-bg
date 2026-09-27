-- Stage 2: ownership access from book + property invites (24h).

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- owns_property: legacy owner_email OR active book owner email
-- ---------------------------------------------------------------------------

create or replace function public.owns_property(property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    auth.email() is not null
    and (
      exists (
        select 1
        from public.properties as p
        where p.id = owns_property.property_id
          and lower(btrim(coalesce(p.owner_email, ''))) = lower(btrim(auth.email()))
      )
      or exists (
        select 1
        from public.property_registry_people as r
        where r.property_id = owns_property.property_id
          and r.relation_type = 'owner'
          and r.deregistered_at is null
          and lower(btrim(coalesce(r.email, ''))) = lower(btrim(auth.email()))
      )
    );
$fn$;

revoke all on function public.owns_property(bigint) from public;
revoke all on function public.owns_property(bigint) from anon;
grant execute on function public.owns_property(bigint) to authenticated;

create or replace function public.list_my_owned_properties()
returns setof public.properties
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.*
  from public.properties as p
  where public.owns_property(p.id)
  order by p.apartment_number::text;
$fn$;

revoke all on function public.list_my_owned_properties() from public;
revoke all on function public.list_my_owned_properties() from anon;
grant execute on function public.list_my_owned_properties() to authenticated;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

create table if not exists public.property_access_invites (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  email text not null,
  token_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  invited_by_staff_id integer null
    references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  constraint property_access_invites_email_chk
    check (btrim(email) <> '')
);

create unique index if not exists property_access_invites_token_hash_uidx
  on public.property_access_invites (token_hash);

create index if not exists property_access_invites_property_email_idx
  on public.property_access_invites (property_id, lower(email));

create index if not exists property_access_invites_pending_idx
  on public.property_access_invites (property_id, status)
  where status = 'pending';

alter table public.property_access_invites enable row level security;

drop policy if exists property_access_invites_admin_select on public.property_access_invites;
create policy property_access_invites_admin_select
  on public.property_access_invites
  for select
  to authenticated
  using (public.has_staff_role('администрация'));

revoke all on table public.property_access_invites from public;
revoke all on table public.property_access_invites from anon;
grant select on table public.property_access_invites to authenticated;

create or replace function public.admin_create_property_invite(
  p_property_id bigint,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_staff integer := public.current_staff_id();
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now() + interval '24 hours';
begin
  perform public.admin_assert_book_admin();
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'admin_create_property_invite: email required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_create_property_invite: property not found'
      using errcode = 'P0002';
  end if;

  -- expire previous pending for same pair
  update public.property_access_invites as i
     set status = 'expired'
   where i.property_id = p_property_id
     and lower(i.email) = v_email
     and i.status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.property_access_invites (
    property_id, email, token_hash, status, expires_at, invited_by_staff_id
  ) values (
    p_property_id, v_email, v_hash, 'pending', v_expires, v_staff
  )
  returning id into v_id;

  -- Ensure book has an owner stub with this email if missing (natural, sole share TBD by admin).
  -- Do not invent shares — only attach email context note via invite; book remains source of truth.

  return jsonb_build_object(
    'id', v_id,
    'property_id', p_property_id,
    'email', v_email,
    'expires_at', v_expires,
    'token', v_token,
    'status', 'pending'
  );
end;
$fn$;

revoke all on function public.admin_create_property_invite(bigint, text) from public;
revoke all on function public.admin_create_property_invite(bigint, text) from anon;
grant execute on function public.admin_create_property_invite(bigint, text) to authenticated;

create or replace function public.admin_revoke_property_invite(p_invite_id uuid)
returns public.property_access_invites
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_access_invites%rowtype;
begin
  perform public.admin_assert_book_admin();
  update public.property_access_invites as i
     set status = 'revoked'
   where i.id = p_invite_id
     and i.status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'admin_revoke_property_invite: not found or not pending'
      using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.admin_revoke_property_invite(uuid) from public;
revoke all on function public.admin_revoke_property_invite(uuid) from anon;
grant execute on function public.admin_revoke_property_invite(uuid) to authenticated;

create or replace function public.admin_list_property_invites(p_property_id bigint)
returns setof public.property_access_invites
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.admin_assert_book_admin();
  return query
  select i.*
  from public.property_access_invites as i
  where i.property_id = p_property_id
  order by i.created_at desc
  limit 50;
end;
$fn$;

revoke all on function public.admin_list_property_invites(bigint) from public;
revoke all on function public.admin_list_property_invites(bigint) from anon;
grant execute on function public.admin_list_property_invites(bigint) to authenticated;

-- Public accept: validate token, mark accepted, return email + apartment (for signup / login).
create or replace function public.accept_property_invite(
  p_token text,
  p_mark_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_hash text;
  v_row public.property_access_invites%rowtype;
  v_apt text;
begin
  if v_token is null then
    raise exception 'accept_property_invite: token required'
      using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select i.* into v_row
  from public.property_access_invites as i
  where i.token_hash = v_hash
  for update;

  if not found then
    raise exception 'accept_property_invite: invalid token'
      using errcode = 'P0002';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'accept_property_invite: revoked'
      using errcode = 'P0001';
  end if;

  if v_row.status = 'accepted' then
    select p.apartment_number::text into v_apt
    from public.properties as p where p.id = v_row.property_id;
    return jsonb_build_object(
      'status', 'accepted',
      'email', v_row.email,
      'property_id', v_row.property_id,
      'apartment_number', v_apt,
      'already_accepted', true
    );
  end if;

  if v_row.status <> 'pending' or v_row.expires_at < now() then
    update public.property_access_invites as i
       set status = 'expired'
     where i.id = v_row.id and i.status = 'pending';
    raise exception 'accept_property_invite: expired'
      using errcode = 'P0001';
  end if;

  if p_mark_accepted then
    update public.property_access_invites as i
       set status = 'accepted',
           accepted_at = now()
     where i.id = v_row.id
    returning * into v_row;
  end if;

  select p.apartment_number::text into v_apt
  from public.properties as p where p.id = v_row.property_id;

  return jsonb_build_object(
    'status', v_row.status,
    'email', v_row.email,
    'property_id', v_row.property_id,
    'apartment_number', v_apt,
    'expires_at', v_row.expires_at,
    'already_accepted', false
  );
end;
$fn$;

revoke all on function public.accept_property_invite(text, boolean) from public;
revoke all on function public.accept_property_invite(text, boolean) from anon;
grant execute on function public.accept_property_invite(text, boolean) to anon;
grant execute on function public.accept_property_invite(text, boolean) to authenticated;

commit;
