-- SH-2A: close only the three critical staff mutation paths identified by SH-2.
-- Preserve existing non-ownership property edits and existing expense create/edit/publish rules.

begin;

-- ---------------------------------------------------------------------------
-- Properties
-- - creation and deletion require exact active administration;
-- - active non-administration staff retain operational updates, but cannot
--   change ownership identity or existing administration-only legal fields.
-- ---------------------------------------------------------------------------

drop policy if exists properties_staff_insert on public.properties;
create policy properties_staff_insert
on public.properties
for insert
to authenticated
with check (public.has_staff_role('администрация'));

drop policy if exists properties_staff_delete on public.properties;
create policy properties_staff_delete
on public.properties
for delete
to authenticated
using (public.has_staff_role('администрация'));

create or replace function public.enforce_properties_update()
returns trigger
language plpgsql
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
       or NEW.owner_user_management_agreement is distinct from OLD.owner_user_management_agreement then
      raise exception 'properties: ownership and legal fields require administration'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$function$;

revoke all on function public.enforce_properties_update() from public;
revoke execute on function public.enforce_properties_update() from anon;
revoke execute on function public.enforce_properties_update() from authenticated;

-- ---------------------------------------------------------------------------
-- Owner transfers
-- Decisions require exact active administration in both RLS and the trigger.
-- The owner-created pending-transfer workflow is unchanged.
-- ---------------------------------------------------------------------------

drop policy if exists owner_transfers_staff_update on public.owner_transfers;
create policy owner_transfers_staff_update
on public.owner_transfers
for update
to authenticated
using (public.has_staff_role('администрация'))
with check (public.has_staff_role('администрация'));

create or replace function public.enforce_owner_transfer_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.has_staff_role('администрация') then
    raise exception 'owner_transfers: decision requires administration'
      using errcode = '42501';
  end if;

  if (
    to_jsonb(NEW) - 'status' - 'decided_at' - 'decided_by' - 'reject_reason'
  ) <> (
    to_jsonb(OLD) - 'status' - 'decided_at' - 'decided_by' - 'reject_reason'
  ) then
    raise exception 'owner_transfers: only decision fields may be updated'
      using errcode = '42501';
  end if;

  if NEW.status is distinct from 'утверждена'
     and NEW.status is distinct from 'отклонена' then
    raise exception 'owner_transfers: invalid decision status'
      using errcode = '42501';
  end if;

  if NEW.decided_at is null then
    raise exception 'owner_transfers: decided_at is required'
      using errcode = '42501';
  end if;

  if lower(btrim(NEW.decided_by))
     is distinct from lower(btrim(auth.email())) then
    raise exception 'owner_transfers: decided_by must match the current user'
      using errcode = '42501';
  end if;

  if NEW.status = 'утверждена'
     and NEW.reject_reason is not null then
    raise exception 'owner_transfers: reject_reason must be null when approved'
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

revoke all on function public.enforce_owner_transfer_update() from public;
revoke execute on function public.enforce_owner_transfer_update() from anon;
revoke execute on function public.enforce_owner_transfer_update() from authenticated;

-- ---------------------------------------------------------------------------
-- UK expenses
-- Keep existing create/edit/publish behavior; restrict DELETE only.
-- ---------------------------------------------------------------------------

drop policy if exists uk_expenses_staff_delete on public.uk_expenses;
create policy uk_expenses_staff_delete
on public.uk_expenses
for delete
to authenticated
using (public.has_staff_role('администрация'));

commit;
