-- =============================================================================
-- R1-RC8 — Mandatory first-run wizard (complex card + progress + Book gates)
-- Additive only. Grandfather existing installations on upgrade (not by properties count).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- platform_installations: complex card + first-run status
-- ---------------------------------------------------------------------------

alter table public.platform_installations
  add column if not exists address text,
  add column if not exists apartment_count integer,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists first_run_status text,
  add column if not exists first_run_stage text,
  add column if not exists first_run_draft jsonb not null default '{}'::jsonb,
  add column if not exists first_run_completed_at timestamptz;

update public.platform_installations
set first_run_status = coalesce(nullif(btrim(first_run_status), ''), 'pending')
where first_run_status is null or btrim(first_run_status) = '';

update public.platform_installations
set first_run_stage = coalesce(nullif(btrim(first_run_stage), ''), 'welcome')
where first_run_stage is null or btrim(first_run_stage) = '';

do $chk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_installations_first_run_status_chk'
      and conrelid = 'public.platform_installations'::regclass
  ) then
    alter table public.platform_installations
      add constraint platform_installations_first_run_status_chk
      check (first_run_status in ('pending', 'in_progress', 'complete'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_installations_apartment_count_chk'
      and conrelid = 'public.platform_installations'::regclass
  ) then
    alter table public.platform_installations
      add constraint platform_installations_apartment_count_chk
      check (apartment_count is null or apartment_count > 0);
  end if;
end;
$chk$;

-- Extensible stage registry (future modules append rows; never delete history).
create table if not exists public.first_run_stage_catalog (
  stage_key text primary key,
  sort_order integer not null,
  required boolean not null default true,
  module_key text null,
  label_i18n_key text not null,
  created_at timestamptz not null default now()
);

alter table public.first_run_stage_catalog enable row level security;
revoke all on table public.first_run_stage_catalog from public, anon, authenticated;

insert into public.first_run_stage_catalog (stage_key, sort_order, required, module_key, label_i18n_key)
values
  ('welcome', 10, true, null, 'admin.firstRunStageWelcome'),
  ('complex_card', 20, true, null, 'admin.firstRunStageComplex'),
  ('property_book', 30, true, 'property_book', 'admin.firstRunStagePropertyBook'),
  ('meters_select', 40, true, null, 'admin.firstRunStageMetersSelect'),
  ('meters_water', 50, false, 'water', 'admin.firstRunStageMetersWater'),
  ('meters_electricity', 60, false, 'electricity', 'admin.firstRunStageMetersElectricity'),
  ('complete', 1000, true, null, 'admin.firstRunStageComplete')
on conflict (stage_key) do nothing;

create table if not exists public.first_run_stage_progress (
  installation_id uuid not null references public.platform_installations (id) on delete cascade,
  stage_key text not null references public.first_run_stage_catalog (stage_key),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'complete', 'skipped')),
  draft jsonb not null default '{}'::jsonb,
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  primary key (installation_id, stage_key)
);

alter table public.first_run_stage_progress enable row level security;
revoke all on table public.first_run_stage_progress from public, anon, authenticated;

-- Grandfather FULL prior setups on upgrade only:
-- property_book ACTIVE AND (water OR electricity) ACTIVE.
-- Partial (book-only / READY-only / meters without book) stays pending.
-- Not by properties count (count used only as optional apartment_count backfill).
update public.platform_installations as i
set
  first_run_status = 'complete',
  first_run_stage = 'complete',
  first_run_completed_at = coalesce(i.first_run_completed_at, now()),
  apartment_count = coalesce(
    i.apartment_count,
    nullif((select count(*)::integer from public.properties), 0)
  )
where coalesce(i.first_run_status, 'pending') <> 'complete'
  and exists (
    select 1 from public.module_lifecycle as ml
    where ml.installation_id = i.id
      and ml.module_key = 'property_book'
      and ml.state = 'ACTIVE'
  )
  and exists (
    select 1 from public.module_lifecycle as ml
    where ml.installation_id = i.id
      and ml.module_key in ('water', 'electricity')
      and ml.state = 'ACTIVE'
  );

insert into public.first_run_stage_progress (installation_id, stage_key, status, completed_at)
select i.id, c.stage_key, 'complete', now()
from public.platform_installations as i
cross join public.first_run_stage_catalog as c
where i.first_run_status = 'complete'
on conflict (installation_id, stage_key) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.first_run_default_installation_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select i.id
  from public.platform_installations as i
  where lower(btrim(i.installation_key)) = 'default'
  order by i.created_at
  limit 1;
$fn$;

revoke all on function public.first_run_default_installation_id() from public, anon;
grant execute on function public.first_run_default_installation_id() to authenticated;

create or replace function public.admin_get_first_run_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_stages jsonb := '[]'::jsonb;
begin
  perform public.admin_assert_module_setup();

  select * into v_inst
  from public.platform_installations as i
  where i.id = public.first_run_default_installation_id();

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'installation_missing',
      'first_run_status', 'pending',
      'first_run_stage', 'welcome',
      'gate_required', true
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'stage_key', c.stage_key,
      'sort_order', c.sort_order,
      'required', c.required,
      'module_key', c.module_key,
      'label_i18n_key', c.label_i18n_key,
      'status', coalesce(p.status, 'pending'),
      'draft', coalesce(p.draft, '{}'::jsonb),
      'completed_at', p.completed_at
    )
    order by c.sort_order
  ), '[]'::jsonb)
  into v_stages
  from public.first_run_stage_catalog as c
  left join public.first_run_stage_progress as p
    on p.installation_id = v_inst.id
   and p.stage_key = c.stage_key;

  return jsonb_build_object(
    'ok', true,
    'installation_id', v_inst.id,
    'first_run_status', coalesce(v_inst.first_run_status, 'pending'),
    'first_run_stage', coalesce(v_inst.first_run_stage, 'welcome'),
    'gate_required', coalesce(v_inst.first_run_status, 'pending') <> 'complete',
    'complex', jsonb_build_object(
      'display_name', coalesce(v_inst.display_name, v_inst.complex_name),
      'complex_name', v_inst.complex_name,
      'address', v_inst.address,
      'apartment_count', v_inst.apartment_count,
      'contact_phone', v_inst.contact_phone,
      'contact_email', v_inst.contact_email
    ),
    'draft', coalesce(v_inst.first_run_draft, '{}'::jsonb),
    'stages', v_stages,
    'completed_at', v_inst.first_run_completed_at
  );
end;
$fn$;

revoke all on function public.admin_get_first_run_state() from public, anon;
grant execute on function public.admin_get_first_run_state() to authenticated;

create or replace function public.admin_save_first_run_progress(
  p_stage text,
  p_draft jsonb default '{}'::jsonb,
  p_complex jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_stage text;
  v_name text;
  v_address text;
  v_count integer;
  v_phone text;
  v_email text;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null then
    raise exception 'first_run: stage required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.first_run_stage_catalog as c where c.stage_key = v_stage
  ) then
    raise exception 'first_run: unknown stage %', v_stage using errcode = '22023';
  end if;

  if p_complex is not null then
    v_name := nullif(btrim(coalesce(p_complex ->> 'display_name', p_complex ->> 'complex_name', '')), '');
    v_address := nullif(btrim(coalesce(p_complex ->> 'address', '')), '');
    begin
      v_count := nullif(btrim(coalesce(p_complex ->> 'apartment_count', '')), '')::integer;
    exception when others then
      raise exception 'first_run: apartment_count invalid' using errcode = '22023';
    end;
    v_phone := nullif(btrim(coalesce(p_complex ->> 'contact_phone', '')), '');
    v_email := nullif(btrim(coalesce(p_complex ->> 'contact_email', '')), '');

    if v_name is null then
      raise exception 'first_run: complex name required' using errcode = '22023';
    end if;
    if v_address is null then
      raise exception 'first_run: address required' using errcode = '22023';
    end if;
    if v_count is null or v_count <= 0 then
      raise exception 'first_run: apartment_count required' using errcode = '22023';
    end if;

    update public.platform_installations as i
    set
      display_name = v_name,
      complex_name = coalesce(v_name, i.complex_name),
      address = v_address,
      apartment_count = v_count,
      contact_phone = v_phone,
      contact_email = v_email,
      updated_at = now()
    where i.id = v_id;
  end if;

  update public.platform_installations as i
  set
    first_run_status = case
      when i.first_run_status = 'complete' then 'complete'
      else 'in_progress'
    end,
    first_run_stage = case
      when i.first_run_status = 'complete' then i.first_run_stage
      else v_stage
    end,
    first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb)
      || coalesce(p_draft, '{}'::jsonb)
      || jsonb_build_object('current_stage', v_stage),
    updated_at = now()
  where i.id = v_id
    and i.first_run_status is distinct from 'complete';

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, updated_at, updated_by
  )
  values (
    v_id,
    v_stage,
    'in_progress',
    coalesce(p_draft, '{}'::jsonb),
    now(),
    auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = case
      when p.status = 'complete' then p.status
      else 'in_progress'
    end,
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    updated_at = now(),
    updated_by = auth.uid();

  return public.admin_get_first_run_state();
end;
$fn$;

revoke all on function public.admin_save_first_run_progress(text, jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_first_run_progress(text, jsonb, jsonb) to authenticated;

create or replace function public.admin_complete_first_run_stage(
  p_stage text,
  p_next_stage text default null,
  p_draft jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_stage text;
  v_next text;
  v_selected jsonb;
  v_need_water boolean := false;
  v_need_elec boolean := false;
begin
  perform public.admin_assert_module_setup();
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is null
     or not exists (select 1 from public.first_run_stage_catalog c where c.stage_key = v_stage) then
    raise exception 'first_run: unknown stage' using errcode = '22023';
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
  )
  values (
    v_id, v_stage, 'complete', coalesce(p_draft, '{}'::jsonb), now(), now(), auth.uid()
  )
  on conflict (installation_id, stage_key) do update
  set
    status = 'complete',
    draft = coalesce(p.draft, '{}'::jsonb) || coalesce(excluded.draft, '{}'::jsonb),
    completed_at = coalesce(p.completed_at, now()),
    updated_at = now(),
    updated_by = auth.uid();

  v_next := nullif(btrim(coalesce(p_next_stage, '')), '');

  if v_stage = 'meters_select' then
    select coalesce(i.first_run_draft -> 'meters_selected', p_draft -> 'meters_selected', '[]'::jsonb)
    into v_selected
    from public.platform_installations as i
    where i.id = v_id;

    v_need_water := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) = 'water'
    );
    v_need_elec := exists (
      select 1 from jsonb_array_elements_text(coalesce(v_selected, '[]'::jsonb)) as t(v)
      where lower(btrim(t.v)) in ('electricity', 'electric')
    );

    if not v_need_water and not v_need_elec then
      raise exception 'first_run: at least one meter utility required' using errcode = '22023';
    end if;

    if not v_need_water then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_water', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
    end if;
    if not v_need_elec then
      insert into public.first_run_stage_progress as p (
        installation_id, stage_key, status, draft, completed_at, updated_at, updated_by
      ) values (v_id, 'meters_electricity', 'skipped', '{}'::jsonb, now(), now(), auth.uid())
      on conflict (installation_id, stage_key) do update
      set status = 'skipped', completed_at = coalesce(p.completed_at, now()), updated_at = now();
    end if;

    if v_next is null then
      v_next := case
        when v_need_water then 'meters_water'
        when v_need_elec then 'meters_electricity'
        else 'complete'
      end;
    end if;
  end if;

  if v_stage = 'meters_water' and v_next is null then
    select exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'skipped'
    ) into v_need_elec;
    -- if electricity not skipped and not complete, go there
    if exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'skipped'
    ) then
      v_next := 'complete';
    elsif exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = v_id and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      v_next := 'complete';
    else
      v_next := 'meters_electricity';
    end if;
  end if;

  if v_stage = 'meters_electricity' and v_next is null then
    v_next := 'complete';
  end if;

  if v_stage = 'complete' or v_next = 'complete' then
    update public.platform_installations as i
    set
      first_run_status = 'complete',
      first_run_stage = 'complete',
      first_run_completed_at = coalesce(i.first_run_completed_at, now()),
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
      updated_at = now()
    where i.id = v_id;

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, completed_at, updated_at, updated_by
    ) values (v_id, 'complete', 'complete', now(), now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set status = 'complete', completed_at = coalesce(p.completed_at, now()), updated_at = now();
  elsif v_next is not null then
    update public.platform_installations as i
    set
      first_run_status = case when i.first_run_status = 'complete' then 'complete' else 'in_progress' end,
      first_run_stage = case when i.first_run_status = 'complete' then i.first_run_stage else v_next end,
      first_run_draft = coalesce(i.first_run_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb),
      updated_at = now()
    where i.id = v_id
      and i.first_run_status is distinct from 'complete';

    insert into public.first_run_stage_progress as p (
      installation_id, stage_key, status, updated_at, updated_by
    ) values (v_id, v_next, 'in_progress', now(), auth.uid())
    on conflict (installation_id, stage_key) do update
    set
      status = case when p.status in ('complete', 'skipped') then p.status else 'in_progress' end,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  return public.admin_get_first_run_state();
end;
$fn$;

revoke all on function public.admin_complete_first_run_stage(text, text, jsonb) from public, anon;
grant execute on function public.admin_complete_first_run_stage(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Property Book import: empty-book auto-create, apartment_count match,
-- idempotent confirm (identical existing rows → no-op success).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_import_property_book(p_objects jsonb, p_owners jsonb, p_dry_run boolean DEFAULT true, p_allow_create_missing boolean DEFAULT false, p_allow_overwrite boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obj jsonb;
  v_own jsonb;
  v_apt text;
  v_apt_num bigint;
  v_prop_id bigint;
  v_errors jsonb := '[]'::jsonb;
  v_existing jsonb := '[]'::jsonb;
  v_new_props jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_touched bigint[] := array[]::bigint[];
  v_created bigint[] := array[]::bigint[];
  v_skipped_identical bigint[] := array[]::bigint[];
  v_owners_by_apt jsonb := '{}'::jsonb;
  v_list jsonb;
  v_validation jsonb;
  v_ok_count integer := 0;
  v_purpose text;
  v_area numeric;
  v_ideal numeric;
  v_own_type text;
  v_floor bigint;
  v_section text;
  v_block text;
  v_seen_apts text[] := array[]::text[];
  v_prop public.properties%rowtype;
  v_would_create boolean;
  v_would_change boolean;
  v_identical boolean;
  v_owner_count int;
  v_allow_create boolean;
  v_expected_count integer;
  v_unique_count integer;
  v_book_empty boolean;
begin
  perform public.admin_assert_book_admin();
  perform public.property_book_set_mutating(true);

  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'admin_import_property_book: objects array required'
      using errcode = '22023';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'array' then
    raise exception 'admin_import_property_book: owners array required'
      using errcode = '22023';
  end if;

  select not exists (select 1 from public.properties limit 1) into v_book_empty;
  v_allow_create := coalesce(p_allow_create_missing, false) or v_book_empty;

  select i.apartment_count
  into v_expected_count
  from public.platform_installations as i
  where i.id = public.first_run_default_installation_id();

  for v_own in select value from jsonb_array_elements(p_owners) as t(value)
  loop
    v_apt := nullif(btrim(coalesce(v_own ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners',
        'row', coalesce((v_own ->> '_row')::int, null),
        'field', 'apartment_number',
        'code', 'apartment_number_required',
        'reason', 'apartment_number_required',
        'row_data', v_own
      ));
      continue;
    end if;
    v_list := coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb);
    v_owners_by_apt := jsonb_set(
      v_owners_by_apt,
      array[v_apt],
      v_list || jsonb_build_array(v_own)
    );
  end loop;

  for v_obj in select value from jsonb_array_elements(p_objects) as t(value)
  loop
    v_would_create := false;
    v_would_change := false;
    v_identical := false;
    v_apt := nullif(btrim(coalesce(v_obj ->> 'apartment_number', '')), '');
    if v_apt is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', coalesce((v_obj ->> '_row')::int, null),
        'field', 'apartment_number',
        'code', 'apartment_number_required',
        'reason', 'apartment_number_required',
        'row_data', v_obj
      ));
      continue;
    end if;

    if v_apt = any (v_seen_apts) then
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'code', 'duplicate_apartment', 'apartment_number', v_apt
      ));
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'row', coalesce((v_obj ->> '_row')::int, null),
        'field', 'apartment_number',
        'code', 'duplicate_apartment',
        'reason', 'duplicate_apartment',
        'apartment_number', v_apt
      ));
      continue;
    end if;
    v_seen_apts := array_append(v_seen_apts, v_apt);

    begin
      v_apt_num := v_apt::bigint;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects',
        'field', 'apartment_number',
        'code', 'apartment_number_invalid',
        'reason', 'apartment_number_invalid',
        'apartment_number', v_apt
      ));
      continue;
    end;

    v_purpose := nullif(btrim(coalesce(v_obj ->> 'purpose', '')), '');
    begin
      v_area := nullif(btrim(coalesce(v_obj ->> 'area_sqm', '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'area_sqm', 'code', 'area_sqm_invalid',
        'reason', 'area_sqm_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;
    begin
      v_ideal := nullif(btrim(coalesce(v_obj ->> 'ideal_parts_percent', '')), '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'ideal_parts_percent', 'code', 'ideal_parts_invalid',
        'reason', 'ideal_parts_invalid', 'apartment_number', v_apt
      ));
      continue;
    end;
    v_own_type := nullif(btrim(coalesce(v_obj ->> 'ownership_type', '')), '');
    if v_own_type is not null and v_own_type not in ('sole', 'shared') then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'ownership_type', 'code', 'ownership_type_invalid',
        'reason', 'ownership_type_invalid', 'apartment_number', v_apt
      ));
      continue;
    end if;
    v_section := nullif(btrim(coalesce(v_obj ->> 'section_code', '')), '');
    v_block := nullif(btrim(coalesce(v_obj ->> 'block_code', '')), '');
    begin
      v_floor := nullif(btrim(coalesce(v_obj ->> 'floor', '')), '')::bigint;
    exception when others then
      v_floor := null;
    end;

    select p.* into v_prop
    from public.properties as p
    where p.apartment_number = v_apt
    limit 1;

    if not found then
      v_would_create := true;
      v_new_props := v_new_props || jsonb_build_array(jsonb_build_object(
        'apartment_number', v_apt,
        'purpose', v_purpose,
        'area_sqm', v_area,
        'ideal_parts_percent', v_ideal,
        'ownership_type', v_own_type
      ));
      if not v_allow_create and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'field', 'apartment_number',
          'code', 'create_missing_requires_confirmation',
          'reason', 'create_missing_requires_confirmation',
          'apartment_number', v_apt
        ));
        continue;
      end if;
      v_prop_id := null;
    else
      v_prop_id := v_prop.id;
      v_existing := v_existing || jsonb_build_array(jsonb_build_object(
        'property_id', v_prop.id,
        'apartment_number', v_apt
      ));

      select count(*)::int into v_owner_count
      from public.property_registry_people as r
      where r.property_id = v_prop.id
        and r.relation_type = 'owner'
        and r.deregistered_at is null;

      -- Real field diffs only (do NOT treat "owners present in file" as always-change).
      if (v_purpose is distinct from v_prop.purpose)
         or (v_area is distinct from v_prop.area_sqm)
         or (v_ideal is distinct from v_prop.ideal_parts_percent)
         or (v_own_type is distinct from v_prop.ownership_type)
         or (v_section is distinct from v_prop.section_code)
         or (v_block is distinct from v_prop.block_code)
         or (v_floor is distinct from v_prop.floor)
         or coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) <> v_owner_count
      then
        v_would_change := true;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'property_id', v_prop.id,
          'apartment_number', v_apt,
          'object_fields_differ', true,
          'owners_in_file', coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0),
          'active_owners_now', v_owner_count
        ));
      else
        -- Same object shape + owner count; payload validation below must also pass.
        v_identical := true;
      end if;

      if v_would_change
         and not coalesce(p_allow_overwrite, false)
         and not coalesce(p_dry_run, true) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sheet', 'objects',
          'field', 'apartment_number',
          'code', 'overwrite_requires_confirmation',
          'reason', 'overwrite_requires_confirmation',
          'apartment_number', v_apt,
          'property_id', v_prop.id
        ));
        continue;
      end if;
    end if;

    if coalesce(jsonb_array_length(v_owners_by_apt -> v_apt), 0) = 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'field', 'owners', 'code', 'owners_required',
        'reason', 'owners_required', 'apartment_number', v_apt
      ));
    end if;
    if v_purpose is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'purpose', 'code', 'purpose_required',
        'reason', 'purpose_required', 'apartment_number', v_apt
      ));
    end if;
    if v_area is null or v_area <= 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'area_sqm', 'code', 'area_required',
        'reason', 'area_required', 'apartment_number', v_apt
      ));
    end if;
    if v_ideal is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'ideal_parts_percent', 'code', 'object_ideal_parts_required',
        'reason', 'object_ideal_parts_required', 'apartment_number', v_apt
      ));
    end if;
    if v_own_type is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'objects', 'field', 'ownership_type', 'code', 'ownership_type_required',
        'reason', 'ownership_type_required', 'apartment_number', v_apt
      ));
    end if;

    v_validation := public.property_book_validate_owners_payload(
      v_purpose,
      v_area,
      v_ideal,
      v_own_type,
      coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
    );
    if not coalesce((v_validation ->> 'ok')::boolean, false) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'validation',
        'field', 'owners',
        'apartment_number', v_apt,
        'codes', v_validation -> 'errors',
        'reason', 'owners_validation_failed'
      ));
      v_identical := false;
    end if;

    if coalesce(p_dry_run, true) then
      continue;
    end if;

    -- Idempotent path: existing identical + valid → skip writes, count success.
    if v_identical and not v_would_create and not coalesce(p_allow_overwrite, false) then
      v_ok_count := v_ok_count + 1;
      v_skipped_identical := array_append(v_skipped_identical, v_prop_id);
      v_touched := array_append(v_touched, v_prop_id);
      continue;
    end if;

    if v_would_create then
      if v_floor is null then
        v_floor := case
          when v_apt_num between 1 and 99 then 1
          else greatest(1, (v_apt_num / 100)::bigint)
        end;
      end if;
      insert into public.properties (
        apartment_number, floor, section_code, block_code,
        area_sqm, purpose, ideal_parts_percent, ownership_type, status
      ) values (
        v_apt, v_floor, v_section, v_block,
        v_area, v_purpose, v_ideal, v_own_type, 'vacant'
      )
      returning id into v_prop_id;
      v_created := array_append(v_created, v_prop_id);
    end if;

    perform public.admin_upsert_property_book_object(
      v_prop_id,
      v_purpose,
      v_area,
      v_ideal,
      v_own_type,
      v_obj ->> 'ideal_parts_source',
      v_apt_num,
      v_floor,
      null,
      null,
      v_section,
      v_block
    );
    perform public.admin_replace_property_book_owners(
      v_prop_id,
      coalesce(v_owners_by_apt -> v_apt, '[]'::jsonb)
    );

    v_validation := public.property_book_validate(v_prop_id);
    if not coalesce((v_validation ->> 'ok')::boolean, false) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'validation',
        'field', 'owners',
        'apartment_number', v_apt,
        'property_id', v_prop_id,
        'codes', v_validation -> 'errors',
        'reason', 'owners_validation_failed'
      ));
    else
      v_ok_count := v_ok_count + 1;
    end if;

    v_touched := array_append(v_touched, v_prop_id);
  end loop;

  v_unique_count := coalesce(cardinality(v_seen_apts), 0);
  if v_expected_count is not null and v_unique_count <> v_expected_count then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'sheet', 'objects',
      'field', 'apartment_count',
      'code', 'apartment_count_mismatch',
      'reason', 'apartment_count_mismatch',
      'expected', v_expected_count,
      'actual', v_unique_count
    ));
  end if;

  for v_apt in select jsonb_object_keys(v_owners_by_apt)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_objects) as o(value)
      where btrim(coalesce(o.value ->> 'apartment_number', '')) = v_apt
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'sheet', 'owners', 'field', 'apartment_number', 'code', 'object_row_missing',
        'reason', 'object_row_missing', 'apartment_number', v_apt
      ));
    end if;
  end loop;

  if not coalesce(p_dry_run, true) and jsonb_array_length(v_errors) > 0 then
    raise exception 'admin_import_property_book: apply aborted - % errors', jsonb_array_length(v_errors)
      using errcode = 'P0001',
            detail = v_errors::text;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'existing_properties', v_existing,
    'new_properties', v_new_props,
    'changes', v_changes,
    'duplicates', v_duplicates,
    'requires_create_confirmation', jsonb_array_length(v_new_props) > 0 and not v_book_empty,
    'requires_overwrite_confirmation', jsonb_array_length(v_changes) > 0,
    'allow_create_missing', v_allow_create,
    'allow_overwrite', coalesce(p_allow_overwrite, false),
    'book_empty_auto_create', v_book_empty,
    'expected_apartment_count', v_expected_count,
    'unique_apartment_count', v_unique_count,
    'touched_property_ids', to_jsonb(v_touched),
    'created_property_ids', to_jsonb(v_created),
    'skipped_identical_property_ids', to_jsonb(v_skipped_identical),
    'complete_count', v_ok_count
  );
end;
$function$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean, boolean, boolean) to authenticated;

create or replace function public.admin_import_property_book(
  p_objects jsonb,
  p_owners jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return public.admin_import_property_book(
    p_objects, p_owners, p_dry_run, false, false
  );
end;
$fn$;

revoke all on function public.admin_import_property_book(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.admin_import_property_book(jsonb, jsonb, boolean) to authenticated;

commit;
