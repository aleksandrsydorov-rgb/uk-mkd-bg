-- =============================================================================
-- AMADEUS 11 - Support Fee Tariff Core VERIFY (READ-ONLY)
-- =============================================================================
-- Safe: SELECT / catalog introspection only. No DDL/DML.
-- FAIL rows sort first.
-- All fragile text uses dollar-quoting for paste-safe SQL Editor runs.
-- =============================================================================

with sofia_today as (
  select (now() at time zone $tz$Europe/Sofia$tz$)::date as d
),
fn as (
  select
    to_regprocedure($sig$public.resolve_support_tariff_for_year(integer)$sig$) as resolve_year,
    to_regprocedure($sig$public.get_applicable_support_tariff(integer)$sig$) as get_applicable,
    to_regprocedure($sig$public.support_fee_base_amount(bigint)$sig$) as base_amount,
    to_regprocedure($sig$public.support_fee_base_amount_for_year(bigint,integer)$sig$) as base_amount_year,
    to_regprocedure($sig$public.finalize_support_fee_assessment(bigint,integer)$sig$) as finalize_one,
    to_regprocedure($sig$public.charge_support_fee(bigint,text)$sig$) as charge_one,
    to_regprocedure($sig$public.set_support_rate_eur_per_sqm_year(numeric)$sig$) as legacy_setter,
    to_regprocedure($sig$public.tariff_version_bound_to_support_usage(uuid)$sig$) as binding_fn
),
checks as (
  select $t$catalog$t$::text as check_type, $t$support_fee_catalog$t$::text as item,
    case when exists (
      select 1 from public.tariff_catalog
      where tariff_key = $t$support_fee$t$ and active is true
        and unit_code = $t$m2$t$ and application_basis = $t$billing_year$t$
    ) then $t$OK$t$ else $t$FAIL$t$ end as result,
    '{}'::jsonb as detail

  union all
  select $t$rpc$t$, $t$resolve_support_tariff_for_year$t$,
    case when (select resolve_year from fn) is not null
      then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb
  union all
  select $t$rpc$t$, $t$get_applicable_support_tariff$t$,
    case when (select get_applicable from fn) is not null
      then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb
  union all
  select $t$rpc$t$, $t$support_fee_base_amount_for_year$t$,
    case when (select base_amount_year from fn) is not null
      then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb
  union all
  select $t$rpc$t$, $t$finalize_support_fee_assessment$t$,
    case when (select finalize_one from fn) is not null
      then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb

  union all
  select $t$schema$t$, $t$assessments.tariff_version_id$t$,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = $t$public$t$ and table_name = $t$support_fee_assessments$t$
        and column_name = $t$tariff_version_id$t$
    ) then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb
  union all
  select $t$schema$t$, $t$assessments.area_sqm_snapshot$t$,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = $t$public$t$ and table_name = $t$support_fee_assessments$t$
        and column_name = $t$area_sqm_snapshot$t$
    ) then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb
  union all
  select $t$schema$t$, $t$assessments.rate_eur_per_sqm_year_snapshot$t$,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = $t$public$t$ and table_name = $t$support_fee_assessments$t$
        and column_name = $t$rate_eur_per_sqm_year_snapshot$t$
    ) then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb

  union all
  select $t$schema$t$, $t$assessments.tariff_version_fk$t$,
    case when exists (
      select 1 from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
      where tc.table_schema = $t$public$t$
        and tc.table_name = $t$support_fee_assessments$t$
        and tc.constraint_type = $t$FOREIGN KEY$t$
        and kcu.column_name = $t$tariff_version_id$t$
    ) then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb

  union all
  select $t$data$t$, $t$support_versions_jan1$t$,
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = $t$support_fee$t$
        and tv.status = $t$published$t$
        and (extract(month from tv.valid_from)::int <> 1
             or extract(day from tv.valid_from)::int <> 1)
    ) then $t$FAIL$t$ else $t$OK$t$ end, '{}'::jsonb

  union all
  select $t$data$t$, $t$at_least_one_published_support$t$,
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = $t$support_fee$t$ and tv.status = $t$published$t$
    ) then $t$OK$t$ else $t$FAIL$t$ end, '{}'::jsonb

  union all
  select $t$data$t$, $t$baseline_2026_exists$t$,
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      join public.tariff_rate_items as ri
        on ri.version_id = tv.id and ri.component_key = $t$base$t$
      where c.tariff_key = $t$support_fee$t$
        and tv.status = $t$published$t$
        and tv.valid_from = date $d$2026-01-01$d$
        and ri.rate = 8.0000
    ) then $t$OK$t$ else $t$FAIL$t$ end,
    jsonb_build_object($t$expected$t$, $n$published 2026-01-01 base=8.0000$n$)

  union all
  select $t$data$t$, $t$resolve_2026_is_8$t$,
    case
      when (select resolve_year from fn) is null then $t$FAIL$t$
      when (
        select r.rate = 8.0000 and r.valid_from = date $d$2026-01-01$d$
        from public.resolve_support_tariff_for_year(2026) as r
        limit 1
      ) then $t$OK$t$
      else $t$FAIL$t$
    end, '{}'::jsonb

  union all
  select $t$data$t$, $t$applicable_current_year_uses_2026_baseline$t$,
    case
      when extract(year from (now() at time zone $tz$Europe/Sofia$tz$))::integer <> 2026
        then $t$INFO$t$
      when (
        select r.rate = 8.0000 and r.valid_from = date $d$2026-01-01$d$
        from public.resolve_support_tariff_for_year(
          extract(year from (now() at time zone $tz$Europe/Sofia$tz$))::integer
        ) as r
        limit 1
      ) then $t$OK$t$
      else $t$FAIL$t$
    end,
    jsonb_build_object(
      $t$note$t$, $n$When Sofia year is 2026, applicable rate must be the cutover baseline$n$
    )

  union all
  select $t$data$t$, $t$duplicate_published_valid_from$t$,
    case when exists (
      select 1
      from public.tariff_versions as tv
      join public.tariff_catalog as c on c.id = tv.tariff_id
      where c.tariff_key = $t$support_fee$t$ and tv.status = $t$published$t$
      group by tv.tariff_id, tv.valid_from
      having count(*) > 1
    ) then $t$FAIL$t$ else $t$OK$t$ end, '{}'::jsonb

  union all
  select $t$data$t$, $t$assessment_duplicate_property_year$t$,
    case when exists (
      select 1 from public.support_fee_assessments
      group by property_id, billing_year
      having count(*) > 1
    ) then $t$FAIL$t$ else $t$OK$t$ end, '{}'::jsonb

  union all
  select $t$data$t$, $t$incomplete_new_snapshots$t$,
    case when exists (
      select 1 from public.support_fee_assessments
      where (
        (tariff_version_id is null)
        <> (area_sqm_snapshot is null)
      ) or (
        (tariff_version_id is null)
        <> (rate_eur_per_sqm_year_snapshot is null)
      )
    ) then $t$FAIL$t$ else $t$OK$t$ end,
    jsonb_build_object($t$note$t$, $n$partial snapshot rows violate all-or-nothing rule$n$)

  union all
  select $t$data$t$, $t$orphan_tariff_version_id$t$,
    case when exists (
      select 1 from public.support_fee_assessments as a
      where a.tariff_version_id is not null
        and not exists (
          select 1 from public.tariff_versions as tv where tv.id = a.tariff_version_id
        )
    ) then $t$FAIL$t$ else $t$OK$t$ end, '{}'::jsonb

  union all
  select $t$data$t$, $t$snapshot_base_inconsistency$t$,
    case when exists (
      select 1 from public.support_fee_assessments as a
      where a.tariff_version_id is not null
        and a.base_amount is distinct from
            round(a.area_sqm_snapshot * a.rate_eur_per_sqm_year_snapshot, 2)
    ) then $t$FAIL$t$ else $t$OK$t$ end, '{}'::jsonb

  union all
  select $t$fn_body$t$, $t$legacy_setter_blocked$t$,
    case
      when (select legacy_setter from fn) is null then $t$FAIL$t$
      when pg_get_functiondef((select legacy_setter from fn))
           ilike $p$%Legacy Support Fee tariff publication disabled%$p$
        then $t$OK$t$
      else $t$FAIL$t$
    end, '{}'::jsonb

  union all
  select $t$fn_body$t$, $t$base_amount_no_building_settings$t$,
    case
      when (select base_amount from fn) is null
        or (select base_amount_year from fn) is null then $t$FAIL$t$
      when pg_get_functiondef((select base_amount from fn))
           ilike $p$%building_settings%$p$
        then $t$FAIL$t$
      when pg_get_functiondef((select base_amount_year from fn))
           ilike $p$%resolve_support_tariff_for_year%$p$
        then $t$OK$t$
      else $t$FAIL$t$
    end, '{}'::jsonb

  union all
  select $t$fn_body$t$, $t$finalize_uses_core_snapshot$t$,
    case
      when (select finalize_one from fn) is null then $t$FAIL$t$
      when pg_get_functiondef((select finalize_one from fn))
           ilike $p$%tariff_version_id%$p$
           and pg_get_functiondef((select finalize_one from fn))
               ilike $p$%resolve_support_tariff_for_year%$p$
           and pg_get_functiondef((select finalize_one from fn))
               not ilike $p$%building_settings%$p$
        then $t$OK$t$
      else $t$FAIL$t$
    end, '{}'::jsonb

  union all
  select $t$fn_body$t$, $t$binding_not_stub$t$,
    case
      when (select binding_fn from fn) is null then $t$FAIL$t$
      when pg_get_functiondef((select binding_fn from fn))
           ilike $p$%support_fee_assessments%$p$
        then $t$OK$t$
      when pg_get_functiondef((select binding_fn from fn))
           ~* $p$return false;[[:space:]]*end$p$
        then $t$FAIL$t$
      else $t$INFO$t$
    end, '{}'::jsonb

  union all
  select $t$fn_body$t$, $t$charge_delegates_to_finalize$t$,
    case
      when (select charge_one from fn) is null then $t$FAIL$t$
      when pg_get_functiondef((select charge_one from fn))
           ilike $p$%finalize_support_fee_assessment%$p$
           and pg_get_functiondef((select charge_one from fn))
               not ilike $p$%building_settings%$p$
           and pg_get_functiondef((select charge_one from fn))
               !~* $p$insert into public\.support_fee_ledger$p$
        then $t$OK$t$
      else $t$FAIL$t$
    end,
    jsonb_build_object($t$note$t$, $n$charge_support_fee must not own an independent ledger engine$n$)

  union all
  select $t$fn_body$t$, $t$finalize_no_ordinary_bypass$t$,
    case
      when (select finalize_one from fn) is null then $t$FAIL$t$
      when pg_get_functiondef((select finalize_one from fn))
           ilike $p$%policy_disabled_use_ordinary_charge%$p$
        then $t$FAIL$t$
      when pg_get_functiondef((select finalize_one from fn))
           ilike $p$%pricing_rule%$p$
           and pg_get_functiondef((select finalize_one from fn))
               ilike $p$%standard%$p$
           and pg_get_functiondef((select finalize_one from fn))
               ilike $p$%policy_disabled%$p$
        then $t$OK$t$
      else $t$FAIL$t$
    end,
    jsonb_build_object($t$note$t$, $n$no-policy years must create standard assessments$n$)

  union all
  select $t$data$t$, $t$standard_rows_complete_snapshot$t$,
    case when exists (
      select 1 from public.support_fee_assessments as a
      where a.pricing_rule = $t$standard$t$
        and (
          a.tariff_version_id is null
          or a.area_sqm_snapshot is null
          or a.rate_eur_per_sqm_year_snapshot is null
        )
    ) then $t$FAIL$t$ else $t$OK$t$ end,
    jsonb_build_object($t$note$t$, $n$standard assessments may have policy_id null but must have Core snapshot$n$)

  union all
  select $t$data$t$, $t$post_cutover_incomplete_snapshots$t$,
    case when exists (
      select 1 from public.support_fee_assessments as a
      where a.finalized_at is not null
        and a.tariff_version_id is not null
        and (
          a.area_sqm_snapshot is null
          or a.rate_eur_per_sqm_year_snapshot is null
          or a.base_amount is distinct from
             round(a.area_sqm_snapshot * a.rate_eur_per_sqm_year_snapshot, 2)
        )
    ) then $t$FAIL$t$ else $t$OK$t$ end, '{}'::jsonb

  union all
  select $t$priv$t$, $t$get_applicable_support_tariff_grant$t$,
    case
      when (select get_applicable from fn) is null then $t$FAIL$t$
      when has_function_privilege(
        $t$authenticated$t$,
        (select get_applicable from fn),
        $t$execute$t$
      ) then $t$OK$t$
      else $t$FAIL$t$
    end, '{}'::jsonb

  union all
  select $t$priv$t$, $t$resolve_support_tariff_for_year_internal$t$,
    case
      when (select resolve_year from fn) is null then $t$FAIL$t$
      when has_function_privilege(
        $t$authenticated$t$,
        (select resolve_year from fn),
        $t$execute$t$
      ) then $t$FAIL$t$
      else $t$OK$t$
    end,
    jsonb_build_object($t$note$t$, $n$internal resolver must not be granted to authenticated$n$)
)
select check_type, item, result, detail
from checks
order by
  case result when $t$FAIL$t$ then 0 when $t$INFO$t$ then 1 else 2 end,
  check_type,
  item;
