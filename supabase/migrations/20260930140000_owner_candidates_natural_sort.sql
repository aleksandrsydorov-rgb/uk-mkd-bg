-- Natural sort of apartment numbers in election candidate picker (1,2,3… not 1,10,11).

create or replace function public.gm_list_owner_candidates()
returns table (
  picker_key text,
  source text,
  registry_people_id bigint,
  staff_id bigint,
  property_id bigint,
  apartment_number text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select *
  from (
    select
      ('owner:' || r.id::text) as picker_key,
      'owner'::text as source,
      r.id::bigint as registry_people_id,
      null::bigint as staff_id,
      r.property_id::bigint as property_id,
      coalesce(p.apartment_number::text, p.id::text) as apartment_number,
      coalesce(
        nullif(trim(concat_ws(' ',
          nullif(btrim(coalesce(r.first_name, '')), ''),
          nullif(btrim(coalesce(r.middle_name, '')), ''),
          nullif(btrim(coalesce(r.last_name, '')), ''),
          nullif(btrim(coalesce(r.entity_name, '')), '')
        )), ''),
        coalesce(p.owner_name, '—')
      ) as display_name
    from public.property_registry_people as r
    join public.properties as p on p.id = r.property_id
    where r.relation_type = 'owner'
      and r.deregistered_at is null

    union all

    select
      ('admin:' || s.id::text),
      'admin'::text,
      null::bigint,
      s.id::bigint,
      null::bigint,
      null::text,
      coalesce(nullif(btrim(s.name), ''), coalesce(s.email, 'admin#' || s.id::text))
    from public.staff as s
    where s.active is true
      and s.role = 'администрация'
      and not exists (
        select 1
        from public.property_registry_people as r
        where r.relation_type = 'owner'
          and r.deregistered_at is null
          and r.email is not null
          and s.email is not null
          and lower(btrim(r.email)) = lower(btrim(s.email))
      )
  ) as q
  order by
    case when q.source = 'admin' then 1 else 0 end,
    case
      when q.apartment_number ~ '^[0-9]+'
        then (regexp_match(q.apartment_number, '^[0-9]+'))[1]::integer
      else null
    end nulls last,
    q.apartment_number nulls last,
    q.display_name;
$fn$;

revoke all on function public.gm_list_owner_candidates() from public, anon;
grant execute on function public.gm_list_owner_candidates() to authenticated;
