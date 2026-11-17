-- R1-RC8: capital_repair first-run tariff basis — rates + basis_type only.
-- Drop required document number / date / note / decision_id for capital_repair prep and activation publish.
-- Do not invent fake decision IDs or document references; note is derived from basis label when empty.

CREATE OR REPLACE FUNCTION public.first_run_tariff_prep_ok(p_key text, p_item jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_rate numeric;
  v_legal numeric;
  v_day numeric;
  v_night numeric;
  v_basis text;
  v_note text;
  v_ref text;
  v_decision text;
  v_date date;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    return false;
  end if;
  begin
    v_basis := lower(btrim(coalesce(p_item ->> 'basis_type', '')));
    v_note := btrim(coalesce(p_item ->> 'basis_note', ''));
    v_ref := nullif(btrim(coalesce(p_item ->> 'basis_reference', '')), '');
    v_decision := nullif(btrim(coalesce(p_item ->> 'decision_id', '')), '');
    if nullif(btrim(coalesce(p_item ->> 'basis_date', '')), '') is null then
      v_date := null;
    else
      v_date := (p_item ->> 'basis_date')::date;
    end if;
    if v_key = 'support_fee' then
      v_rate := (p_item ->> 'rate_natural')::numeric;
      v_legal := coalesce((p_item ->> 'rate_legal')::numeric, v_rate);
      return v_rate > 0
        and v_legal > 0
        and v_basis in ('external_decision', 'general_meeting');
    elsif v_key = 'capital_repair' then
      -- Rates + basis_type only (document number/date/note/decision no longer required).
      v_rate := (p_item ->> 'rate_natural')::numeric;
      v_legal := coalesce((p_item ->> 'rate_legal')::numeric, v_rate);
      return v_rate > 0
        and v_legal > 0
        and v_basis in ('external_decision', 'general_meeting');
    elsif v_key = 'water' then
      v_rate := (p_item ->> 'rate')::numeric;
      return v_rate is not null
        and v_rate >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other');
    elsif v_key = 'electricity' then
      v_day := (p_item ->> 'day')::numeric;
      v_night := (p_item ->> 'night')::numeric;
      return v_day is not null
        and v_night is not null
        and v_day >= 0
        and v_night >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other');
    elsif v_key = 'internet' then
      v_rate := (p_item ->> 'package_30')::numeric;
      v_day := (p_item ->> 'day')::numeric;
      return v_rate >= 0
        and v_day >= 0
        and v_basis in ('supplier_notice', 'invoice', 'other')
        and v_ref is not null
        and v_note <> '';
    end if;
  exception
    when others then
      return false;
  end;
  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.first_run_publish_activation_tariffs(p_installation_id uuid, p_activated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inst public.platform_installations%rowtype;
  v_at timestamptz := coalesce(p_activated_at, now());
  v_date date := (coalesce(p_activated_at, now()) at time zone 'Europe/Sofia')::date;
  v_year integer := extract(year from (coalesce(p_activated_at, now()) at time zone 'Europe/Sofia'))::integer;
  v_selected jsonb;
  v_keys text[];
  v_key text;
  v_item jsonb;
  v_cat public.tariff_catalog%rowtype;
  v_cover uuid;
  v_cover_from date;
  v_natural jsonb;
  v_legal jsonb;
  v_rate numeric;
  v_legal_rate numeric;
  v_day numeric;
  v_night numeric;
  v_basis text;
  v_note text;
  v_ref text;
  v_decision uuid;
  v_basis_date date;
  v_fingerprint text;
  v_existing public.tariff_versions%rowtype;
  v_idem uuid;
  v_version_id uuid;
  v_match boolean;
  v_component text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id
  for update;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  if v_inst.first_run_status = 'complete' then
    return;
  end if;

  select coalesce(v_inst.first_run_draft -> 'meters_selected', '[]'::jsonb) into v_selected;
  v_keys := array['support_fee', 'capital_repair'];
  if exists (
    select 1 from jsonb_array_elements_text(v_selected) as t(v) where lower(btrim(t.v)) = 'water'
  ) then
    v_keys := v_keys || array['water'];
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_selected) as t(v)
    where lower(btrim(t.v)) in ('electricity', 'electric')
  ) then
    v_keys := v_keys || array['electricity'];
  end if;
  if public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    v_keys := v_keys || array['internet'];
  end if;

  foreach v_key in array v_keys loop
    v_item := coalesce(v_inst.first_run_draft, '{}'::jsonb) -> 'tariff_prep' -> v_key;
    select c.* into v_cat
    from public.tariff_catalog as c
    where c.tariff_key = v_key
      and c.active is true;
    if not found then
      raise exception 'first_run: tariff catalog missing %', v_key using errcode = 'P0001';
    end if;

    v_cover := null;
    if v_key in ('support_fee', 'capital_repair') then
      v_cover := public.tariff_version_for_billing_year(v_cat.id, v_year);
    else
      select tv.id
        into v_cover
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.status = 'published'
        and tv.cancelled_at is null
        and tv.valid_from <= v_date
      order by tv.valid_from desc, tv.id desc
      limit 1;
    end if;

    if v_cover is not null then
      select tv.valid_from into v_cover_from
      from public.tariff_versions as tv
      where tv.id = v_cover;
      if v_cover_from > v_date then
        v_cover := null;
      end if;
    end if;

    if v_cover is not null and not public.first_run_tariff_prep_ok(v_key, v_item) then
      continue;
    end if;

    if not public.first_run_tariff_prep_ok(v_key, v_item) then
      raise exception 'first_run: tariff prep missing %', v_key using errcode = 'P0001';
    end if;

    v_basis := lower(btrim(v_item ->> 'basis_type'));
    v_note := btrim(v_item ->> 'basis_note');
    v_ref := nullif(btrim(coalesce(v_item ->> 'basis_reference', '')), '');
    if nullif(btrim(coalesce(v_item ->> 'decision_id', '')), '') is null then
      v_decision := null;
    else
      v_decision := (v_item ->> 'decision_id')::uuid;
    end if;
    if nullif(btrim(coalesce(v_item ->> 'basis_date', '')), '') is null then
      v_basis_date := null;
    else
      v_basis_date := (v_item ->> 'basis_date')::date;
    end if;

    -- Support fee first-run no longer collects document note/date/reference.
    if v_key = 'support_fee' and v_note = '' then
      v_note := case v_basis
        when 'general_meeting' then
          'Действующий тариф на основании решения собрания собственников'
        when 'external_decision' then
          'Внешний документ'
        else v_basis
      end;
    end if;

    -- Capital repair first-run: fixed GM basis; invent note from basis label (not a fake document).
    if v_key = 'capital_repair' and v_note = '' then
      v_note := case v_basis
        when 'general_meeting' then
          'Действующий тариф на основании решения собрания собственников'
        when 'external_decision' then
          'Внешний документ'
        else v_basis
      end;
    end if;

    -- Water first-run no longer collects document note/date/reference.
    if v_key = 'water' and v_note = '' then
      v_note := case v_basis
        when 'supplier_notice' then
          'Действующий тариф поставщика'
        when 'invoice' then
          'Счёт / фактура поставщика'
        when 'other' then
          'Иное основание тарифа воды'
        else v_basis
      end;
    end if;

    -- Electricity first-run no longer collects document note/date/reference.
    -- Persist a non-empty basis_note from the selected basis label (not a fake document).
    if v_key = 'electricity' and v_note = '' then
      v_note := case v_basis
        when 'supplier_notice' then
          'Действующий тариф поставщика'
        when 'invoice' then
          'Счёт / фактура поставщика'
        when 'other' then
          'Иное основание тарифа электроэнергии'
        else v_basis
      end;
    end if;

    if v_key in ('support_fee', 'capital_repair') then
      v_rate := (v_item ->> 'rate_natural')::numeric;
      v_legal_rate := coalesce((v_item ->> 'rate_legal')::numeric, v_rate);
      v_natural := jsonb_build_object('base', v_rate);
      v_legal := jsonb_build_object('base', v_legal_rate);
    elsif v_key = 'water' then
      v_rate := (v_item ->> 'rate')::numeric;
      v_natural := jsonb_build_object('base', v_rate);
      v_legal := v_natural;
    elsif v_key = 'internet' then
      v_rate := (v_item ->> 'package_30')::numeric;
      v_day := (v_item ->> 'day')::numeric;
      v_natural := jsonb_build_object('package_30', v_rate, 'day', v_day);
      v_legal := v_natural;
    else
      v_day := (v_item ->> 'day')::numeric;
      v_night := (v_item ->> 'night')::numeric;
      v_natural := jsonb_build_object('day', v_day, 'night', v_night);
      v_legal := v_natural;
    end if;

    if v_cover is not null then
      v_match := true;
      foreach v_component in array v_cat.component_keys loop
        if (
          select ri.rate
          from public.tariff_rate_items as ri
          where ri.version_id = v_cover
            and ri.component_key = v_component
            and ri.subject_kind = 'natural'
        ) is distinct from (v_natural ->> v_component)::numeric
        or (
          select ri.rate
          from public.tariff_rate_items as ri
          where ri.version_id = v_cover
            and ri.component_key = v_component
            and ri.subject_kind = 'legal'
        ) is distinct from (v_legal ->> v_component)::numeric then
          v_match := false;
        end if;
      end loop;
      if not v_match then
        raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
      end if;
      continue;
    end if;

    v_idem := public.first_run_activation_tariff_key(p_installation_id, v_key);
    v_fingerprint := md5(
      v_cat.id::text || '|' || v_date::text || '|' || v_basis || '|' ||
      coalesce(v_ref, '') || '|' || coalesce(v_basis_date::text, '') || '|' ||
      v_note || '|' || coalesce(v_decision::text, '') || '|' ||
      v_natural::text || '|' || v_legal::text
    );

    select tv.* into v_existing
    from public.tariff_versions as tv
    where tv.idempotency_key = v_idem;

    if found then
      if v_existing.payload_fingerprint is distinct from v_fingerprint then
        raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
      end if;
      continue;
    end if;

    if exists (
      select 1
      from public.tariff_versions as tv
      where tv.tariff_id = v_cat.id
        and tv.valid_from = v_date
        and tv.status = 'published'
        and tv.cancelled_at is null
    ) then
      raise exception 'first_run: tariff conflict %', v_key using errcode = 'P0001';
    end if;

    insert into public.tariff_versions (
      tariff_id, valid_from, status, basis_type, basis_reference, basis_date, basis_note,
      decision_id, published_at, published_by, idempotency_key, payload_fingerprint
    ) values (
      v_cat.id, v_date, 'published', v_basis, v_ref, v_basis_date, v_note,
      v_decision, v_at, auth.uid(), v_idem, v_fingerprint
    )
    returning id into v_version_id;

    insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
    select v_version_id, k, (v_natural ->> k)::numeric, 'natural'
    from unnest(v_cat.component_keys) as k;

    insert into public.tariff_rate_items (version_id, component_key, rate, subject_kind)
    select v_version_id, k, (v_legal ->> k)::numeric, 'legal'
    from unnest(v_cat.component_keys) as k;
  end loop;
end;
$function$;

revoke all on function public.first_run_tariff_prep_ok(text, jsonb) from public, anon;
grant execute on function public.first_run_tariff_prep_ok(text, jsonb) to authenticated;

revoke all on function public.first_run_publish_activation_tariffs(uuid, timestamptz) from public, anon;
grant execute on function public.first_run_publish_activation_tariffs(uuid, timestamptz) to authenticated, service_role;
