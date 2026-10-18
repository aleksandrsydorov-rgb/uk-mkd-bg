-- =============================================================================
-- R1-MT-HIDE — Exclude Meetings (general_meeting) from Distribution Release 1.0
-- =============================================================================
-- Canonical control: module_catalog.implemented = false (same pattern as rental).
-- Force building_modules.enabled = false. Block DML via triggers + email enqueue.
-- Schema / historical migrations retained for future upgrade (set implemented=true).
-- Does NOT delete Meeting Core code. Does NOT touch Property Book SoT.
-- Tariff FK reads of general_meeting_decisions remain SELECT-ok (writes blocked).
-- =============================================================================

begin;

-- Catalog: not activatable in R1.0
update public.module_catalog as c
   set implemented = false,
       default_name = coalesce(c.default_name, 'Общие собрания'),
       category = coalesce(nullif(btrim(c.category), ''), 'documents'),
       sort_order = coalesce(c.sort_order, 10)
 where c.module_key = 'general_meeting';

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values ('general_meeting', 'Общие собрания', 'documents', false, 10)
on conflict (module_key) do update
  set implemented = false,
      default_name = excluded.default_name,
      category = excluded.category,
      sort_order = excluded.sort_order;

-- Force disabled (cannot become ACTIVE while implemented=false)
insert into public.building_modules (module_key, enabled, updated_at, updated_by)
values ('general_meeting', false, now(), null)
on conflict (module_key) do update
  set enabled = false,
      updated_at = now();

-- Module Lifecycle: force DISABLED (stale ACTIVE from earlier installs must not remain)
update public.module_lifecycle as ml
   set state = 'DISABLED',
       last_transition_at = now(),
       notes = coalesce(nullif(btrim(ml.notes), ''), 'R1-MT-HIDE: Meetings excluded from Distribution R1.0')
 where ml.module_key = 'general_meeting'
   and ml.state is distinct from 'DISABLED';

-- Canonical gate: unimplemented catalog modules cannot leave DISABLED via lifecycle
create or replace function public.module_lifecycle_block_unimplemented()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_implemented boolean;
begin
  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  if NEW.state is not distinct from 'DISABLED' then
    return NEW;
  end if;

  select c.implemented
    into v_implemented
  from public.module_catalog as c
  where c.module_key = NEW.module_key;

  if v_implemented is not true then
    raise exception 'module_setup: module % not implemented in this release', NEW.module_key
      using errcode = '42501';
  end if;

  return NEW;
end;
$fn$;

revoke all on function public.module_lifecycle_block_unimplemented() from public, anon;

drop trigger if exists module_lifecycle_block_unimplemented_trg on public.module_lifecycle;
create trigger module_lifecycle_block_unimplemented_trg
  before insert or update of state, module_key on public.module_lifecycle
  for each row
  execute function public.module_lifecycle_block_unimplemented();

create or replace function public.general_meeting_module_available()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_implemented boolean;
  v_enabled boolean;
begin
  select c.implemented
    into v_implemented
  from public.module_catalog as c
  where c.module_key = 'general_meeting';

  if v_implemented is not true then
    return false;
  end if;

  select coalesce(bm.enabled, false)
    into v_enabled
  from public.building_modules as bm
  where bm.module_key = 'general_meeting';

  return v_enabled is true;
end;
$fn$;

revoke all on function public.general_meeting_module_available() from public, anon;
grant execute on function public.general_meeting_module_available() to authenticated;
grant execute on function public.general_meeting_module_available() to service_role;

create or replace function public.general_meeting_assert_available()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.general_meeting_module_available() then
    raise exception 'general_meeting: module not available in this release'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.general_meeting_assert_available() from public, anon;

-- DML fail-closed (security-definer RPCs still hit table triggers)
create or replace function public.general_meeting_block_mutate_when_unavailable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Allow service_role maintenance / future upgrade migrations that set local GUC.
  if auth.role() is not distinct from 'service_role'
     and current_setting('general_meeting.allow_mutate', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform public.general_meeting_assert_available();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

revoke all on function public.general_meeting_block_mutate_when_unavailable() from public, anon;

do $gates$
declare
  v_rel text;
  v_tables text[] := array[
    'general_meetings',
    'general_meeting_agenda_items',
    'general_meeting_decisions',
    'general_meeting_participants',
    'general_meeting_votes',
    'general_meeting_files',
    'meeting_invitation_versions',
    'meeting_notice_snapshots',
    'meeting_notice_snapshot_parties',
    'meeting_voting_snapshots',
    'meeting_voting_snapshot_parties',
    'meeting_audit_log',
    'meeting_notifications',
    'meeting_proxies',
    'meeting_absentee_declarations',
    'meeting_protocols',
    'meeting_documents',
    'meeting_candidates',
    'meeting_challenges',
    'meeting_rulesets'
  ];
begin
  foreach v_rel in array v_tables
  loop
    if to_regclass('public.' || v_rel) is null then
      continue;
    end if;
    execute format(
      'drop trigger if exists general_meeting_r1_block_mutate_trg on public.%I',
      v_rel
    );
    execute format(
      'create trigger general_meeting_r1_block_mutate_trg
         before insert or update or delete on public.%I
         for each row
         execute function public.general_meeting_block_mutate_when_unavailable()',
      v_rel
    );
  end loop;
end;
$gates$;

-- Email Core: reject meeting enqueue while Meetings unavailable (sending remains OFF)
create or replace function public.email_core_assert_can_enqueue(
  p_module_key text,
  p_template_key text,
  p_to_email text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_module text := nullif(btrim(coalesce(p_module_key, '')), '');
  v_tpl text := lower(nullif(btrim(coalesce(p_template_key, '')), ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_property_id bigint := null;
  v_transfer_id bigint := null;
  v_is_admin boolean := false;
  v_raw text;
  v_to text := public.email_core_normalize_email(p_to_email);
  v_system_ok boolean := false;
begin
  if v_module is null then
    raise exception 'email_core_enqueue: invalid module_key'
      using errcode = '22023';
  end if;

  if auth.role() is not distinct from 'service_role' then
    return;
  end if;

  if auth.uid() is null then
    raise exception 'email_core_enqueue: not authenticated'
      using errcode = '28000';
  end if;

  v_is_admin := public.has_staff_role('администрация');

  if v_tpl is null then
    raise exception 'email_core_enqueue: template_key required'
      using errcode = '22023';
  end if;

  -- R1-MT-HIDE: Meetings email production blocked while module unavailable
  if v_module = 'meeting' or v_tpl like 'meeting_%' then
    if not public.general_meeting_module_available() then
      raise exception 'email_core_enqueue: meetings not available in this release'
        using errcode = '42501';
    end if;
  end if;

  if v_module = 'pb1_invite' and v_tpl not like 'pb1_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'user_activation' and v_tpl not like 'ua_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'pkg_xfer' and v_tpl not like 'ownership_change_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'meeting' and v_tpl not like 'meeting_%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;
  if v_module = 'email_test' and v_tpl not like 'email_test%' then
    raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
  end if;

  if v_module = 'system' then
    v_system_ok :=
      v_tpl like 'meters_%'
      or v_tpl like 'uk_%'
      or v_tpl like 'internet_%'
      or v_tpl like 'ticket_%'
      or v_tpl like 'residence_%'
      or v_tpl like 'cleaning_%'
      or v_tpl like 'support_fee_%'
      or v_tpl like 'capital_repair_%'
      or v_tpl like 'inventory_%'
      or v_tpl like 'email_digest%';
    if not v_system_ok then
      raise exception 'email_core_enqueue: template_key mismatch' using errcode = '22023';
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    if v_is_admin then
      return;
    end if;

    if v_property_id is not null
       and v_to is not null
       and public.owns_property(v_property_id)
       and public.property_book_active_owner_by_email(v_property_id, v_to) then
      return;
    end if;

    raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
  end if;

  if v_module in ('pb1_invite', 'user_activation', 'email_test', 'meeting') then
    if not v_is_admin then
      raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
    end if;
    return;
  end if;

  if v_module = 'pkg_xfer' then
    if v_is_admin then
      return;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'property_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_property_id := v_raw::bigint;
    end if;

    v_raw := nullif(btrim(coalesce(v_payload->>'transfer_id', '')), '');
    if v_raw is not null and v_raw ~ '^[0-9]+$' then
      v_transfer_id := v_raw::bigint;
    end if;

    if v_property_id is null and v_transfer_id is not null then
      select t.property_id
        into v_property_id
      from public.owner_transfers as t
      where t.id = v_transfer_id;
    end if;

    if v_property_id is not null and public.owns_property(v_property_id) then
      return;
    end if;

    raise exception 'email_core_enqueue: forbidden' using errcode = '42501';
  end if;

  raise exception 'email_core_enqueue: invalid module_key' using errcode = '22023';
end;
$fn$;

revoke all on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  from public, anon;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to authenticated;
grant execute on function public.email_core_assert_can_enqueue(text, text, text, jsonb)
  to service_role;

comment on function public.general_meeting_module_available() is
  'R1-MT-HIDE: true only when module_catalog.implemented and building_modules.enabled for general_meeting.';

commit;
