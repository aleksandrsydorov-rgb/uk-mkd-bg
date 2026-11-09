-- =============================================================================
-- R1-RC8 — Building profile: complex info, management company, bank accounts
-- =============================================================================
-- Extends platform_installations (single building/UK org — no second UK catalog).
-- Structured complex address; management-company fields; building_bank_accounts.
-- IBAN normalize + mod-97 check. Snapshot helper for future payment receipts.
-- Completed installs are not reopened; new fields are nullable until edited.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Columns on the existing installation singleton
-- ---------------------------------------------------------------------------

alter table public.platform_installations
  add column if not exists address_country text,
  add column if not exists address_city text,
  add column if not exists address_postal_code text,
  add column if not exists address_street text,
  add column if not exists address_building_number text,
  add column if not exists mgmt_legal_name text,
  add column if not exists mgmt_legal_form text,
  add column if not exists mgmt_registration_country text,
  add column if not exists mgmt_registration_number text,
  add column if not exists mgmt_vat_registered boolean not null default false,
  add column if not exists mgmt_vat_number text,
  add column if not exists mgmt_registered_address text,
  add column if not exists mgmt_correspondence_address text,
  add column if not exists mgmt_representative_name text,
  add column if not exists mgmt_representative_title text,
  add column if not exists mgmt_phone text,
  add column if not exists mgmt_email text;

comment on column public.platform_installations.address is
  'Legacy/composed complex address line. Prefer structured address_* columns.';
comment on column public.platform_installations.mgmt_legal_name is
  'Registered management-company (UK) legal name for this installation.';
comment on column public.platform_installations.mgmt_registration_number is
  'Company registration number (EIK/BULSTAT for Bulgaria).';

-- Preserve flat address into street when structured fields are empty.
update public.platform_installations as i
set address_street = coalesce(nullif(btrim(i.address_street), ''), nullif(btrim(i.address), ''))
where nullif(btrim(coalesce(i.address, '')), '') is not null
  and nullif(btrim(coalesce(i.address_street, '')), '') is null
  and nullif(btrim(coalesce(i.address_city, '')), '') is null
  and nullif(btrim(coalesce(i.address_country, '')), '') is null;

create table if not exists public.building_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null
    references public.platform_installations (id) on delete cascade,
  purpose text not null default '',
  account_holder text not null,
  bank_name text not null,
  iban text not null,
  bic_swift text null,
  currency text not null default 'EUR',
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_bank_accounts_iban_chk check (length(btrim(iban)) >= 15),
  constraint building_bank_accounts_currency_chk check (length(btrim(currency)) = 3)
);

create index if not exists building_bank_accounts_installation_idx
  on public.building_bank_accounts (installation_id, sort_order, created_at);

create unique index if not exists building_bank_accounts_one_primary_uidx
  on public.building_bank_accounts (installation_id)
  where is_primary is true;

alter table public.building_bank_accounts enable row level security;
revoke all on table public.building_bank_accounts from public, anon, authenticated;

drop policy if exists building_bank_accounts_staff_select on public.building_bank_accounts;
create policy building_bank_accounts_staff_select
  on public.building_bank_accounts
  for select
  to authenticated
  using (public.has_staff_role('администрация') or public.has_staff_role('бухгалтер'));

-- ---------------------------------------------------------------------------
-- IBAN helpers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_iban(p_iban text)
returns text
language sql
immutable
as $fn$
  select nullif(upper(regexp_replace(coalesce(p_iban, ''), '\\s+', '', 'g')), '');
$fn$;

revoke all on function public.normalize_iban(text) from public, anon;
grant execute on function public.normalize_iban(text) to authenticated;

create or replace function public.iban_mod97_valid(p_iban text)
returns boolean
language plpgsql
immutable
as $fn$
declare
  v text := public.normalize_iban(p_iban);
  v_rearranged text;
  v_digits text := '';
  ch text;
  code int;
  i int;
  v_rem int := 0;
  chunk text;
begin
  if v is null then
    return false;
  end if;
  if length(v) < 15 or length(v) > 34 then
    return false;
  end if;
  if v !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]+$' then
    return false;
  end if;
  v_rearranged := substr(v, 5) || substr(v, 1, 4);
  for i in 1..length(v_rearranged) loop
    ch := substr(v_rearranged, i, 1);
    if ch ~ '[0-9]' then
      v_digits := v_digits || ch;
    else
      code := ascii(ch) - 55; -- A=10
      v_digits := v_digits || code::text;
    end if;
  end loop;
  i := 1;
  while i <= length(v_digits) loop
    chunk := (v_rem::text || substr(v_digits, i, 7));
    v_rem := chunk::numeric % 97;
    i := i + 7;
  end loop;
  return v_rem = 1;
end;
$fn$;

revoke all on function public.iban_mod97_valid(text) from public, anon;
grant execute on function public.iban_mod97_valid(text) to authenticated;

create or replace function public.compose_complex_address(
  p_street text,
  p_building_number text,
  p_postal_code text,
  p_city text,
  p_country text,
  p_fallback text default null
)
returns text
language plpgsql
immutable
as $fn$
declare
  v_line1 text;
  v_line2 text;
  v_parts text[] := array[]::text[];
begin
  v_line1 := nullif(btrim(concat_ws(' ', nullif(btrim(p_street), ''), nullif(btrim(p_building_number), ''))), '');
  v_line2 := nullif(btrim(concat_ws(' ', nullif(btrim(p_postal_code), ''), nullif(btrim(p_city), ''))), '');
  if v_line1 is not null then v_parts := array_append(v_parts, v_line1); end if;
  if v_line2 is not null then v_parts := array_append(v_parts, v_line2); end if;
  if nullif(btrim(p_country), '') is not null then
    v_parts := array_append(v_parts, btrim(p_country));
  end if;
  if cardinality(v_parts) > 0 then
    return array_to_string(v_parts, ', ');
  end if;
  return nullif(btrim(coalesce(p_fallback, '')), '');
end;
$fn$;

revoke all on function public.compose_complex_address(text, text, text, text, text, text) from public, anon;
grant execute on function public.compose_complex_address(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile apply / read / snapshot
-- ---------------------------------------------------------------------------

create or replace function public.building_profile_json(p_installation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_banks jsonb;
begin
  select * into v_inst from public.platform_installations as i where i.id = p_installation_id;
  if not found then
    return null;
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'purpose', b.purpose,
      'account_holder', b.account_holder,
      'bank_name', b.bank_name,
      'iban', b.iban,
      'bic_swift', b.bic_swift,
      'currency', b.currency,
      'is_primary', b.is_primary,
      'sort_order', b.sort_order
    )
    order by b.sort_order, b.created_at
  ), '[]'::jsonb)
  into v_banks
  from public.building_bank_accounts as b
  where b.installation_id = p_installation_id;

  return jsonb_build_object(
    'display_name', coalesce(v_inst.display_name, v_inst.complex_name),
    'complex_name', v_inst.complex_name,
    'address', v_inst.address,
    'address_country', v_inst.address_country,
    'address_city', v_inst.address_city,
    'address_postal_code', v_inst.address_postal_code,
    'address_street', v_inst.address_street,
    'address_building_number', v_inst.address_building_number,
    'apartment_count', v_inst.apartment_count,
    'contact_phone', v_inst.contact_phone,
    'contact_email', v_inst.contact_email,
    'mgmt_legal_name', v_inst.mgmt_legal_name,
    'mgmt_legal_form', v_inst.mgmt_legal_form,
    'mgmt_registration_country', v_inst.mgmt_registration_country,
    'mgmt_registration_number', v_inst.mgmt_registration_number,
    'mgmt_vat_registered', v_inst.mgmt_vat_registered,
    'mgmt_vat_number', v_inst.mgmt_vat_number,
    'mgmt_registered_address', v_inst.mgmt_registered_address,
    'mgmt_correspondence_address', v_inst.mgmt_correspondence_address,
    'mgmt_representative_name', v_inst.mgmt_representative_name,
    'mgmt_representative_title', v_inst.mgmt_representative_title,
    'mgmt_phone', v_inst.mgmt_phone,
    'mgmt_email', v_inst.mgmt_email,
    'bank_accounts', v_banks
  );
end;
$fn$;

revoke all on function public.building_profile_json(uuid) from public, anon;
grant execute on function public.building_profile_json(uuid) to authenticated;

create or replace function public.building_party_snapshot(p_installation_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid := coalesce(p_installation_id, public.first_run_default_installation_id());
  v_profile jsonb;
begin
  v_profile := public.building_profile_json(v_id);
  if v_profile is null then
    raise exception 'building profile missing' using errcode = 'P0002';
  end if;
  -- Immutable copy for documents. Callers must store this JSON on the issued document.
  return jsonb_build_object(
    'captured_at', now(),
    'complex', jsonb_build_object(
      'display_name', v_profile ->> 'display_name',
      'address', v_profile ->> 'address',
      'address_country', v_profile ->> 'address_country',
      'address_city', v_profile ->> 'address_city',
      'address_postal_code', v_profile ->> 'address_postal_code',
      'address_street', v_profile ->> 'address_street',
      'address_building_number', v_profile ->> 'address_building_number',
      'apartment_count', v_profile -> 'apartment_count',
      'contact_phone', v_profile ->> 'contact_phone',
      'contact_email', v_profile ->> 'contact_email'
    ),
    'management_company', jsonb_build_object(
      'legal_name', v_profile ->> 'mgmt_legal_name',
      'legal_form', v_profile ->> 'mgmt_legal_form',
      'registration_country', v_profile ->> 'mgmt_registration_country',
      'registration_number', v_profile ->> 'mgmt_registration_number',
      'vat_registered', v_profile -> 'mgmt_vat_registered',
      'vat_number', v_profile ->> 'mgmt_vat_number',
      'registered_address', v_profile ->> 'mgmt_registered_address',
      'correspondence_address', v_profile ->> 'mgmt_correspondence_address',
      'representative_name', v_profile ->> 'mgmt_representative_name',
      'representative_title', v_profile ->> 'mgmt_representative_title',
      'phone', v_profile ->> 'mgmt_phone',
      'email', v_profile ->> 'mgmt_email'
    ),
    'bank_accounts', coalesce(v_profile -> 'bank_accounts', '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.building_party_snapshot(uuid) from public, anon;
grant execute on function public.building_party_snapshot(uuid) to authenticated;

create or replace function public.first_run_assert_building_profile_ready(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
begin
  select * into v_inst from public.platform_installations as i where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  -- Completed installs are never reopened by new profile fields.
  if v_inst.first_run_status = 'complete' and v_inst.first_run_completed_at is not null then
    return;
  end if;

  if nullif(btrim(coalesce(v_inst.display_name, v_inst.complex_name, '')), '') is null then
    raise exception 'first_run: complex name required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.address_country, '')), '') is null
     or nullif(btrim(coalesce(v_inst.address_city, '')), '') is null
     or nullif(btrim(coalesce(v_inst.address_street, '')), '') is null
     or nullif(btrim(coalesce(v_inst.address_building_number, '')), '') is null then
    raise exception 'first_run: complex address incomplete' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.address, '')), '') is null then
    raise exception 'first_run: address required' using errcode = 'P0001';
  end if;
  if v_inst.apartment_count is null or v_inst.apartment_count <= 0 then
    raise exception 'first_run: apartment_count required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_legal_name, '')), '') is null then
    raise exception 'first_run: management company name required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_registration_country, '')), '') is null then
    raise exception 'first_run: management registration country required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_registration_number, '')), '') is null then
    raise exception 'first_run: management registration number required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_registered_address, '')), '') is null then
    raise exception 'first_run: management registered address required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_representative_name, '')), '') is null then
    raise exception 'first_run: management representative required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_phone, '')), '') is null then
    raise exception 'first_run: management phone required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_inst.mgmt_email, '')), '') is null then
    raise exception 'first_run: management email required' using errcode = 'P0001';
  end if;
  if coalesce(v_inst.mgmt_vat_registered, false)
     and nullif(btrim(coalesce(v_inst.mgmt_vat_number, '')), '') is null then
    raise exception 'first_run: management VAT number required' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.first_run_assert_building_profile_ready(uuid) from public, anon;
grant execute on function public.first_run_assert_building_profile_ready(uuid) to authenticated;

create or replace function public.apply_building_profile(
  p_installation_id uuid,
  p_complex jsonb,
  p_mode text default 'draft'
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_mode text := lower(btrim(coalesce(p_mode, 'draft')));
  v_name text;
  v_count integer;
  v_country text;
  v_city text;
  v_postal text;
  v_street text;
  v_building text;
  v_address text;
  v_phone text;
  v_email text;
  v_vat_registered boolean;
  v_vat_number text;
  v_banks jsonb;
  v_item jsonb;
  v_iban text;
  v_holder text;
  v_bank text;
  v_purpose text;
  v_bic text;
  v_currency text;
  v_primary boolean;
  v_sort integer := 0;
  v_any_bank boolean;
  v_primary_seen boolean := false;
begin
  if p_installation_id is null or p_complex is null then
    raise exception 'building profile payload required' using errcode = '22023';
  end if;
  if v_mode not in ('draft', 'commit') then
    raise exception 'building profile mode invalid' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_complex ->> 'display_name', p_complex ->> 'complex_name', '')), '');
  v_country := nullif(btrim(coalesce(p_complex ->> 'address_country', '')), '');
  v_city := nullif(btrim(coalesce(p_complex ->> 'address_city', '')), '');
  v_postal := nullif(btrim(coalesce(p_complex ->> 'address_postal_code', '')), '');
  v_street := nullif(btrim(coalesce(p_complex ->> 'address_street', '')), '');
  v_building := nullif(btrim(coalesce(p_complex ->> 'address_building_number', '')), '');
  v_address := public.compose_complex_address(
    v_street, v_building, v_postal, v_city, v_country, p_complex ->> 'address'
  );
  begin
    v_count := nullif(btrim(coalesce(p_complex ->> 'apartment_count', '')), '')::integer;
  exception when others then
    raise exception 'first_run: apartment_count invalid' using errcode = '22023';
  end;
  v_phone := nullif(btrim(coalesce(p_complex ->> 'contact_phone', '')), '');
  v_email := nullif(btrim(coalesce(p_complex ->> 'contact_email', '')), '');
  v_vat_registered := coalesce((p_complex ->> 'mgmt_vat_registered')::boolean, false);
  v_vat_number := nullif(btrim(coalesce(p_complex ->> 'mgmt_vat_number', '')), '');
  if not v_vat_registered then
    v_vat_number := null;
  end if;

  if v_mode = 'commit' then
    if v_name is null then
      raise exception 'first_run: complex name required' using errcode = '22023';
    end if;
    if v_country is null or v_city is null or v_street is null or v_building is null or v_address is null then
      raise exception 'first_run: complex address incomplete' using errcode = '22023';
    end if;
    if v_count is null or v_count <= 0 then
      raise exception 'first_run: apartment_count required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_legal_name', '')), '') is null then
      raise exception 'first_run: management company name required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_registration_country', '')), '') is null then
      raise exception 'first_run: management registration country required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_registration_number', '')), '') is null then
      raise exception 'first_run: management registration number required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_registered_address', '')), '') is null then
      raise exception 'first_run: management registered address required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_representative_name', '')), '') is null then
      raise exception 'first_run: management representative required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_phone', '')), '') is null then
      raise exception 'first_run: management phone required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_complex ->> 'mgmt_email', '')), '') is null then
      raise exception 'first_run: management email required' using errcode = '22023';
    end if;
    if v_vat_registered and v_vat_number is null then
      raise exception 'first_run: management VAT number required' using errcode = '22023';
    end if;
  elsif v_name is not null or v_address is not null or v_count is not null then
    -- Soft draft: if core identity is present, keep basic integrity.
    if v_name is null then
      raise exception 'first_run: complex name required' using errcode = '22023';
    end if;
    if v_address is null then
      raise exception 'first_run: address required' using errcode = '22023';
    end if;
    if v_count is null or v_count <= 0 then
      raise exception 'first_run: apartment_count required' using errcode = '22023';
    end if;
  end if;

  update public.platform_installations as i
  set
    display_name = coalesce(v_name, i.display_name),
    complex_name = coalesce(v_name, i.complex_name),
    address = coalesce(v_address, i.address),
    address_country = v_country,
    address_city = v_city,
    address_postal_code = v_postal,
    address_street = v_street,
    address_building_number = v_building,
    apartment_count = coalesce(v_count, i.apartment_count),
    contact_phone = v_phone,
    contact_email = v_email,
    mgmt_legal_name = nullif(btrim(coalesce(p_complex ->> 'mgmt_legal_name', '')), ''),
    mgmt_legal_form = nullif(btrim(coalesce(p_complex ->> 'mgmt_legal_form', '')), ''),
    mgmt_registration_country = nullif(btrim(coalesce(p_complex ->> 'mgmt_registration_country', '')), ''),
    mgmt_registration_number = nullif(btrim(coalesce(p_complex ->> 'mgmt_registration_number', '')), ''),
    mgmt_vat_registered = v_vat_registered,
    mgmt_vat_number = v_vat_number,
    mgmt_registered_address = nullif(btrim(coalesce(p_complex ->> 'mgmt_registered_address', '')), ''),
    mgmt_correspondence_address = nullif(btrim(coalesce(p_complex ->> 'mgmt_correspondence_address', '')), ''),
    mgmt_representative_name = nullif(btrim(coalesce(p_complex ->> 'mgmt_representative_name', '')), ''),
    mgmt_representative_title = nullif(btrim(coalesce(p_complex ->> 'mgmt_representative_title', '')), ''),
    mgmt_phone = nullif(btrim(coalesce(p_complex ->> 'mgmt_phone', '')), ''),
    mgmt_email = nullif(btrim(coalesce(p_complex ->> 'mgmt_email', '')), ''),
    updated_at = now()
  where i.id = p_installation_id;

  v_banks := coalesce(p_complex -> 'bank_accounts', '[]'::jsonb);
  if jsonb_typeof(v_banks) is distinct from 'array' then
    raise exception 'first_run: bank_accounts must be an array' using errcode = '22023';
  end if;

  delete from public.building_bank_accounts as b where b.installation_id = p_installation_id;

  for v_item in select * from jsonb_array_elements(v_banks)
  loop
    v_holder := nullif(btrim(coalesce(v_item ->> 'account_holder', '')), '');
    v_bank := nullif(btrim(coalesce(v_item ->> 'bank_name', '')), '');
    v_iban := public.normalize_iban(v_item ->> 'iban');
    v_purpose := coalesce(nullif(btrim(coalesce(v_item ->> 'purpose', '')), ''), '');
    v_bic := nullif(btrim(coalesce(v_item ->> 'bic_swift', '')), '');
    v_currency := upper(coalesce(nullif(btrim(coalesce(v_item ->> 'currency', '')), ''), 'EUR'));
    v_primary := coalesce((v_item ->> 'is_primary')::boolean, false);
    v_any_bank := v_holder is not null or v_bank is not null or v_iban is not null
      or v_purpose <> '' or v_bic is not null;

    if not v_any_bank then
      continue; -- empty optional row
    end if;
    if v_holder is null or v_bank is null or v_iban is null then
      raise exception 'first_run: bank account incomplete' using errcode = '22023';
    end if;
    if not public.iban_mod97_valid(v_iban) then
      raise exception 'first_run: iban invalid' using errcode = '22023';
    end if;
    if length(v_currency) is distinct from 3 then
      raise exception 'first_run: bank currency invalid' using errcode = '22023';
    end if;
    if v_primary and v_primary_seen then
      v_primary := false;
    end if;
    if v_primary then
      v_primary_seen := true;
    end if;

    insert into public.building_bank_accounts (
      installation_id, purpose, account_holder, bank_name, iban, bic_swift,
      currency, is_primary, sort_order
    ) values (
      p_installation_id, v_purpose, v_holder, v_bank, v_iban, v_bic,
      v_currency, v_primary, v_sort
    );
    v_sort := v_sort + 1;
  end loop;
end;
$fn$;

revoke all on function public.apply_building_profile(uuid, jsonb, text) from public, anon;
grant execute on function public.apply_building_profile(uuid, jsonb, text) to authenticated;

create or replace function public.admin_get_building_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authorized.';
  end if;
  if not (
    public.has_staff_role('администрация')
    or public.has_staff_role('бухгалтер')
  ) then
    raise exception 'Not authorized.';
  end if;
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  return public.building_profile_json(v_id);
end;
$fn$;

revoke all on function public.admin_get_building_profile() from public, anon;
grant execute on function public.admin_get_building_profile() to authenticated;

create or replace function public.admin_update_building_profile(p_complex jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform public.admin_assert_module_setup();
  if not public.has_staff_role('администрация') then
    raise exception 'Not authorized.';
  end if;
  v_id := public.first_run_default_installation_id();
  if v_id is null then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;
  perform public.apply_building_profile(v_id, p_complex, 'commit');
  return public.building_profile_json(v_id);
end;
$fn$;

revoke all on function public.admin_update_building_profile(jsonb) from public, anon;
grant execute on function public.admin_update_building_profile(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- First-run get/save patches + readiness
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_first_run_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_stages jsonb;
  v_profile jsonb;
begin
  perform public.admin_assert_module_setup();
  select * into v_inst
  from public.platform_installations as i
  order by i.created_at
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'installation_missing');
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

  v_profile := public.building_profile_json(v_inst.id);

  return jsonb_build_object(
    'ok', true,
    'installation_id', v_inst.id,
    'first_run_status', coalesce(v_inst.first_run_status, 'pending'),
    'first_run_stage', coalesce(v_inst.first_run_stage, 'welcome'),
    'gate_required', coalesce(v_inst.first_run_status, 'pending') <> 'complete',
    'complex', coalesce(v_profile, '{}'::jsonb),
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
  v_mode text;
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
    v_mode := case
      when lower(btrim(coalesce(p_complex ->> 'as_draft', ''))) in ('true', 't', '1', 'yes')
        then 'draft'
      else 'commit'
    end;
    -- Continue = commit validation; as_draft=true keeps optional banks empty-friendly.
    perform public.apply_building_profile(v_id, p_complex, v_mode);
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
      || case
           when p_complex is null then '{}'::jsonb
           else jsonb_build_object('complex_profile', p_complex)
         end
      || jsonb_build_object('current_stage', v_stage),
    updated_at = now()
  where i.id = v_id
    and i.first_run_status is distinct from 'complete';

  -- Allow post-activation draft key updates without flipping first-run status.
  if exists (
    select 1 from public.platform_installations as i
    where i.id = v_id and i.first_run_status = 'complete'
  ) and p_complex is not null then
    null; -- profile already applied above
  end if;

  insert into public.first_run_stage_progress as p (
    installation_id, stage_key, status, draft, updated_at, updated_by
  )
  values (
    v_id,
    v_stage,
    'in_progress',
    coalesce(p_draft, '{}'::jsonb)
      || case when p_complex is null then '{}'::jsonb else jsonb_build_object('complex_profile', p_complex) end,
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

create or replace function public.first_run_assert_ready_to_complete(p_installation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inst public.platform_installations%rowtype;
  v_need_water boolean := false;
  v_need_elec boolean := false;
  v_need_budget boolean := false;
  v_book_state text;
  v_water_state text;
  v_elec_state text;
  v_sf_state text;
  v_cr_state text;
  v_stage_status text;
begin
  select * into v_inst
  from public.platform_installations as i
  where i.id = p_installation_id;
  if not found then
    raise exception 'first_run: installation missing' using errcode = 'P0001';
  end if;

  perform public.first_run_assert_building_profile_ready(p_installation_id);

  foreach v_stage_status in array array[
    'welcome', 'modules_select', 'complex_card', 'property_book',
    'support_fee_opening', 'capital_repair_opening', 'tariffs', 'budget', 'uk_expenses_opening'
  ]
  loop
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = v_stage_status
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage % not complete', v_stage_status using errcode = 'P0001';
    end if;
  end loop;

  v_need_water := public.first_run_draft_has_module(v_inst.first_run_draft, 'water');
  v_need_elec := public.first_run_draft_has_module(v_inst.first_run_draft, 'electricity');
  v_need_budget := public.first_run_draft_has_module(v_inst.first_run_draft, 'budget');

  select ml.state into v_book_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'property_book';
  if v_book_state is distinct from 'ACTIVE' then
    raise exception 'first_run: property_book must be ACTIVE (got %)', coalesce(v_book_state, 'missing')
      using errcode = 'P0001';
  end if;

  if v_need_water then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_water' and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_water stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_water_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'water';
    if v_water_state is distinct from 'ACTIVE' then
      raise exception 'first_run: water must be ACTIVE (got %)', coalesce(v_water_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  if v_need_elec then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'meters_electricity' and p.status = 'complete'
    ) then
      raise exception 'first_run: meters_electricity stage not complete' using errcode = 'P0001';
    end if;
    select ml.state into v_elec_state
    from public.module_lifecycle as ml
    where ml.installation_id = p_installation_id and ml.module_key = 'electricity';
    if v_elec_state is distinct from 'ACTIVE' then
      raise exception 'first_run: electricity must be ACTIVE (got %)', coalesce(v_elec_state, 'missing')
        using errcode = 'P0001';
    end if;
  end if;

  select ml.state into v_sf_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'support_fee';
  if v_sf_state is distinct from 'ACTIVE' then
    raise exception 'first_run: support_fee must be ACTIVE (got %)', coalesce(v_sf_state, 'missing')
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.support_fee_opening_imports) then
    raise exception 'first_run: support_fee opening inventarisation missing' using errcode = 'P0001';
  end if;

  perform public.first_run_assert_capital_repair_opening_ready(p_installation_id);

  select ml.state into v_cr_state
  from public.module_lifecycle as ml
  where ml.installation_id = p_installation_id and ml.module_key = 'capital_repair';
  if v_cr_state is distinct from 'ACTIVE' then
    raise exception 'first_run: capital_repair must be ACTIVE (got %)', coalesce(v_cr_state, 'missing')
      using errcode = 'P0001';
  end if;

  perform public.first_run_assert_tariffs_ready(p_installation_id);

  if public.first_run_draft_has_module(v_inst.first_run_draft, 'internet') then
    if not exists (
      select 1 from public.first_run_stage_progress p
      where p.installation_id = p_installation_id
        and p.stage_key = 'internet_opening'
        and p.status = 'complete'
    ) then
      raise exception 'first_run: stage internet_opening not complete' using errcode = 'P0001';
    end if;
    perform public.first_run_assert_internet_opening_ready(p_installation_id);
  end if;

  if v_need_budget then
    perform public.first_run_assert_budget_ready(p_installation_id);
  end if;
  perform public.first_run_assert_uk_expenses_opening_ready(p_installation_id);
end;
$fn$;

revoke all on function public.first_run_assert_ready_to_complete(uuid) from public, anon;
grant execute on function public.first_run_assert_ready_to_complete(uuid) to authenticated;

-- On complex_card completion, commit-validate the profile when payload is present in draft.
create or replace function public.first_run_commit_complex_profile_from_draft(p_installation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_draft jsonb;
  v_complex jsonb;
begin
  select i.first_run_draft into v_draft
  from public.platform_installations as i
  where i.id = p_installation_id;
  v_complex := coalesce(v_draft -> 'complex_profile', null);
  if v_complex is not null then
    perform public.apply_building_profile(p_installation_id, v_complex, 'commit');
  end if;
  perform public.first_run_assert_building_profile_ready(p_installation_id);
end;
$fn$;

revoke all on function public.first_run_commit_complex_profile_from_draft(uuid) from public, anon;
grant execute on function public.first_run_commit_complex_profile_from_draft(uuid) to authenticated;


-- When complex_card stage is completed, require a committed building profile.
create or replace function public.first_run_on_complex_card_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.stage_key = 'complex_card'
     and new.status = 'complete'
     and (tg_op = 'INSERT' or old.status is distinct from 'complete') then
    perform public.first_run_commit_complex_profile_from_draft(new.installation_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists first_run_complex_card_complete_trg on public.first_run_stage_progress;
create trigger first_run_complex_card_complete_trg
  after insert or update of status
  on public.first_run_stage_progress
  for each row
  execute function public.first_run_on_complex_card_complete();


commit;
