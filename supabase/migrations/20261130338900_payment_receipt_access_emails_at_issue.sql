-- Payment receipt owner ACL (post-ownership-change):
-- - Staff (can_manage_payment_receipts): full apartment history
-- - Portal readers: only receipts whose frozen access_emails_at_issue (or
--   owner_email_at_issue) contains their auth email — including after they
--   lose owns_property on the apartment
-- - Current owns_property alone must NOT open another payer's receipts
-- - At issue, freeze Book owner emails + accepted invite emails so an invited
--   owner whose cabinet email differs from the Book email still keeps access
--   to their own receipt after transfer

alter table public.payment_receipts
  add column if not exists access_emails_at_issue text[] not null default '{}'::text[];

comment on column public.payment_receipts.access_emails_at_issue is
  'Frozen lowercased emails allowed to read this receipt after ownership changes.';

create index if not exists payment_receipts_access_emails_gin
  on public.payment_receipts using gin (access_emails_at_issue);

-- ---------------------------------------------------------------------------
-- Collect beneficiary emails for a property at issue time
-- ---------------------------------------------------------------------------

create or replace function public.payment_receipt_access_emails_for_property(p_property_id bigint)
returns text[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (
      select array_agg(distinct e order by e)
      from (
        select lower(nullif(btrim(r.email), '')) as e
        from public.property_registry_people as r
        where r.property_id = p_property_id
          and r.relation_type = 'owner'
          and r.deregistered_at is null
          and r.admin_status is distinct from 'deceased_recorded'
        union
        select lower(nullif(btrim(i.email), ''))
        from public.property_access_invites as i
        where i.property_id = p_property_id
          and i.status = 'accepted'
        union
        select lower(nullif(btrim(p.owner_email), ''))
        from public.properties as p
        where p.id = p_property_id
      ) as s
      where e is not null
    ),
    '{}'::text[]
  );
$fn$;

revoke all on function public.payment_receipt_access_emails_for_property(bigint) from public, anon;
grant execute on function public.payment_receipt_access_emails_for_property(bigint) to authenticated;
grant execute on function public.payment_receipt_access_emails_for_property(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: freeze access emails when not already set by caller
-- ---------------------------------------------------------------------------

create or replace function public.trg_payment_receipt_freeze_access_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emails text[];
  v_owner text;
begin
  v_emails := coalesce(new.access_emails_at_issue, '{}'::text[]);
  if cardinality(v_emails) = 0 then
    v_emails := public.payment_receipt_access_emails_for_property(new.property_id);
  end if;

  v_owner := lower(nullif(btrim(coalesce(new.owner_email_at_issue, '')), ''));
  if v_owner is not null and not (v_owner = any (v_emails)) then
    v_emails := array_append(v_emails, v_owner);
  end if;

  new.access_emails_at_issue := coalesce(v_emails, '{}'::text[]);
  if new.owner_email_at_issue is null and cardinality(new.access_emails_at_issue) > 0 then
    new.owner_email_at_issue := new.access_emails_at_issue[1];
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_payment_receipt_freeze_access_emails on public.payment_receipts;
create trigger trg_payment_receipt_freeze_access_emails
  before insert on public.payment_receipts
  for each row
  execute function public.trg_payment_receipt_freeze_access_emails();

-- ---------------------------------------------------------------------------
-- Backfill existing rows from owner_email_at_issue only (do not invent invites)
-- ---------------------------------------------------------------------------

update public.payment_receipts as r
   set access_emails_at_issue = array[lower(btrim(r.owner_email_at_issue))]
 where cardinality(coalesce(r.access_emails_at_issue, '{}'::text[])) = 0
   and nullif(btrim(coalesce(r.owner_email_at_issue, '')), '') is not null;

-- Rows with null owner_email_at_issue stay '{}'::text[] — readable by UK staff only.

-- ---------------------------------------------------------------------------
-- ACL: frozen email link, not owns_property alone
-- ---------------------------------------------------------------------------

create or replace function public.can_read_payment_receipt(p_receipt public.payment_receipts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.can_manage_payment_receipts()
    or (
      nullif(btrim(coalesce(auth.email(), '')), '') is not null
      and (
        lower(btrim(auth.email())) = any (coalesce(p_receipt.access_emails_at_issue, '{}'::text[]))
        or (
          p_receipt.owner_email_at_issue is not null
          and lower(btrim(auth.email())) = lower(btrim(p_receipt.owner_email_at_issue))
        )
      )
    );
$fn$;

revoke all on function public.can_read_payment_receipt(public.payment_receipts) from public, anon;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to authenticated;
grant execute on function public.can_read_payment_receipt(public.payment_receipts) to service_role;

-- Former owners may still list receipts they can read on a property they no longer own.
create or replace function public.list_payment_receipts_for_property(p_property_id bigint)
returns setof public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_property_id is null then
    raise exception 'payment_receipt: property required' using errcode = '22023';
  end if;
  if not (
    public.can_manage_payment_receipts()
    or public.owns_property(p_property_id)
    or exists (
      select 1
      from public.payment_receipts as r
      where r.property_id = p_property_id
        and public.can_read_payment_receipt(r)
    )
  ) then
    raise exception 'Not authorized.';
  end if;

  return query
  select r.*
  from public.payment_receipts as r
  where r.property_id = p_property_id
    and public.can_read_payment_receipt(r)
  order by r.issued_at desc, r.number desc;
end;
$fn$;

revoke all on function public.list_payment_receipts_for_property(bigint) from public, anon;
grant execute on function public.list_payment_receipts_for_property(bigint) to authenticated;
grant execute on function public.list_payment_receipts_for_property(bigint) to service_role;
