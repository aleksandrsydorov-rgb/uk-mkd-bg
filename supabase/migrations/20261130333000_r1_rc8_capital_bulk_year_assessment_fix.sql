-- Capital repair year bulk: keep assessment years distinct and return skipped_existing.
--
-- Bugs fixed:
-- 1) ensure_capital_repair_year_assessment matched by extract(year from decision_date).
--    Future-year assessments used least(Jan1, today) so decision_date fell into the current
--    calendar year and were reused for other billing years (e.g. title 2027 matched year 2026).
-- 2) charge_capital_repair_bulk returned key "skipped" while the UI contract expects
--    "skipped_existing", which made a successful all-skipped run look like a generic error.

begin;

create or replace function public.ensure_capital_repair_year_assessment(
  p_billing_year integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_id uuid;
  v_title text;
  v_decision date;
begin
  if v_email is null then
    raise exception 'ensure_capital_repair_year_assessment: not authenticated'
      using errcode = '28000';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'ensure_capital_repair_year_assessment: not allowed'
      using errcode = '42501';
  end if;
  if p_billing_year is null or p_billing_year < 2000 or p_billing_year > 2100 then
    raise exception 'ensure_capital_repair_year_assessment: invalid year'
      using errcode = '22023';
  end if;

  v_title := 'Капитальный ремонт ' || p_billing_year::text;
  -- Keep the billing year in decision_date even for future years so years never cross-match.
  v_decision := make_date(p_billing_year, 1, 1);

  select a.id into v_id
  from public.capital_repair_assessments as a
  where a.status = 'active'
    and a.title = v_title
  order by a.created_at desc
  limit 1;

  if v_id is not null then
    -- Repair legacy rows that stored "today" instead of Jan 1 of the billing year.
    update public.capital_repair_assessments as a
       set decision_date = v_decision
     where a.id = v_id
       and a.decision_date is distinct from v_decision;
    return v_id;
  end if;

  insert into public.capital_repair_assessments (
    title, description, decision_date, due_date, status, created_by_email
  ) values (
    v_title,
    'Автоматическое решение для начисления по тарифу ' || p_billing_year::text,
    v_decision,
    null,
    'active',
    v_email
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.ensure_capital_repair_year_assessment(integer) from public;
revoke all on function public.ensure_capital_repair_year_assessment(integer) from anon;
grant execute on function public.ensure_capital_repair_year_assessment(integer) to authenticated;

create or replace function public.charge_capital_repair_bulk(
  p_assessment_id uuid,
  p_billing_year integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := nullif(btrim(auth.email()), '');
  v_note text;
  v_status text;
  v_id bigint;
  v_rows int;
  v_total int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_blocked int := 0;
  v_module_enabled boolean;
  v_calc record;
  v_apt text;
begin
  if v_email is null then
    raise exception 'Not authorized.';
  end if;
  if not public.has_staff_role('администрация')
     and not public.has_staff_role('бухгалтер') then
    raise exception 'Not authorized.';
  end if;

  select coalesce(bm.enabled, false) into v_module_enabled
  from public.building_modules as bm
  where bm.module_key = 'capital_repair';
  if v_module_enabled is not true then
    raise exception 'Capital repair module is disabled.';
  end if;

  if p_assessment_id is null then
    raise exception 'Assessment not found.';
  end if;

  -- Ensure a published year tariff exists before locking properties.
  perform 1
  from public.resolve_capital_tariff_for_year(p_billing_year, 'natural') as r;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    perform 1 from public.properties as p where p.id = v_id for update;
  end loop;

  select a.status into v_status
  from public.capital_repair_assessments as a
  where a.id = p_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found.';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Assessment is not active.';
  end if;

  for v_id in
    select p.id from public.properties as p order by p.id
  loop
    v_total := v_total + 1;

    if exists (
      select 1 from public.capital_repair_opening_imports as i
      where i.property_id = v_id
        and (i.assessment_id = p_assessment_id or i.billing_year = p_billing_year)
    ) then
      v_blocked := v_blocked + 1;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (
      select 1 from public.capital_repair_ledger as l
      where l.property_id = v_id
        and l.assessment_id = p_assessment_id
        and l.kind = 'charge'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      select * into v_calc
      from public.capital_repair_charge_amount_for_year(v_id, p_billing_year);
    exception
      when others then
        select nullif(btrim(coalesce(p.apartment_number::text, '')), '') into v_apt
        from public.properties as p where p.id = v_id;
        raise exception 'capital_repair bulk: apartment % — %',
          coalesce(v_apt, v_id::text), SQLERRM
          using errcode = 'P0001';
    end;

    insert into public.capital_repair_ledger (
      property_id, assessment_id, kind, amount_eur, note, recorded_by_email, idempotency_key,
      area_sqm_snapshot, rate_eur_per_sqm_year_snapshot, tariff_version_id, subject_kind
    ) values (
      v_id, p_assessment_id, 'charge', v_calc.amount_eur, v_note, v_email, pg_catalog.gen_random_uuid(),
      v_calc.area_sqm, v_calc.rate_eur_per_sqm_year, v_calc.tariff_version_id, v_calc.subject_kind
    )
    on conflict (property_id, assessment_id) where kind = 'charge' and assessment_id is not null
    do nothing;

    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'created', v_created,
    'skipped', v_skipped,
    'skipped_existing', v_skipped,
    'not_applied', 0,
    'repriced', 0,
    'opening_import_blocked', v_blocked,
    'assessment_id', p_assessment_id,
    'billing_year', p_billing_year
  );
end;
$fn$;

revoke all on function public.charge_capital_repair_bulk(uuid, integer, text) from public, anon;
grant execute on function public.charge_capital_repair_bulk(uuid, integer, text) to authenticated;

-- One-shot repair of already-created future-year assessments on this install.
update public.capital_repair_assessments as a
   set decision_date = make_date(
     nullif(substring(a.title from '([0-9]{4})$'), '')::int,
     1,
     1
   )
 where a.title ~ '^Капитальный ремонт [0-9]{4}$'
   and extract(year from a.decision_date)::int
       is distinct from nullif(substring(a.title from '([0-9]{4})$'), '')::int;

commit;
