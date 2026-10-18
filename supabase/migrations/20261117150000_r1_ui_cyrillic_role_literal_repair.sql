-- R1-UI FINAL: repair double-encoded (mojibake) Cyrillic staff role literals
-- inside public function bodies.
--
-- Same root class as INV-7A.1 (is_staff): companion SQL applied with a non-UTF8
-- client encoding turned role literals into mojibake inside function source.
-- has_staff_role() itself is correct; callers such as admin_assert_book_admin()
-- compare against garbage and block Property Book / capital / tariff paths.
--
-- Encoding-safe: correct Cyrillic only via convert_from(decode(...)).
-- Additive. Does not change business rules.

begin;

do $repair$
declare
  r record;
  def text;
  lit text;
  v_admin text := convert_from(decode('d0b0d0b4d0bcd0b8d0bdd0b8d181d182d180d0b0d186d0b8d18f', 'hex'), 'utf8');
  v_acct  text := convert_from(decode('d0b1d183d185d0b3d0b0d0bbd182d0b5d180', 'hex'), 'utf8');
  v_eng   text := convert_from(decode('d0b8d0bdd0b6d0b5d0bdd0b5d180', 'hex'), 'utf8');
  v_clean text := convert_from(decode('d183d0b1d0bed180d189d0b8d0ba', 'hex'), 'utf8');
  v_bad_admin text := convert_from(
    decode('d0a0c2b0d0a0d291d0a0d198d0a0d191d0a0d085d0a0d191d0a1d083d0a1e2809ad0a1d082d0a0c2b0d0a1e280a0d0a0d191d0a1d08f', 'hex'),
    'utf8'
  );
  v_fixed int := 0;
  v_hex text;
  v_target text;
begin
  -- Prefer exact observed admin mojibake; additionally map any other
  -- has_staff_role('...') literal whose UTF-8 hex is NOT one of the four goods
  -- by matching against convert_from(convert_to(good,'UTF8'),'SQL_ASCII') style
  -- double-encoding when available; otherwise skip non-matching unknowns.

  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as fdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (
        position(v_bad_admin in pg_get_functiondef(p.oid)) > 0
        or p.prosrc like '%has_staff_role%'
      )
  loop
    def := r.fdef;
    def := replace(def, v_bad_admin, v_admin);

    for lit in
      select distinct m[1]
      from regexp_matches(def, $re$has_staff_role\(\s*'([^']+)'\s*\)$re$, 'g') as m
    loop
      if lit in (v_admin, v_acct, v_eng, v_clean) then
        continue;
      end if;
      v_hex := encode(convert_to(lit, 'UTF8'), 'hex');
      v_target := null;
      -- Double-encoded form of each good role: each UTF-8 byte becomes a latin1 char then UTF-8.
      if v_hex = encode(
           convert_to(convert_from(convert_to(v_admin, 'UTF8'), 'LATIN1'), 'UTF8'),
           'hex'
         )
         or lit = v_bad_admin then
        v_target := v_admin;
      elsif v_hex = encode(
           convert_to(convert_from(convert_to(v_acct, 'UTF8'), 'LATIN1'), 'UTF8'),
           'hex'
         ) then
        v_target := v_acct;
      elsif v_hex = encode(
           convert_to(convert_from(convert_to(v_eng, 'UTF8'), 'LATIN1'), 'UTF8'),
           'hex'
         ) then
        v_target := v_eng;
      elsif v_hex = encode(
           convert_to(convert_from(convert_to(v_clean, 'UTF8'), 'LATIN1'), 'UTF8'),
           'hex'
         ) then
        v_target := v_clean;
      end if;
      if v_target is not null then
        def := replace(def, lit, v_target);
      end if;
    end loop;

    if def is distinct from r.fdef then
      begin
        execute def;
        v_fixed := v_fixed + 1;
        raise notice 'r1_ui_cyrillic_repair: fixed %', r.proname;
      exception when others then
        raise warning 'r1_ui_cyrillic_repair: skip % (%)', r.proname, sqlerrm;
      end;
    end if;
  end loop;

  raise notice 'r1_ui_cyrillic_repair: fixed % function(s)', v_fixed;
end;
$repair$;

-- Explicit recreate of the Property Book gate (canonical role via decode).
create or replace function public.admin_assert_book_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'admin_book: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role(
    convert_from(decode('d0b0d0b4d0bcd0b8d0bdd0b8d181d182d180d0b0d186d0b8d18f', 'hex'), 'utf8')
  ) then
    raise exception 'admin_book: not allowed'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.admin_assert_book_admin() from public;
revoke all on function public.admin_assert_book_admin() from anon;
grant execute on function public.admin_assert_book_admin() to authenticated;
grant execute on function public.admin_assert_book_admin() to service_role;

commit;
