-- Restore missing annual-policy RPCs expected by AdminSupportFeePolicyEditor /
-- database.types.ts. Table public.support_fee_annual_policies already exists;
-- upsert/publish/close and support_fee_early_deadline were never shipped in a
-- numbered migration (only in legacy DO_NOT_RUN hotfix) → PostgREST PGRST202.

begin;

create or replace function public.support_fee_early_deadline(p_billing_year integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select make_timestamptz(p_billing_year - 1, 12, 31, 23, 59, 59, 'Europe/Sofia');
$$;

comment on function public.support_fee_early_deadline(integer) is
  'Default early-payment cutoff: 31 Dec (billing_year-1) 23:59:59 Europe/Sofia.';

create or replace function public.support_fee_year_start(p_billing_year integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select make_timestamptz(p_billing_year, 1, 1, 0, 0, 0, 'Europe/Sofia');
$$;

comment on function public.support_fee_year_start(integer) is
  'Billing year start: 1 Jan billing_year 00:00:00 Europe/Sofia.';

create or replace function public.upsert_support_fee_annual_policy(
  p_billing_year integer,
  p_enabled boolean,
  p_early_discount_percent numeric,
  p_late_increase_percent numeric,
  p_early_payment_deadline timestamptz
)
returns public.support_fee_annual_policies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.support_fee_annual_policies;
  v_email text := auth.email();
  v_deadline timestamptz;
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'upsert_support_fee_annual_policy: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'upsert_support_fee_annual_policy: not allowed'
      using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'upsert_support_fee_annual_policy: invalid billing year'
      using errcode = '22023';
  end if;
  if p_early_discount_percent is null
     or p_early_discount_percent < 0
     or p_early_discount_percent > 100 then
    raise exception 'upsert_support_fee_annual_policy: invalid early discount percent'
      using errcode = '22023';
  end if;
  if p_late_increase_percent is null
     or p_late_increase_percent < 0
     or p_late_increase_percent > 100 then
    raise exception 'upsert_support_fee_annual_policy: invalid late increase percent'
      using errcode = '22023';
  end if;

  v_deadline := coalesce(p_early_payment_deadline, public.support_fee_early_deadline(p_billing_year));

  -- Deadline must fall strictly before the billing year in Europe/Sofia.
  if (v_deadline at time zone 'Europe/Sofia')::date
       >= make_date(p_billing_year, 1, 1) then
    raise exception 'upsert_support_fee_annual_policy: deadline must be before billing year'
      using errcode = '22023';
  end if;

  select * into v_row
  from public.support_fee_annual_policies as p
  where p.billing_year = p_billing_year
  for update;

  if found then
    if v_row.status is distinct from 'draft' then
      raise exception 'upsert_support_fee_annual_policy: published policy cannot be edited'
        using errcode = '42501';
    end if;
    update public.support_fee_annual_policies as p
       set enabled = coalesce(p_enabled, p.enabled),
           early_discount_percent = round(p_early_discount_percent, 2),
           late_increase_percent = round(p_late_increase_percent, 2),
           early_payment_deadline = v_deadline,
           updated_at = now(),
           updated_by_email = btrim(v_email)
     where p.id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.support_fee_annual_policies (
    billing_year, enabled, status,
    early_discount_percent, late_increase_percent, early_payment_deadline,
    created_by_email, updated_by_email
  ) values (
    p_billing_year,
    coalesce(p_enabled, true),
    'draft',
    round(p_early_discount_percent, 2),
    round(p_late_increase_percent, 2),
    v_deadline,
    btrim(v_email),
    btrim(v_email)
  )
  returning * into v_row;
  return v_row;
end;
$fn$;

comment on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) is
  'Create or update a draft annual early/late policy for one billing year.';

create or replace function public.publish_support_fee_annual_policy(p_billing_year integer)
returns public.support_fee_annual_policies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.support_fee_annual_policies;
  v_email text := auth.email();
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'publish_support_fee_annual_policy: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'publish_support_fee_annual_policy: not allowed'
      using errcode = '42501';
  end if;

  update public.support_fee_annual_policies as p
     set status = 'published',
         updated_at = now(),
         updated_by_email = btrim(v_email)
   where p.billing_year = p_billing_year
     and p.status = 'draft'
  returning * into v_row;

  if not found then
    raise exception 'publish_support_fee_annual_policy: draft policy not found'
      using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

comment on function public.publish_support_fee_annual_policy(integer) is
  'Promote a draft annual policy to published. Does not rewrite existing charges.';

create or replace function public.close_support_fee_annual_policy(p_billing_year integer)
returns public.support_fee_annual_policies
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.support_fee_annual_policies;
  v_email text := auth.email();
begin
  if v_email is null or btrim(v_email) = '' then
    raise exception 'close_support_fee_annual_policy: authentication required'
      using errcode = '42501';
  end if;
  if not public.can_manage_support_fees() then
    raise exception 'close_support_fee_annual_policy: not allowed'
      using errcode = '42501';
  end if;

  update public.support_fee_annual_policies as p
     set status = 'closed',
         updated_at = now(),
         updated_by_email = btrim(v_email)
   where p.billing_year = p_billing_year
     and p.status = 'published'
  returning * into v_row;

  if not found then
    raise exception 'close_support_fee_annual_policy: published policy not found'
      using errcode = 'P0002';
  end if;
  return v_row;
end;
$fn$;

comment on function public.close_support_fee_annual_policy(integer) is
  'Close a published annual policy. Existing assessments remain unchanged.';

revoke all on function public.support_fee_early_deadline(integer) from public;
revoke all on function public.support_fee_early_deadline(integer) from anon;
grant execute on function public.support_fee_early_deadline(integer) to authenticated;
grant execute on function public.support_fee_early_deadline(integer) to service_role;

revoke all on function public.support_fee_year_start(integer) from public;
revoke all on function public.support_fee_year_start(integer) from anon;
grant execute on function public.support_fee_year_start(integer) to authenticated;
grant execute on function public.support_fee_year_start(integer) to service_role;

revoke all on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) from public;
revoke all on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) from anon;
grant execute on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.upsert_support_fee_annual_policy(integer, boolean, numeric, numeric, timestamptz) to service_role;

revoke all on function public.publish_support_fee_annual_policy(integer) from public;
revoke all on function public.publish_support_fee_annual_policy(integer) from anon;
grant execute on function public.publish_support_fee_annual_policy(integer) to authenticated;
grant execute on function public.publish_support_fee_annual_policy(integer) to service_role;

revoke all on function public.close_support_fee_annual_policy(integer) from public;
revoke all on function public.close_support_fee_annual_policy(integer) from anon;
grant execute on function public.close_support_fee_annual_policy(integer) to authenticated;
grant execute on function public.close_support_fee_annual_policy(integer) to service_role;

commit;
