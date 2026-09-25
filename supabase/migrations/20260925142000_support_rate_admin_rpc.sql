-- Administration-only support-rate write.
-- Replaces direct building_settings UPSERT so ON CONFLICT does not need
-- SELECT on support_rate_eur_per_sqm_year.
-- Does not change fee math, utility modes, meters, or payments.
-- Does not restore table-wide SELECT or grant broad writes.

begin;

create or replace function public.set_support_rate_eur_per_sqm_year(
  p_rate numeric
)
returns table (
  id integer,
  support_rate_eur_per_sqm_year numeric,
  updated_at timestamptz,
  updated_by text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_rate numeric;
begin
  v_email := nullif(btrim(auth.email()), '');
  if v_email is null then
    raise exception 'set_support_rate_eur_per_sqm_year: not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_staff_role('администрация') then
    raise exception 'set_support_rate_eur_per_sqm_year: not allowed'
      using errcode = '42501';
  end if;

  if p_rate is null or p_rate <= 0 then
    raise exception 'set_support_rate_eur_per_sqm_year: rate must be greater than zero'
      using errcode = '22023';
  end if;

  v_rate := p_rate;

  update public.building_settings as bs
     set support_rate_eur_per_sqm_year = v_rate,
         updated_at = now(),
         updated_by = v_email
   where bs.id = 1;

  if not found then
    raise exception 'set_support_rate_eur_per_sqm_year: settings row not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    bs.id,
    bs.support_rate_eur_per_sqm_year,
    bs.updated_at,
    bs.updated_by
  from public.building_settings as bs
  where bs.id = 1;
end;
$fn$;

revoke all on function public.set_support_rate_eur_per_sqm_year(numeric) from public;
revoke execute on function public.set_support_rate_eur_per_sqm_year(numeric) from anon;
grant execute on function public.set_support_rate_eur_per_sqm_year(numeric) to authenticated;

commit;
