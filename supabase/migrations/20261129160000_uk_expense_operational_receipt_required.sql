-- =============================================================================
-- New operational UK expenses need a real file in private uk-expense-receipts.
-- Opening rows created by import_uk_expense_opening_row stay without a receipt.
-- A client set_config / opening_import / request origin does not grant that exemption.
-- Rows that already exist keep receipt_enforced = false and stay editable.
-- An enforced row cannot drop its last real receipt.
-- Storage policies are not dropped. can_upload_expense_receipt keeps the
-- expenses/{id}/ rule and also accepts a staff pending path so the object
-- can exist before the row. The insert still requires that object.
-- =============================================================================

alter table public.uk_expenses
  add column if not exists receipt_enforced boolean not null default false;

comment on column public.uk_expenses.receipt_enforced is
  'Server-owned. True only for operational rows inserted after this migration. Clients cannot clear it.';

create schema if not exists ux_guard;
revoke all on schema ux_guard from public, anon, authenticated;

create table if not exists ux_guard.uk_expense_origin (
  backend_pid integer primary key,
  kind text not null check (kind = 'opening')
);

alter table ux_guard.uk_expense_origin enable row level security;
alter table ux_guard.uk_expense_origin force row level security;
revoke all on table ux_guard.uk_expense_origin from public, anon, authenticated;

create or replace function ux_guard.claim_uk_expense_opening_origin()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into ux_guard.uk_expense_origin (backend_pid, kind)
  values (pg_backend_pid(), 'opening')
  on conflict (backend_pid) do update
    set kind = excluded.kind;
end;
$fn$;

revoke all on function ux_guard.claim_uk_expense_opening_origin() from public, anon, authenticated;

create or replace function ux_guard.uk_expense_receipt_exists(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from storage.objects as o
    join storage.buckets as b on b.id = o.bucket_id
    where o.bucket_id = 'uk-expense-receipts'
      and b.public = false
      and o.name = p_name
      and p_name ~* '^expenses/(pending|[0-9]+)/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|pdf)$'
  );
$fn$;

revoke all on function ux_guard.uk_expense_receipt_exists(text) from public, anon, authenticated;

create or replace function public.uk_expenses_require_operational_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_opening boolean;
  v_url text;
  v_ok integer := 0;
  v_bad integer := 0;
begin
  v_opening := coalesce(new.opening_import, false)
    and exists (
      select 1
      from ux_guard.uk_expense_origin as o
      where o.backend_pid = pg_backend_pid()
        and o.kind = 'opening'
    );

  if tg_op = 'INSERT' then
    if v_opening then
      new.receipt_enforced := false;
      delete from ux_guard.uk_expense_origin
      where backend_pid = pg_backend_pid();
      return new;
    end if;
    new.receipt_enforced := true;
  elsif coalesce(old.receipt_enforced, false) then
    new.receipt_enforced := true;
  else
    return new;
  end if;

  if new.photo_urls is null or cardinality(new.photo_urls) = 0 then
    if tg_op = 'UPDATE' then
      raise exception 'uk_expenses: receipt unlink blocked'
        using errcode = '23514';
    end if;
    raise exception 'uk_expenses: receipt required'
      using errcode = '23514';
  end if;

  foreach v_url in array new.photo_urls loop
    if ux_guard.uk_expense_receipt_exists(v_url) then
      v_ok := v_ok + 1;
    else
      v_bad := v_bad + 1;
    end if;
  end loop;

  if v_bad > 0 or v_ok < 1 then
    raise exception 'uk_expenses: receipt required'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

revoke all on function public.uk_expenses_require_operational_receipt() from public, anon, authenticated;

drop trigger if exists uk_expenses_receipt_required_biu on public.uk_expenses;
create trigger uk_expenses_receipt_required_biu
  before insert or update on public.uk_expenses
  for each row
  execute function public.uk_expenses_require_operational_receipt();

create or replace function public.uk_expenses_bind_pending_receipts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url text;
  v_file text;
  v_dest text;
  v_new text[] := '{}';
begin
  if coalesce(new.receipt_enforced, false) is not true or new.photo_urls is null then
    return new;
  end if;

  foreach v_url in array new.photo_urls loop
    if v_url ~ '^expenses/pending/[0-9a-f-]{36}\.[a-z0-9]{1,8}$' then
      v_file := split_part(v_url, '/', 3);
      v_dest := 'expenses/' || new.id::text || '/' || v_file;
      update storage.objects
         set name = v_dest
       where bucket_id = 'uk-expense-receipts'
         and name = v_url;
      if not found then
        raise exception 'uk_expenses: receipt required'
          using errcode = '23514';
      end if;
      v_new := v_new || v_dest;
    else
      v_new := v_new || v_url;
    end if;
  end loop;

  if v_new is distinct from new.photo_urls then
    update public.uk_expenses
       set photo_urls = v_new
     where id = new.id;
  end if;
  return new;
end;
$fn$;

revoke all on function public.uk_expenses_bind_pending_receipts() from public, anon, authenticated;

drop trigger if exists uk_expenses_receipt_bind_ai on public.uk_expenses;
create trigger uk_expenses_receipt_bind_ai
  after insert on public.uk_expenses
  for each row
  execute function public.uk_expenses_bind_pending_receipts();

create or replace function public.can_upload_expense_receipt(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_expense_id bigint;
begin
  if p_name ~ '^expenses/pending/[0-9a-f-]{36}\.[a-z0-9]{1,8}$' then
    return public.is_staff();
  end if;
  if not public.private_object_name_ok(p_name, 'expenses') then
    return false;
  end if;
  v_expense_id := split_part(p_name, '/', 2)::bigint;
  return exists (
    select 1
    from public.uk_expenses as e
    where e.id = v_expense_id
      and public.is_staff()
      and (
        public.can_approve_uk_expenses()
        or not public.uk_expense_is_published(e.status)
      )
  );
end;
$fn$;

do $patch$
declare
  def text;
begin
  select pg_get_functiondef(p.oid)
    into def
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'import_uk_expense_opening_row';

  if def is null then
    raise exception 'import_uk_expense_opening_row missing';
  end if;
  if position('claim_uk_expense_opening_origin' in def) > 0 then
    return;
  end if;
  if position('app.uk_expense_opening_import' in def) = 0 then
    raise exception 'opening import marker missing';
  end if;

  def := regexp_replace(
    def,
    'perform[[:space:]]+set_config\([[:space:]]*''app\.uk_expense_opening_import''[[:space:]]*,[[:space:]]*''1''[[:space:]]*,[[:space:]]*true[[:space:]]*\)[[:space:]]*;',
    'perform set_config(''app.uk_expense_opening_import'', ''1'', true); perform ux_guard.claim_uk_expense_opening_origin();',
    'i'
  );

  if position('claim_uk_expense_opening_origin' in def) = 0 then
    raise exception 'opening origin patch did not apply';
  end if;
  execute def;
end;
$patch$;
