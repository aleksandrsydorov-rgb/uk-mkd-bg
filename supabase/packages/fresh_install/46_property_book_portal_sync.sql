-- =============================================================================
-- Fresh-install — Property Book portal mirror sync (PB-1 display fields)
-- =============================================================================
-- Canonical ownership = property_registry_people.
-- properties.owner_* are display mirrors only — never authorize (owns_property).
-- Independent portal owner_* UPDATEs are blocked unless property_book.mutating=1.
-- Depends on: 00_properties, 40_registry, 45_book_auth (property_book_set_mutating).
-- =============================================================================

create or replace function public.property_book_sync_portal_owner_fields(p_property_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner public.property_registry_people%rowtype;
  v_name text;
begin
  perform public.property_book_set_mutating(true);

  select r.* into v_owner
  from public.property_registry_people as r
  where r.property_id = p_property_id
    and r.relation_type = 'owner'
    and r.deregistered_at is null
  order by r.id
  limit 1;

  if not found then
    update public.properties as p
       set owner_email = null,
           owner_name = null
     where p.id = p_property_id;
    return;
  end if;

  if v_owner.entity_kind in ('legal_entity', 'sole_trader') then
    v_name := nullif(btrim(coalesce(v_owner.entity_name, '')), '');
  else
    v_name := nullif(btrim(concat_ws(' ',
      nullif(btrim(coalesce(v_owner.first_name, '')), ''),
      nullif(btrim(coalesce(v_owner.middle_name, '')), ''),
      nullif(btrim(coalesce(v_owner.last_name, '')), '')
    )), '');
  end if;

  update public.properties as p
     set owner_email = lower(nullif(btrim(coalesce(v_owner.email, '')), '')),
         owner_name = v_name,
         owner_type = case
           when v_owner.entity_kind = 'legal_entity' then 'юридическое лицо'
           when v_owner.entity_kind = 'sole_trader' then 'ЕТ'
           else 'физическое лицо'
         end,
         company_name = case
           when v_owner.entity_kind in ('legal_entity', 'sole_trader')
             then nullif(btrim(coalesce(v_owner.entity_name, '')), '')
           else p.company_name
         end
   where p.id = p_property_id;
end;
$fn$;

revoke all on function public.property_book_sync_portal_owner_fields(bigint) from public, anon;
grant execute on function public.property_book_sync_portal_owner_fields(bigint) to service_role;

create or replace function public.properties_block_independent_owner_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and (
       new.owner_email is distinct from old.owner_email
       or new.owner_name is distinct from old.owner_name
       or new.owner_phone is distinct from old.owner_phone
       or new.owner_type is distinct from old.owner_type
       or new.company_name is distinct from old.company_name
     )
     and current_setting('property_book.mutating', true) is distinct from '1'
  then
    raise exception 'properties: ownership fields are managed only via Property Book'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists properties_block_independent_owner_mutation_trg on public.properties;
create trigger properties_block_independent_owner_mutation_trg
  before update on public.properties
  for each row
  execute function public.properties_block_independent_owner_mutation();

comment on function public.property_book_sync_portal_owner_fields(bigint) is
  'PB-1: mirror active Book owner into properties.owner_* for display. Never authorizes.';
