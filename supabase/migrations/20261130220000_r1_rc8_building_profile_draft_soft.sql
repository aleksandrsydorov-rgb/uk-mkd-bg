-- =============================================================================
-- R1-RC8 — Soft draft for building profile (partial form persist)
-- =============================================================================
-- Draft mode must accept incomplete complex/UK fields so the wizard can restore
-- after re-login. Commit mode keeps full required checks. Partially filled bank
-- rows still fail; empty optional bank rows are skipped.
-- =============================================================================

begin;

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
    if v_mode = 'commit' then
      raise exception 'first_run: apartment_count invalid' using errcode = '22023';
    end if;
    v_count := null;
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
  end if;
  -- draft mode: persist partial values without required-field checks

  update public.platform_installations as i
  set
    display_name = case when v_mode = 'draft' then coalesce(v_name, i.display_name) else coalesce(v_name, i.display_name) end,
    complex_name = case when v_mode = 'draft' then coalesce(v_name, i.complex_name) else coalesce(v_name, i.complex_name) end,
    address = case
      when v_mode = 'draft' and v_address is null and v_name is null and v_count is null
           and v_country is null and v_city is null and v_street is null and v_building is null
        then i.address
      else coalesce(v_address, i.address)
    end,
    address_country = v_country,
    address_city = v_city,
    address_postal_code = v_postal,
    address_street = v_street,
    address_building_number = v_building,
    apartment_count = case
      when v_mode = 'draft' and v_count is null then i.apartment_count
      else coalesce(v_count, i.apartment_count)
    end,
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

commit;
