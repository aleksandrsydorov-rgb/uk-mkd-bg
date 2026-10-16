-- INV-10 local write proof (disposable local Supabase only — never cloud).
-- Uses canonical inventory_set_staff_capabilities + JWT admin simulation.

\set ON_ERROR_STOP on

do $inv10$
declare
  v_admin_uid uuid;
  v_admin_email text := 'inv7a-admin@local.dev';
  v_staff_id bigint;
  v_row public.staff_inventory_capabilities%rowtype;
  v_ticket_claim boolean;
  v_ticket_receive boolean;
begin
  select u.id into v_admin_uid from auth.users u where lower(u.email) = lower(v_admin_email) limit 1;
  if v_admin_uid is null then
    raise exception 'inv10: inv7a-admin@local.dev auth user missing on local';
  end if;

  select s.id into v_staff_id
  from public.staff s
  where lower(s.email) = 'inv7a-staff@local.dev'
  limit 1;
  if v_staff_id is null then
    raise exception 'inv10: inv7a-staff staff missing';
  end if;

  -- Snapshot ticket profile (must remain unchanged by inventory cap writes)
  select c.can_self_claim_requests, c.can_receive_work_orders
    into v_ticket_claim, v_ticket_receive
  from public.staff_work_capabilities c
  where c.staff_id = v_staff_id;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin_uid::text, 'email', v_admin_email, 'role', 'authenticated')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  perform set_config('request.jwt.claim.email', v_admin_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  if not public.has_staff_role('администрация') then
    raise exception 'inv10: admin role check failed';
  end if;

  -- Enable granular caps
  select * into v_row from public.inventory_set_staff_capabilities(
    v_staff_id,
    true,  -- view
    true,  -- edit_assets (covers maintenance gate)
    false, -- manage_categories
    true,  -- stock_move
    true,  -- participate
    false, -- review
    false, -- approve
    false  -- write_off
  );

  if v_row.can_view is not true
     or v_row.can_edit_assets is not true
     or v_row.can_stock_move is not true
     or v_row.can_session_participate is not true
     or v_row.can_approve_sessions is not false
     or v_row.can_write_off is not false then
    raise exception 'inv10: unexpected capability row after enable';
  end if;

  if v_row.updated_by_email is distinct from v_admin_email then
    raise exception 'inv10: audit email missing: %', v_row.updated_by_email;
  end if;

  -- Reload check
  select * into v_row from public.staff_inventory_capabilities where staff_id = v_staff_id;
  if not found or v_row.can_view is not true then
    raise exception 'inv10: reload failed';
  end if;

  -- Disable / revoke
  select * into v_row from public.inventory_set_staff_capabilities(
    v_staff_id, false, false, false, false, false, false, false, false
  );
  if v_row.can_view or v_row.can_edit_assets or v_row.can_session_participate then
    raise exception 'inv10: revoke incomplete';
  end if;

  -- Ticket profile unchanged
  if exists (
    select 1 from public.staff_work_capabilities c
    where c.staff_id = v_staff_id
      and (
        c.can_self_claim_requests is distinct from coalesce(v_ticket_claim, c.can_self_claim_requests)
        or c.can_receive_work_orders is distinct from coalesce(v_ticket_receive, c.can_receive_work_orders)
      )
  ) then
    raise exception 'inv10: ticket capabilities mutated';
  end if;

  raise notice 'inv10_local_permissions_ok staff_id=%', v_staff_id;
end;
$inv10$;
