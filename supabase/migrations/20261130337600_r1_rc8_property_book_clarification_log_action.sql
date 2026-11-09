-- R1-RC8 — Fix clarification request history action for property_change_log CHECK.
-- admin_record_property_book_clarification_request logged action='create', but
-- property_change_log_action_check only allows insert|update|delete|replace_owners.
-- Keep the CHECK; write history with action='insert' (new clarification request row).
-- Payload kind=clarification_request is unchanged.

begin;

create or replace function public.admin_record_property_book_clarification_request(
  p_property_id bigint,
  p_registry_people_id bigint default null,
  p_channel text default 'manual_copy',
  p_message_text text default null,
  p_missing_codes text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id bigint;
  v_channel text := lower(btrim(coalesce(p_channel, 'manual_copy')));
  v_msg text := btrim(coalesce(p_message_text, ''));
  v_issues jsonb;
begin
  perform public.admin_assert_book_admin();

  if not exists (select 1 from public.properties p where p.id = p_property_id) then
    raise exception 'admin_record_property_book_clarification_request: property not found'
      using errcode = 'P0002';
  end if;

  if v_channel not in ('manual_copy', 'email_queued', 'internal_note') then
    raise exception 'admin_record_property_book_clarification_request: invalid channel'
      using errcode = '22023';
  end if;

  v_issues := public.property_book_clarification_issues(p_property_id);
  if v_msg = '' then
    v_msg := format(
      'Property book clarification request for apartment property_id=%s. Missing: %s',
      p_property_id,
      coalesce(array_to_string(p_missing_codes, ', '), (v_issues -> 'issues')::text)
    );
  end if;

  insert into public.property_book_clarification_requests (
    property_id, registry_people_id, channel, message_text, missing_codes,
    created_by_email, created_by_uid
  ) values (
    p_property_id,
    p_registry_people_id,
    v_channel,
    v_msg,
    coalesce(p_missing_codes, '{}'::text[]),
    public.property_change_actor_email(),
    auth.uid()
  )
  returning id into v_id;

  perform public.log_property_change(
    p_property_id,
    'admin_ui',
    'book',
    'insert',
    jsonb_build_object(
      'request_id', v_id,
      'channel', v_channel,
      'registry_people_id', p_registry_people_id,
      'missing_codes', to_jsonb(coalesce(p_missing_codes, '{}'::text[])),
      'kind', 'clarification_request'
    ),
    'clarification request recorded'
  );

  return jsonb_build_object(
    'id', v_id,
    'property_id', p_property_id,
    'channel', v_channel,
    'issues', v_issues
  );
end;
$fn$;

revoke all on function public.admin_record_property_book_clarification_request(bigint, bigint, text, text, text[]) from public, anon;
grant execute on function public.admin_record_property_book_clarification_request(bigint, bigint, text, text, text[]) to authenticated;
grant execute on function public.admin_record_property_book_clarification_request(bigint, bigint, text, text, text[]) to service_role;

commit;
