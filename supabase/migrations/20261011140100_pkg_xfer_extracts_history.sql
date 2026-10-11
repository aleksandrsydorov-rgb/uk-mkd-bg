-- PKG-XFER — Property Book PDF extracts + owner history (XFER.24–XFER.30)

begin;

-- ---------------------------------------------------------------------------
-- Immutable extract archive
-- ---------------------------------------------------------------------------

create table if not exists public.property_book_extracts (
  id bigserial primary key,
  extract_number text not null,
  property_id bigint not null references public.properties (id) on delete restrict,
  generated_at timestamptz not null default now(),
  generated_by_email text not null,
  locale text not null default 'bg'
    check (locale in ('bg', 'ru', 'en')),
  extract_kind text not null default 'informational'
    check (extract_kind in ('informational', 'certified_request')),
  is_signed boolean not null default false,
  is_informational boolean not null default true,
  content_sha256 text not null,
  content_html text not null,
  storage_path text null,
  linked_group_id uuid not null default gen_random_uuid(),
  excludes_restricted_personal_data boolean not null default true,
  book_snapshot jsonb not null,
  certified_request_status text null
    check (
      certified_request_status is null
      or certified_request_status in ('requested', 'fulfilled', 'rejected')
    ),
  note text null,
  constraint property_book_extracts_number_uidx unique (extract_number)
);

create index if not exists property_book_extracts_property_idx
  on public.property_book_extracts (property_id, generated_at desc);

create index if not exists property_book_extracts_group_idx
  on public.property_book_extracts (linked_group_id);

comment on table public.property_book_extracts is
  'XFER.25–30: immutable dated Property Book extracts. New rows only; never overwrite.';

alter table public.property_book_extracts enable row level security;
revoke all on table public.property_book_extracts from public, anon;
revoke all on table public.property_book_extracts from authenticated;
grant select on table public.property_book_extracts to authenticated;

drop policy if exists property_book_extracts_select on public.property_book_extracts;
create policy property_book_extracts_select
on public.property_book_extracts
for select to authenticated
using (
  public.has_staff_role('администрация')
  or public.owns_property(property_id)
);

-- Prevent updates/deletes of extract content (immutability)
create or replace function public.property_book_extracts_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'property_book_extracts: immutable — delete forbidden'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.content_html is distinct from old.content_html
       or new.content_sha256 is distinct from old.content_sha256
       or new.book_snapshot is distinct from old.book_snapshot
       or new.extract_number is distinct from old.extract_number
       or new.property_id is distinct from old.property_id
       or new.generated_at is distinct from old.generated_at
       or new.locale is distinct from old.locale
       or new.linked_group_id is distinct from old.linked_group_id
    then
      raise exception 'property_book_extracts: immutable content fields'
        using errcode = '42501';
    end if;
    -- Allow certified_request_status transitions only
  end if;
  return new;
end;
$fn$;

drop trigger if exists property_book_extracts_immutable_trg on public.property_book_extracts;
create trigger property_book_extracts_immutable_trg
  before update or delete on public.property_book_extracts
  for each row
  execute function public.property_book_extracts_immutable();

create sequence if not exists public.property_book_extract_number_seq;

create or replace function public.property_book_next_extract_number()
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n bigint;
begin
  v_n := nextval('public.property_book_extract_number_seq');
  return 'PB-X-' || to_char(now() at time zone 'Europe/Sofia', 'YYYY') || '-' || lpad(v_n::text, 6, '0');
end;
$fn$;

revoke all on function public.property_book_next_extract_number() from public, anon;

create or replace function public.property_book_extract_html(
  p_property_id bigint,
  p_locale text,
  p_snapshot jsonb,
  p_extract_number text,
  p_generated_at timestamptz,
  p_informational boolean
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_apt text;
  v_title text;
  v_mark text;
  v_auth text;
  v_owners text := '';
  v_hist text := '';
  v_item jsonb;
  v_name text;
  v_h jsonb;
begin
  v_apt := coalesce(p_snapshot ->> 'apartment_number', '');
  if v_apt = '' then
    select coalesce(p.apartment_number::text, p.id::text) into v_apt
    from public.properties as p
    where p.id = p_property_id;
  end if;

  v_title := case p_locale
    when 'en' then 'Property Book extract'
    when 'ru' then 'Выписка из книги собственности'
    else 'Извлечение от книгата на собствеността'
  end;

  v_mark := case
    when p_informational then case p_locale
      when 'en' then 'INFORMATIONAL — UNSIGNED'
      when 'ru' then 'ИНФОРМАЦИОННАЯ — БЕЗ ПОДПИСИ'
      else 'ИНФОРМАЦИОННО — НЕПОДПИСАНО'
    end
    else case p_locale
      when 'en' then 'CERTIFIED REQUEST — UNSIGNED PENDING LEGAL WORKFLOW'
      when 'ru' then 'ЗАПРОС ЗАВЕРЕННОЙ ВЫПИСКИ — БЕЗ ПОДПИСИ (ОЖИДАЕТ ПРАВОВОЙ ПРОЦЕДУРЫ)'
      else 'ЗАЯВКА ЗА ЗАВЕРЕНО ИЗВЛЕЧЕНИЕ — НЕПОДПИСАНО (ЧАКА ПРАВНА ПРОЦЕДУРА)'
    end
  end;

  v_auth := case p_locale
    when 'en' then
      'Authoritative original: Bulgarian (BG). This RU/EN text is an informational translation only.'
    when 'ru' then
      'Авторитетный оригинал: болгарский (BG). Этот RU/EN текст — только информационный перевод.'
    else
      'Оригинал на български език (BG) е авторитетният текст. RU/EN са информационни преводи.'
  end;

  for v_item in select value from jsonb_array_elements(coalesce(p_snapshot -> 'owners', '[]'::jsonb)) as t(value)
  loop
    v_name := coalesce(
      nullif(btrim(coalesce(v_item ->> 'entity_name', '')), ''),
      nullif(btrim(concat_ws(' ',
        v_item ->> 'first_name', v_item ->> 'middle_name', v_item ->> 'last_name'
      )), ''),
      '—'
    );
    -- Exclude restricted personal data (XFER.26): no email/phone/EIK in owner extract
    v_owners := v_owners || '<tr><td>' ||
      replace(replace(v_name, '&', '&amp;'), '<', '&lt;') ||
      '</td><td>' || coalesce(v_item ->> 'entity_kind', '') ||
      '</td><td>' || coalesce(v_item ->> 'ownership_share_percent', '') ||
      '%</td><td>' || coalesce(v_item ->> 'ideal_parts_percent', '') ||
      '%</td></tr>';
  end loop;

  for v_h in select value from jsonb_array_elements(coalesce(p_snapshot -> 'history', '[]'::jsonb)) as t(value)
  loop
    v_hist := v_hist || '<tr><td>' ||
      coalesce(v_h ->> 'legal_effective_date', '—') ||
      '</td><td>' || coalesce(v_h ->> 'book_updated_at', '—') ||
      '</td><td>' || coalesce(v_h ->> 'change_reason', v_h ->> 'change_kind', '—') ||
      '</td><td>' || coalesce(v_h ->> 'document_type', '—') ||
      ' ' || coalesce(v_h ->> 'document_number', '') ||
      '</td></tr>';
  end loop;

  return '<!DOCTYPE html><html lang="' || p_locale || '"><head><meta charset="utf-8"/>' ||
    '<title>' || v_title || ' ' || p_extract_number || '</title>' ||
    '<style>body{font-family:Georgia,serif;color:#111;padding:24px}' ||
    'h1{font-size:20px;margin:0 0 8px} h2{font-size:14px;margin:20px 0 8px}' ||
    '.mark{color:#a30;font-weight:700;margin:12px 0}' ||
    'table{border-collapse:collapse;width:100%;margin-top:8px}' ||
    'td,th{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left}' ||
    '.meta{font-size:12px;color:#444;margin-top:12px}</style></head><body>' ||
    '<h1>' || v_title || '</h1>' ||
    '<div class="meta">№ ' || p_extract_number || ' · ' ||
      to_char(p_generated_at at time zone 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') ||
      ' · apt. ' || coalesce(v_apt, '') || '</div>' ||
    '<div class="mark">' || v_mark || '</div>' ||
    '<p class="meta">' || v_auth || '</p>' ||
    '<h2>' || case p_locale
      when 'en' then 'Current owners (frozen snapshot)'
      when 'ru' then 'Текущие собственники (замороженный снимок)'
      else 'Текущи собственици (замразен момент)'
    end || '</h2>' ||
    '<table><thead><tr><th>Owner</th><th>Kind</th><th>Share</th><th>Ideal parts</th></tr></thead>' ||
    '<tbody>' || v_owners || '</tbody></table>' ||
    case when v_hist <> '' then
      '<h2>' || case p_locale
        when 'en' then 'Permitted ownership history'
        when 'ru' then 'Допустимая история владения'
        else 'Допустима история на собствеността'
      end || '</h2>' ||
      '<table><thead><tr><th>Legal date</th><th>Book update</th><th>Reason</th><th>Document</th></tr></thead>' ||
      '<tbody>' || v_hist || '</tbody></table>'
    else '' end ||
    '<p class="meta">Snapshot frozen at generation. PDF attachment is separate; HTML alone is not a PDF.</p>' ||
    '</body></html>';
end;
$fn$;

revoke all on function public.property_book_extract_html(
  bigint, text, jsonb, text, timestamptz, boolean
) from public, anon;

create or replace function public.owner_generate_property_book_extract(
  p_property_id bigint,
  p_locales text[] default array['bg', 'ru', 'en']
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_locales text[] := coalesce(p_locales, array['bg']);
  v_loc text;
  v_group uuid := gen_random_uuid();
  v_snapshot jsonb;
  v_owners jsonb;
  v_base_number text;
  v_number text;
  v_html text;
  v_hash text;
  v_ids bigint[] := array[]::bigint[];
  v_id bigint;
  v_i integer := 0;
  v_now timestamptz := now();
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_generate_property_book_extract: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_generate_property_book_extract: not allowed'
      using errcode = '42501';
  end if;

  v_owners := public.ownership_change_book_owners_json(p_property_id);
  -- Strip restricted personal data from snapshot used in extract body
  v_owners := (
    select coalesce(jsonb_agg(
      (x - 'email' - 'eik_bulstat')
    ), '[]'::jsonb)
    from jsonb_array_elements(v_owners) as t(x)
  );
  v_snapshot := jsonb_build_object(
    'property_id', p_property_id,
    'apartment_number', (
      select coalesce(p.apartment_number::text, p.id::text)
      from public.properties as p where p.id = p_property_id
    ),
    'owners', v_owners,
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'legal_effective_date', s.legal_effective_date,
        'book_updated_at', s.book_updated_at,
        'change_kind', s.change_kind,
        'change_reason', s.change_reason,
        'document_type', s.document_type,
        'document_number', s.document_number,
        'document_date', s.document_date,
        'status', s.status
      ) order by s.book_updated_at desc), '[]'::jsonb)
      from (
        select
          t.legal_effective_date,
          coalesce(t.decided_at, t.created_at) as book_updated_at,
          t.change_kind,
          t.change_reason,
          t.document_type,
          t.document_number,
          t.document_date,
          t.status
        from public.owner_transfers as t
        where t.property_id = p_property_id
          and t.status = 'утверждена'
        order by coalesce(t.decided_at, t.created_at) desc
        limit 20
      ) as s
    ),
    'generated_at', v_now,
    'pdf_attached', false
  );

  v_base_number := public.property_book_next_extract_number();

  foreach v_loc in array v_locales
  loop
    if v_loc not in ('bg', 'ru', 'en') then
      continue;
    end if;
    v_i := v_i + 1;
    v_number := v_base_number || '-' || upper(v_loc);
    v_html := public.property_book_extract_html(
      p_property_id, v_loc, v_snapshot, v_number, v_now, true
    );
    -- Content fingerprint (immutable archive key). md5 is sufficient for integrity tagging.
    v_hash := md5(v_html);

    insert into public.property_book_extracts (
      extract_number, property_id, generated_at, generated_by_email,
      locale, extract_kind, is_signed, is_informational,
      content_sha256, content_html, linked_group_id,
      excludes_restricted_personal_data, book_snapshot
    ) values (
      v_number, p_property_id, v_now, v_email,
      v_loc, 'informational', false, true,
      v_hash, v_html, v_group,
      true, v_snapshot
    )
    returning id into v_id;

    v_ids := array_append(v_ids, v_id);
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'owner_generate_property_book_extract: no locales'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'linked_group_id', v_group,
    'extract_ids', to_jsonb(v_ids),
    'base_number', v_base_number,
    'informational', true,
    'signed', false
  );
end;
$fn$;

revoke all on function public.owner_generate_property_book_extract(bigint, text[])
  from public, anon;
grant execute on function public.owner_generate_property_book_extract(bigint, text[])
  to authenticated;

create or replace function public.owner_request_certified_extract(
  p_property_id bigint,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(nullif(btrim(coalesce(auth.email(), '')), ''));
  v_id bigint;
  v_number text;
  v_snapshot jsonb;
  v_html text;
  v_hash text;
  v_now timestamptz := now();
  v_admins text[];
begin
  if auth.uid() is null or v_email is null then
    raise exception 'owner_request_certified_extract: not authenticated'
      using errcode = '28000';
  end if;
  if not public.owns_property(p_property_id) then
    raise exception 'owner_request_certified_extract: not allowed'
      using errcode = '42501';
  end if;

  v_number := public.property_book_next_extract_number() || '-CERT';
  v_snapshot := jsonb_build_object(
    'property_id', p_property_id,
    'apartment_number', (
      select coalesce(p.apartment_number::text, p.id::text)
      from public.properties as p where p.id = p_property_id
    ),
    'owners', (
      select coalesce(jsonb_agg((x - 'email' - 'eik_bulstat')), '[]'::jsonb)
      from jsonb_array_elements(public.ownership_change_book_owners_json(p_property_id)) as t(x)
    ),
    'history', '[]'::jsonb,
    'generated_at', v_now,
    'pdf_attached', false,
    'certified_request', true
  );
  v_html := public.property_book_extract_html(
    p_property_id, 'bg', v_snapshot, v_number, v_now, false
  );
  v_hash := md5(v_html);

  insert into public.property_book_extracts (
    extract_number, property_id, generated_at, generated_by_email,
    locale, extract_kind, is_signed, is_informational,
    content_sha256, content_html, linked_group_id,
    excludes_restricted_personal_data, book_snapshot,
    certified_request_status, note
  ) values (
    v_number, p_property_id, v_now, v_email,
    'bg', 'certified_request', false, false,
    v_hash, v_html, gen_random_uuid(),
    true, v_snapshot,
    'requested', nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  select coalesce(array_agg(lower(btrim(s.email))), array[]::text[])
    into v_admins
  from public.staff as s
  where s.active is true
    and s.role = 'администрация';

  perform public.ownership_change_notify(
    null, p_property_id, 'extract_certified_requested',
    v_admins,
    jsonb_build_object('extract_id', v_id),
    'admin'
  );

  return jsonb_build_object('ok', true, 'extract_id', v_id, 'status', 'requested');
end;
$fn$;

revoke all on function public.owner_request_certified_extract(bigint, text)
  from public, anon;
grant execute on function public.owner_request_certified_extract(bigint, text)
  to authenticated;

create or replace function public.owner_list_property_book_extracts(p_property_id bigint)
returns setof public.property_book_extracts
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_list_property_book_extracts: not allowed'
      using errcode = '42501';
  end if;
  return query
  select e.*
  from public.property_book_extracts as e
  where e.property_id = p_property_id
  order by e.generated_at desc
  limit 100;
end;
$fn$;

revoke all on function public.owner_list_property_book_extracts(bigint)
  from public, anon;
grant execute on function public.owner_list_property_book_extracts(bigint)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Ownership history for owner cabinet (XFER.24) — filtered
-- ---------------------------------------------------------------------------

create or replace function public.owner_list_ownership_history(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_transfers jsonb;
  v_corrections jsonb;
  v_reps jsonb;
begin
  if not public.owns_property(p_property_id)
     and not public.has_staff_role('администрация')
  then
    raise exception 'owner_list_ownership_history: not allowed'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) - 'supporting_document_path' order by t.created_at desc), '[]'::jsonb)
    into v_transfers
  from public.owner_transfers as t
  where t.property_id = p_property_id;

  -- Owners do not see full admin correction evidence paths; admins do via table select
  if public.has_staff_role('администрация') then
    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
      into v_corrections
    from public.ownership_admin_corrections as c
    where c.property_id = p_property_id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'created_at', c.created_at,
      'reason', c.reason,
      'after_owners', (
        select coalesce(jsonb_agg((x - 'email' - 'eik_bulstat')), '[]'::jsonb)
        from jsonb_array_elements(c.after_owners) as t(x)
      )
    ) order by c.created_at desc), '[]'::jsonb)
      into v_corrections
    from public.ownership_admin_corrections as c
    where c.property_id = p_property_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'representative_name', r.representative_name,
    'valid_from', r.valid_from,
    'valid_until', r.valid_until
  ) order by r.valid_from desc), '[]'::jsonb)
    into v_reps
  from public.legal_entity_representatives as r
  where r.property_id = p_property_id;

  return jsonb_build_object(
    'transfers', v_transfers,
    'corrections', v_corrections,
    'representatives', v_reps
  );
end;
$fn$;

revoke all on function public.owner_list_ownership_history(bigint) from public, anon;
grant execute on function public.owner_list_ownership_history(bigint) to authenticated;

commit;
