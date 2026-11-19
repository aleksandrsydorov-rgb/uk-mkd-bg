-- Admin email send history: search, status filter, period, pagination, recipient context.
-- Full recipient email only for complex admins (администрация). Never returns tokens/secrets.

create or replace function public.admin_list_email_history(
  p_limit integer default 20,
  p_offset integer default 0,
  p_query text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 100));
  v_off int := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_total int := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'admin_list_email_history: not allowed' using errcode = '42501';
  end if;

  if v_status not in ('all', 'awaiting', 'accepted', 'delivered', 'failed', 'skipped') then
    v_status := 'all';
  end if;

  with base as (
    select
      o.id,
      o.module_key,
      o.template_key,
      o.locale,
      o.to_email,
      o.status,
      o.attempts,
      o.last_error_code,
      o.next_attempt_at,
      o.provider_message_id is not null as provider_message_id_present,
      o.created_at,
      o.updated_at,
      o.event_occurred_at,
      (
        select e.event_type
        from public.email_delivery_events as e
        where e.outbox_id = o.id
        order by e.event_at desc, e.id desc
        limit 1
      ) as latest_event_type,
      nullif(btrim(coalesce(o.payload->>'property_id', '')), '')::bigint as property_id,
      case
        when (
          select e.event_type
          from public.email_delivery_events as e
          where e.outbox_id = o.id
          order by e.event_at desc, e.id desc
          limit 1
        ) = 'delivered' then 'delivered'
        when o.status = 'sent' then 'accepted'
        when o.status in ('queued', 'held', 'sending') then 'awaiting'
        when o.status = 'cancelled'
          or o.status like 'blocked_%'
          or coalesce(o.last_error_code, '') in (
            'blocked_pre_registration_event',
            'blocked_not_registered',
            'blocked_not_ready'
          )
          or coalesce(o.last_error_code, '') like 'blocked_%'
          then 'skipped'
        when o.status = 'failed' then 'failed'
        else 'failed'
      end as user_status
    from public.email_outbox as o
    where (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
  ),
  enriched as (
    select
      b.*,
      case
        when prp.entity_kind = 'company' then nullif(btrim(coalesce(prp.entity_name, '')), '')
        else nullif(
          btrim(concat_ws(' ', prp.first_name, prp.middle_name, prp.last_name)),
          ''
        )
      end as recipient_name,
      case
        when p.id is null then null
        else nullif(
          btrim(
            concat_ws(
              ' · ',
              nullif(btrim(coalesce(p.apartment_number, '')), ''),
              nullif(btrim(coalesce(p.section_code, '')), ''),
              nullif(btrim(coalesce(p.block_code, '')), '')
            )
          ),
          ''
        )
      end as apartment_label
    from base b
    left join public.properties p on p.id = b.property_id
    left join lateral (
      select r.*
      from public.property_registry_people r
      where lower(btrim(coalesce(r.email, ''))) = lower(btrim(b.to_email))
        and r.deregistered_at is null
      order by
        case when b.property_id is not null and r.property_id = b.property_id then 0 else 1 end,
        r.id desc
      limit 1
    ) prp on true
  ),
  filtered as (
    select *
    from enriched e
    where (v_status = 'all' or e.user_status = v_status)
      and (
        v_q is null
        or position(v_q in lower(coalesce(e.to_email, ''))) > 0
        or position(v_q in lower(coalesce(e.recipient_name, ''))) > 0
        or position(v_q in lower(coalesce(e.apartment_label, ''))) > 0
        or position(v_q in lower(coalesce(e.module_key, ''))) > 0
        or position(v_q in lower(coalesce(e.template_key, ''))) > 0
      )
  ),
  counted as (
    select count(*)::int as total from filtered
  ),
  page as (
    select
      jsonb_build_object(
        'id', f.id,
        'module_key', f.module_key,
        'template_key', f.template_key,
        'locale', f.locale,
        'to_email', f.to_email,
        'to_masked', public.email_core_mask_email(f.to_email),
        'recipient_name', f.recipient_name,
        'apartment_label', f.apartment_label,
        'status', f.status,
        'user_status', f.user_status,
        'attempts', f.attempts,
        'last_error_code', f.last_error_code,
        'next_attempt_at', f.next_attempt_at,
        'provider_message_id_present', f.provider_message_id_present,
        'latest_event_type', f.latest_event_type,
        'created_at', f.created_at,
        'updated_at', f.updated_at,
        'event_occurred_at', f.event_occurred_at
      ) as row_json,
      f.created_at
    from filtered f
    order by f.created_at desc
    offset v_off
    limit v_lim
  )
  select
    (select total from counted),
    coalesce(
      (select jsonb_agg(row_json order by created_at desc) from page),
      '[]'::jsonb
    )
  into v_total, v_rows;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', v_lim,
    'offset', v_off
  );
end;
$fn$;

revoke all on function public.admin_list_email_history(integer, integer, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.admin_list_email_history(integer, integer, text, text, timestamptz, timestamptz)
  to authenticated;
