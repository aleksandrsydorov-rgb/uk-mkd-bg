-- PB-1.8 Property lifecycle: safe physical delete OR archive (no destructive CASCADE redesign).
-- Root cause of prior UI delete failure: CASCADE delete of properties fires
-- property_registry_people AFTER DELETE → insert into property_change_log while parent
-- row is mid-delete → property_change_log_property_id_fkey violation.
-- Significant history is preserved via archive; empty shells may be deleted safely.

begin;

-- ---------------------------------------------------------------------------
-- Schema: archived_at (soft archive; history rows stay FK-linked)
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists archived_at timestamptz null;

comment on column public.properties.archived_at is
  'PB-1.8: when set, property is archived — excluded from active access/ops; history retained.';

create index if not exists properties_archived_at_idx
  on public.properties (archived_at)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- Change-log trigger: allow suppress during controlled property delete
-- ---------------------------------------------------------------------------

create or replace function public.property_registry_people_change_log_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_diff jsonb;
  v_property_id bigint;
  v_suppress text := current_setting('property_lifecycle.suppress_change_log', true);
begin
  if v_suppress = '1' then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if OLD.relation_type is distinct from 'owner' then
      return OLD;
    end if;
    perform public.log_property_change(
      OLD.property_id,
      'trigger',
      'owner',
      'delete',
      jsonb_build_object('snapshot', public.owner_tracked_snapshot(OLD)),
      null
    );
    return OLD;
  end if;

  if NEW.relation_type is distinct from 'owner'
     and (TG_OP = 'INSERT' or OLD.relation_type is distinct from 'owner') then
    return NEW;
  end if;

  v_property_id := NEW.property_id;
  if TG_OP = 'INSERT' then
    perform public.log_property_change(
      v_property_id,
      'trigger',
      'owner',
      'insert',
      jsonb_build_object('snapshot', public.owner_tracked_snapshot(NEW)),
      null
    );
  else
    v_diff := public.property_change_json_diff(
      public.owner_tracked_snapshot(OLD),
      public.owner_tracked_snapshot(NEW)
    );
    if v_diff <> '{}'::jsonb then
      perform public.log_property_change(
        v_property_id,
        'trigger',
        'owner',
        'update',
        v_diff,
        null
      );
    end if;
  end if;
  return NEW;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Access-ready: archived properties never grant access
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
  if v_prop.archived_at is not null then
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

-- ---------------------------------------------------------------------------
-- Lifecycle inspect + retire
-- ---------------------------------------------------------------------------

create or replace function public.admin_property_lifecycle_inspect(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_blockers jsonb := '[]'::jsonb;
  v_archived timestamptz;
  v_n bigint;
  v_significant boolean := false;
begin
  perform public.admin_assert_book_admin();

  select p.archived_at into v_archived
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    raise exception 'admin_property_lifecycle_inspect: property not found'
      using errcode = 'P0002';
  end if;

  -- Significant / RESTRICT dependencies (force archive, never hard-delete)
  select count(*) into v_n from public.capital_repair_ledger c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'capital_repair_ledger', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.cleaning_orders c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'cleaning_orders', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.electricity_charges c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'electricity_charges', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.electricity_ledger c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'electricity_ledger', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.electricity_meters c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'electricity_meters', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.water_ledger c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'water_ledger', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.water_meters c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'water_meters', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.water_readings c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'water_readings', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.internet_ledger c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'internet_ledger', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.internet_subscriptions c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'internet_subscriptions', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.support_fee_assessments c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'support_fee_assessments', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.support_fee_ledger c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'support_fee_ledger', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.property_registry_people c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'property_registry_people', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.owner_transfers c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'owner_transfers', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.general_meeting_participants c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'general_meeting_participants', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.general_meeting_votes c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'general_meeting_votes', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.meeting_notice_snapshot_parties c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'meeting_notice_snapshot_parties', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.meeting_voting_snapshot_parties c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'meeting_voting_snapshot_parties', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.meeting_absentee_declarations c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'meeting_absentee_declarations', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.meeting_proxies c where c.principal_property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'meeting_proxies', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.property_service_locks c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'property_service_locks', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.property_service_lock_events c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'property_service_lock_events', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.security_requests c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'security_requests', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.requests c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'requests', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n from public.chat_messages c where c.property_id = p_property_id;
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'chat_messages', 'count', v_n));
    v_significant := true;
  end if;
  select count(*) into v_n
  from public.property_change_log c
  where c.property_id = p_property_id
    and (
      c.entity in ('owner', 'book')
      or c.action in ('replace_owners', 'delete')
    );
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'property_change_log_ownership', 'count', v_n));
    v_significant := true;
  end if;

  return jsonb_build_object(
    'property_id', p_property_id,
    'already_archived', v_archived is not null,
    'archived_at', v_archived,
    'must_archive', v_significant,
    'can_delete', (not v_significant) and v_archived is null,
    'blockers', v_blockers
  );
end;
$fn$;

revoke all on function public.admin_property_lifecycle_inspect(bigint) from public, anon;
grant execute on function public.admin_property_lifecycle_inspect(bigint) to authenticated;

create or replace function public.admin_retire_property(p_property_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inspect jsonb;
  v_must_archive boolean;
  v_can_delete boolean;
  v_already boolean;
  v_blockers jsonb;
begin
  perform public.admin_assert_book_admin();

  v_inspect := public.admin_property_lifecycle_inspect(p_property_id);
  v_already := coalesce((v_inspect ->> 'already_archived')::boolean, false);
  v_must_archive := coalesce((v_inspect ->> 'must_archive')::boolean, false);
  v_can_delete := coalesce((v_inspect ->> 'can_delete')::boolean, false);
  v_blockers := coalesce(v_inspect -> 'blockers', '[]'::jsonb);

  if v_already then
    return jsonb_build_object(
      'ok', true,
      'action', 'noop',
      'property_id', p_property_id,
      'blockers', v_blockers,
      'message', 'already_archived'
    );
  end if;

  if v_must_archive or not v_can_delete then
    update public.properties as p
       set archived_at = now()
     where p.id = p_property_id
       and p.archived_at is null;

    update public.property_access_invites as i
       set status = 'expired'
     where i.property_id = p_property_id
       and i.status = 'pending';

    update public.property_guest_accesses as g
       set status = 'revoked'
     where g.property_id = p_property_id
       and g.status = 'active';

    perform public.log_property_change(
      p_property_id,
      'admin_ui',
      'property',
      'update',
      jsonb_build_object(
        'archived_at', jsonb_build_object('old', null, 'new', now()),
        'lifecycle', 'archived'
      ),
      'PB-1.8 archive: significant history retained'
    );

    return jsonb_build_object(
      'ok', true,
      'action', 'archived',
      'property_id', p_property_id,
      'blockers', v_blockers,
      'message', 'archived_with_history'
    );
  end if;

  -- Safe physical delete (empty shell): suppress owner-delete logging, clear logs, delete row.
  perform set_config('property_lifecycle.suppress_change_log', '1', true);

  delete from public.property_change_log as c
   where c.property_id = p_property_id;

  delete from public.properties as p
   where p.id = p_property_id;

  perform set_config('property_lifecycle.suppress_change_log', '0', true);

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'property_id', p_property_id,
    'blockers', '[]'::jsonb,
    'message', 'deleted_empty_shell'
  );
end;
$fn$;

revoke all on function public.admin_retire_property(bigint) from public, anon;
grant execute on function public.admin_retire_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Active lists / ops: exclude archived
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_property_book(p_limit integer default 500)
returns table (
  property_id bigint,
  apartment_number text,
  floor bigint,
  section_code text,
  block_code text,
  purpose text,
  area_sqm numeric,
  ideal_parts_percent numeric,
  ownership_type text,
  owner_count integer,
  book_complete boolean,
  validation jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  perform public.admin_assert_book_admin();
  return query
  select
    p.id,
    p.apartment_number::text,
    p.floor,
    p.section_code,
    p.block_code,
    p.purpose,
    p.area_sqm::numeric,
    p.ideal_parts_percent,
    p.ownership_type,
    (
      select count(*)::integer
      from public.property_book_active_owners(p.id)
    ),
    public.property_book_is_complete(p.id),
    public.property_book_validate(p.id)
  from public.properties as p
  where p.archived_at is null
  order by
    lower(coalesce(nullif(btrim(p.block_code), ''), '')),
    lower(coalesce(nullif(btrim(p.section_code), ''), '')),
    p.floor nulls last,
    p.apartment_number asc,
    p.id asc
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_property_book(integer) from public, anon;
grant execute on function public.admin_list_property_book(integer) to authenticated;

create or replace function public.user_activation_owner_base()
returns table (
  email text,
  display_name text,
  properties jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with book as (
    select
      public.user_activation_normalize_email(r.email) as email,
      nullif(btrim(concat_ws(' ', r.first_name, r.middle_name, r.last_name)), '') as person_name,
      nullif(btrim(r.entity_name), '') as entity_name,
      p.id as property_id,
      p.apartment_number,
      p.section_code,
      p.block_code
    from public.property_registry_people as r
    join public.properties as p on p.id = r.property_id
    where r.relation_type = 'owner'
      and r.deregistered_at is null
      and p.archived_at is null
      and public.user_activation_normalize_email(r.email) is not null
  )
  select
    a.email,
    coalesce(
      max(nullif(a.person_name, '')),
      max(nullif(a.entity_name, '')),
      a.email
    ) as display_name,
    coalesce(
      jsonb_agg(
        distinct jsonb_build_object(
          'property_id', a.property_id,
          'apartment_number', a.apartment_number,
          'section', a.section_code,
          'block', a.block_code
        )
      ) filter (where a.property_id is not null),
      '[]'::jsonb
    ) as properties
  from book as a
  group by a.email;
$fn$;

revoke all on function public.user_activation_owner_base() from public, anon;

create or replace function public.gm_book_roster_hash()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(x.k, '|' order by x.k), ''))
  from (
    select
      p.id::text || ':' || coalesce(r.id::text, 'prop') || ':' ||
      coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::text || ':' ||
      lower(coalesce(r.email, '')) as k
    from public.properties as p
    left join public.property_registry_people as r
      on r.property_id = p.id
     and r.relation_type = 'owner'
     and r.deregistered_at is null
    where p.archived_at is null
  ) as x;
$$;

revoke all on function public.gm_book_roster_hash() from public, anon;

-- Patch freeze party inserts to skip archived (replace notice freeze body join only via
-- redefining both freeze functions from book_only_readers with archived filter).

-- Freeze functions: only add archived_at filter to party selection (keep rest identical).
-- Full bodies copied from 20261010233000 with `where p.archived_at is null`.

create or replace function public.gm_freeze_notice_snapshot(p_meeting_id uuid)
returns public.meeting_notice_snapshots
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_hash text;
  v_snap public.meeting_notice_snapshots%rowtype;
  v_total numeric := 0;
  v_objects integer := 0;
  v_parties integer := 0;
begin
  if v_email is null then
    raise exception 'gm_freeze_notice_snapshot: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'gm_freeze_notice_snapshot: not allowed' using errcode = '42501';
  end if;
  if p_meeting_id is null then
    raise exception 'gm_freeze_notice_snapshot: meeting required' using errcode = '22023';
  end if;
  if exists (select 1 from public.meeting_notice_snapshots as s where s.meeting_id = p_meeting_id) then
    raise exception 'gm_freeze_notice_snapshot: already frozen' using errcode = 'P0001';
  end if;

  v_hash := public.gm_book_roster_hash();

  insert into public.meeting_notice_snapshots (
    meeting_id, roster_hash, created_by_email
  ) values (
    p_meeting_id, v_hash, v_email
  )
  returning * into v_snap;

  insert into public.meeting_notice_snapshot_parties (
    snapshot_id, property_id, registry_people_id, apartment_number,
    party_email, party_name, ideal_parts_percent, ownership_share_percent, relation_type
  )
  select
    v_snap.id,
    p.id,
    r.id,
    p.apartment_number,
    r.email,
    nullif(btrim(concat_ws(' ', r.first_name, r.last_name, r.entity_name)), ''),
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0),
    r.ownership_share_percent,
    coalesce(r.relation_type, 'owner')
  from public.properties as p
  inner join public.property_registry_people as r
    on r.property_id = p.id
   and r.relation_type = 'owner'
   and r.deregistered_at is null
   and nullif(btrim(coalesce(r.email, '')), '') is not null
  where p.archived_at is null;

  select
    coalesce(sum(sp.ideal_parts_percent), 0),
    count(distinct sp.property_id)::integer,
    count(*)::integer
  into v_total, v_objects, v_parties
  from public.meeting_notice_snapshot_parties as sp
  where sp.snapshot_id = v_snap.id;

  update public.meeting_notice_snapshots as s
     set total_ideal_parts_percent = v_total,
         object_count = v_objects,
         party_count = v_parties
   where s.id = v_snap.id
  returning * into v_snap;

  perform public.gm_audit(p_meeting_id, 'NOTICE_SNAPSHOT_FROZEN', jsonb_build_object(
    'snapshot_id', v_snap.id, 'roster_hash', v_hash
  ));

  return v_snap;
end;
$fn$;

revoke all on function public.gm_freeze_notice_snapshot(uuid) from public, anon;
grant execute on function public.gm_freeze_notice_snapshot(uuid) to authenticated;

create or replace function public.gm_freeze_voting_snapshot(p_meeting_id uuid)
returns public.meeting_voting_snapshots
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_hash text;
  v_notice_hash text;
  v_snap public.meeting_voting_snapshots%rowtype;
  v_total numeric := 0;
  v_objects integer := 0;
  v_parties integer := 0;
  v_dominant boolean := false;
begin
  if v_email is null then
    raise exception 'gm_freeze_voting_snapshot: not authenticated' using errcode = '28000';
  end if;
  if not public.can_manage_building_governance() then
    raise exception 'gm_freeze_voting_snapshot: not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.meeting_voting_snapshots as s where s.meeting_id = p_meeting_id) then
    raise exception 'gm_freeze_voting_snapshot: already frozen' using errcode = 'P0001';
  end if;

  v_hash := public.gm_book_roster_hash();

  select s.roster_hash into v_notice_hash
  from public.meeting_notice_snapshots as s
  where s.meeting_id = p_meeting_id
  order by s.created_at desc
  limit 1;

  if v_notice_hash is not null and v_notice_hash is distinct from v_hash then
    perform public.gm_audit(p_meeting_id, 'OWNERSHIP_CHANGED_AFTER_INVITATION', jsonb_build_object(
      'notice_hash', v_notice_hash, 'voting_hash', v_hash
    ));
    raise exception 'gm_freeze_voting_snapshot: OWNERSHIP_CHANGED_AFTER_INVITATION'
      using errcode = 'P0001';
  end if;

  insert into public.meeting_voting_snapshots (
    meeting_id, roster_hash, created_by_email
  ) values (
    p_meeting_id, v_hash, v_email
  )
  returning * into v_snap;

  insert into public.meeting_voting_snapshot_parties (
    snapshot_id, property_id, registry_people_id, apartment_number,
    party_email, party_name, ideal_parts_percent, ownership_share_percent,
    relation_type, representable_right_key
  )
  select
    v_snap.id,
    p.id,
    r.id,
    p.apartment_number,
    r.email,
    nullif(btrim(concat_ws(' ', r.first_name, r.last_name, r.entity_name)), ''),
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0),
    r.ownership_share_percent,
    coalesce(r.relation_type, 'owner'),
    p.id::text || ':' || r.id::text
  from public.properties as p
  inner join public.property_registry_people as r
    on r.property_id = p.id
   and r.relation_type = 'owner'
   and r.deregistered_at is null
   and nullif(btrim(coalesce(r.email, '')), '') is not null
  where p.archived_at is null;

  select
    coalesce(sum(sp.ideal_parts_percent), 0),
    count(distinct sp.property_id)::integer,
    count(*)::integer,
    exists (
      select 1
      from public.meeting_voting_snapshot_parties as q
      where q.snapshot_id = v_snap.id
        and q.ideal_parts_percent > 51
    )
  into v_total, v_objects, v_parties, v_dominant
  from public.meeting_voting_snapshot_parties as sp
  where sp.snapshot_id = v_snap.id;

  update public.meeting_voting_snapshots as s
     set total_ideal_parts_percent = v_total,
         object_count = v_objects,
         party_count = v_parties,
         dominant_owner_over_51 = v_dominant
   where s.id = v_snap.id
  returning * into v_snap;

  update public.general_meetings as m
     set ownership_drift_alert = false,
         ownership_drift_detail = null,
         check_in_blocked_reason = null,
         updated_at = now()
   where m.id = p_meeting_id
     and coalesce(m.check_in_blocked_reason, '') = 'OWNERSHIP_CHANGED_AFTER_INVITATION';

  perform public.gm_audit(p_meeting_id, 'VOTING_SNAPSHOT_FROZEN', jsonb_build_object(
    'snapshot_id', v_snap.id, 'dominant_owner_over_51', v_dominant
  ));
  return v_snap;
end;
$fn$;

revoke all on function public.gm_freeze_voting_snapshot(uuid) from public, anon;
grant execute on function public.gm_freeze_voting_snapshot(uuid) to authenticated;

-- Invite create: same as PB-1 + archived guard
create or replace function public.admin_create_property_invite(
  p_property_id bigint,
  p_registry_people_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner public.property_registry_people%rowtype;
  v_staff integer := public.current_staff_id();
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now() + interval '24 hours';
  v_email text;
  v_archived timestamptz;
begin
  perform public.admin_assert_book_admin();

  select p.archived_at into v_archived
  from public.properties as p
  where p.id = p_property_id;
  if not found then
    raise exception 'admin_create_property_invite: property not found'
      using errcode = 'P0002';
  end if;
  if v_archived is not null then
    raise exception 'admin_create_property_invite: property is archived'
      using errcode = 'P0001';
  end if;

  select r.* into v_owner
  from public.property_registry_people as r
  where r.id = p_registry_people_id
    and r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;

  if not found then
    raise exception 'admin_create_property_invite: not a current Book owner'
      using errcode = 'P0002';
  end if;

  if not public.property_book_owner_row_access_ready(v_owner) then
    raise exception 'admin_create_property_invite: incomplete ownership information'
      using errcode = 'P0001';
  end if;

  if not public.property_book_is_complete(p_property_id) then
    raise exception 'admin_create_property_invite: property Book incomplete'
      using errcode = 'P0001';
  end if;

  v_email := lower(btrim(v_owner.email));

  update public.property_access_invites as i
     set status = 'expired'
   where i.property_id = p_property_id
     and (
       i.registry_people_id = p_registry_people_id
       or lower(i.email) = v_email
     )
     and i.status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.property_access_invites (
    property_id, email, token_hash, status, expires_at, invited_by_staff_id,
    registry_people_id, delivery_channel, delivery_status
  ) values (
    p_property_id, v_email, v_hash, 'pending', v_expires, v_staff,
    p_registry_people_id, 'copy_link', 'COPY_LINK'
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'property_id', p_property_id,
    'registry_people_id', p_registry_people_id,
    'email', v_email,
    'expires_at', v_expires,
    'token', v_token,
    'status', 'pending',
    'delivery_channel', 'copy_link',
    'delivery_status', 'COPY_LINK',
    'email_sent', false
  );
end;
$fn$;

revoke all on function public.admin_create_property_invite(bigint, bigint) from public, anon;
grant execute on function public.admin_create_property_invite(bigint, bigint) to authenticated;

-- Transfer approve: gate version + archived rejection
create or replace function public.admin_approve_owner_transfer(p_transfer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
  v_prop public.properties%rowtype;
  v_parts text[];
  v_first text;
  v_last text;
  v_book jsonb;
  v_ideal numeric;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'admin_approve_owner_transfer: not found'
      using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'admin_approve_owner_transfer: not pending'
      using errcode = 'P0001';
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = v_tr.property_id;
  if not found then
    raise exception 'admin_approve_owner_transfer: property not found'
      using errcode = 'P0002';
  end if;
  if v_prop.archived_at is not null then
    raise exception 'admin_approve_owner_transfer: property is archived'
      using errcode = 'P0001';
  end if;

  v_ideal := coalesce(v_prop.ideal_parts_percent, 0);
  v_parts := regexp_split_to_array(btrim(coalesce(v_tr.to_owner_name, '')), '\s+');
  v_first := coalesce(v_parts[1], 'Owner');
  if coalesce(array_length(v_parts, 1), 0) >= 2 then
    v_last := array_to_string(v_parts[2:array_length(v_parts, 1)], ' ');
  else
    v_last := v_first;
  end if;

  update public.properties as p
     set ownership_type = coalesce(p.ownership_type, 'sole')
   where p.id = v_tr.property_id
     and (p.ownership_type is null or p.ownership_type = 'sole');

  if (select p.ownership_type from public.properties as p where p.id = v_tr.property_id) = 'shared' then
    raise exception 'admin_approve_owner_transfer: shared ownership — edit Book manually'
      using errcode = 'P0001';
  end if;

  update public.properties as p
     set ownership_type = 'sole'
   where p.id = v_tr.property_id;

  v_book := public.admin_replace_property_book_owners(
    v_tr.property_id,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', v_first,
      'last_name', v_last,
      'email', lower(btrim(v_tr.to_owner_email)),
      'ownership_share_percent', 100,
      'ideal_parts_percent', v_ideal
    ))
  );

  update public.properties as p
     set owner_phone = v_tr.to_owner_phone
   where p.id = v_tr.property_id;

  insert into public.property_book_transfer_approve_gate (transfer_id)
  values (p_transfer_id)
  on conflict (transfer_id) do update
    set created_at = now();

  update public.owner_transfers as t
     set status = 'утверждена',
         decided_at = now(),
         decided_by = nullif(auth.email(), '')
   where t.id = p_transfer_id;

  delete from public.property_book_transfer_approve_gate as g
   where g.transfer_id = p_transfer_id;

  perform public.property_book_set_mutating(false);

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'property_id', v_tr.property_id,
    'book', v_book
  );
exception
  when others then
    delete from public.property_book_transfer_approve_gate as g
     where g.transfer_id = p_transfer_id;
    perform public.property_book_set_mutating(false);
    raise;
end;
$fn$;

revoke all on function public.admin_approve_owner_transfer(bigint) from public, anon;
grant execute on function public.admin_approve_owner_transfer(bigint) to authenticated;

commit;
