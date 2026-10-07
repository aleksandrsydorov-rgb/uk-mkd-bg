-- Invitation posting protocol + mass dispatch gate (after agenda lock).

-- Allow photo evidence file type on meeting files
alter table public.general_meeting_files drop constraint if exists general_meeting_files_type_chk;
alter table public.general_meeting_files
  add constraint general_meeting_files_type_chk
  check (file_type in (
    'invitation', 'invitation_posting_protocol', 'invitation_posting_photo',
    'agenda', 'minutes', 'minutes_notice', 'minutes_notice_posting_protocol',
    'proxy', 'absentee_declaration', 'appendix', 'cancellation_notice', 'other'
  ));

create or replace function public.gm_invitation_dispatch_ready(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_locked boolean := false;
  v_posted boolean := false;
  v_has_protocol boolean := false;
  v_has_photo boolean := false;
  v_notified int := 0;
  v_legal text;
begin
  select
    m.invitation_locked_at is not null,
    m.invitation_posted_at is not null,
    coalesce(m.legal_state, 'DRAFT')
  into v_locked, v_posted, v_legal
  from public.general_meetings as m
  where m.id = p_meeting_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'meeting_not_found');
  end if;

  select exists (
    select 1 from public.general_meeting_files as f
    where f.meeting_id = p_meeting_id and f.file_type = 'invitation_posting_protocol'
  ) into v_has_protocol;

  select exists (
    select 1 from public.general_meeting_files as f
    where f.meeting_id = p_meeting_id and f.file_type = 'invitation_posting_photo'
  ) into v_has_photo;

  select count(*)::int into v_notified
  from public.meeting_notifications as n
  where n.meeting_id = p_meeting_id and n.kind = 'INVITATION';

  return jsonb_build_object(
    'ok', true,
    'locked', v_locked,
    'posted', v_posted,
    'has_protocol', v_has_protocol,
    'has_photo', v_has_photo,
    'posting_complete', v_posted and v_has_protocol and v_has_photo,
    'can_dispatch', v_posted and v_has_protocol and v_has_photo,
    'invitation_sent_count', v_notified,
    'legal_state', v_legal
  );
end;
$fn$;

create or replace function public.gm_confirm_invitation_posting(
  p_meeting_id uuid,
  p_posted_place text,
  p_posted_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ready jsonb;
  v_photo_path text;
  v_ver public.meeting_invitation_versions%rowtype;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_confirm_invitation_posting: not allowed' using errcode = '42501';
  end if;

  v_ready := public.gm_invitation_dispatch_ready(p_meeting_id);
  if coalesce((v_ready->>'locked')::boolean, false) is not true then
    raise exception 'gm_confirm_invitation_posting: lock invitation first' using errcode = 'P0001';
  end if;
  if coalesce((v_ready->>'has_protocol')::boolean, false) is not true then
    raise exception 'gm_confirm_invitation_posting: upload signed protocol PDF first'
      using errcode = 'P0001';
  end if;
  if coalesce((v_ready->>'has_photo')::boolean, false) is not true then
    raise exception 'gm_confirm_invitation_posting: upload posting photo first'
      using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_posted_place, '')), '') is null then
    raise exception 'gm_confirm_invitation_posting: posted_place required' using errcode = '22023';
  end if;

  select d.storage_path into v_photo_path
  from public.general_meeting_files as f
  join public.building_documents as d on d.id = f.document_id
  where f.meeting_id = p_meeting_id
    and f.file_type = 'invitation_posting_photo'
  order by f.created_at desc
  limit 1;

  select * into v_ver
  from public.gm_record_invitation_posting(
    p_meeting_id,
    coalesce(p_posted_at, now()),
    p_posted_place,
    v_photo_path
  );

  return jsonb_build_object(
    'ok', true,
    'version_id', v_ver.id,
    'posted_at', v_ver.posted_at,
    'posted_place', v_ver.posted_place
  );
end;
$fn$;

create or replace function public.gm_dispatch_meeting_invitations(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ready jsonb;
  v_email text;
  v_name text;
  v_apt text;
  v_count int := 0;
  v_skipped int := 0;
  v_row record;
begin
  if not public.can_manage_building_governance() then
    raise exception 'gm_dispatch_meeting_invitations: not allowed' using errcode = '42501';
  end if;

  v_ready := public.gm_invitation_dispatch_ready(p_meeting_id);
  if coalesce((v_ready->>'can_dispatch')::boolean, false) is not true then
    raise exception 'gm_dispatch_meeting_invitations: posting protocol + photo required first'
      using errcode = 'P0001';
  end if;

  -- Avoid duplicate blast: if already sent, return current counts
  if coalesce((v_ready->>'invitation_sent_count')::int, 0) > 0 then
    return jsonb_build_object(
      'ok', true,
      'already_sent', true,
      'sent', (v_ready->>'invitation_sent_count')::int,
      'skipped', 0
    );
  end if;

  for v_row in
    select
      r.id as registry_people_id,
      r.property_id,
      coalesce(
        nullif(trim(concat_ws(' ',
          nullif(btrim(coalesce(r.first_name, '')), ''),
          nullif(btrim(coalesce(r.middle_name, '')), ''),
          nullif(btrim(coalesce(r.last_name, '')), ''),
          nullif(btrim(coalesce(r.entity_name, '')), '')
        )), ''),
        coalesce(p.owner_name, '—')
      ) as display_name,
      coalesce(nullif(btrim(coalesce(r.email, '')), ''), nullif(btrim(coalesce(p.owner_email, '')), '')) as email,
      coalesce(p.apartment_number::text, p.id::text) as apartment_number
    from public.property_registry_people as r
    join public.properties as p on p.id = r.property_id
    where r.relation_type = 'owner'
      and r.deregistered_at is null
  loop
    v_email := v_row.email;
    v_name := v_row.display_name;
    v_apt := v_row.apartment_number;

    if v_email is null then
      perform public.gm_log_notification(
        p_meeting_id,
        'INVITATION',
        'in_app',
        null,
        jsonb_build_object(
          'registry_people_id', v_row.registry_people_id,
          'property_id', v_row.property_id,
          'apartment_number', v_apt,
          'display_name', v_name
        ),
        'skipped',
        null,
        'no_email'
      );
      v_skipped := v_skipped + 1;
    else
      perform public.gm_log_notification(
        p_meeting_id,
        'INVITATION',
        'email',
        v_email,
        jsonb_build_object(
          'registry_people_id', v_row.registry_people_id,
          'property_id', v_row.property_id,
          'apartment_number', v_apt,
          'display_name', v_name
        ),
        'sent',
        null,
        null
      );
      -- Mirror in-app acknowledgment for portal users with email
      perform public.gm_log_notification(
        p_meeting_id,
        'INVITATION',
        'in_app',
        v_email,
        jsonb_build_object(
          'registry_people_id', v_row.registry_people_id,
          'property_id', v_row.property_id,
          'apartment_number', v_apt,
          'display_name', v_name
        ),
        'sent',
        null,
        null
      );
      v_count := v_count + 1;
    end if;
  end loop;

  update public.general_meetings as m
     set legal_state = case
           when coalesce(m.legal_state, '') in ('INVITATION_POSTED', 'INVITATION_LOCKED', 'NOTIFICATION_RUNNING')
             then 'WAITING_FOR_MEETING'
           else m.legal_state
         end,
         status = case when m.status = 'draft' then 'published' else m.status end,
         published_at = coalesce(m.published_at, now()),
         updated_at = now()
   where m.id = p_meeting_id;

  perform public.gm_audit(p_meeting_id, 'INVITATIONS_DISPATCHED', jsonb_build_object(
    'sent', v_count,
    'skipped', v_skipped
  ));

  return jsonb_build_object(
    'ok', true,
    'already_sent', false,
    'sent', v_count,
    'skipped', v_skipped
  );
end;
$fn$;

revoke all on function public.gm_invitation_dispatch_ready(uuid) from public, anon;
revoke all on function public.gm_confirm_invitation_posting(uuid, text, timestamptz) from public, anon;
revoke all on function public.gm_dispatch_meeting_invitations(uuid) from public, anon;

grant execute on function public.gm_invitation_dispatch_ready(uuid) to authenticated;
grant execute on function public.gm_confirm_invitation_posting(uuid, text, timestamptz) to authenticated;
grant execute on function public.gm_dispatch_meeting_invitations(uuid) to authenticated;
