-- Harden owner_transfers direct-approve guard (non-spoofable).
--
-- Custom GUCs (property_book.mutating / transfer_approve) are NOT safe:
-- any SQL-capable role can SELECT set_config('property_book.transfer_approve','1',true)
-- and then UPDATE owner_transfers.status to утверждена.
--
-- Gate: a table with ZERO grants to anon/authenticated. Only SECURITY DEFINER
-- routines owned by a privileged role can insert a one-row ticket before the
-- status update. The BEFORE UPDATE trigger requires that ticket for approve.

begin;

-- Drop spoofable GUC helper if a prior draft created it
drop function if exists public.property_book_set_transfer_approve(boolean);

create table if not exists public.property_book_transfer_approve_gate (
  transfer_id bigint primary key
    references public.owner_transfers (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.property_book_transfer_approve_gate is
  'Ephemeral approve tickets. No client grants. Written only by admin_approve_owner_transfer.';

revoke all on table public.property_book_transfer_approve_gate from public;
revoke all on table public.property_book_transfer_approve_gate from anon;
revoke all on table public.property_book_transfer_approve_gate from authenticated;

alter table public.property_book_transfer_approve_gate enable row level security;

-- No RLS policies → authenticated/anon denied even if grants were mis-added.
-- Table owner / SECURITY DEFINER (owner) still has full access.

create or replace function public.owner_transfers_block_direct_approve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.status = 'утверждена'
     and old.status is distinct from 'утверждена'
     and not exists (
       select 1
       from public.property_book_transfer_approve_gate as g
       where g.transfer_id = new.id
     )
  then
    raise exception 'owner_transfers: approve only via admin_approve_owner_transfer'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

create or replace function public.admin_approve_owner_transfer(p_transfer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tr public.owner_transfers%rowtype;
  v_prop public.properties%rowtype;
  v_parts text[];
  v_first text;
  v_last text;
  v_book jsonb;
  v_ideal numeric;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  select t.* into v_tr
  from public.owner_transfers as t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'admin_approve_owner_transfer: not found'
      using errcode = 'P0002';
  end if;
  if v_tr.status is distinct from 'ожидает' then
    raise exception 'admin_approve_owner_transfer: not pending'
      using errcode = 'P0001';
  end if;

  select p.* into v_prop
  from public.properties as p
  where p.id = v_tr.property_id;
  if not found then
    raise exception 'admin_approve_owner_transfer: property not found'
      using errcode = 'P0002';
  end if;

  v_ideal := coalesce(v_prop.ideal_parts_percent, 0);
  v_parts := regexp_split_to_array(btrim(coalesce(v_tr.to_owner_name, '')), '\s+');
  v_first := coalesce(v_parts[1], 'Owner');
  if coalesce(array_length(v_parts, 1), 0) >= 2 then
    v_last := array_to_string(v_parts[2:array_length(v_parts, 1)], ' ');
  else
    v_last := v_first;
  end if;

  update public.properties as p
     set ownership_type = coalesce(p.ownership_type, 'sole')
   where p.id = v_tr.property_id
     and (p.ownership_type is null or p.ownership_type = 'sole');

  if (select p.ownership_type from public.properties as p where p.id = v_tr.property_id) = 'shared' then
    raise exception 'admin_approve_owner_transfer: shared ownership — edit Book manually'
      using errcode = 'P0001';
  end if;

  update public.properties as p
     set ownership_type = 'sole'
   where p.id = v_tr.property_id;

  v_book := public.admin_replace_property_book_owners(
    v_tr.property_id,
    jsonb_build_array(jsonb_build_object(
      'entity_kind', 'natural_person',
      'first_name', v_first,
      'last_name', v_last,
      'email', lower(btrim(v_tr.to_owner_email)),
      'ownership_share_percent', 100,
      'ideal_parts_percent', v_ideal
    ))
  );

  update public.properties as p
     set owner_phone = v_tr.to_owner_phone
   where p.id = v_tr.property_id;

  -- Non-spoofable ticket (table has no client grants)
  insert into public.property_book_transfer_approve_gate (transfer_id)
  values (p_transfer_id)
  on conflict (transfer_id) do update
    set created_at = now();

  update public.owner_transfers as t
     set status = 'утверждена',
         decided_at = now(),
         decided_by = nullif(auth.email(), '')
   where t.id = p_transfer_id;

  delete from public.property_book_transfer_approve_gate as g
   where g.transfer_id = p_transfer_id;

  perform public.property_book_set_mutating(false);

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'property_id', v_tr.property_id,
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

revoke all on function public.admin_approve_owner_transfer(bigint) from public, anon;
grant execute on function public.admin_approve_owner_transfer(bigint) to authenticated;

comment on function public.owner_transfers_block_direct_approve() is
  'Rejects status→утверждена unless a row exists in property_book_transfer_approve_gate (RPC-only).';

commit;
