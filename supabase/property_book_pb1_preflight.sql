-- PKG-PB1-BOOK-ONLY preflight (read-only). Run before applying migrations.
-- Does not modify data.

select
  to_regprocedure('public.owns_property(bigint)') is not null as has_owns_property,
  to_regprocedure('public.list_my_owned_properties()') is not null as has_list_my_owned,
  to_regprocedure('public.admin_create_property_invite(bigint,text)') is not null as has_invite_email,
  to_regprocedure('public.admin_import_property_book(jsonb,jsonb,boolean)') is not null
    or to_regprocedure('public.admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean)') is not null
    as has_import,
  to_regclass('public.property_access_invites') is not null as has_invites_table,
  to_regclass('public.property_registry_people') is not null as has_registry,
  to_regclass('public.owner_transfers') is not null as has_transfers,
  to_regprocedure('public.user_activation_owner_base()') is not null as has_ua_owner_base,
  to_regprocedure('public.gm_freeze_notice_snapshot(uuid)') is not null as has_gm_notice_freeze,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'owner_email'
  ) as has_portal_owner_email_column,
  to_regclass('public.property_book_runtime_flags') is not null as has_compat_runtime_flags,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261010120000'
  ) as migration_120000_applied,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261010120100'
  ) as migration_120100_applied,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261010233000'
  ) as migration_233000_applied;

-- Portal-only vs Book gaps (informational; portal email never authorizes after BOOK-ONLY)
select
  (select count(*) from public.properties p
    where nullif(btrim(coalesce(p.owner_email, '')), '') is not null
      and not exists (
        select 1 from public.property_registry_people r
        where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
      )
  ) as portal_email_without_book_owners,
  (select count(*) from public.properties p
    where nullif(btrim(coalesce(p.owner_email, '')), '') is not null
      and exists (
        select 1 from public.property_registry_people r
        where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
      )
      and not exists (
        select 1 from public.property_registry_people r
        where r.property_id = p.id and r.relation_type = 'owner' and r.deregistered_at is null
          and lower(btrim(coalesce(r.email, ''))) = lower(btrim(p.owner_email))
      )
  ) as portal_email_not_in_active_book,
  (select count(*) from public.property_access_invites i where i.status = 'pending') as pending_invites,
  (select count(*) from public.property_registry_people r
    where r.relation_type = 'owner' and r.deregistered_at is null
      and (
        nullif(btrim(coalesce(r.email, '')), '') is null
        or position('@' in coalesce(r.email, '')) = 0
        or r.ownership_share_percent is null
        or r.ownership_share_percent <= 0
      )
  ) as incomplete_active_book_owners;
