-- PKG-PB1-BOOK-ONLY: migrate already-applied readers (UA + Meeting freeze)
-- off properties.owner_email. Does not rewrite immutable snapshot rows.
-- Idempotent re-assert of Book-only owns_property for safety.

begin;

-- ---------------------------------------------------------------------------
-- owns_property: Book-only (idempotent; matches amended PB-1 migration)
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

-- Drop compat cutover objects if an older local draft of PB-1 created them
drop function if exists public.admin_property_book_disable_legacy_email_access(text);
drop function if exists public.property_book_legacy_reconciliation_report();
drop function if exists public.property_book_legacy_email_access_enabled();
drop table if exists public.property_book_runtime_flags;

-- ---------------------------------------------------------------------------
-- User Activation: Book emails only (no properties.owner_email union)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Meeting Core: new freezes use Book parties only (no owner_email fallback).
-- Existing snapshot tables are not rewritten.
-- ---------------------------------------------------------------------------

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
  ) as x;
$$;

revoke all on function public.gm_book_roster_hash() from public, anon;

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

  -- Inner join: only properties with active Book owners (no portal email fallback)
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
   and nullif(btrim(coalesce(r.email, '')), '') is not null;

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
   and nullif(btrim(coalesce(r.email, '')), '') is not null;

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

commit;
