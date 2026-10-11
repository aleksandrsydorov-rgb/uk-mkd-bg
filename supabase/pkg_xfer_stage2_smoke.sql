-- =============================================================================
-- PKG-XFER Stage 2 — SAFE database-level smoke (BEGIN / ROLLBACK)
-- Fixture scope: synthetic apt 99351 (bigint) + floor; emails smoke.xfer2.*@example.com
-- NEVER apartment 99501 / Owner A/B.
-- Schema note: properties.apartment_number and properties.floor are bigint NOT NULL.
--
-- SAFE: no JWT GUC spoofing, no auth.users / storage.objects inserts.
-- No direct INSERT/UPDATE on owner_transfers (enforce_owner_transfer_* requires auth).
-- Auth-gated RPCs / transfer DML → SKIPPED
--   (see audit_exports/pkg_xfer_authenticated_session_test_plan.md).
-- Book fixture setup may use property_book_set_mutating (product GUC, not identity spoof).
-- =============================================================================

begin;

create temporary table pg_temp.xfer2_results (
  check_id text primary key,
  status text not null check (status in ('PASS', 'FAIL', 'SKIPPED')),
  detail text null
) on commit drop;

create or replace function pg_temp.xfer2_mark(p_id text, p_status text, p_detail text default null)
returns void language plpgsql as $fn$
begin
  insert into pg_temp.xfer2_results (check_id, status, detail)
  values (p_id, p_status, p_detail)
  on conflict (check_id) do update set status = excluded.status, detail = excluded.detail;
end;
$fn$;

do $body$
declare
  apt bigint := 99351;
  prop_id bigint;
  ideal numeric := 1.250000;
  floor_n bigint := 9;
  owner_a text := 'smoke.xfer2.a@example.com';
  owner_b text := 'smoke.xfer2.b@example.com';
  owner_c text := 'smoke.xfer2.c@example.com';
  raised boolean;
  hash1 text;
  hash2 text;
  idxdef text;
begin
  if to_regprocedure(
    'public.ownership_change_validate_owners(bigint,jsonb)'
  ) is null then
    raise exception 'smoke2: PKG-XFER core not applied';
  end if;

  -- Fixtures (rolled back)
  insert into public.properties (
    apartment_number, floor, ideal_parts_percent, ownership_type, owner_email, owner_name
  ) values (apt, floor_n, ideal, 'sole', owner_a, 'Smoke Xfer2 A')
  returning id into prop_id;

  perform public.property_book_set_mutating(true);
  insert into public.property_registry_people (
    property_id, relation_type, entity_kind, first_name, last_name, email,
    ownership_share_percent, ideal_parts_percent
  ) values (
    prop_id, 'owner', 'natural_person', 'Alice', 'Owner', owner_a, 100, ideal
  );
  perform public.property_book_set_mutating(false);

  -- S2-DB-01 valid roster
  begin
    perform public.ownership_change_validate_owners(
      prop_id,
      jsonb_build_array(jsonb_build_object(
        'entity_kind', 'natural_person',
        'first_name', 'Bob', 'last_name', 'Buyer', 'email', owner_b,
        'ownership_share_percent', 100, 'ideal_parts_percent', ideal
      ))
    );
    perform pg_temp.xfer2_mark('S2-DB-01_valid_1to1_roster', 'PASS');
  exception when others then
    perform pg_temp.xfer2_mark('S2-DB-01_valid_1to1_roster', 'FAIL', sqlerrm);
  end;

  -- S2-DB-02 share total mismatch
  raised := false;
  begin
    perform public.ownership_change_validate_owners(
      prop_id,
      jsonb_build_array(
        jsonb_build_object(
          'entity_kind', 'natural_person',
          'first_name', 'A', 'last_name', 'A', 'email', owner_b,
          'ownership_share_percent', 50, 'ideal_parts_percent', round(ideal * 0.5, 6)
        ),
        jsonb_build_object(
          'entity_kind', 'natural_person',
          'first_name', 'B', 'last_name', 'B', 'email', owner_c,
          'ownership_share_percent', 40, 'ideal_parts_percent', round(ideal * 0.5, 6)
        )
      )
    );
  exception when others then
    raised := true;
  end;
  perform pg_temp.xfer2_mark(
    'S2-DB-02_share_total_mismatch',
    case when raised then 'PASS' else 'FAIL' end,
    case when raised then null else 'expected rejection' end
  );

  -- S2-DB-03 ideal parts mismatch
  raised := false;
  begin
    perform public.ownership_change_validate_owners(
      prop_id,
      jsonb_build_array(jsonb_build_object(
        'entity_kind', 'natural_person',
        'first_name', 'Bad', 'last_name', 'Ideal', 'email', owner_b,
        'ownership_share_percent', 100, 'ideal_parts_percent', ideal + 1
      ))
    );
  exception when others then
    raised := true;
  end;
  perform pg_temp.xfer2_mark(
    'S2-DB-03_ideal_parts_mismatch',
    case when raised then 'PASS' else 'FAIL' end
  );

  -- S2-DB-04 1→many valid roster
  begin
    perform public.ownership_change_validate_owners(
      prop_id,
      jsonb_build_array(
        jsonb_build_object(
          'entity_kind', 'natural_person',
          'first_name', 'Bob', 'last_name', 'Buyer', 'email', owner_b,
          'ownership_share_percent', 60, 'ideal_parts_percent', round(ideal * 0.6, 6)
        ),
        jsonb_build_object(
          'entity_kind', 'natural_person',
          'first_name', 'Carol', 'last_name', 'Co', 'email', owner_c,
          'ownership_share_percent', 40, 'ideal_parts_percent', round(ideal * 0.4, 6)
        )
      )
    );
    perform pg_temp.xfer2_mark('S2-DB-04_valid_1_to_many', 'PASS');
  exception when others then
    perform pg_temp.xfer2_mark('S2-DB-04_valid_1_to_many', 'FAIL', sqlerrm);
  end;

  -- S2-DB-05 one-pending unique index (catalog only — no owner_transfers DML)
  select indexdef into idxdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'owner_transfers'
    and indexname = 'owner_transfers_one_pending_per_property_uidx';

  perform pg_temp.xfer2_mark(
    'S2-DB-05_one_pending_unique_index',
    case when idxdef is not null
          and idxdef ilike '%unique%'
          and idxdef ilike '%property_id%'
          and idxdef ilike '%ожидает%'
      then 'PASS' else 'FAIL' end,
    coalesce(left(idxdef, 200), 'index missing')
  );

  -- S2-DB-06 roster hash changes on material Book fields
  -- Hash inputs: owner id, email, ownership_share_percent, ideal_parts_percent, admin_status
  -- (first_name / display name intentionally excluded — do not mutate those here)
  hash1 := public.ownership_change_roster_hash(prop_id);
  perform public.property_book_set_mutating(true);
  update public.property_registry_people
     set email = 'smoke.xfer2.a.mutated@example.com',
         ownership_share_percent = 99.000000,
         admin_status = 'pending_inheritance'
   where property_id = prop_id
     and relation_type = 'owner'
     and deregistered_at is null;
  perform public.property_book_set_mutating(false);
  hash2 := public.ownership_change_roster_hash(prop_id);
  perform pg_temp.xfer2_mark(
    'S2-DB-06_roster_hash_changes',
    case when hash1 is distinct from hash2 then 'PASS' else 'FAIL' end,
    case when hash1 is distinct from hash2
      then 'material email/share/admin_status change detected'
      else format('hash unchanged after material mutate (hash=%s)', hash1)
    end
  );

  -- S2-DB-07 corrects_transfer_id column + FK (catalog only — no transfer DML)
  perform pg_temp.xfer2_mark(
    'S2-DB-07_corrects_transfer_id_schema',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'owner_transfers'
        and column_name = 'corrects_transfer_id'
        and data_type = 'bigint'
    ) and exists (
      select 1
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public'
        and rel.relname = 'owner_transfers'
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid) ilike '%corrects_transfer_id%'
    ) then 'PASS' else 'FAIL' end
  );

  -- S2-DB-08 insert trigger rejects unauthenticated (negative; no bypass)
  raised := false;
  begin
    insert into public.owner_transfers (
      property_id, from_owner_name, from_owner_email, to_owner_name, to_owner_email,
      status, change_kind, initiated_by, baseline_owners, target_owners, baseline_roster_hash
    ) values (
      prop_id, 'Alice Owner', owner_a, 'Bob Buyer', owner_b,
      'ожидает', 'ordinary', 'owner',
      '[]'::jsonb, '[]'::jsonb, 'hash-auth-boundary'
    );
  exception when others then
    raised := sqlstate = '28000' or sqlerrm ilike '%not authenticated%';
  end;
  perform pg_temp.xfer2_mark(
    'S2-DB-08_insert_requires_auth',
    case when raised then 'PASS' else 'FAIL' end,
    case when raised then null else 'expected 28000 from enforce_owner_transfer_insert' end
  );

  -- Auth-gated coverage deferred (real sessions — not PASS)
  perform pg_temp.xfer2_mark('S2-AUTH-01_owner_submit_1to1', 'SKIPPED', 'session plan A1; needs real owner session');
  perform pg_temp.xfer2_mark(
    'S2-AUTH-02_duplicate_pending_rpc',
    'SKIPPED',
    'session plan A8; catalog index = S2-DB-05; needs real owner session'
  );
  perform pg_temp.xfer2_mark('S2-AUTH-03_cancel_own_pending', 'SKIPPED', 'session plan A1; needs real owner session');
  perform pg_temp.xfer2_mark('S2-AUTH-04_admin_approve_reject', 'SKIPPED', 'session plan A6/A7; needs real admin session');
  perform pg_temp.xfer2_mark('S2-AUTH-05_stale_baseline_approve', 'SKIPPED', 'session plan A9; needs real admin session');
  perform pg_temp.xfer2_mark('S2-AUTH-06_former_owner_owns_property', 'SKIPPED', 'session plan X1; needs real sessions');
  perform pg_temp.xfer2_mark('S2-AUTH-07_direct_status_update_as_owner', 'SKIPPED', 'needs authenticated SET ROLE / owner session');
  perform pg_temp.xfer2_mark('S2-AUTH-08_approve_without_docs', 'SKIPPED', 'session plan A6 gate; needs real admin session');
  perform pg_temp.xfer2_mark(
    'S2-AUTH-09_linked_correction_behavior',
    'SKIPPED',
    'session plan A10/A11; schema = S2-DB-07; needs real admin session'
  );

  -- Defer final raise until after result SELECT (see below) so assertion IDs are visible.
end;
$body$;

-- Emit every assertion id/status before any final failure RAISE.
select check_id, status, detail from pg_temp.xfer2_results order by check_id;

do $assert$
declare
  n_fail integer;
  fail_ids text;
begin
  select count(*)::integer,
         string_agg(check_id, ', ' order by check_id)
    into n_fail, fail_ids
  from pg_temp.xfer2_results
  where status = 'FAIL';

  if n_fail > 0 then
    raise exception 'smoke2: % FAIL check(s): %', n_fail, coalesce(fail_ids, '(unknown)');
  end if;
end;
$assert$;

rollback;
