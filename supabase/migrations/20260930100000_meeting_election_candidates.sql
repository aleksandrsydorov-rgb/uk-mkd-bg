-- Election candidates for invitation/agenda: chair, secretary, controller (3 each);
-- boards: seat_count then 3 per seat. Owners from book + building admins (staff).

alter table public.meeting_candidates drop constraint if exists meeting_candidates_election_type_check;
alter table public.meeting_candidates
  add constraint meeting_candidates_election_type_check
  check (election_type in (
    'manager', 'management_board', 'control_board', 'controller', 'cashier', 'other',
    'meeting_chair', 'meeting_secretary'
  ));

alter table public.meeting_candidates
  add column if not exists seat_index integer null,
  add column if not exists sort_order integer not null default 1,
  add column if not exists staff_id integer null references public.staff (id) on delete set null;

alter table public.meeting_candidates drop constraint if exists meeting_candidates_seat_index_chk;
alter table public.meeting_candidates
  add constraint meeting_candidates_seat_index_chk
  check (seat_index is null or seat_index >= 1);

alter table public.meeting_candidates drop constraint if exists meeting_candidates_person_chk;
alter table public.meeting_candidates
  add constraint meeting_candidates_person_chk
  check (not (registry_people_id is not null and staff_id is not null));

create table if not exists public.meeting_election_seats (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.general_meetings (id) on delete cascade,
  election_type text not null
    check (election_type in ('management_board', 'control_board')),
  seat_count integer not null check (seat_count >= 1 and seat_count <= 21),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_election_seats_uidx unique (meeting_id, election_type)
);

alter table public.meeting_election_seats enable row level security;
revoke all on table public.meeting_election_seats from public, anon;
grant select on table public.meeting_election_seats to authenticated;

drop policy if exists meeting_election_seats_select on public.meeting_election_seats;
create policy meeting_election_seats_select on public.meeting_election_seats
for select to authenticated
using (
  public.can_manage_building_governance()
  or public.is_owner()
  or public.is_staff()
);

create or replace function public.gm_owner_display_name(p_registry_people_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select nullif(trim(concat_ws(' ',
    nullif(btrim(coalesce(r.first_name, '')), ''),
    nullif(btrim(coalesce(r.middle_name, '')), ''),
    nullif(btrim(coalesce(r.last_name, '')), ''),
    nullif(btrim(coalesce(r.entity_name, '')), '')
  )), '')
  from public.property_registry_people as r
  where r.id = p_registry_people_id;
$fn$;

drop function if exists public.gm_list_owner_candidates();
create or replace function public.gm_list_owner_candidates()
returns table (
  picker_key text,
  source text,
  registry_people_id bigint,
  staff_id bigint,
  property_id bigint,
  apartment_number text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    ('owner:' || r.id::text),
    'owner'::text,
    r.id::bigint,
    null::bigint,
    r.property_id::bigint,
    coalesce(p.apartment_number::text, p.id::text),
    coalesce(
      nullif(trim(concat_ws(' ',
        nullif(btrim(coalesce(r.first_name, '')), ''),
        nullif(btrim(coalesce(r.middle_name, '')), ''),
        nullif(btrim(coalesce(r.last_name, '')), ''),
        nullif(btrim(coalesce(r.entity_name, '')), '')
      )), ''),
      coalesce(p.owner_name, '—')
    )
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.relation_type = 'owner'
    and r.deregistered_at is null

  union all

  select
    ('admin:' || s.id::text),
    'admin'::text,
    null::bigint,
    s.id::bigint,
    null::bigint,
    null::text,
    coalesce(nullif(btrim(s.name), ''), coalesce(s.email, 'admin#' || s.id::text))
  from public.staff as s
  where s.active is true
    and s.role = 'администрация'
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.relation_type = 'owner'
        and r.deregistered_at is null
        and r.email is not null
        and s.email is not null
        and lower(btrim(r.email)) = lower(btrim(s.email))
    )

  order by 2 desc, 6 nulls last, 7;
$fn$;

create or replace function public.gm_agenda_item_for_election(
  p_meeting_id uuid,
  p_election_type text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_title text;
begin
  v_title := case p_election_type
    when 'meeting_chair' then 'Потвърждаване на председателстващия'
    when 'meeting_secretary' then 'Избор на протоколчик'
    when 'controller' then 'Избор на контролен орган'
    when 'control_board' then 'Избор на контролен орган'
    when 'management_board' then 'Избор на управител / УС'
    when 'manager' then 'Избор на управител / УС'
    else null
  end;
  if v_title is null then
    return null;
  end if;
  select a.id into v_id
  from public.general_meeting_agenda_items as a
  where a.meeting_id = p_meeting_id
    and lower(btrim(a.title)) = lower(v_title)
  order by a.position
  limit 1;
  return v_id;
end;
$fn$;

create or replace function public.gm_sync_agenda_election_text(p_meeting_id uuid, p_election_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_agenda uuid;
  v_lines text := '';
  v_seat int;
  v_names text;
  v_seat_count int;
  v_model_agenda uuid;
begin
  v_agenda := public.gm_agenda_item_for_election(p_meeting_id, p_election_type);
  if v_agenda is null then
    return;
  end if;

  if p_election_type in ('management_board', 'control_board') then
    select s.seat_count into v_seat_count
    from public.meeting_election_seats as s
    where s.meeting_id = p_meeting_id and s.election_type = p_election_type;

    if v_seat_count is not null then
      v_lines := 'Предложен брой членове: ' || v_seat_count::text;
      for v_seat in 1..v_seat_count loop
        select string_agg(c.display_name, ' / ' order by c.sort_order, c.created_at)
          into v_names
        from public.meeting_candidates as c
        where c.meeting_id = p_meeting_id
          and c.election_type = p_election_type
          and c.seat_index = v_seat;
        if v_names is not null then
          v_lines := v_lines || E'\nМясто ' || v_seat::text || ': ' || v_names;
        end if;
      end loop;
    end if;

    if p_election_type = 'management_board' then
      select a.id into v_model_agenda
      from public.general_meeting_agenda_items as a
      where a.meeting_id = p_meeting_id
        and lower(btrim(a.title)) = lower('Модел на управление')
      limit 1;
    elsif p_election_type = 'control_board' then
      select a.id into v_model_agenda
      from public.general_meeting_agenda_items as a
      where a.meeting_id = p_meeting_id
        and lower(btrim(a.title)) = lower('Модел на контрол')
      limit 1;
    end if;
    if v_model_agenda is not null and v_seat_count is not null then
      update public.general_meeting_agenda_items as a
         set proposed_decision_text = 'Предложен брой членове на органа: ' || v_seat_count::text
       where a.id = v_model_agenda;
    end if;
  else
    select string_agg(c.display_name, ' / ' order by c.sort_order, c.created_at)
      into v_names
    from public.meeting_candidates as c
    where c.meeting_id = p_meeting_id
      and c.election_type = p_election_type
      and c.seat_index is null;
    if v_names is not null then
      v_lines := 'Кандидати: ' || v_names;
    end if;
  end if;

  update public.general_meeting_agenda_items as a
     set proposed_decision_text = nullif(v_lines, '')
   where a.id = v_agenda;
end;
$fn$;

create or replace function public.gm_set_election_seat_count(
  p_meeting_id uuid,
  p_election_type text,
  p_seat_count integer
)
returns public.meeting_election_seats
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.meeting_election_seats;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_set_election_seat_count: not allowed' using errcode = '42501';
  end if;
  if p_election_type not in ('management_board', 'control_board') then
    raise exception 'gm_set_election_seat_count: invalid type' using errcode = '22023';
  end if;
  if p_seat_count is null or p_seat_count < 1 or p_seat_count > 21 then
    raise exception 'gm_set_election_seat_count: seat_count 1..21' using errcode = '22023';
  end if;

  insert into public.meeting_election_seats (meeting_id, election_type, seat_count)
  values (p_meeting_id, p_election_type, p_seat_count)
  on conflict (meeting_id, election_type) do update
    set seat_count = excluded.seat_count,
        updated_at = now()
  returning * into v_row;

  delete from public.meeting_candidates as c
  where c.meeting_id = p_meeting_id
    and c.election_type = p_election_type
    and c.seat_index is not null
    and c.seat_index > p_seat_count;

  perform public.gm_sync_agenda_election_text(p_meeting_id, p_election_type);
  return v_row;
end;
$fn$;

drop function if exists public.gm_set_meeting_slot_candidates(uuid, text, integer, bigint[]);
create or replace function public.gm_set_meeting_slot_candidates(
  p_meeting_id uuid,
  p_election_type text,
  p_seat_index integer,
  p_picker_keys text[]
)
returns setof public.meeting_candidates
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_keys text[];
  v_key text;
  v_kind text;
  v_id_text text;
  v_id bigint;
  v_name text;
  v_agenda uuid;
  v_ord int := 0;
  v_seat_count int;
  v_reg_id bigint;
  v_staff_id integer;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_set_meeting_slot_candidates: not allowed' using errcode = '42501';
  end if;
  if p_election_type not in (
    'meeting_chair', 'meeting_secretary', 'controller',
    'management_board', 'control_board', 'manager'
  ) then
    raise exception 'gm_set_meeting_slot_candidates: invalid type' using errcode = '22023';
  end if;

  v_keys := coalesce(p_picker_keys, array[]::text[]);
  if cardinality(v_keys) is distinct from 3 then
    raise exception 'gm_set_meeting_slot_candidates: need exactly 3 candidates'
      using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(v_keys) as x) is distinct from 3 then
    raise exception 'gm_set_meeting_slot_candidates: candidates must be distinct'
      using errcode = '22023';
  end if;

  if p_election_type in ('management_board', 'control_board') then
    if p_seat_index is null or p_seat_index < 1 then
      raise exception 'gm_set_meeting_slot_candidates: seat_index required' using errcode = '22023';
    end if;
    select s.seat_count into v_seat_count
    from public.meeting_election_seats as s
    where s.meeting_id = p_meeting_id and s.election_type = p_election_type;
    if v_seat_count is null then
      raise exception 'gm_set_meeting_slot_candidates: set seat_count first' using errcode = '22023';
    end if;
    if p_seat_index > v_seat_count then
      raise exception 'gm_set_meeting_slot_candidates: seat_index out of range' using errcode = '22023';
    end if;
  else
    if p_seat_index is not null then
      raise exception 'gm_set_meeting_slot_candidates: seat_index must be null' using errcode = '22023';
    end if;
  end if;

  foreach v_key in array v_keys loop
    v_kind := split_part(v_key, ':', 1);
    v_id_text := split_part(v_key, ':', 2);
    if v_kind not in ('owner', 'admin') or v_id_text !~ '^[0-9]+$' then
      raise exception 'gm_set_meeting_slot_candidates: invalid picker key %', v_key
        using errcode = '22023';
    end if;
    v_id := v_id_text::bigint;
    if v_kind = 'owner' then
      if not exists (
        select 1 from public.property_registry_people as r
        where r.id = v_id
          and r.relation_type = 'owner'
          and r.deregistered_at is null
      ) then
        raise exception 'gm_set_meeting_slot_candidates: not an active owner: %', v_id
          using errcode = '42501';
      end if;
    else
      if not exists (
        select 1 from public.staff as s
        where s.id = v_id::integer
          and s.active is true
          and s.role = 'администрация'
      ) then
        raise exception 'gm_set_meeting_slot_candidates: not an active admin: %', v_id
          using errcode = '42501';
      end if;
    end if;
  end loop;

  v_agenda := public.gm_agenda_item_for_election(p_meeting_id, p_election_type);

  delete from public.meeting_candidates as c
  where c.meeting_id = p_meeting_id
    and c.election_type = p_election_type
    and c.seat_index is not distinct from p_seat_index;

  foreach v_key in array v_keys loop
    v_ord := v_ord + 1;
    v_kind := split_part(v_key, ':', 1);
    v_id := split_part(v_key, ':', 2)::bigint;
    v_reg_id := null;
    v_staff_id := null;
    if v_kind = 'owner' then
      v_reg_id := v_id;
      v_name := coalesce(public.gm_owner_display_name(v_id), v_id::text);
    else
      v_staff_id := v_id::integer;
      select coalesce(nullif(btrim(s.name), ''), coalesce(s.email, 'admin#' || s.id::text))
        into v_name
      from public.staff as s
      where s.id = v_staff_id;
      v_name := coalesce(v_name, 'admin#' || v_id::text) || ' (администрация)';
    end if;
    insert into public.meeting_candidates (
      meeting_id, election_type, display_name, registry_people_id, staff_id,
      status, agenda_item_id, seat_index, sort_order
    ) values (
      p_meeting_id, p_election_type, v_name, v_reg_id, v_staff_id,
      'INCLUDED_IN_AGENDA', v_agenda, p_seat_index, v_ord
    );
  end loop;

  perform public.gm_sync_agenda_election_text(p_meeting_id, p_election_type);

  return query
    select c.*
    from public.meeting_candidates as c
    where c.meeting_id = p_meeting_id
      and c.election_type = p_election_type
      and c.seat_index is not distinct from p_seat_index
    order by c.sort_order;
end;
$fn$;

create or replace function public.gm_meeting_election_ready(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_missing text[] := array[]::text[];
  v_has boolean;
  v_n int;
  v_seat int;
  v_count int;
begin
  select exists (
    select 1 from public.general_meeting_agenda_items as a
    where a.meeting_id = p_meeting_id
      and lower(btrim(a.title)) = lower('Потвърждаване на председателстващия')
  ) into v_has;
  if v_has then
    select count(*)::int into v_n
    from public.meeting_candidates as c
    where c.meeting_id = p_meeting_id and c.election_type = 'meeting_chair' and c.seat_index is null;
    if v_n is distinct from 3 then
      v_missing := array_append(v_missing, 'meeting_chair');
    end if;
  end if;

  select exists (
    select 1 from public.general_meeting_agenda_items as a
    where a.meeting_id = p_meeting_id
      and lower(btrim(a.title)) = lower('Избор на протоколчик')
  ) into v_has;
  if v_has then
    select count(*)::int into v_n
    from public.meeting_candidates as c
    where c.meeting_id = p_meeting_id and c.election_type = 'meeting_secretary' and c.seat_index is null;
    if v_n is distinct from 3 then
      v_missing := array_append(v_missing, 'meeting_secretary');
    end if;
  end if;

  select exists (
    select 1 from public.general_meeting_agenda_items as a
    where a.meeting_id = p_meeting_id
      and lower(btrim(a.title)) = lower('Избор на контролен орган')
  ) into v_has;
  if v_has then
    select s.seat_count into v_count
    from public.meeting_election_seats as s
    where s.meeting_id = p_meeting_id and s.election_type = 'control_board';
    if v_count is not null then
      for v_seat in 1..v_count loop
        select count(*)::int into v_n
        from public.meeting_candidates as c
        where c.meeting_id = p_meeting_id
          and c.election_type = 'control_board'
          and c.seat_index = v_seat;
        if v_n is distinct from 3 then
          v_missing := array_append(v_missing, 'control_board:' || v_seat::text);
        end if;
      end loop;
    else
      select count(*)::int into v_n
      from public.meeting_candidates as c
      where c.meeting_id = p_meeting_id and c.election_type = 'controller' and c.seat_index is null;
      if v_n is distinct from 3 then
        v_missing := array_append(v_missing, 'controller');
      end if;
    end if;
  end if;

  select exists (
    select 1 from public.general_meeting_agenda_items as a
    where a.meeting_id = p_meeting_id
      and lower(btrim(a.title)) = lower('Избор на управител / УС')
  ) into v_has;
  if v_has then
    select s.seat_count into v_count
    from public.meeting_election_seats as s
    where s.meeting_id = p_meeting_id and s.election_type = 'management_board';
    if v_count is null then
      v_missing := array_append(v_missing, 'management_board:seats');
    else
      for v_seat in 1..v_count loop
        select count(*)::int into v_n
        from public.meeting_candidates as c
        where c.meeting_id = p_meeting_id
          and c.election_type = 'management_board'
          and c.seat_index = v_seat;
        if v_n is distinct from 3 then
          v_missing := array_append(v_missing, 'management_board:' || v_seat::text);
        end if;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'ready', coalesce(cardinality(v_missing), 0) = 0,
    'missing', to_jsonb(coalesce(v_missing, array[]::text[]))
  );
end;
$fn$;

create or replace function public.gm_lock_invitation_version(
  p_meeting_id uuid,
  p_title_bg text,
  p_body_bg text,
  p_title_ru text default null,
  p_body_ru text default null,
  p_title_en text default null,
  p_body_en text default null
)
returns public.meeting_invitation_versions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_ver integer;
  v_hash text;
  v_row public.meeting_invitation_versions%rowtype;
  v_prev uuid;
  v_ready jsonb;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_lock_invitation_version: not allowed' using errcode = '42501';
  end if;

  v_ready := public.gm_meeting_election_ready(p_meeting_id);
  if coalesce((v_ready->>'ready')::boolean, false) is not true then
    raise exception 'gm_lock_invitation_version: election candidates incomplete: %', v_ready->>'missing'
      using errcode = '22023';
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_ver
  from public.meeting_invitation_versions as v
  where v.meeting_id = p_meeting_id;

  select v.id into v_prev
  from public.meeting_invitation_versions as v
  where v.meeting_id = p_meeting_id
  order by v.version_no desc
  limit 1;

  v_hash := md5(
    coalesce(p_title_bg, '') || '|' || coalesce(p_body_bg, '') || '|' ||
    coalesce(p_title_ru, '') || '|' || coalesce(p_body_ru, '') || '|' ||
    coalesce(p_title_en, '') || '|' || coalesce(p_body_en, '')
  );

  insert into public.meeting_invitation_versions (
    meeting_id, version_no, locked_at, content_hash,
    title_bg, body_bg, title_ru, body_ru, title_en, body_en,
    supersedes_version_id, created_by_email, legal_deadline_basis
  ) values (
    p_meeting_id, v_ver, now(), v_hash,
    p_title_bg, p_body_bg, p_title_ru, p_body_ru, p_title_en, p_body_en,
    v_prev, v_email, 'BG_ZUES_2026_09'
  )
  returning * into v_row;

  update public.general_meetings as m
     set invitation_locked_at = coalesce(m.invitation_locked_at, now()),
         legal_state = case
           when coalesce(m.legal_state, 'DRAFT') in ('DRAFT', 'PRECHECK', 'SCHEDULED', 'AGENDA_READY', 'INVITATION_READY')
             then 'INVITATION_LOCKED'
           else m.legal_state
         end,
         updated_at = now()
   where m.id = p_meeting_id;

  if not exists (select 1 from public.meeting_notice_snapshots as s where s.meeting_id = p_meeting_id) then
    perform public.gm_freeze_notice_snapshot(p_meeting_id);
  end if;

  perform public.gm_audit(p_meeting_id, 'INVITATION_LOCKED', jsonb_build_object(
    'version_id', v_row.id, 'version_no', v_ver, 'content_hash', v_hash
  ));
  return v_row;
end;
$fn$;

create or replace function public.gm_clear_election_seat_count(
  p_meeting_id uuid,
  p_election_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_clear_election_seat_count: not allowed' using errcode = '42501';
  end if;
  if p_election_type not in ('management_board', 'control_board') then
    raise exception 'gm_clear_election_seat_count: invalid type' using errcode = '22023';
  end if;

  delete from public.meeting_election_seats as s
  where s.meeting_id = p_meeting_id and s.election_type = p_election_type;

  delete from public.meeting_candidates as c
  where c.meeting_id = p_meeting_id and c.election_type = p_election_type;

  perform public.gm_sync_agenda_election_text(p_meeting_id, p_election_type);
end;
$fn$;

revoke all on function public.gm_owner_display_name(bigint) from public, anon;
revoke all on function public.gm_list_owner_candidates() from public, anon;
revoke all on function public.gm_agenda_item_for_election(uuid, text) from public, anon;
revoke all on function public.gm_sync_agenda_election_text(uuid, text) from public, anon;
revoke all on function public.gm_set_election_seat_count(uuid, text, integer) from public, anon;
revoke all on function public.gm_clear_election_seat_count(uuid, text) from public, anon;
revoke all on function public.gm_set_meeting_slot_candidates(uuid, text, integer, text[]) from public, anon;
revoke all on function public.gm_meeting_election_ready(uuid) from public, anon;
revoke all on function public.gm_lock_invitation_version(uuid, text, text, text, text, text, text) from public, anon;

grant execute on function public.gm_list_owner_candidates() to authenticated;
grant execute on function public.gm_set_election_seat_count(uuid, text, integer) to authenticated;
grant execute on function public.gm_clear_election_seat_count(uuid, text) to authenticated;
grant execute on function public.gm_set_meeting_slot_candidates(uuid, text, integer, text[]) to authenticated;
grant execute on function public.gm_meeting_election_ready(uuid) to authenticated;
grant execute on function public.gm_lock_invitation_version(uuid, text, text, text, text, text, text) to authenticated;
