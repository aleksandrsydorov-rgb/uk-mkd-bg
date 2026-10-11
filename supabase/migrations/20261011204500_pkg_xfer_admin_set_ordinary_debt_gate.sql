-- PKG-XFER P5.7 / F3: staff-safe toggle for ordinary debt gate.
-- Direct UPDATE on ownership_change_settings is revoked for authenticated;
-- without this RPC, F3 cannot be exercised or restored via Admin session.

create or replace function public.admin_set_ordinary_debt_gate(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := auth.email();
  v_row public.ownership_change_settings;
begin
  perform public.admin_assert_book_admin();

  if p_enabled is null then
    raise exception 'admin_set_ordinary_debt_gate: p_enabled required' using errcode = '22023';
  end if;

  update public.ownership_change_settings as s
     set ordinary_debt_gate_enabled = p_enabled,
         updated_at = now(),
         updated_by_email = nullif(btrim(coalesce(v_email, '')), '')
   where s.id = 1
  returning * into v_row;

  if not found then
    raise exception 'admin_set_ordinary_debt_gate: settings row missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'ordinary_debt_gate_enabled', v_row.ordinary_debt_gate_enabled,
    'updated_at', v_row.updated_at,
    'updated_by_email', v_row.updated_by_email
  );
end;
$fn$;

revoke all on function public.admin_set_ordinary_debt_gate(boolean) from public, anon;
grant execute on function public.admin_set_ordinary_debt_gate(boolean) to authenticated;

comment on function public.admin_set_ordinary_debt_gate(boolean) is
  'PKG-XFER P5: Admin toggle for ordinary_debt_gate_enabled (F3). Always restore false after tests.';
