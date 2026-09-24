-- AMADEUS 11 SH-2B: high-access hardening.
-- Exact active roles: администрация, бухгалтер, инженер, уборщик.
-- Request-photos stays unchanged; the SH-2 audit classified it MEDIUM.

begin;

-- ---------------------------------------------------------------------------
-- Properties
-- Full rows: administration and the owning resident.
-- Accountant and engineer receive an explicit directory without contact fields.
-- ---------------------------------------------------------------------------

drop policy if exists properties_owner_staff_select on public.properties;
create policy properties_admin_owner_select
on public.properties
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(id)
);

create or replace function public.enforce_properties_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if TG_OP = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      if not public.has_staff_role('администрация') then
        raise exception 'properties: creation requires administration'
          using errcode = '42501';
      end if;

      if coalesce(NEW.debt, 0) <> 0
         or coalesce(NEW.overpayment, 0) <> 0 then
        raise exception 'properties: initial debt and overpayment must be zero'
          using errcode = '42501';
      end if;
    end if;

    return NEW;
  end if;

  if current_user in ('anon', 'authenticated') then
    if NEW.debt is distinct from OLD.debt
       or NEW.overpayment is distinct from OLD.overpayment then
      raise exception 'properties: debt and overpayment can only change via support-fee RPC'
        using errcode = '42501';
    end if;
  end if;

  if current_user in ('anon', 'authenticated') and not public.is_staff() then
    if not public.owns_property(OLD.id) then
      raise exception 'properties: owner can update only own apartments'
        using errcode = '42501';
    end if;

    if (
      to_jsonb(NEW) - array[
        'occupant_kind',
        'occupant_name',
        'occupant_phone',
        'occupant_email',
        'occupant_until',
        'occupancy_status',
        'status',
        'pet_info'
      ]
    ) is distinct from (
      to_jsonb(OLD) - array[
        'occupant_kind',
        'occupant_name',
        'occupant_phone',
        'occupant_email',
        'occupant_until',
        'occupancy_status',
        'status',
        'pet_info'
      ]
    ) then
      raise exception 'properties: owner cannot change protected columns'
        using errcode = '42501';
    end if;
  end if;

  if current_user in ('anon', 'authenticated')
     and public.is_staff()
     and not public.has_staff_role('администрация') then
    if NEW.owner_name is distinct from OLD.owner_name
       or NEW.owner_email is distinct from OLD.owner_email
       or NEW.owner_phone is distinct from OLD.owner_phone
       or NEW.owner_type is distinct from OLD.owner_type
       or NEW.company_name is distinct from OLD.company_name
       or NEW.purpose is distinct from OLD.purpose
       or NEW.ideal_parts_percent is distinct from OLD.ideal_parts_percent
       or NEW.ideal_parts_source is distinct from OLD.ideal_parts_source
       or NEW.ideal_parts_note is distinct from OLD.ideal_parts_note
       or NEW.ideal_parts_meeting_ref is distinct from OLD.ideal_parts_meeting_ref
       or NEW.owner_user_management_agreement is distinct from OLD.owner_user_management_agreement
       or NEW.occupant_kind is distinct from OLD.occupant_kind
       or NEW.occupant_name is distinct from OLD.occupant_name
       or NEW.occupant_phone is distinct from OLD.occupant_phone
       or NEW.occupant_email is distinct from OLD.occupant_email
       or NEW.occupant_until is distinct from OLD.occupant_until
       or NEW.pet_info is distinct from OLD.pet_info then
      raise exception 'properties: resident contact fields require administration'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$function$;

revoke all on function public.enforce_properties_update() from public;
revoke execute on function public.enforce_properties_update() from anon;
revoke execute on function public.enforce_properties_update() from authenticated;

create or replace function public.list_staff_property_directory()
returns setof public.properties
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_finance boolean := public.has_staff_role('администрация') or public.has_staff_role('бухгалтер');
  v_engineer boolean := public.has_staff_role('инженер');
begin
  if not (v_finance or v_engineer) then
    return;
  end if;

  return query
  select
    p.id,
    p.created_at,
    p.apartment_number,
    p.floor,
    p.area_sqm,
    p.status,
    case when v_finance then p.owner_name else null end,
    null::text,
    null::text,
    case when v_finance then p.debt else null end,
    case when v_finance then p.overpayment else null end,
    p.electricity_meter_number,
    p.occupancy_status,
    null::text,
    case when v_finance then p.owner_type else null end,
    case when v_finance then p.company_name else null end,
    null::text,
    null::text,
    null::text,
    null::text,
    null::date,
    case when v_finance then p.purpose else null end,
    case when v_finance then p.ideal_parts_percent else null::numeric(12,6) end,
    case when v_finance then p.ideal_parts_source else null end,
    case when v_finance then p.ideal_parts_note else null end,
    case when v_finance then p.ideal_parts_meeting_ref else null end,
    null::text
  from public.properties as p
  order by p.apartment_number, p.id;
end;
$function$;

revoke all on function public.list_staff_property_directory() from public;
revoke execute on function public.list_staff_property_directory() from anon;
grant execute on function public.list_staff_property_directory() to authenticated;

-- ---------------------------------------------------------------------------
-- Private communications and resident records
-- Administration manages them. Owners keep their own rows.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_requests_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'requests: update requires administration'
      using errcode = '42501';
  end if;

  if (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') then
    raise exception 'requests: only status may be updated'
      using errcode = '42501';
  end if;

  if NEW.status is distinct from 'новая'
     and NEW.status is distinct from 'в работе'
     and NEW.status is distinct from 'выполнена'
     and NEW.status is distinct from 'отклонена' then
    raise exception 'requests: invalid status'
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

revoke all on function public.enforce_requests_update() from public;
revoke execute on function public.enforce_requests_update() from anon;
revoke execute on function public.enforce_requests_update() from authenticated;

drop policy if exists requests_owner_staff_select on public.requests;
create policy requests_admin_owner_select
on public.requests
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists requests_staff_update on public.requests;
create policy requests_admin_update
on public.requests
for update
to authenticated
using (public.has_staff_role('администрация'))
with check (public.has_staff_role('администрация'));

drop policy if exists requests_staff_delete on public.requests;
create policy requests_admin_delete
on public.requests
for delete
to authenticated
using (public.has_staff_role('администрация'));

create or replace function public.enforce_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owner_ack boolean;
  staff_ack boolean;
begin
  owner_ack :=
    public.owns_property(OLD.property_id)
    and OLD.sender = 'uk'
    and NEW.read_by_owner is true
    and (to_jsonb(NEW) - 'read_by_owner') = (to_jsonb(OLD) - 'read_by_owner');

  staff_ack :=
    public.has_staff_role('администрация')
    and OLD.sender is distinct from 'uk'
    and NEW.read_by_uk is true
    and (to_jsonb(NEW) - 'read_by_uk') = (to_jsonb(OLD) - 'read_by_uk');

  if owner_ack or staff_ack then
    return NEW;
  end if;

  raise exception 'chat_messages: only read acknowledgement is allowed'
    using errcode = '42501';
end;
$function$;

revoke all on function public.enforce_chat_message_update() from public;
revoke execute on function public.enforce_chat_message_update() from anon;
revoke execute on function public.enforce_chat_message_update() from authenticated;

drop policy if exists chat_messages_owner_staff_select on public.chat_messages;
create policy chat_messages_admin_owner_select
on public.chat_messages
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists chat_messages_staff_insert on public.chat_messages;
create policy chat_messages_admin_insert
on public.chat_messages
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  and sender = 'uk'
  and coalesce(read_by_owner, false) = false
);

drop policy if exists chat_messages_owner_staff_update on public.chat_messages;
create policy chat_messages_admin_owner_update
on public.chat_messages
for update
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
)
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_guests_owner_staff_select on public.apartment_guests;
create policy apartment_guests_admin_owner_select
on public.apartment_guests
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_guests_owner_staff_insert on public.apartment_guests;
create policy apartment_guests_admin_owner_insert
on public.apartment_guests
for insert
to authenticated
with check (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists apartment_guests_owner_staff_delete on public.apartment_guests;
create policy apartment_guests_admin_owner_delete
on public.apartment_guests
for delete
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

drop policy if exists owner_transfers_owner_staff_select on public.owner_transfers;
create policy owner_transfers_admin_owner_select
on public.owner_transfers
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

-- ---------------------------------------------------------------------------
-- Announcements, polls, and individual votes
-- Questions stay readable. Management and vote rows are administration-only.
-- ---------------------------------------------------------------------------

drop policy if exists announcements_staff_insert on public.announcements;
create policy announcements_admin_insert
on public.announcements
for insert
to authenticated
with check (public.has_staff_role('администрация'));

drop policy if exists announcements_staff_delete on public.announcements;
create policy announcements_admin_delete
on public.announcements
for delete
to authenticated
using (public.has_staff_role('администрация'));

drop policy if exists polls_staff_insert on public.polls;
create policy polls_admin_insert
on public.polls
for insert
to authenticated
with check (public.has_staff_role('администрация'));

drop policy if exists polls_staff_update on public.polls;
create policy polls_admin_update
on public.polls
for update
to authenticated
using (public.has_staff_role('администрация'))
with check (public.has_staff_role('администрация'));

drop policy if exists polls_staff_delete on public.polls;
create policy polls_admin_delete
on public.polls
for delete
to authenticated
using (public.has_staff_role('администрация'));

drop policy if exists poll_options_staff_insert on public.poll_options;
create policy poll_options_admin_insert
on public.poll_options
for insert
to authenticated
with check (public.has_staff_role('администрация'));

drop policy if exists poll_votes_staff_select on public.poll_votes;
create policy poll_votes_admin_select
on public.poll_votes
for select
to authenticated
using (public.has_staff_role('администрация'));

drop policy if exists poll_vote_history_staff_select on public.poll_vote_history;
create policy poll_vote_history_admin_select
on public.poll_vote_history
for select
to authenticated
using (public.has_staff_role('администрация'));

create or replace function public.enforce_polls_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated')
     and (
       NEW.status is distinct from OLD.status
       or NEW.result is distinct from OLD.result
       or NEW.result_option_id is distinct from OLD.result_option_id
     ) then
    raise exception 'polls: status and result changes require the administration RPC'
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

revoke all on function public.enforce_polls_update() from public;
revoke execute on function public.enforce_polls_update() from anon;
revoke execute on function public.enforce_polls_update() from authenticated;

drop trigger if exists enforce_polls_update on public.polls;
create trigger enforce_polls_update
before update on public.polls
for each row
execute function public.enforce_polls_update();

create or replace function public.set_poll_lifecycle(p_poll_id bigint, p_close boolean)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $function$
declare
  poll_rec public.polls%rowtype;
  v_total numeric;
  v_winner_id bigint;
  v_winner_weight numeric;
  v_accepted boolean;
begin
  if not public.has_staff_role('администрация') then
    raise exception 'set_poll_lifecycle: administration required'
      using errcode = '42501';
  end if;

  select *
    into poll_rec
  from public.polls
  where id = p_poll_id
  for update;

  if not found then
    raise exception 'set_poll_lifecycle: poll not found'
      using errcode = '42501';
  end if;

  if p_close is not true then
    update public.polls
       set status = 'открыт',
           result = 'идёт',
           result_option_id = null
     where id = p_poll_id
     returning * into poll_rec;
    return poll_rec;
  end if;

  v_total := public.poll_building_total_weight();

  select o.id, coalesce(sum(
    case
      when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
      else 0
    end
  ), 0)
    into v_winner_id, v_winner_weight
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id
   and v.poll_id = o.poll_id
  left join public.properties as pr
    on pr.id = v.property_id
  where o.poll_id = p_poll_id
  group by o.id, o.sort_order
  order by coalesce(sum(
    case
      when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
      else 0
    end
  ), 0) desc,
           o.sort_order asc,
           o.id asc
  limit 1;

  v_accepted :=
    v_total is not null
    and v_total > 0
    and v_winner_id is not null
    and (v_winner_weight / v_total) >= 0.51;

  update public.polls
     set status = 'закрыт',
         result = case when v_accepted then 'принято' else 'не принято' end,
         result_option_id = case when v_accepted then v_winner_id else null end
   where id = p_poll_id
   returning * into poll_rec;

  return poll_rec;
end;
$function$;

revoke all on function public.set_poll_lifecycle(bigint, boolean) from public;
revoke execute on function public.set_poll_lifecycle(bigint, boolean) from anon;
grant execute on function public.set_poll_lifecycle(bigint, boolean) to authenticated;

create or replace function public.get_poll_tallies()
returns table (
  poll_id bigint,
  option_id bigint,
  option_weight numeric,
  apartment_count integer,
  total_building_weight numeric,
  percentage numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_total numeric;
begin
  if not (public.is_owner() or public.has_staff_role('администрация')) then
    raise exception 'get_poll_tallies: owner or administration required'
      using errcode = '42501';
  end if;

  v_total := public.poll_building_total_weight();

  return query
  select
    o.poll_id,
    o.id,
    coalesce(sum(
      case
        when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
        else 0
      end
    ), 0)::numeric,
    count(v.property_id)::integer,
    coalesce(v_total, 0),
    (
      case
        when coalesce(v_total, 0) > 0 then
          (
            coalesce(sum(
              case
                when pr.area_sqm is not null and pr.area_sqm > 0 then pr.area_sqm
                else 0
              end
            ), 0) / v_total
          ) * 100
        else 0
      end
    )::numeric
  from public.poll_options as o
  left join public.poll_votes as v
    on v.option_id = o.id
   and v.poll_id = o.poll_id
  left join public.properties as pr
    on pr.id = v.property_id
  group by o.poll_id, o.id;
end;
$function$;

revoke all on function public.get_poll_tallies() from public;
revoke execute on function public.get_poll_tallies() from anon;
grant execute on function public.get_poll_tallies() to authenticated;

-- ---------------------------------------------------------------------------
-- Support-fee reads
-- Administration and accountant, plus the owning resident.
-- Calculations are unchanged.
-- ---------------------------------------------------------------------------

drop policy if exists support_fee_ledger_staff_select on public.support_fee_ledger;
create policy support_fee_ledger_finance_select
on public.support_fee_ledger
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
);

drop policy if exists support_fee_assessments_select on public.support_fee_assessments;
create policy support_fee_assessments_select
on public.support_fee_assessments
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or public.owns_property(property_id)
);

drop policy if exists support_fee_allocations_select on public.support_fee_allocations;
create policy support_fee_allocations_select
on public.support_fee_allocations
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or exists (
    select 1
    from public.support_fee_assessments as a
    where a.id = assessment_id
      and public.owns_property(a.property_id)
  )
);

drop policy if exists support_fee_annual_policies_select on public.support_fee_annual_policies;
create policy support_fee_annual_policies_select
on public.support_fee_annual_policies
for select
to authenticated
using (
  public.has_staff_role('администрация')
  or public.has_staff_role('бухгалтер')
  or (
    status in ('published', 'closed')
    and public.is_owner()
  )
);

create or replace function public.preview_support_fee_year(
  p_property_id bigint,
  p_billing_year integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_base numeric;
  v_early numeric;
  v_late numeric;
  v_over numeric;
  v_debt numeric;
  v_pol public.support_fee_annual_policies;
  v_now timestamptz := now();
  v_need numeric;
begin
  if v_email is null then
    raise exception 'preview_support_fee_year: authentication required' using errcode = '42501';
  end if;
  if not public.owns_property(p_property_id) and not public.can_manage_support_fees() then
    raise exception 'preview_support_fee_year: not allowed' using errcode = '42501';
  end if;

  v_base := public.support_fee_base_amount(p_property_id);

  select * into v_pol
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
    and p.status in ('published','closed');

  select
    greatest(0, round(coalesce(p.debt, 0)::numeric, 2)),
    greatest(0, round(coalesce(p.overpayment, 0)::numeric, 2))
    into v_debt, v_over
  from public.properties as p
  where p.id = p_property_id;

  if v_pol.id is null or v_pol.enabled is not true then
    return jsonb_build_object(
      'billing_year', p_billing_year,
      'policy_enabled', false,
      'pricing_mode', 'standard',
      'base_amount', v_base,
      'early_amount', v_base,
      'late_amount', v_base,
      'available_credit', coalesce(v_over, 0),
      'old_debt', coalesce(v_debt, 0),
      'amount_needed_for_discount', null
    );
  end if;

  v_early := round(v_base * (1 - v_pol.early_discount_percent / 100), 2);
  v_late := round(v_base * (1 + v_pol.late_increase_percent / 100), 2);
  v_need := round(greatest(0, v_early - coalesce(v_over, 0)), 2);

  return jsonb_build_object(
    'billing_year', p_billing_year,
    'policy_enabled', true,
    'early_deadline_at', v_pol.early_payment_deadline,
    'year_starts_at', public.support_fee_year_start(p_billing_year),
    'in_early_window', v_now <= v_pol.early_payment_deadline,
    'discount_percent', v_pol.early_discount_percent,
    'increase_percent', v_pol.late_increase_percent,
    'base_amount', v_base,
    'early_amount', v_early,
    'late_amount', v_late,
    'available_credit', coalesce(v_over, 0),
    'old_debt', coalesce(v_debt, 0),
    'credit_covers_early', coalesce(v_over, 0) >= v_early,
    'amount_needed_for_discount', v_need
  );
end;
$fn$;

revoke all on function public.preview_support_fee_year(bigint, integer) from public;
revoke all on function public.preview_support_fee_year(bigint, integer) from anon;
grant execute on function public.preview_support_fee_year(bigint, integer) to authenticated;

commit;
