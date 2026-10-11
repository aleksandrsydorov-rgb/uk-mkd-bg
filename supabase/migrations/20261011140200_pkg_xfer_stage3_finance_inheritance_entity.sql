-- PKG-XFER Stage 3 — Finance overdue debt, inheritance, voting eligibility,
-- Guest Mode temporary access, legal-entity representatives, Tariff Core note.
-- Forward-only. Depends on 20261011140000. Enforcement switch stays OFF by default.

begin;

-- ---------------------------------------------------------------------------
-- Inherited liability determinations (manual; never auto from shares)
-- ---------------------------------------------------------------------------

alter table public.ownership_inherited_liabilities
  add column if not exists obligation_ref text null;

alter table public.ownership_inherited_liabilities
  add column if not exists accepted_status text not null default 'recorded';

alter table public.ownership_inherited_liabilities
  add column if not exists inventory_limited boolean not null default false;

alter table public.ownership_inherited_liabilities
  add column if not exists decision_document_ref text null;

alter table public.ownership_inherited_liabilities
  add column if not exists confirmed_at timestamptz null;

alter table public.ownership_inherited_liabilities
  add column if not exists confirmed_by_email text null;

alter table public.ownership_inherited_liabilities
  drop constraint if exists ownership_inherited_liabilities_status_chk;

alter table public.ownership_inherited_liabilities
  add constraint ownership_inherited_liabilities_status_chk
  check (accepted_status in (
    'recorded', 'accepted', 'inventory_limited', 'rejected', 'withdrawn'
  ));

comment on table public.ownership_inherited_liabilities is
  'XFER.11 Stage 3: auditable inheritance-liability determinations. Does not recreate Finance charges.';

-- Death / pending-inheritance documentary fields on Book owner row
alter table public.property_registry_people
  add column if not exists death_document_type text null;

alter table public.property_registry_people
  add column if not exists death_document_number text null;

alter table public.property_registry_people
  add column if not exists death_document_date date null;

alter table public.property_registry_people
  add column if not exists death_document_path text null;

-- ---------------------------------------------------------------------------
-- Finance Core overdue (support fee assessments + capital repair past due)
-- ---------------------------------------------------------------------------

create or replace function public.ownership_change_overdue_debt(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sf_overdue numeric := 0;
  v_sf_future numeric := 0;
  v_cap_overdue numeric := 0;
  v_cap_future numeric := 0;
  v_prop_debt numeric := 0;
  v_gate boolean := false;
  v_overdue numeric := 0;
  v_future numeric := 0;
begin
  -- Support Fee Core: remaining_due already reflects payments/credits/adjustments
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
  into v_sf_overdue, v_sf_future
  from public.support_fee_assessments as a
  where a.property_id = p_property_id
    and a.status is distinct from 'void'
    and a.status is distinct from 'corrected';

  -- Capital repair: net remaining per assessment, classified by due_date
  select
    coalesce(sum(case
      when n.net > 0 and n.due_date is not null and n.due_date < current_date
      then n.net else 0 end), 0),
    coalesce(sum(case
      when n.net > 0 and (n.due_date is null or n.due_date >= current_date)
      then n.net else 0 end), 0)
  into v_cap_overdue, v_cap_future
  from (
    select
      a.due_date,
      coalesce(sum(
        case when l.kind = 'charge' then l.amount_eur else -l.amount_eur end
      ), 0) as net
    from public.capital_repair_ledger as l
    join public.capital_repair_assessments as a on a.id = l.assessment_id
    where l.property_id = p_property_id
      and coalesce(a.status, 'open') is distinct from 'cancelled'
      and coalesce(a.status, 'open') is distinct from 'void'
    group by a.id, a.due_date
  ) as n;

  v_overdue := v_sf_overdue + v_cap_overdue;
  v_future := v_sf_future + v_cap_future;

  select coalesce(p.debt, 0) into v_prop_debt
  from public.properties as p
  where p.id = p_property_id;

  select s.ordinary_debt_gate_enabled into v_gate
  from public.ownership_change_settings as s
  where s.id = 1;

  return jsonb_build_object(
    'overdue_unpaid_eur', v_overdue,
    'future_due_eur', v_future,
    'support_fee_overdue_eur', v_sf_overdue,
    'support_fee_future_eur', v_sf_future,
    'capital_repair_overdue_eur', v_cap_overdue,
    'capital_repair_future_eur', v_cap_future,
    'portal_debt_eur', v_prop_debt,
    'blocks_ordinary', v_overdue > 0,
    'ordinary_debt_gate_enabled', coalesce(v_gate, false),
    'reason', case
      when v_overdue > 0 then 'overdue_unpaid_obligations'
      else null
    end
  );
end;
$fn$;

revoke all on function public.ownership_change_overdue_debt(bigint) from public, anon;
grant execute on function public.ownership_change_overdue_debt(bigint) to authenticated;

create or replace function public.admin_get_ownership_debt_status(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.admin_assert_book_admin();
  return public.ownership_change_overdue_debt(p_property_id);
end;
$fn$;

revoke all on function public.admin_get_ownership_debt_status(bigint) from public, anon;
grant execute on function public.admin_get_ownership_debt_status(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Approve: recheck debt; inheritance & legal corrections never blocked by debt
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
  v_subject_before text;
  v_subject_after text;
  v_skip_debt boolean := false;
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

  v_current_hash := public.ownership_change_roster_hash(v_tr.property_id);
  if v_tr.baseline_roster_hash is not null
     and v_tr.baseline_roster_hash is distinct from v_current_hash
  then
    raise exception 'admin_approve_owner_transfer: stale Book baseline — reject and resubmit'
      using errcode = 'P0001';
  end if;

  v_targets := coalesce(p_target_owners, v_tr.target_owners);
  if v_targets is null or jsonb_typeof(v_targets) <> 'array' then
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

  if v_doc_type is null or v_doc_num is null or v_doc_date is null or v_sup_path is null then
    raise exception 'admin_approve_owner_transfer: document type, number, date and supporting document required'
      using errcode = '22023';
  end if;

  select s.ordinary_debt_gate_enabled into v_gate
  from public.ownership_change_settings as s
  where s.id = 1;

  -- Recheck immediately before approval (Finance Core)
  v_debt := public.ownership_change_overdue_debt(v_tr.property_id);

  -- Inheritance + administrative/legal corrections never debt-blocked (legal safety)
  v_skip_debt := v_tr.change_kind in ('inheritance', 'correction_link')
    or coalesce(v_tr.change_reason, '') in ('inheritance', 'correction');

  if not v_skip_debt
     and v_tr.change_kind in ('ordinary', 'admin_initiated', 'entity_person')
     and coalesce(v_gate, false)
     and (v_debt ->> 'blocks_ordinary')::boolean
  then
    raise exception 'admin_approve_owner_transfer: overdue unpaid obligations block ordinary approval (eur=%)',
      v_debt ->> 'overdue_unpaid_eur'
      using errcode = 'P0001';
  end if;

  v_subject_before := public.property_tariff_subject_kind(v_tr.property_id);

  v_share_n := jsonb_array_length(v_targets);
  v_own_type := case when v_share_n > 1 then 'shared' else 'sole' end;

  update public.properties as p
     set ownership_type = v_own_type
   where p.id = v_tr.property_id;

  v_book := public.admin_replace_property_book_owners(v_tr.property_id, v_targets);

  update public.properties as p
     set owner_phone = coalesce(v_tr.to_owner_phone, p.owner_phone)
   where p.id = v_tr.property_id;

  -- Clear pending-inheritance flags for replaced deceased rows (historical deregistered kept)
  -- New owners start active/voting_eligible by default via insert defaults.

  if p_record_inherited_liabilities is not null
     and jsonb_typeof(p_record_inherited_liabilities) = 'array'
  then
    for v_liab in select value from jsonb_array_elements(p_record_inherited_liabilities) as t(value)
    loop
      insert into public.ownership_inherited_liabilities (
        property_id, transfer_id, heir_email, heir_name, amount_eur,
        basis_document_type, basis_document_number, basis_document_date,
        note, created_by_email,
        obligation_ref, accepted_status, inventory_limited, decision_document_ref
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
        v_email,
        nullif(btrim(coalesce(v_liab ->> 'obligation_ref', '')), ''),
        coalesce(nullif(btrim(coalesce(v_liab ->> 'accepted_status', '')), ''), 'recorded'),
        coalesce((v_liab ->> 'inventory_limited')::boolean, false),
        nullif(btrim(coalesce(v_liab ->> 'decision_document_ref', '')), '')
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
         debt_gate_applied = coalesce(v_gate, false) and not v_skip_debt
   where t.id = p_transfer_id;

  delete from public.property_book_transfer_approve_gate as g
   where g.transfer_id = p_transfer_id;

  v_subject_after := public.property_tariff_subject_kind(v_tr.property_id);

  perform public.log_property_change(
    v_tr.property_id,
    'book_ui',
    'book',
    'replace_owners',
    jsonb_build_object(
      'transfer_id', p_transfer_id,
      'change_kind', v_tr.change_kind,
      'change_reason', v_tr.change_reason,
      'legal_effective_date', v_legal_date,
      'system_approval_at', now(),
      'debt_check', v_debt,
      'tariff_subject_before', v_subject_before,
      'tariff_subject_after', v_subject_after,
      'tariff_prospective_only', true,
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
      'decided_at', now(),
      'debt_check', v_debt
    )
  );

  perform public.property_book_set_mutating(false);

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'property_id', v_tr.property_id,
    'legal_effective_date', v_legal_date,
    'debt_check', v_debt,
    'debt_gate_applied', coalesce(v_gate, false) and not v_skip_debt,
    'tariff_subject_before', v_subject_before,
    'tariff_subject_after', v_subject_after,
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

revoke all on function public.admin_approve_owner_transfer(
  bigint, jsonb, text, text, date, text, date, jsonb
) from public, anon;
grant execute on function public.admin_approve_owner_transfer(
  bigint, jsonb, text, text, date, text, date, jsonb
) to authenticated;

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

-- ---------------------------------------------------------------------------
-- Record / confirm inherited liability (does not rewrite Finance ledgers)
-- ---------------------------------------------------------------------------

create or replace function public.admin_record_inherited_liability(
  p_property_id bigint,
  p_heir_email text,
  p_heir_name text,
  p_amount_eur numeric,
  p_basis_document_type text,
  p_basis_document_number text,
  p_basis_document_date date,
  p_obligation_ref text default null,
  p_accepted_status text default 'recorded',
  p_inventory_limited boolean default false,
  p_decision_document_ref text default null,
  p_transfer_id bigint default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_status text := coalesce(nullif(btrim(coalesce(p_accepted_status, '')), ''), 'recorded');
  v_id bigint;
begin
  perform public.admin_assert_book_admin();
  if p_amount_eur is null or p_amount_eur < 0 then
    raise exception 'admin_record_inherited_liability: amount required'
      using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_basis_document_type, '')), '') is null
     or nullif(btrim(coalesce(p_basis_document_number, '')), '') is null
     or p_basis_document_date is null
  then
    raise exception 'admin_record_inherited_liability: basis document required'
      using errcode = '22023';
  end if;
  if v_status not in (
    'recorded', 'accepted', 'inventory_limited', 'rejected', 'withdrawn'
  ) then
    raise exception 'admin_record_inherited_liability: invalid status'
      using errcode = '22023';
  end if;

  insert into public.ownership_inherited_liabilities (
    property_id, transfer_id, heir_email, heir_name, amount_eur,
    basis_document_type, basis_document_number, basis_document_date,
    note, created_by_email,
    obligation_ref, accepted_status, inventory_limited, decision_document_ref
  ) values (
    p_property_id,
    p_transfer_id,
    lower(nullif(btrim(coalesce(p_heir_email, '')), '')),
    nullif(btrim(coalesce(p_heir_name, '')), ''),
    p_amount_eur,
    btrim(p_basis_document_type),
    btrim(p_basis_document_number),
    p_basis_document_date,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_email,
    nullif(btrim(coalesce(p_obligation_ref, '')), ''),
    v_status,
    coalesce(p_inventory_limited, false),
    nullif(btrim(coalesce(p_decision_document_ref, '')), '')
  )
  returning id into v_id;

  perform public.log_property_change(
    p_property_id, 'book_ui', 'owner', 'update',
    jsonb_build_object(
      'inherited_liability_id', v_id,
      'finance_ledger_unchanged', true,
      'no_auto_share_allocation', true
    ),
    'inherited_liability_recorded'
  );

  return jsonb_build_object('ok', true, 'liability_id', v_id, 'status', v_status);
end;
$fn$;

revoke all on function public.admin_record_inherited_liability(
  bigint, text, text, numeric, text, text, date, text, text, boolean, text, bigint, text
) from public, anon;
grant execute on function public.admin_record_inherited_liability(
  bigint, text, text, numeric, text, text, date, text, text, boolean, text, bigint, text
) to authenticated;

create or replace function public.admin_confirm_inherited_liability(
  p_liability_id bigint,
  p_accepted_status text,
  p_confirmed_amount_eur numeric default null,
  p_decision_document_ref text default null,
  p_inventory_limited boolean default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.ownership_inherited_liabilities%rowtype;
  v_status text := nullif(btrim(coalesce(p_accepted_status, '')), '');
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  perform public.admin_assert_book_admin();
  if v_status is null or v_status not in (
    'recorded', 'accepted', 'inventory_limited', 'rejected', 'withdrawn'
  ) then
    raise exception 'admin_confirm_inherited_liability: invalid status'
      using errcode = '22023';
  end if;

  select l.* into v_row
  from public.ownership_inherited_liabilities as l
  where l.id = p_liability_id
  for update;
  if not found then
    raise exception 'admin_confirm_inherited_liability: not found' using errcode = 'P0002';
  end if;

  update public.ownership_inherited_liabilities as l
     set accepted_status = v_status,
         amount_eur = coalesce(p_confirmed_amount_eur, l.amount_eur),
         decision_document_ref = coalesce(
           nullif(btrim(coalesce(p_decision_document_ref, '')), ''),
           l.decision_document_ref
         ),
         inventory_limited = coalesce(p_inventory_limited, l.inventory_limited),
         note = case when p_note is null then l.note else nullif(btrim(p_note), '') end,
         confirmed_at = now(),
         confirmed_by_email = v_email
   where l.id = p_liability_id;

  perform public.log_property_change(
    v_row.property_id, 'book_ui', 'owner', 'update',
    jsonb_build_object(
      'inherited_liability_id', p_liability_id,
      'accepted_status', v_status,
      'finance_ledger_unchanged', true
    ),
    'inherited_liability_confirmed'
  );

  return jsonb_build_object('ok', true, 'liability_id', p_liability_id, 'status', v_status);
end;
$fn$;

revoke all on function public.admin_confirm_inherited_liability(
  bigint, text, numeric, text, boolean, text
) from public, anon;
grant execute on function public.admin_confirm_inherited_liability(
  bigint, text, numeric, text, boolean, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Pending inheritance (enhanced documentary evidence)
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_inheritance_pending(
  p_registry_people_id bigint,
  p_mark_deceased boolean default false,
  p_note text default null,
  p_death_document_type text default null,
  p_death_document_number text default null,
  p_death_document_date date default null,
  p_death_document_path text default null
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

  if p_mark_deceased
     and (
       nullif(btrim(coalesce(p_death_document_type, '')), '') is null
       or nullif(btrim(coalesce(p_death_document_number, '')), '') is null
       or p_death_document_date is null
       or nullif(btrim(coalesce(p_death_document_path, '')), '') is null
     )
  then
    raise exception 'admin_set_inheritance_pending: death document type, number, date and path required'
      using errcode = '22023';
  end if;

  v_status := case when p_mark_deceased then 'deceased_recorded' else 'pending_inheritance' end;

  -- Keep row registered (not deregistered) so ideal parts remain in quorum denominators.
  update public.property_registry_people as r
     set admin_status = v_status,
         voting_eligible = false,
         death_document_type = coalesce(
           nullif(btrim(coalesce(p_death_document_type, '')), ''), r.death_document_type
         ),
         death_document_number = coalesce(
           nullif(btrim(coalesce(p_death_document_number, '')), ''), r.death_document_number
         ),
         death_document_date = coalesce(p_death_document_date, r.death_document_date),
         death_document_path = coalesce(
           nullif(btrim(coalesce(p_death_document_path, '')), ''), r.death_document_path
         ),
         note = case
           when p_note is null then r.note
           else nullif(btrim(p_note), '')
         end,
         updated_at = now()
   where r.id = p_registry_people_id;

  -- Expire pending invites for this email (access revocation for deceased)
  if v_status = 'deceased_recorded' and nullif(btrim(coalesce(v_row.email, '')), '') is not null then
    update public.property_access_invites as i
       set status = 'expired'
     where i.property_id = v_row.property_id
       and i.status = 'pending'
       and lower(btrim(i.email)) = lower(btrim(v_row.email));
  end if;

  perform public.log_property_change(
    v_row.property_id, 'book_ui', 'owner', 'update',
    jsonb_build_object(
      'registry_people_id', p_registry_people_id,
      'admin_status', v_status,
      'voting_eligible', false,
      'heirs_not_auto_created', true
    ),
    'inheritance_pending_set'
  );

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
revoke all on function public.admin_set_inheritance_pending(
  bigint, boolean, text, text, text, date, text
) from public, anon;
grant execute on function public.admin_set_inheritance_pending(
  bigint, boolean, text, text, text, date, text
) to authenticated;

-- Keep 3-arg wrapper
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
begin
  return public.admin_set_inheritance_pending(
    p_registry_people_id, p_mark_deceased, p_note, null, null, null, null
  );
end;
$fn$;

revoke all on function public.admin_set_inheritance_pending(bigint, boolean, text)
  from public, anon;
grant execute on function public.admin_set_inheritance_pending(bigint, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Voting parties / vote cast: exclude non-eligible (quorum Book hash unchanged)
-- ---------------------------------------------------------------------------

create or replace function public.property_voting_parties(p_property_id bigint)
returns table (
  registry_people_id bigint,
  property_id bigint,
  ideal_parts_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    r.id::bigint,
    r.property_id::bigint,
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::numeric
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
    and coalesce(r.voting_eligible, true) is true
    and coalesce(r.admin_status, 'active') = 'active'
    and coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0) > 0
  union all
  select
    null::bigint,
    p.id::bigint,
    coalesce(p.ideal_parts_percent, 0)::numeric
  from public.properties as p
  where p.id = p_property_id
    and coalesce(p.ideal_parts_percent, 0) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
    );
$fn$;

revoke all on function public.property_voting_parties(bigint) from public, anon;
grant execute on function public.property_voting_parties(bigint) to authenticated;

-- Patch gm_write_vote (7-arg) with eligibility guard (based on 20260929210000)
create or replace function public.gm_write_vote(
  p_meeting_id uuid,
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text,
  p_source text,
  p_method text,
  p_registry_people_id bigint
)
returns public.general_meeting_votes
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_meeting public.general_meetings;
  v_item public.general_meeting_agenda_items;
  v_part public.general_meeting_participants;
  v_decision uuid;
  v_row public.general_meeting_votes;
  v_party_id bigint := p_registry_people_id;
  v_ideal numeric;
  v_live boolean := false;
  v_online_early boolean := false;
  v_dec_n integer;
begin
  if p_vote not in ('for', 'against', 'abstain') then
    raise exception 'gm_write_vote: invalid vote' using errcode = '22023';
  end if;

  select m.* into v_meeting from public.general_meetings as m where m.id = p_meeting_id;
  if not found then
    raise exception 'gm_write_vote: meeting not found' using errcode = 'P0002';
  end if;
  if v_meeting.status in ('held', 'cancelled', 'rescheduled', 'draft', 'archived', 'minutes_ready') then
    raise exception 'gm_write_vote: meeting closed' using errcode = '42501';
  end if;

  select a.* into v_item from public.general_meeting_agenda_items as a
  where a.id = p_agenda_item_id and a.meeting_id = p_meeting_id;
  if not found then
    raise exception 'gm_write_vote: agenda not found' using errcode = 'P0002';
  end if;

  select p.* into v_part from public.general_meeting_participants as p
  where p.meeting_id = p_meeting_id and p.property_id = p_property_id;
  if not found or v_part.attendance_status is distinct from 'confirmed' or v_part.left_at is not null then
    raise exception 'gm_write_vote: property not confirmed present' using errcode = '42501';
  end if;

  v_live := v_meeting.operational_phase = 'in_progress'
    and v_meeting.meeting_started_at is not null
    and v_item.voting_status = 'open';

  v_online_early := v_part.attendance_mode = 'online'
    and v_meeting.status = 'published'
    and v_item.voting_status in ('pending', 'open');

  if not v_live and not v_online_early then
    raise exception 'gm_write_vote: voting not available' using errcode = '42501';
  end if;

  if v_party_id is null then
    select op.registry_people_id, op.ideal_parts_percent
      into v_party_id, v_ideal
    from public.property_voting_parties(p_property_id) as op
    order by op.registry_people_id nulls last
    limit 1;
  else
    select op.ideal_parts_percent into v_ideal
    from public.property_voting_parties(p_property_id) as op
    where op.registry_people_id is not distinct from v_party_id;
  end if;

  -- Stage 3: deceased / pending inheritance cannot cast (authorization, not roster UI)
  if v_party_id is not null
     and not public.property_book_voting_eligible_owner(v_party_id)
  then
    raise exception 'gm_write_vote: owner not voting-eligible (pending inheritance / deceased)'
      using errcode = '42501';
  end if;

  if v_ideal is null then
    v_ideal := v_part.ideal_parts_percent_snapshot;
  end if;
  if v_ideal is null then
    raise exception 'gm_write_vote: missing ideal parts' using errcode = '22023';
  end if;

  select d.id into v_decision from public.general_meeting_decisions as d
  where d.agenda_item_id = p_agenda_item_id;
  if v_decision is null then
    select coalesce(max(nullif(regexp_replace(d.decision_number, '\D', '', 'g'), '')::int), 0) + 1
      into v_dec_n
    from public.general_meeting_decisions as d
    where d.meeting_id = p_meeting_id;
    insert into public.general_meeting_decisions (
      meeting_id, agenda_item_id, decision_number, title, decision_text, protocol_result
    ) values (
      p_meeting_id,
      p_agenda_item_id,
      coalesce(v_dec_n::text, v_item.position::text),
      v_item.title,
      coalesce(v_item.proposed_decision_text, v_item.title),
      'information'
    )
    returning id into v_decision;
  end if;

  if v_party_id is not null then
    select v.* into v_row
    from public.general_meeting_votes as v
    where v.decision_id = v_decision and v.registry_people_id = v_party_id;
  else
    select v.* into v_row
    from public.general_meeting_votes as v
    where v.decision_id = v_decision
      and v.property_id = p_property_id
      and v.registry_people_id is null;
  end if;

  if found then
    raise exception 'gm_write_vote: vote already cast' using errcode = '42501';
  end if;

  insert into public.general_meeting_votes (
    meeting_id, decision_id, property_id, registry_people_id, participant_id, vote,
    ideal_parts_percent_snapshot, vote_method, vote_source, recorded_by_email
  ) values (
    p_meeting_id, v_decision, p_property_id, v_party_id, v_part.id, p_vote,
    v_ideal, p_method, p_source, auth.email()
  )
  returning * into v_row;

  insert into public.general_meeting_vote_events (
    vote_id, meeting_id, decision_id, property_id, vote, vote_source, recorded_by_email
  ) values (
    v_row.id, p_meeting_id, v_decision, p_property_id, p_vote, p_source, auth.email()
  );

  return v_row;
end;
$fn$;

drop function if exists public.gm_write_vote(uuid, uuid, bigint, text, text, text);

create function public.gm_write_vote(
  p_meeting_id uuid,
  p_agenda_item_id uuid,
  p_property_id bigint,
  p_vote text,
  p_source text,
  p_method text
)
returns public.general_meeting_votes
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.gm_write_vote(
    p_meeting_id, p_agenda_item_id, p_property_id, p_vote, p_source, p_method, null::bigint
  );
end;
$fn$;

revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text) from public, anon;
revoke all on function public.gm_write_vote(uuid, uuid, bigint, text, text, text, bigint)
  from public, anon;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text)
  from anon, authenticated;
revoke execute on function public.gm_write_vote(uuid, uuid, bigint, text, text, text, bigint)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guest Mode: inheritance-pending temporary occupant (reuse property_guest_accesses)
-- ---------------------------------------------------------------------------

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

  perform public.log_property_change(
    p_property_id, 'book_ui', 'owner', 'update',
    jsonb_build_object(
      'guest_access_id', v_row.id,
      'email', v_email,
      'inheritance_temporary', true,
      'note', nullif(btrim(coalesce(p_note, '')), ''),
      'no_ownership_no_voting', true
    ),
    'inheritance_guest_granted'
  );

  return v_row;
end;
$fn$;

revoke all on function public.admin_grant_inheritance_guest_access(bigint, text, timestamptz, text)
  from public, anon;
grant execute on function public.admin_grant_inheritance_guest_access(bigint, text, timestamptz, text)
  to authenticated;

-- Settings read for admin UI (debt gate flag visibility)
create or replace function public.admin_get_ownership_change_settings()
returns public.ownership_change_settings
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.ownership_change_settings%rowtype;
begin
  perform public.admin_assert_book_admin();
  select s.* into v_row from public.ownership_change_settings as s where s.id = 1;
  return v_row;
end;
$fn$;

revoke all on function public.admin_get_ownership_change_settings() from public, anon;
grant execute on function public.admin_get_ownership_change_settings() to authenticated;

-- owner_voting_parties: exclude non-eligible (same cast rules as property_voting_parties)
create or replace function public.owner_voting_parties(p_email text default null)
returns table (
  registry_people_id bigint,
  property_id bigint,
  ideal_parts_percent numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, auth.email(), '')));
begin
  if v_email = '' then
    return;
  end if;

  return query
  select
    r.id::bigint,
    r.property_id::bigint,
    coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0)::numeric
  from public.property_registry_people as r
  join public.properties as p on p.id = r.property_id
  where r.relation_type = 'owner'
    and r.deregistered_at is null
    and coalesce(r.voting_eligible, true) is true
    and coalesce(r.admin_status, 'active') = 'active'
    and lower(btrim(coalesce(r.email, ''))) = v_email
    and coalesce(r.ideal_parts_percent, p.ideal_parts_percent, 0) > 0;

  return query
  select
    null::bigint,
    p.id::bigint,
    coalesce(p.ideal_parts_percent, 0)::numeric
  from public.properties as p
  where lower(btrim(coalesce(p.owner_email, ''))) = v_email
    and coalesce(p.ideal_parts_percent, 0) > 0
    and not exists (
      select 1
      from public.property_registry_people as r
      where r.property_id = p.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null
        and lower(btrim(coalesce(r.email, ''))) = v_email
    );
end;
$fn$;

revoke all on function public.owner_voting_parties(text) from public, anon;
grant execute on function public.owner_voting_parties(text) to authenticated;

-- Admin revoke of inheritance temporary guest (reuse property_guest_accesses)
create or replace function public.admin_revoke_inheritance_guest_access(p_access_id uuid)
returns public.property_guest_accesses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.property_guest_accesses%rowtype;
begin
  perform public.admin_assert_book_admin();
  update public.property_guest_accesses as g
     set status = 'revoked'
   where g.id = p_access_id
     and g.status in ('pending', 'active')
  returning * into v_row;
  if not found then
    raise exception 'admin_revoke_inheritance_guest_access: not found or not active'
      using errcode = 'P0002';
  end if;

  perform public.log_property_change(
    v_row.property_id, 'book_ui', 'owner', 'update',
    jsonb_build_object('guest_access_id', p_access_id, 'revoked', true),
    'inheritance_guest_revoked'
  );

  return v_row;
end;
$fn$;

revoke all on function public.admin_revoke_inheritance_guest_access(uuid) from public, anon;
grant execute on function public.admin_revoke_inheritance_guest_access(uuid) to authenticated;

-- Legal entity representative: require supporting docs; revoke former portal invites
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
  v_doc_type text := nullif(btrim(coalesce(p_document_type, '')), '');
  v_doc_num text := nullif(btrim(coalesce(p_document_number, '')), '');
  v_sup text := nullif(btrim(coalesce(p_supporting_document_path, '')), '');
  v_prev_email text;
  v_id bigint;
  v_actor text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
begin
  perform public.admin_assert_book_admin();
  if v_name is null or v_email is null then
    raise exception 'admin_update_legal_entity_representative: name and email required'
      using errcode = '22023';
  end if;
  if v_doc_type is null or v_doc_num is null or p_document_date is null or v_sup is null then
    raise exception 'admin_update_legal_entity_representative: supporting documents required'
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

  v_prev_email := lower(nullif(btrim(coalesce(v_row.email, '')), ''));

  -- Close previous open representative rows (immutable history)
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
    v_doc_type, v_doc_num, p_document_date, v_sup,
    current_date, v_actor, nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  -- Revoke former representative pending invites (ownership entity unchanged)
  if v_prev_email is not null and v_prev_email is distinct from v_email then
    update public.property_access_invites as i
       set status = 'expired'
     where i.property_id = v_row.property_id
       and i.status = 'pending'
       and lower(btrim(i.email)) = v_prev_email;
  end if;

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
      'previous_representative_email', v_prev_email,
      'representative_email', v_email,
      'ownership_unchanged', true,
      'legal_entity_100_pct_preserved', true
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
    'registry_people_id', p_registry_people_id,
    'previous_representative_email', v_prev_email
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

commit;
