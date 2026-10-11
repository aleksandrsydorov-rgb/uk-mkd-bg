-- PKG-XFER P6.6/P6.8: allow PDF attach to enrich book_snapshot metadata.
-- Content HTML/SHA and identity fields stay immutable; has_pdf/path/sha attach OK.
-- Previous trigger treated any book_snapshot change as forbidden, breaking
-- owner_attach_property_book_extract_pdf (stage5b merges pdf_attached flags).

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
       or new.extract_number is distinct from old.extract_number
       or new.property_id is distinct from old.property_id
       or new.generated_at is distinct from old.generated_at
       or new.locale is distinct from old.locale
       or new.linked_group_id is distinct from old.linked_group_id
    then
      raise exception 'property_book_extracts: immutable content fields'
        using errcode = '42501';
    end if;

    -- After PDF attached: freeze attachment fields (P6.8 archive)
    if old.has_pdf is true then
      if new.has_pdf is distinct from old.has_pdf
         or new.storage_path is distinct from old.storage_path
         or new.pdf_sha256 is distinct from old.pdf_sha256
         or new.building_document_id is distinct from old.building_document_id
         or new.content_html is distinct from old.content_html
      then
        raise exception 'property_book_extracts: immutable after PDF attach'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$fn$;
