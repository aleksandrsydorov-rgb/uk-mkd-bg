-- Ordinary notifications must compare registration against the *source event* time.
-- Re-queue after registration must not revive pre-registration events via a fresh created_at.

begin;

alter table public.email_outbox
  add column if not exists event_occurred_at timestamptz null;

comment on column public.email_outbox.event_occurred_at is
  'Original business-event timestamp. Used for pre-registration stale cancel; falls back to created_at.';

update public.email_outbox
   set event_occurred_at = coalesce(event_occurred_at, created_at)
 where event_occurred_at is null;

create or replace function public.email_core_payload_event_occurred_at(p_payload jsonb, p_fallback timestamptz)
returns timestamptz
language plpgsql
immutable
as $fn$
declare
  v text;
  v_ts timestamptz;
begin
  if p_payload is null then
    return p_fallback;
  end if;

  foreach v in array array[
    nullif(btrim(coalesce(p_payload->>'event_occurred_at', '')), ''),
    nullif(btrim(coalesce(p_payload->>'occurred_at', '')), ''),
    nullif(btrim(coalesce(p_payload->>'event_at', '')), ''),
    nullif(btrim(coalesce(p_payload->>'event_time', '')), ''),
    nullif(btrim(coalesce(p_payload->>'source_event_at', '')), '')
  ]
  loop
    if v is null then
      continue;
    end if;
    begin
      v_ts := v::timestamptz;
      if v_ts is not null then
        return v_ts;
      end if;
    exception when others then
      null;
    end;
  end loop;

  return p_fallback;
end;
$fn$;

revoke all on function public.email_core_payload_event_occurred_at(jsonb, timestamptz) from public, anon;
grant execute on function public.email_core_payload_event_occurred_at(jsonb, timestamptz)
  to authenticated, service_role;

create or replace function public.email_outbox_registration_gate()
returns trigger
language plpgsql
security definer
set search_path to public
as $tg$
declare
  v_event_at timestamptz;
begin
  -- Resolve source event time before any registration comparison.
  v_event_at := coalesce(
    new.event_occurred_at,
    public.email_core_payload_event_occurred_at(new.payload, new.created_at),
    new.created_at
  );
  new.event_occurred_at := v_event_at;

  if public.email_core_module_allowed_before_registration(new.module_key) then
    return new;
  end if;

  if public.email_core_recipient_registration_ready(new.to_email) then
    if exists (
      select 1 from public.user_activation_profiles p
       where lower(p.email) = lower(btrim(new.to_email))
         and p.app_registration_completed_at is not null
         and v_event_at < p.app_registration_completed_at
    ) then
      new.status := 'cancelled';
      new.last_error_code := 'blocked_pre_registration_event';
      new.updated_at := now();
    end if;
    return new;
  end if;

  new.status := 'cancelled';
  new.last_error_code := 'blocked_not_registered';
  new.updated_at := now();
  return new;
end;
$tg$;

drop trigger if exists email_outbox_registration_gate_trg on public.email_outbox;
create trigger email_outbox_registration_gate_trg
  before insert on public.email_outbox
  for each row
  execute function public.email_outbox_registration_gate();

commit;
