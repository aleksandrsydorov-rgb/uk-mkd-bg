-- PKG-XFER — Ownership change core (XFER.1–XFER.24 operational surface)
-- Forward-only. Extends owner_transfers; Property Book remains sole ownership SoT.
-- Ordinary overdue-debt gate is configurable and OFF by default (legal safety).

begin;

-- ---------------------------------------------------------------------------
-- Settings (debt gate OFF until legal signoff)
-- ---------------------------------------------------------------------------

create table if not exists public.ownership_change_settings (
  id smallint primary key default 1 check (id = 1),
  ordinary_debt_gate_enabled boolean not null default false,
  email_provider_configured boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_email text null
);

comment on table public.ownership_change_settings is
  'PKG-XFER settings. ordinary_debt_gate_enabled stays false until legal review (XFER.6/7 safety).';

insert into public.ownership_change_settings (id, ordinary_debt_gate_enabled, email_provider_configured)
values (1, false, false)
on conflict (id) do nothing;

alter table public.ownership_change_settings enable row level security;
revoke all on table public.ownership_change_settings from public, anon, authenticated;
grant select on table public.ownership_change_settings to authenticated;

drop policy if exists ownership_change_settings_admin_select on public.ownership_change_settings;
create policy ownership_change_settings_admin_select
on public.ownership_change_settings
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Book owner administrative status (inheritance / voting)
-- ---------------------------------------------------------------------------

alter table public.property_registry_people
  add column if not exists admin_status text not null default 'active';

alter table public.property_registry_people
  drop constraint if exists property_registry_people_admin_status_chk;

alter table public.property_registry_people
  add constraint property_registry_people_admin_status_chk
  check (admin_status in ('active', 'pending_inheritance', 'deceased_recorded'));

alter table public.property_registry_people
  add column if not exists voting_eligible boolean not null default true;

comment on column public.property_registry_people.admin_status is
  'XFER.12: pending_inheritance / deceased_recorded preserve history; voting_eligible false for deceased.';

-- ---------------------------------------------------------------------------
-- Extend owner_transfers
-- ---------------------------------------------------------------------------

alter table public.owner_transfers
  add column if not exists change_kind text not null default 'ordinary';

alter table public.owner_transfers
  add column if not exists change_reason text null;

alter table public.owner_transfers
  add column if not exists initiated_by text not null default 'owner';

alter table public.owner_transfers
  add column if not exists document_type text null;

alter table public.owner_transfers
  add column if not exists document_number text null;

alter table public.owner_transfers
  add column if not exists document_date date null;

alter table public.owner_transfers
  add column if not exists supporting_document_path text null;

alter table public.owner_transfers
  add column if not exists supporting_document_mime text null;

alter table public.owner_transfers
  add column if not exists legal_effective_date date null;

alter table public.owner_transfers
  add column if not exists baseline_owners jsonb null;

alter table public.owner_transfers
  add column if not exists baseline_roster_hash text null;

alter table public.owner_transfers
  add column if not exists target_owners jsonb null;

alter table public.owner_transfers
  add column if not exists submitted_by_email text null;

alter table public.owner_transfers
  add column if not exists cancelled_at timestamptz null;

alter table public.owner_transfers
  add column if not exists cancelled_by_email text null;

alter table public.owner_transfers
  add column if not exists corrects_transfer_id bigint null
    references public.owner_transfers (id);

alter table public.owner_transfers
  add column if not exists debt_check_result jsonb null;

alter table public.owner_transfers
  add column if not exists debt_gate_applied boolean not null default false;

alter table public.owner_transfers
  drop constraint if exists owner_transfers_change_kind_chk;

alter table public.owner_transfers
  add constraint owner_transfers_change_kind_chk
  check (change_kind in (
    'ordinary',
    'inheritance',
    'admin_initiated',
    'correction_link',
    'entity_person'
  ));

alter table public.owner_transfers
  drop constraint if exists owner_transfers_change_reason_chk;

alter table public.owner_transfers
  add constraint owner_transfers_change_reason_chk
  check (
    change_reason is null
    or change_reason in (
      'sale',
      'donation',
      'partial_transfer',
      'inheritance',
      'correction',
      'other'
    )
  );

alter table public.owner_transfers
  drop constraint if exists owner_transfers_initiated_by_chk;

alter table public.owner_transfers
  add constraint owner_transfers_initiated_by_chk
  check (initiated_by in ('owner', 'admin'));

alter table public.owner_transfers
  drop constraint if exists owner_transfers_status_chk;

alter table public.owner_transfers
  add constraint owner_transfers_status_chk
  check (status in ('ожидает', 'утверждена', 'отклонена', 'отменена'));

-- At most one active (pending) ownership-change request per property (XFER.19)
create unique index if not exists owner_transfers_one_pending_per_property_uidx
  on public.owner_transfers (property_id)
  where status = 'ожидает';

create index if not exists owner_transfers_status_created_idx
  on public.owner_transfers (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Legal-entity representative history (XFER.14 — not ownership)
-- ---------------------------------------------------------------------------

create table if not exists public.legal_entity_representatives (
  id bigserial primary key,
  property_id bigint not null references public.properties (id) on delete cascade,
  registry_people_id bigint not null references public.property_registry_people (id) on delete cascade,
  representative_name text not null,
  representative_email text not null,
  document_type text null,
  document_number text null,
  document_date date null,
  supporting_document_path text null,
  valid_from date not null default current_date,
  valid_until date null,
  created_at timestamptz not null default now(),
  created_by_email text null,
  note text null,
  constraint legal_entity_representatives_email_chk
    check (position('@' in representative_email) > 0)
);

create index if not exists legal_entity_representatives_property_idx
  on public.legal_entity_representatives (property_id, valid_from desc);

alter table public.legal_entity_representatives enable row level security;
revoke all on table public.legal_entity_representatives from public, anon;
revoke all on table public.legal_entity_representatives from authenticated;
grant select on table public.legal_entity_representatives to authenticated;

drop policy if exists legal_entity_representatives_admin_owner_select on public.legal_entity_representatives;
create policy legal_entity_representatives_admin_owner_select
on public.legal_entity_representatives
for select to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

-- ---------------------------------------------------------------------------
-- Administrative data corrections (XFER.16 — not a transfer)
-- ---------------------------------------------------------------------------

create table if not exists public.ownership_admin_corrections (
  id bigserial primary key,
  property_id bigint not null references public.properties (id) on delete cascade,
  reason text not null,
  evidence_document_path text null,
  evidence_note text null,
  before_owners jsonb not null,
  after_owners jsonb not null,
  created_at timestamptz not null default now(),
  created_by_email text not null,
  book_result jsonb null
);

create index if not exists ownership_admin_corrections_property_idx
  on public.ownership_admin_corrections (property_id, created_at desc);

alter table public.ownership_admin_corrections enable row level security;
revoke all on table public.ownership_admin_corrections from public, anon, authenticated;
grant select on table public.ownership_admin_corrections to authenticated;

drop policy if exists ownership_admin_corrections_admin_select on public.ownership_admin_corrections;
create policy ownership_admin_corrections_admin_select
on public.ownership_admin_corrections
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- Inherited liabilities (XFER.11 — never auto-assigned from shares)
-- ---------------------------------------------------------------------------

create table if not exists public.ownership_inherited_liabilities (
  id bigserial primary key,
  property_id bigint not null references public.properties (id) on delete cascade,
  transfer_id bigint null references public.owner_transfers (id) on delete set null,
  heir_email text null,
  heir_name text null,
  amount_eur numeric(14, 2) not null check (amount_eur >= 0),
  basis_document_type text not null,
  basis_document_number text not null,
  basis_document_date date not null,
  note text null,
  created_at timestamptz not null default now(),
  created_by_email text not null
);

alter table public.ownership_inherited_liabilities enable row level security;
revoke all on table public.ownership_inherited_liabilities from public, anon, authenticated;
grant select on table public.ownership_inherited_liabilities to authenticated;

drop policy if exists ownership_inherited_liabilities_admin_select on public.ownership_inherited_liabilities;
create policy ownership_inherited_liabilities_admin_select
on public.ownership_inherited_liabilities
for select to authenticated
using (public.has_staff_role('администрация'));

-- ---------------------------------------------------------------------------
-- In-app notifications with truthful email delivery state (XFER.10/22/23)
-- ---------------------------------------------------------------------------

create table if not exists public.ownership_change_notifications (
  id bigserial primary key,
  transfer_id bigint null references public.owner_transfers (id) on delete cascade,
  property_id bigint not null references public.properties (id) on delete cascade,
  event_kind text not null,
  recipient_email text not null,
  recipient_role text not null default 'owner',
  in_app_delivered boolean not null default true,
  email_attempted boolean not null default false,
  email_delivered boolean not null default false,
  email_skip_reason text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ownership_change_notifications_event_chk
    check (event_kind in (
      'submitted', 'approved', 'rejected', 'cancelled',
      'admin_pending', 'inheritance_pending', 'representative_changed',
      'correction_recorded', 'extract_certified_requested'
    ))
);

create index if not exists ownership_change_notifications_transfer_idx
  on public.ownership_change_notifications (transfer_id, created_at desc);

create index if not exists ownership_change_notifications_admin_pending_idx
  on public.ownership_change_notifications (event_kind, created_at desc)
  where event_kind = 'admin_pending';

alter table public.ownership_change_notifications enable row level security;
revoke all on table public.ownership_change_notifications from public, anon;
revoke all on table public.ownership_change_notifications from authenticated;
grant select on table public.ownership_change_notifications to authenticated;

drop policy if exists ownership_change_notifications_select on public.ownership_change_notifications;
create policy ownership_change_notifications_select
on public.ownership_change_notifications
for select to authenticated
using (
  public.has_staff_role('администрация')
  or lower(btrim(recipient_email)) = lower(btrim(coalesce(auth.email(), '')))
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.ownership_change_book_owners_json(p_property_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'entity_kind', r.entity_kind,
        'first_name', r.first_name,
        'middle_name', r.middle_name,
        'last_name', r.last_name,
        'entity_name', r.entity_name,
        'eik_bulstat', r.eik_bulstat,
        'email', lower(btrim(coalesce(r.email, ''))),
        'ownership_share_percent', r.ownership_share_percent,
        'ideal_parts_percent', r.ideal_parts_percent,
        'admin_status', r.admin_status,
        'voting_eligible', r.voting_eligible
      )
      order by r.id
    ),
    '[]'::jsonb
  )
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null;
$$;

revoke all on function public.ownership_change_book_owners_json(bigint) from public, anon;
grant execute on function public.ownership_change_book_owners_json(bigint) to authenticated;

create or replace function public.ownership_change_roster_hash(p_property_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(x.k, '|' order by x.k), ''))
  from (
    select
      r.id::text || ':' ||
      lower(coalesce(r.email, '')) || ':' ||
      coalesce(r.ownership_share_percent, 0)::text || ':' ||
      coalesce(r.ideal_parts_percent, 0)::text || ':' ||
      coalesce(r.admin_status, 'active') as k
    from public.property_registry_people as r
    where r.property_id = p_property_id
      and r.relation_type = 'owner'
      and r.deregistered_at is null
  ) as x;
$$;

revoke all on function public.ownership_change_roster_hash(bigint) from public, anon;

create or replace function public.ownership_change_validate_owners(
  p_property_id bigint,
  p_owners jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_kind text;
  v_share_sum numeric := 0;
  v_ideal_sum numeric := 0;
  v_prop_ideal numeric;
  v_share numeric;
  v_ideal numeric;
  v_n integer := 0;
begin
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' or jsonb_array_length(p_owners) < 1 then
    raise exception 'ownership_change: target_owners required'
      using errcode = '22023';
  end if;

  select coalesce(p.ideal_parts_percent, 0) into v_prop_ideal
  from public.properties as p
  where p.id = p_property_id;

  for v_item in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_n := v_n + 1;
    v_kind := nullif(btrim(coalesce(v_item ->> 'entity_kind', '')), '');
    if v_kind is null or v_kind not in ('natural_person', 'legal_entity', 'sole_trader') then
      raise exception 'ownership_change: invalid entity_kind'
        using errcode = '22023';
    end if;
    v_share := nullif(v_item ->> 'ownership_share_percent', '')::numeric;
    v_ideal := nullif(v_item ->> 'ideal_parts_percent', '')::numeric;
    if v_share is null or v_share <= 0 then
      raise exception 'ownership_change: ownership_share_percent required'
        using errcode = '22023';
    end if;
    if v_ideal is null or v_ideal < 0 then
      raise exception 'ownership_change: ideal_parts_percent required'
        using errcode = '22023';
    end if;
    v_share_sum := v_share_sum + v_share;
    v_ideal_sum := v_ideal_sum + v_ideal;
  end loop;

  if abs(v_share_sum - 100) > 0.001 then
    raise exception 'ownership_change: ownership shares must total 100%% (got %)', v_share_sum
      using errcode = '22023';
  end if;
  if abs(v_ideal_sum - coalesce(v_prop_ideal, 0)) > 0.001 then
    raise exception 'ownership_change: ideal parts must total property ideal %% (got % vs %)',
      v_ideal_sum, v_prop_ideal
      using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.ownership_change_validate_owners(bigint, jsonb) from public, anon;

create or replace function public.ownership_change_overdue_debt(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_overdue numeric := 0;
  v_future numeric := 0;
  v_prop_debt numeric := 0;
begin
  -- Support-fee assessments: overdue = remaining_due > 0 and early_deadline_at < now()
  select
    coalesce(sum(case
      when a.remaining_due > 0
       and a.early_deadline_at is not null
       and a.early_deadline_at < now()
      then a.remaining_due else 0 end), 0),
    coalesce(sum(case
      when a.remaining_due > 0
       and (a.early_deadline_at is null or a.early_deadline_at >= now())
      then a.remaining_due else 0 end), 0)
  into v_overdue, v_future
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected';

  select coalesce(p.debt, 0) into v_prop_debt
  from public.properties as p
  where p.id = p_property_id;

  -- Portal debt field may include overdue; do not treat undated portal debt as blocking
  -- unless assessments confirm overdue (XFER.7 + legal safety).
  return jsonb_build_object(
    'overdue_unpaid_eur', v_overdue,
    'future_due_eur', v_future,
    'portal_debt_eur', v_prop_debt,
    'blocks_ordinary', v_overdue > 0
  );
end;
$fn$;

revoke all on function public.ownership_change_overdue_debt(bigint) from public, anon;
grant execute on function public.ownership_change_overdue_debt(bigint) to authenticated;

create or replace function public.ownership_change_notify(
  p_transfer_id bigint,
  p_property_id bigint,
  p_event_kind text,
  p_emails text[],
  p_payload jsonb default '{}'::jsonb,
  p_recipient_role text default 'owner'
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_provider boolean := false;
  v_seen text[] := array[]::text[];
begin
  select s.email_provider_configured into v_provider
  from public.ownership_change_settings as s
  where s.id = 1;

  foreach v_email in array coalesce(p_emails, array[]::text[])
  loop
    v_email := lower(nullif(btrim(coalesce(v_email, '')), ''));
    if v_email is null or v_email = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_email);
    insert into public.ownership_change_notifications (
      transfer_id, property_id, event_kind, recipient_email, recipient_role,
      in_app_delivered, email_attempted, email_delivered, email_skip_reason, payload
    ) values (
      p_transfer_id,
      p_property_id,
      p_event_kind,
      v_email,
      p_recipient_role,
      true,
      v_provider,
      false,
      case when v_provider then null else 'email_provider_not_configured' end,
      coalesce(p_payload, '{}'::jsonb)
    );
  end loop;
end;
$fn$;

revoke all on function public.ownership_change_notify(bigint, bigint, text, text[], jsonb, text)
  from public, anon;

create or replace function public.ownership_change_affected_emails(
  p_property_id bigint,
  p_baseline jsonb,
  p_target jsonb
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct e), array[]::text[])
  from (
    select lower(btrim(x.email)) as e
    from (
      select jsonb_array_elements(coalesce(p_baseline, '[]'::jsonb)) ->> 'email' as email
      union all
      select jsonb_array_elements(coalesce(p_target, '[]'::jsonb)) ->> 'email'
      union all
      select r.email
      from public.property_registry_people as r
      where r.property_id = p_property_id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
    ) as x
    where nullif(btrim(coalesce(x.email, '')), '') is not null
  ) as y;
$$;

revoke all on function public.ownership_change_affected_emails(bigint, jsonb, jsonb)
  from public, anon;

create or replace function public.ownership_change_display_name(p_owner jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ',
      nullif(btrim(coalesce(p_owner ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(p_owner ->> 'middle_name', '')), ''),
      nullif(btrim(coalesce(p_owner ->> 'last_name', '')), '')
    )), ''),
    nullif(btrim(coalesce(p_owner ->> 'entity_name', '')), ''),
    nullif(btrim(coalesce(p_owner ->> 'email', '')), ''),
    'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Submit (owner or admin) — XFER.1/2/8/9/15/17/19
-- ---------------------------------------------------------------------------

create or replace function public.submit_ownership_change(
  p_property_id bigint,
  p_target_owners jsonb,
  p_change_kind text default 'ordinary',
  p_document_type text default null,
  p_document_number text default null,
  p_document_date date default null,
  p_supporting_document_path text default null,
  p_supporting_document_mime text default null,
  p_legal_effective_date date default null,
  p_note text default null,
  p_to_owner_phone text default null,
  p_corrects_transfer_id bigint default null,
  p_as_admin boolean default false,
  p_change_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_kind text := nullif(btrim(coalesce(p_change_kind, '')), '');
  v_reason text := nullif(btrim(coalesce(p_change_reason, '')), '');
  v_baseline jsonb;
  v_hash text;
  v_id bigint;
  v_first jsonb;
  v_from_name text;
  v_from_email text;
  v_to_name text;
  v_to_email text;
  v_admin_emails text[];
  v_initiated text;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'submit_ownership_change: not authenticated'
      using errcode = '28000';
  end if;

  if p_as_admin then
    perform public.admin_assert_book_admin();
    v_initiated := 'admin';
    if v_kind = 'ordinary' then
      v_kind := 'admin_initiated';
    end if;
  else
    if not public.owns_property(p_property_id) then
      raise exception 'submit_ownership_change: not a current Book owner'
        using errcode = '42501';
    end if;
    v_initiated := 'owner';
    -- Any co-owner may submit without others' electronic consent (XFER.2)
  end if;

  if v_kind is null or v_kind not in (
    'ordinary', 'inheritance', 'admin_initiated', 'correction_link', 'entity_person'
  ) then
    raise exception 'submit_ownership_change: invalid change_kind'
      using errcode = '22023';
  end if;

  if v_reason is not null and v_reason not in (
    'sale', 'donation', 'partial_transfer', 'inheritance', 'correction', 'other'
  ) then
    raise exception 'submit_ownership_change: invalid change_reason'
      using errcode = '22023';
  end if;

  -- Map legal basis to workflow kind when owner picks inheritance/correction
  if v_reason = 'inheritance' and v_kind = 'ordinary' then
    v_kind := 'inheritance';
  end if;
  if v_reason = 'correction' and v_kind = 'ordinary' and p_as_admin then
    v_kind := 'correction_link';
  end if;

  perform public.ownership_change_validate_owners(p_property_id, p_target_owners);

  v_baseline := public.ownership_change_book_owners_json(p_property_id);
  v_hash := public.ownership_change_roster_hash(p_property_id);

  v_first := p_target_owners -> 0;
  v_to_name := public.ownership_change_display_name(v_first);
  v_to_email := lower(nullif(btrim(coalesce(v_first ->> 'email', '')), ''));
  if v_to_email is null then
    raise exception 'submit_ownership_change: target email required'
      using errcode = '22023';
  end if;

  select
    public.ownership_change_display_name(b),
    lower(nullif(btrim(coalesce(b ->> 'email', '')), ''))
  into v_from_name, v_from_email
  from jsonb_array_elements(v_baseline) as t(b)
  where lower(nullif(btrim(coalesce(b ->> 'email', '')), '')) = v_email
  limit 1;

  if v_from_email is null then
    select
      public.ownership_change_display_name(b),
      lower(nullif(btrim(coalesce(b ->> 'email', '')), ''))
    into v_from_name, v_from_email
    from jsonb_array_elements(v_baseline) as t(b)
    limit 1;
  end if;

  insert into public.owner_transfers (
    property_id,
    from_owner_name, from_owner_email, from_owner_phone,
    to_owner_name, to_owner_email, to_owner_phone,
    note, status,
    change_kind, change_reason, initiated_by,
    document_type, document_number, document_date,
    supporting_document_path, supporting_document_mime,
    legal_effective_date,
    baseline_owners, baseline_roster_hash, target_owners,
    submitted_by_email, corrects_transfer_id
  ) values (
    p_property_id,
    v_from_name, v_from_email, null,
    v_to_name, v_to_email, nullif(btrim(coalesce(p_to_owner_phone, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    'ожидает',
    v_kind, v_reason, v_initiated,
    nullif(btrim(coalesce(p_document_type, '')), ''),
    nullif(btrim(coalesce(p_document_number, '')), ''),
    p_document_date,
    nullif(btrim(coalesce(p_supporting_document_path, '')), ''),
    nullif(btrim(coalesce(p_supporting_document_mime, '')), ''),
    p_legal_effective_date,
    v_baseline, v_hash, p_target_owners,
    v_email, p_corrects_transfer_id
  )
  returning id into v_id;

  perform public.ownership_change_notify(
    v_id, p_property_id, 'submitted',
    public.ownership_change_affected_emails(p_property_id, v_baseline, p_target_owners),
    jsonb_build_object('change_kind', v_kind)
  );

  select coalesce(array_agg(lower(btrim(s.email))), array[]::text[])
    into v_admin_emails
  from public.staff as s
  where s.active is true
    and s.role = 'администрация'
    and nullif(btrim(coalesce(s.email, '')), '') is not null;

  perform public.ownership_change_notify(
    v_id, p_property_id, 'admin_pending',
    v_admin_emails,
    jsonb_build_object('transfer_id', v_id),
    'admin'
  );

  return jsonb_build_object('ok', true, 'transfer_id', v_id, 'status', 'ожидает');
exception
  when unique_violation then
    raise exception 'submit_ownership_change: property already has a pending ownership-change request'
      using errcode = '23505';
end;
$fn$;

revoke all on function public.submit_ownership_change(
  bigint, jsonb, text, text, text, date, text, text, date, text, text, bigint, boolean, text
) from public, anon;
grant execute on function public.submit_ownership_change(
  bigint, jsonb, text, text, text, date, text, text, date, text, text, bigint, boolean, text
) to authenticated;

-- Admin may edit proposed roster while request is pending (final Book apply still on approve)
create or replace function public.admin_update_pending_ownership_targets(
  p_transfer_id bigint,
  p_target_owners jsonb,
  p_legal_effective_date date default null,
  p_change_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
  v_first jsonb;
  v_reason text := nullif(btrim(coalesce(p_change_reason, '')), '');
begin
  perform public.admin_assert_book_admin();

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'admin_update_pending_ownership_targets: not found'
      using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'admin_update_pending_ownership_targets: not pending'
      using errcode = 'P0001';
  end if;

  perform public.ownership_change_validate_owners(v_tr.property_id, p_target_owners);

  if v_reason is not null and v_reason not in (
    'sale', 'donation', 'partial_transfer', 'inheritance', 'correction', 'other'
  ) then
    raise exception 'admin_update_pending_ownership_targets: invalid change_reason'
      using errcode = '22023';
  end if;

  v_first := p_target_owners -> 0;

  update public.owner_transfers as t
     set target_owners = p_target_owners,
         to_owner_name = public.ownership_change_display_name(v_first),
         to_owner_email = lower(nullif(btrim(coalesce(v_first ->> 'email', '')), '')),
         legal_effective_date = coalesce(p_legal_effective_date, t.legal_effective_date),
         change_reason = coalesce(v_reason, t.change_reason),
         note = case
           when p_note is null then t.note
           else nullif(btrim(p_note), '')
         end
   where t.id = p_transfer_id;

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id);
end;
$fn$;

revoke all on function public.admin_update_pending_ownership_targets(
  bigint, jsonb, date, text, text
) from public, anon;
grant execute on function public.admin_update_pending_ownership_targets(
  bigint, jsonb, date, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel (applicant) — XFER.17
-- ---------------------------------------------------------------------------

create or replace function public.cancel_ownership_change(p_transfer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_tr public.owner_transfers%rowtype;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'cancel_ownership_change: not authenticated'
      using errcode = '28000';
  end if;

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'cancel_ownership_change: not found' using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'cancel_ownership_change: not pending' using errcode = 'P0001';
  end if;
  if lower(btrim(coalesce(v_tr.submitted_by_email, v_tr.from_owner_email, ''))) is distinct from v_email
     and not public.has_staff_role('администрация')
  then
    raise exception 'cancel_ownership_change: only applicant or admin' using errcode = '42501';
  end if;

  update public.owner_transfers as t
     set status = 'отменена',
         cancelled_at = now(),
         cancelled_by_email = v_email,
         decided_at = now(),
         decided_by = v_email
   where t.id = p_transfer_id;

  perform public.ownership_change_notify(
    p_transfer_id, v_tr.property_id, 'cancelled',
    public.ownership_change_affected_emails(
      v_tr.property_id, v_tr.baseline_owners, v_tr.target_owners
    ),
    jsonb_build_object('cancelled_by', v_email)
  );

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'отменена');
end;
$fn$;

revoke all on function public.cancel_ownership_change(bigint) from public, anon;
grant execute on function public.cancel_ownership_change(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Reject (admin, mandatory reason) — XFER.18
-- ---------------------------------------------------------------------------

create or replace function public.admin_reject_owner_transfer(
  p_transfer_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  perform public.admin_assert_book_admin();
  if v_reason is null then
    raise exception 'admin_reject_owner_transfer: reason required'
      using errcode = '22023';
  end if;

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'admin_reject_owner_transfer: not found' using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'admin_reject_owner_transfer: not pending' using errcode = 'P0001';
  end if;

  update public.owner_transfers as t
     set status = 'отклонена',
         decided_at = now(),
         decided_by = v_email,
         reject_reason = v_reason
   where t.id = p_transfer_id;

  perform public.ownership_change_notify(
    p_transfer_id, v_tr.property_id, 'rejected',
    public.ownership_change_affected_emails(
      v_tr.property_id, v_tr.baseline_owners, v_tr.target_owners
    ),
    jsonb_build_object('reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'отклонена');
end;
$fn$;

revoke all on function public.admin_reject_owner_transfer(bigint, text) from public, anon;
grant execute on function public.admin_reject_owner_transfer(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Approve (multi-party Book replace) — XFER.1/3/4/5/6/7/9/11/15/20/21
-- ---------------------------------------------------------------------------

create or replace function public.admin_approve_owner_transfer(
  p_transfer_id bigint,
  p_target_owners jsonb default null,
  p_document_type text default null,
  p_document_number text default null,
  p_document_date date default null,
  p_supporting_document_path text default null,
  p_legal_effective_date date default null,
  p_record_inherited_liabilities jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
  v_prop public.properties%rowtype;
  v_targets jsonb;
  v_current_hash text;
  v_book jsonb;
  v_debt jsonb;
  v_gate boolean := false;
  v_doc_type text;
  v_doc_num text;
  v_doc_date date;
  v_sup_path text;
  v_legal_date date;
  v_liab jsonb;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_share_n integer;
  v_own_type text;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'admin_approve_owner_transfer: not found' using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'admin_approve_owner_transfer: not pending' using errcode = 'P0001';
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = v_tr.property_id;
  if not found then
    raise exception 'admin_approve_owner_transfer: property not found' using errcode = 'P0002';
  end if;

  -- Stale baseline check (XFER.20)
  v_current_hash := public.ownership_change_roster_hash(v_tr.property_id);
  if v_tr.baseline_roster_hash is not null
     and v_tr.baseline_roster_hash is distinct from v_current_hash
  then
    raise exception 'admin_approve_owner_transfer: stale Book baseline — reject and resubmit'
      using errcode = 'P0001';
  end if;

  v_targets := coalesce(p_target_owners, v_tr.target_owners);
  if v_targets is null or jsonb_typeof(v_targets) <> 'array' then
    -- Legacy sole 1→1 row without target_owners
    v_targets := jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', split_part(btrim(v_tr.to_owner_name), ' ', 1),
      'last_name', nullif(btrim(substr(btrim(v_tr.to_owner_name), length(split_part(btrim(v_tr.to_owner_name), ' ', 1)) + 2)), ''),
      'email', lower(btrim(v_tr.to_owner_email)),
      'ownership_share_percent', 100,
      'ideal_parts_percent', coalesce(v_prop.ideal_parts_percent, 0)
    ));
    if (v_targets -> 0 ->> 'last_name') is null then
      v_targets := jsonb_set(v_targets, '{0,last_name}', to_jsonb(v_targets -> 0 ->> 'first_name'));
    end if;
  end if;

  perform public.ownership_change_validate_owners(v_tr.property_id, v_targets);

  v_doc_type := coalesce(nullif(btrim(coalesce(p_document_type, '')), ''), v_tr.document_type);
  v_doc_num := coalesce(nullif(btrim(coalesce(p_document_number, '')), ''), v_tr.document_number);
  v_doc_date := coalesce(p_document_date, v_tr.document_date);
  v_sup_path := coalesce(
    nullif(btrim(coalesce(p_supporting_document_path, '')), ''),
    v_tr.supporting_document_path
  );
  v_legal_date := coalesce(p_legal_effective_date, v_tr.legal_effective_date);

  -- Approval document requirements (XFER.3); inheritance uses same mechanism (XFER.9)
  if v_doc_type is null or v_doc_num is null or v_doc_date is null or v_sup_path is null then
    raise exception 'admin_approve_owner_transfer: document type, number, date and supporting document required'
      using errcode = '22023';
  end if;

  -- Debt gate: ordinary only, and only when enabled (XFER.6/7 + legal safety)
  select s.ordinary_debt_gate_enabled into v_gate
  from public.ownership_change_settings as s
  where s.id = 1;

  v_debt := public.ownership_change_overdue_debt(v_tr.property_id);

  -- Inheritance + legal/admin corrections never debt-blocked (XFER.11 + legal safety)
  if v_tr.change_kind in ('ordinary', 'admin_initiated', 'entity_person')
     and coalesce(v_tr.change_reason, '') is distinct from 'inheritance'
     and coalesce(v_tr.change_reason, '') is distinct from 'correction'
     and coalesce(v_gate, false)
     and (v_debt ->> 'blocks_ordinary')::boolean
  then
    raise exception 'admin_approve_owner_transfer: overdue unpaid obligations block ordinary approval'
      using errcode = 'P0001';
  end if;

  v_share_n := jsonb_array_length(v_targets);
  v_own_type := case when v_share_n > 1 then 'shared' else 'sole' end;

  update public.properties as p
     set ownership_type = v_own_type
   where p.id = v_tr.property_id;

  v_book := public.admin_replace_property_book_owners(v_tr.property_id, v_targets);

  update public.properties as p
     set owner_phone = coalesce(v_tr.to_owner_phone, p.owner_phone)
   where p.id = v_tr.property_id;

  -- Optional manually recorded inherited liabilities (never auto from shares)
  if p_record_inherited_liabilities is not null
     and jsonb_typeof(p_record_inherited_liabilities) = 'array'
  then
    for v_liab in select value from jsonb_array_elements(p_record_inherited_liabilities) as t(value)
    loop
      insert into public.ownership_inherited_liabilities (
        property_id, transfer_id, heir_email, heir_name, amount_eur,
        basis_document_type, basis_document_number, basis_document_date,
        note, created_by_email
      ) values (
        v_tr.property_id,
        p_transfer_id,
        lower(nullif(btrim(coalesce(v_liab ->> 'heir_email', '')), '')),
        nullif(btrim(coalesce(v_liab ->> 'heir_name', '')), ''),
        (v_liab ->> 'amount_eur')::numeric,
        nullif(btrim(coalesce(v_liab ->> 'basis_document_type', '')), ''),
        nullif(btrim(coalesce(v_liab ->> 'basis_document_number', '')), ''),
        nullif(v_liab ->> 'basis_document_date', '')::date,
        nullif(btrim(coalesce(v_liab ->> 'note', '')), ''),
        v_email
      );
    end loop;
  end if;

  insert into public.property_book_transfer_approve_gate (transfer_id)
  values (p_transfer_id)
  on conflict (transfer_id) do update set created_at = now();

  update public.owner_transfers as t
     set status = 'утверждена',
         decided_at = now(),
         decided_by = v_email,
         document_type = v_doc_type,
         document_number = v_doc_num,
         document_date = v_doc_date,
         supporting_document_path = v_sup_path,
         legal_effective_date = v_legal_date,
         target_owners = v_targets,
         debt_check_result = v_debt,
         debt_gate_applied = coalesce(v_gate, false)
   where t.id = p_transfer_id;

  delete from public.property_book_transfer_approve_gate as g
   where g.transfer_id = p_transfer_id;

  perform public.log_property_change(
    v_tr.property_id,
    'book_ui',
    'book',
    'replace_owners',
    jsonb_build_object(
      'transfer_id', p_transfer_id,
      'change_kind', v_tr.change_kind,
      'legal_effective_date', v_legal_date,
      'system_approval_at', now(),
      'baseline', v_tr.baseline_owners,
      'target', v_targets
    ),
    'ownership_change_approved'
  );

  perform public.ownership_change_notify(
    p_transfer_id, v_tr.property_id, 'approved',
    public.ownership_change_affected_emails(
      v_tr.property_id, v_tr.baseline_owners, v_targets
    ),
    jsonb_build_object(
      'legal_effective_date', v_legal_date,
      'decided_at', now()
    )
  );

  perform public.property_book_set_mutating(false);

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'property_id', v_tr.property_id,
    'legal_effective_date', v_legal_date,
    'debt_check', v_debt,
    'debt_gate_applied', coalesce(v_gate, false),
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

-- Keep legacy single-arg overload as wrapper
create or replace function public.admin_approve_owner_transfer(p_transfer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.admin_approve_owner_transfer(
    p_transfer_id, null, null, null, null, null, null, null
  );
end;
$fn$;

revoke all on function public.admin_approve_owner_transfer(bigint) from public, anon;
grant execute on function public.admin_approve_owner_transfer(bigint) to authenticated;

revoke all on function public.admin_approve_owner_transfer(
  bigint, jsonb, text, text, date, text, date, jsonb
) from public, anon;
grant execute on function public.admin_approve_owner_transfer(
  bigint, jsonb, text, text, date, text, date, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- Harden insert trigger: Book co-owner OR admin RPC path (legacy direct insert)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_owner_transfer_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  if auth.uid() is null then
    raise exception 'owner_transfers: not authenticated' using errcode = '28000';
  end if;

  if new.status is distinct from 'ожидает' then
    raise exception 'owner_transfers: insert status must be ожидает' using errcode = '42501';
  end if;
  if new.decided_at is not null or new.decided_by is not null or new.reject_reason is not null then
    raise exception 'owner_transfers: decision fields must be null on insert' using errcode = '42501';
  end if;

  -- Prefer submit_ownership_change RPC; allow direct insert only for Book owners / admin
  if not public.has_staff_role('администрация')
     and not public.owns_property(new.property_id)
  then
    raise exception 'owner_transfers: insert allowed only for current Book co-owner or admin'
      using errcode = '42501';
  end if;

  if new.submitted_by_email is null then
    new.submitted_by_email := v_email;
  end if;
  if new.baseline_owners is null then
    new.baseline_owners := public.ownership_change_book_owners_json(new.property_id);
  end if;
  if new.baseline_roster_hash is null then
    new.baseline_roster_hash := public.ownership_change_roster_hash(new.property_id);
  end if;
  if new.target_owners is null then
    new.target_owners := jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', split_part(btrim(new.to_owner_name), ' ', 1),
      'last_name', coalesce(
        nullif(btrim(substr(btrim(new.to_owner_name), length(split_part(btrim(new.to_owner_name), ' ', 1)) + 2)), ''),
        split_part(btrim(new.to_owner_name), ' ', 1)
      ),
      'email', lower(btrim(new.to_owner_email)),
      'ownership_share_percent', 100,
      'ideal_parts_percent', (
        select coalesce(p.ideal_parts_percent, 0)
        from public.properties as p
        where p.id = new.property_id
      )
    ));
  end if;

  return new;
end;
$fn$;

-- Block client approve/reject bypass; reject/cancel via RPC
create or replace function public.enforce_owner_transfer_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.has_staff_role('администрация')
     and old.status = 'ожидает'
     and new.status = 'отменена'
     and lower(btrim(coalesce(old.submitted_by_email, old.from_owner_email, '')))
         = lower(btrim(coalesce(auth.email(), '')))
  then
    -- Prefer cancel_ownership_change; allow applicant cancel fields only
    if new.property_id is distinct from old.property_id
       or new.to_owner_email is distinct from old.to_owner_email
       or new.to_owner_name is distinct from old.to_owner_name
    then
      raise exception 'owner_transfers: cancel may not alter request body'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'owner_transfers: update allowed only for administration'
      using errcode = '42501';
  end if;

  if new.status = 'утверждена' and old.status is distinct from 'утверждена' then
    -- Gate trigger handles ticket; still forbid other field free-edits via client
    return new;
  end if;

  if new.status = 'отклонена' then
    if nullif(btrim(coalesce(new.reject_reason, '')), '') is null then
      raise exception 'owner_transfers: reject_reason required'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Inheritance pending + guest access (XFER.12/13)
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_inheritance_pending(
  p_registry_people_id bigint,
  p_mark_deceased boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_registry_people%rowtype;
  v_status text;
begin
  perform public.admin_assert_book_admin();

  select r.* into v_row
  from public.property_registry_people as r
  where r.id = p_registry_people_id
  for update;

  if not found then
    raise exception 'admin_set_inheritance_pending: not found' using errcode = 'P0002';
  end if;
  if v_row.relation_type is distinct from 'owner' or v_row.deregistered_at is not null then
    raise exception 'admin_set_inheritance_pending: not an active owner' using errcode = 'P0001';
  end if;

  v_status := case when p_mark_deceased then 'deceased_recorded' else 'pending_inheritance' end;

  update public.property_registry_people as r
     set admin_status = v_status,
         voting_eligible = false,
         note = case
           when p_note is null then r.note
           else nullif(btrim(p_note), '')
         end,
         updated_at = now()
   where r.id = p_registry_people_id;

  -- Historical row preserved (not deregistered). Quorum denominators still count ideal parts.
  perform public.ownership_change_notify(
    null, v_row.property_id, 'inheritance_pending',
    array[lower(btrim(coalesce(v_row.email, '')))],
    jsonb_build_object('registry_people_id', p_registry_people_id, 'admin_status', v_status)
  );

  return jsonb_build_object(
    'ok', true,
    'registry_people_id', p_registry_people_id,
    'admin_status', v_status,
    'voting_eligible', false
  );
end;
$fn$;

revoke all on function public.admin_set_inheritance_pending(bigint, boolean, text)
  from public, anon;
grant execute on function public.admin_set_inheritance_pending(bigint, boolean, text)
  to authenticated;

create or replace function public.admin_grant_inheritance_guest_access(
  p_property_id bigint,
  p_email text,
  p_valid_until timestamptz default (now() + interval '90 days'),
  p_note text default null
)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_creator text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_row public.property_guest_accesses%rowtype;
  v_pending boolean := false;
begin
  perform public.admin_assert_book_admin();
  if v_email is null then
    raise exception 'admin_grant_inheritance_guest_access: email required'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.property_registry_people as r
    where r.property_id = p_property_id
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and r.admin_status in ('pending_inheritance', 'deceased_recorded')
  ) into v_pending;

  if not v_pending then
    raise exception 'admin_grant_inheritance_guest_access: property not in inheritance pending state'
      using errcode = 'P0001';
  end if;

  perform public.guest_access_expire_stale();

  insert into public.property_guest_accesses (
    property_id, email, relation_type, valid_from, valid_until, status, created_by_email
  ) values (
    p_property_id, v_email, 'living_with_owner',
    now(), p_valid_until, 'active', v_creator
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_grant_inheritance_guest_access(bigint, text, timestamptz, text)
  from public, anon;
grant execute on function public.admin_grant_inheritance_guest_access(bigint, text, timestamptz, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Legal entity representative change (XFER.14)
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_legal_entity_representative(
  p_registry_people_id bigint,
  p_representative_name text,
  p_representative_email text,
  p_document_type text default null,
  p_document_number text default null,
  p_document_date date default null,
  p_supporting_document_path text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_registry_people%rowtype;
  v_name text := nullif(btrim(coalesce(p_representative_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_representative_email, '')), ''));
  v_id bigint;
  v_actor text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  perform public.admin_assert_book_admin();
  if v_name is null or v_email is null then
    raise exception 'admin_update_legal_entity_representative: name and email required'
      using errcode = '22023';
  end if;

  select r.* into v_row
  from public.property_registry_people as r
  where r.id = p_registry_people_id
  for update;

  if not found then
    raise exception 'admin_update_legal_entity_representative: not found' using errcode = 'P0002';
  end if;
  if v_row.entity_kind is distinct from 'legal_entity'
     or v_row.relation_type is distinct from 'owner'
     or v_row.deregistered_at is not null
  then
    raise exception 'admin_update_legal_entity_representative: active legal_entity owner required'
      using errcode = 'P0001';
  end if;

  -- Close previous open representative rows (history preserved)
  update public.legal_entity_representatives as x
     set valid_until = current_date
   where x.registry_people_id = p_registry_people_id
     and x.valid_until is null;

  insert into public.legal_entity_representatives (
    property_id, registry_people_id, representative_name, representative_email,
    document_type, document_number, document_date, supporting_document_path,
    valid_from, created_by_email, note
  ) values (
    v_row.property_id, p_registry_people_id, v_name, v_email,
    nullif(btrim(coalesce(p_document_type, '')), ''),
    nullif(btrim(coalesce(p_document_number, '')), ''),
    p_document_date,
    nullif(btrim(coalesce(p_supporting_document_path, '')), ''),
    current_date, v_actor, nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  -- Access: portal email for legal entity points at representative (ownership unchanged)
  perform public.property_book_set_mutating(true);
  update public.property_registry_people as r
     set email = v_email,
         updated_at = now()
   where r.id = p_registry_people_id;
  perform public.property_book_sync_portal_owner_fields(v_row.property_id);
  perform public.property_book_set_mutating(false);

  perform public.log_property_change(
    v_row.property_id, 'book_ui', 'owner', 'update',
    jsonb_build_object(
      'representative_change', true,
      'registry_people_id', p_registry_people_id,
      'representative_email', v_email,
      'ownership_unchanged', true
    ),
    'legal_entity_representative_updated'
  );

  perform public.ownership_change_notify(
    null, v_row.property_id, 'representative_changed',
    array[v_email],
    jsonb_build_object('representative_id', v_id)
  );

  return jsonb_build_object(
    'ok', true,
    'representative_id', v_id,
    'ownership_unchanged', true,
    'registry_people_id', p_registry_people_id
  );
exception
  when others then
    perform public.property_book_set_mutating(false);
    raise;
end;
$fn$;

revoke all on function public.admin_update_legal_entity_representative(
  bigint, text, text, text, text, date, text, text
) from public, anon;
grant execute on function public.admin_update_legal_entity_representative(
  bigint, text, text, text, text, date, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Administrative correction (XFER.16) — not a fictitious transfer
-- ---------------------------------------------------------------------------

create or replace function public.admin_record_ownership_correction(
  p_property_id bigint,
  p_after_owners jsonb,
  p_reason text,
  p_evidence_document_path text default null,
  p_evidence_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before jsonb;
  v_book jsonb;
  v_id bigint;
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_n integer;
begin
  perform public.admin_assert_book_admin();
  if v_reason is null then
    raise exception 'admin_record_ownership_correction: reason required'
      using errcode = '22023';
  end if;

  perform public.ownership_change_validate_owners(p_property_id, p_after_owners);
  v_before := public.ownership_change_book_owners_json(p_property_id);

  v_n := jsonb_array_length(p_after_owners);
  update public.properties as p
     set ownership_type = case when v_n > 1 then 'shared' else 'sole' end
   where p.id = p_property_id;

  v_book := public.admin_replace_property_book_owners(p_property_id, p_after_owners);

  insert into public.ownership_admin_corrections (
    property_id, reason, evidence_document_path, evidence_note,
    before_owners, after_owners, created_by_email, book_result
  ) values (
    p_property_id, v_reason,
    nullif(btrim(coalesce(p_evidence_document_path, '')), ''),
    nullif(btrim(coalesce(p_evidence_note, '')), ''),
    v_before, p_after_owners, v_email, v_book
  )
  returning id into v_id;

  perform public.log_property_change(
    p_property_id, 'book_ui', 'book', 'replace_owners',
    jsonb_build_object(
      'correction_id', v_id,
      'reason', v_reason,
      'before', v_before,
      'after', p_after_owners
    ),
    'ownership_admin_correction'
  );

  perform public.ownership_change_notify(
    null, p_property_id, 'correction_recorded',
    public.ownership_change_affected_emails(p_property_id, v_before, p_after_owners),
    jsonb_build_object('correction_id', v_id, 'reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'correction_id', v_id, 'book', v_book);
end;
$fn$;

revoke all on function public.admin_record_ownership_correction(
  bigint, jsonb, text, text, text
) from public, anon;
grant execute on function public.admin_record_ownership_correction(
  bigint, jsonb, text, text, text
) to authenticated;

-- Linked correction of an approved change = new audited operation (XFER.21)
create or replace function public.admin_submit_linked_ownership_correction(
  p_approved_transfer_id bigint,
  p_target_owners jsonb,
  p_document_type text,
  p_document_number text,
  p_document_date date,
  p_supporting_document_path text,
  p_legal_effective_date date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
begin
  perform public.admin_assert_book_admin();

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_approved_transfer_id;

  if not found or v_tr.status is distinct from 'утверждена' then
    raise exception 'admin_submit_linked_ownership_correction: approved transfer required'
      using errcode = 'P0001';
  end if;

  return public.submit_ownership_change(
    v_tr.property_id,
    p_target_owners,
    'correction_link',
    p_document_type,
    p_document_number,
    p_document_date,
    p_supporting_document_path,
    null,
    p_legal_effective_date,
    p_note,
    null,
    p_approved_transfer_id,
    true,
    'correction'
  );
end;
$fn$;

revoke all on function public.admin_submit_linked_ownership_correction(
  bigint, jsonb, text, text, date, text, date, text
) from public, anon;
grant execute on function public.admin_submit_linked_ownership_correction(
  bigint, jsonb, text, text, date, text, date, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Pending counter (XFER.22)
-- ---------------------------------------------------------------------------

create or replace function public.admin_pending_ownership_change_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.has_staff_role('администрация') then (
      select count(*)::integer
      from public.owner_transfers as t
      where t.status = 'ожидает'
    )
    else 0
  end;
$$;

revoke all on function public.admin_pending_ownership_change_count() from public, anon;
grant execute on function public.admin_pending_ownership_change_count() to authenticated;

-- ---------------------------------------------------------------------------
-- Voting eligibility: exclude deceased / pending inheritance from owns? 
-- Access may remain for pending_inheritance co-owners still listed;
-- deceased_recorded loses portal ownership access (XFER.12).
-- ---------------------------------------------------------------------------

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
    and r.admin_status is distinct from 'deceased_recorded'
    and lower(btrim(coalesce(r.email, ''))) = v_email
  order by r.id
  limit 1;
  return v_row;
end;
$fn$;

revoke all on function public.property_book_active_owner_by_email(bigint, text) from public, anon;

-- Quorum roster hash still includes deceased_recorded ideal parts (XFER.12)
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
      lower(coalesce(r.email, '')) || ':' ||
      coalesce(r.admin_status, 'active') as k
    from public.properties as p
    left join public.property_registry_people as r
      on r.property_id = p.id
     and r.relation_type = 'owner'
     and r.deregistered_at is null
    where p.archived_at is null
  ) as x;
$$;

revoke all on function public.gm_book_roster_hash() from public, anon;

create or replace function public.property_book_voting_eligible_owner(p_registry_people_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_registry_people as r
    where r.id = p_registry_people_id
      and r.relation_type = 'owner'
      and r.deregistered_at is null
      and r.voting_eligible is true
      and r.admin_status = 'active'
  );
$$;

revoke all on function public.property_book_voting_eligible_owner(bigint) from public, anon;
grant execute on function public.property_book_voting_eligible_owner(bigint) to authenticated;

commit;
