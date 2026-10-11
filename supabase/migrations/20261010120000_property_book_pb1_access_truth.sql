-- PB-1: Property Book access truth (BOOK-ONLY authorization).
-- properties.owner_email NEVER grants access. Portal owner_* are display mirrors only.
-- NO destructive data changes. NO automatic production owner rewrites.

begin;

create or replace function public.property_book_set_mutating(p_on boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform set_config('property_book.mutating', case when p_on then '1' else '0' end, true);
end;
$fn$;

revoke all on function public.property_book_set_mutating(boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- Invite: reference specific Book owner row
-- ---------------------------------------------------------------------------

alter table public.property_access_invites
  add column if not exists registry_people_id bigint null
    references public.property_registry_people (id) on delete set null;

alter table public.property_access_invites
  add column if not exists superseded_by_invite_id uuid null
    references public.property_access_invites (id) on delete set null;

alter table public.property_access_invites
  add column if not exists delivery_channel text null;

alter table public.property_access_invites
  add column if not exists delivery_status text null;

comment on column public.property_access_invites.registry_people_id is
  'PB-1: active Book owner row this invite is for. Registration never mutates Book.';
comment on column public.property_access_invites.delivery_status is
  'Honest delivery: COPY_LINK | LOCAL_ONLY | PROVIDER_NOT_CONFIGURED | SENT (future).';

create index if not exists property_access_invites_registry_people_idx
  on public.property_access_invites (registry_people_id)
  where registry_people_id is not null;

-- ---------------------------------------------------------------------------
-- Access eligibility (PB-1.4): required ownership info for owner access/invites
-- Does NOT affect meeting quorum denominators.
-- ---------------------------------------------------------------------------

create or replace function public.property_book_owner_row_access_ready(
  p_owner public.property_registry_people
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_prop public.properties%rowtype;
begin
  if p_owner.relation_type is distinct from 'owner' then
    return false;
  end if;
  if p_owner.deregistered_at is not null then
    return false;
  end if;
  if nullif(btrim(coalesce(p_owner.email, '')), '') is null
     or position('@' in p_owner.email) = 0 then
    return false;
  end if;
  if p_owner.ownership_share_percent is null or p_owner.ownership_share_percent <= 0 then
    return false;
  end if;
  if p_owner.ideal_parts_percent is null or p_owner.ideal_parts_percent < 0 then
    return false;
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = p_owner.property_id;
  if not found then
    return false;
  end if;
  if v_prop.ownership_type is null
     or v_prop.ownership_type not in ('sole', 'shared') then
    return false;
  end if;

  if p_owner.entity_kind = 'legal_entity' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null then
      return false;
    end if;
    if nullif(btrim(coalesce(p_owner.eik_bulstat, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'natural_person' then
    if nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
       or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null then
      return false;
    end if;
  elsif p_owner.entity_kind = 'sole_trader' then
    if nullif(btrim(coalesce(p_owner.entity_name, '')), '') is null
       and (
         nullif(btrim(coalesce(p_owner.first_name, '')), '') is null
         or nullif(btrim(coalesce(p_owner.last_name, '')), '') is null
       ) then
      return false;
    end if;
  else
    return false;
  end if;

  return true;
end;
$fn$;

revoke all on function public.property_book_owner_row_access_ready(public.property_registry_people)
  from public, anon;

create or replace function public.property_book_active_owner_by_email(
  p_property_id bigint,
  p_email text
)
returns public.property_registry_people
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_row public.property_registry_people%rowtype;
begin
  if v_email is null then
    return null;
  end if;
  select r.* into v_row
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and lower(btrim(coalesce(r.email, ''))) = v_email
  order by r.id
  limit 1;
  return v_row;
end;
$fn$;

revoke all on function public.property_book_active_owner_by_email(bigint, text) from public, anon;

-- ---------------------------------------------------------------------------
-- owns_property (BOOK-ONLY): active Book owner + access-ready fields.
-- properties.owner_email is never consulted. Sessions re-check each call.
-- ---------------------------------------------------------------------------

create or replace function public.owns_property(property_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_owner public.property_registry_people%rowtype;
begin
  if v_email is null or auth.uid() is null then
    return false;
  end if;

  v_owner := public.property_book_active_owner_by_email(property_id, v_email);
  if v_owner.id is null then
    return false;
  end if;
  return public.property_book_owner_row_access_ready(v_owner);
end;
$fn$;

revoke all on function public.owns_property(bigint) from public, anon;
grant execute on function public.owns_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Ops audit (read-only): portal mirror vs Book — never used for authorization.
-- ---------------------------------------------------------------------------

create or replace function public.property_book_ownership_audit_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_portal_only jsonb := '[]'::jsonb;
  v_mismatch jsonb := '[]'::jsonb;
  v_dup_emails jsonb := '[]'::jsonb;
  v_stale_invites jsonb := '[]'::jsonb;
  v_conflict jsonb := '[]'::jsonb;
begin
  perform public.admin_assert_book_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
    'property_id', p.id,
    'apartment_number', p.apartment_number,
    'portal_owner_email', lower(btrim(p.owner_email)),
    'issue', 'portal_email_without_book_owners'
  ) order by p.apartment_number), '[]'::jsonb)
  into v_portal_only
  from public.properties as p
  where nullif(btrim(coalesce(p.owner_email, '')), '') is not null
    and position('@' in p.owner_email) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'property_id', p.id,
    'apartment_number', p.apartment_number,
    'portal_owner_email', lower(btrim(p.owner_email)),
    'issue', 'portal_email_not_in_active_book'
  ) order by p.apartment_number), '[]'::jsonb)
  into v_mismatch
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
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'property_id', d.property_id,
    'email', d.email,
    'owner_row_count', d.cnt,
    'issue', 'duplicate_active_owner_email'
  )), '[]'::jsonb)
  into v_dup_emails
  from (
    select r.property_id, lower(btrim(r.email)) as email, count(*)::int as cnt
    from public.property_registry_people as r
    where r.relation_type = 'owner' and r.deregistered_at is null
      and nullif(btrim(coalesce(r.email, '')), '') is not null
    group by r.property_id, lower(btrim(r.email))
    having count(*) > 1
  ) as d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invite_id', i.id,
    'property_id', i.property_id,
    'email', i.email,
    'issue', 'invite_stale_owner'
  )), '[]'::jsonb)
  into v_stale_invites
  from public.property_access_invites as i
  where i.status = 'pending' and i.expires_at >= now()
    and (
      i.registry_people_id is null
      or not exists (
        select 1 from public.property_registry_people as r
        where r.id = i.registry_people_id and r.property_id = i.property_id
          and r.relation_type = 'owner' and r.deregistered_at is null
          and lower(btrim(coalesce(r.email, ''))) = lower(btrim(i.email))
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'property_id', p.id,
    'apartment_number', p.apartment_number,
    'validation', public.property_book_validate(p.id),
    'issue', 'book_validation_failed_with_owners'
  )), '[]'::jsonb)
  into v_conflict
  from public.properties as p
  where exists (
      select 1 from public.property_registry_people as r
      where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
    )
    and not coalesce((public.property_book_validate(p.id) ->> 'ok')::boolean, false);

  return jsonb_build_object(
    'authorization', 'book_only',
    'portal_email_without_book_owners', v_portal_only,
    'portal_email_not_in_active_book', v_mismatch,
    'duplicate_owner_emails', v_dup_emails,
    'stale_pending_invites', v_stale_invites,
    'conflicting_book_validation', v_conflict,
    'note', 'Portal owner_* fields never authorize access. Fix Book rows for cabinet access.'
  );
end;
$fn$;

revoke all on function public.property_book_ownership_audit_report() from public, anon;
grant execute on function public.property_book_ownership_audit_report() to authenticated;

-- ---------------------------------------------------------------------------
-- Sync denormalized portal owner_* from Book (display only; never authorizes).
-- Called only from Book mutation paths.
-- ---------------------------------------------------------------------------

create or replace function public.property_book_sync_portal_owner_fields(p_property_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner public.property_registry_people%rowtype;
  v_name text;
begin
  perform public.property_book_set_mutating(true);

  select r.* into v_owner
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id
  limit 1;

  if not found then
    update public.properties as p
       set owner_email = null,
           owner_name = null
     where p.id = p_property_id;
    return;
  end if;

  if v_owner.entity_kind in ('legal_entity', 'sole_trader') then
    v_name := nullif(btrim(coalesce(v_owner.entity_name, '')), '');
  else
    v_name := nullif(btrim(concat_ws(' ',
      nullif(btrim(coalesce(v_owner.first_name, '')), ''),
      nullif(btrim(coalesce(v_owner.middle_name, '')), ''),
      nullif(btrim(coalesce(v_owner.last_name, '')), '')
    )), '');
  end if;

  update public.properties as p
     set owner_email = lower(nullif(btrim(coalesce(v_owner.email, '')), '')),
         owner_name = v_name,
         owner_type = case
           when v_owner.entity_kind = 'legal_entity' then 'юридическое лицо'
           when v_owner.entity_kind = 'sole_trader' then 'ЕТ'
           else 'физическое лицо'
         end,
         company_name = case
           when v_owner.entity_kind in ('legal_entity', 'sole_trader')
             then nullif(btrim(coalesce(v_owner.entity_name, '')), '')
           else p.company_name
         end
   where p.id = p_property_id;
end;
$fn$;

revoke all on function public.property_book_sync_portal_owner_fields(bigint) from public, anon;

-- Guard: portal ownership fields only via Book mutating flag
create or replace function public.properties_block_independent_owner_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and (
       new.owner_email is distinct from old.owner_email
       or new.owner_name is distinct from old.owner_name
       or new.owner_phone is distinct from old.owner_phone
       or new.owner_type is distinct from old.owner_type
       or new.company_name is distinct from old.company_name
     )
     and current_setting('property_book.mutating', true) is distinct from '1'
  then
    raise exception 'properties: ownership fields are managed only via Property Book'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists properties_block_independent_owner_mutation_trg on public.properties;
create trigger properties_block_independent_owner_mutation_trg
  before update on public.properties
  for each row
  execute function public.properties_block_independent_owner_mutation();

-- ---------------------------------------------------------------------------
-- Replace owners: revoke access + sync portal + expire stale invites (PB-1.3)
-- ---------------------------------------------------------------------------

create or replace function public.admin_replace_property_book_owners(
  p_property_id bigint,
  p_owners jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_old_emails text[];
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  if not exists (select 1 from public.properties as p where p.id = p_property_id) then
    raise exception 'admin_replace_property_book_owners: not found'
      using errcode = 'P0002';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_replace_property_book_owners: owners array required'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(lower(btrim(r.email))), array[]::text[])
    into v_old_emails
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and nullif(btrim(coalesce(r.email, '')), '') is not null;

  update public.property_registry_people as r
     set deregistered_at = coalesce(r.deregistered_at, current_date),
         updated_at = now()
   where r.property_id = p_property_id
     and r.relation_type = 'owner'
     and r.deregistered_at is null;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
      raise exception 'admin_replace_property_book_owners: invalid entity_kind'
        using errcode = '22023';
    end if;
    insert into public.property_registry_people (
      property_id, relation_type, entity_kind,
      first_name, middle_name, last_name, entity_name, eik_bulstat, email,
      ownership_share_percent, ideal_parts_percent,
      registered_at, lives_on_property
    ) values (
      p_property_id,
      'owner',
      v_kind,
      nullif(btrim(coalesce(v_item ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'middle_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'entity_name', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'eik_bulstat', '')), ''),
      lower(nullif(btrim(coalesce(v_item ->> 'email', '')), '')),
      nullif(v_item ->> 'ownership_share_percent', '')::numeric,
      nullif(v_item ->> 'ideal_parts_percent', '')::numeric,
      current_date,
      null
    );
  end loop;

  -- Expire pending invites for former owners no longer on the Book
  update public.property_access_invites as i
     set status = 'expired'
   where i.property_id = p_property_id
     and i.status = 'pending'
     and not exists (
       select 1
       from public.property_registry_people as r
       where r.property_id = p_property_id
         and r.relation_type = 'owner'
         and r.deregistered_at is null
         and lower(btrim(coalesce(r.email, ''))) = lower(btrim(i.email))
     );

  perform public.property_book_sync_portal_owner_fields(p_property_id);

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_replace_property_book_owners(bigint, jsonb) from public, anon;
grant execute on function public.admin_replace_property_book_owners(bigint, jsonb) to authenticated;

-- Also set mutating flag on object upsert (may touch ownership_type etc.)
create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null,
  p_apartment_number bigint default null,
  p_floor bigint default null,
  p_ideal_parts_note text default null,
  p_ideal_parts_meeting_ref text default null,
  p_section_code text default null,
  p_block_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text := nullif(btrim(coalesce(p_ownership_type, '')), '');
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);
  if v_type is null or v_type not in ('sole', 'shared') then
    raise exception 'admin_upsert_property_book_object: invalid ownership_type'
      using errcode = '22023';
  end if;

  update public.properties as p
     set purpose = nullif(btrim(coalesce(p_purpose, '')), ''),
         area_sqm = p_area_sqm,
         ideal_parts_percent = p_ideal_parts_percent,
         ownership_type = v_type,
         ideal_parts_source = coalesce(
           nullif(btrim(coalesce(p_ideal_parts_source, '')), ''),
           p.ideal_parts_source
         ),
         ideal_parts_note = case
           when p_ideal_parts_note is null then p.ideal_parts_note
           else nullif(btrim(p_ideal_parts_note), '')
         end,
         ideal_parts_meeting_ref = case
           when p_ideal_parts_meeting_ref is null then p.ideal_parts_meeting_ref
           else nullif(btrim(p_ideal_parts_meeting_ref), '')
         end,
         apartment_number = coalesce(p_apartment_number, p.apartment_number),
         floor = coalesce(p_floor, p.floor),
         section_code = case
           when p_section_code is null then p.section_code
           else nullif(btrim(p_section_code), '')
         end,
         block_code = case
           when p_block_code is null then p.block_code
           else nullif(btrim(p_block_code), '')
         end
   where p.id = p_property_id;

  if not found then
    raise exception 'admin_upsert_property_book_object: not found'
      using errcode = 'P0002';
  end if;

  return public.admin_get_property_book(p_property_id);
end;
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text, text, text
) from public, anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text, bigint, bigint, text, text, text, text
) to authenticated;

-- Keep shorter overloads forwarding
create or replace function public.admin_upsert_property_book_object(
  p_property_id bigint,
  p_purpose text,
  p_area_sqm numeric,
  p_ideal_parts_percent numeric,
  p_ownership_type text,
  p_ideal_parts_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.admin_upsert_property_book_object(
    p_property_id, p_purpose, p_area_sqm, p_ideal_parts_percent,
    p_ownership_type, p_ideal_parts_source,
    null, null, null, null, null, null
  );
end;
$fn$;

revoke all on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) from public, anon;
grant execute on function public.admin_upsert_property_book_object(
  bigint, text, numeric, numeric, text, text
) to authenticated;

commit;
