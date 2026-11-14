-- The acceptance registry must use the same complex id as the live
-- installation. portal_legal_complex_id() already prefers
-- platform_installations, but the complex row was only seeded for the
-- standalone id, so the first acknowledgement insert failed the foreign key.
-- The lookup stays free of writes: PostgREST runs the stable status function
-- in a read-only transaction.

do $$
begin
  if to_regclass('public.platform_installations') is not null then
    insert into public.portal_legal_complex (id, name)
    select id, 'Амадеус XI'
    from public.platform_installations
    order by created_at
    limit 1
    on conflict (id) do nothing;
  end if;
end;
$$;

create or replace function public.portal_legal_complex_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found uuid;
begin
  if to_regclass('public.platform_installations') is not null then
    execute 'select id from public.platform_installations order by created_at limit 1' into found;
    if found is not null then
      return found;
    end if;
  end if;
  return 'c1111111-1111-4111-8111-111111111111'::uuid;
end;
$$;

revoke all on function public.portal_legal_complex_id() from public, anon, authenticated;

create or replace function public.portal_legal_capture_installation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portal_legal_complex (id, name)
  values (new.id, 'Амадеус XI')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.portal_legal_capture_installation() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.platform_installations') is not null then
    drop trigger if exists portal_legal_capture_installation on public.platform_installations;
    create trigger portal_legal_capture_installation
      after insert on public.platform_installations
      for each row execute function public.portal_legal_capture_installation();
  end if;
end;
$$;
