-- Do not wipe existing owners when overwrite is on but the file has no creatable
-- owner rows for that apartment (identity-only placeholders / omitted owners).
-- New apartments may still be created with an empty owner set.

do $patch$
declare
  v_def text;
  v_new text;
  v_old text := $old$
      -- Replace owners only when file has creatable rows, or create with empty,
      -- or overwrite explicitly requested (may clear non-creatable-only payloads).
      if jsonb_array_length(v_creatable) > 0
         or v_would_create
         or coalesce(p_allow_overwrite, false) then
        perform public.admin_replace_property_book_owners(v_prop_id, v_creatable);
      end if;
$old$;
  v_repl text := $new$
      -- Replace owners only when the file has creatable owner rows, or when
      -- creating a new apartment (empty set). Overwrite alone must not wipe.
      if jsonb_array_length(v_creatable) > 0
         or v_would_create then
        perform public.admin_replace_property_book_owners(v_prop_id, v_creatable);
      end if;
$new$;
begin
  select pg_get_functiondef('public.admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean)'::regprocedure)
    into v_def;
  if v_def is null then
    raise exception 'admin_import_property_book(jsonb,jsonb,boolean,boolean,boolean) not found';
  end if;
  if position(v_old in v_def) = 0 then
    if position('or coalesce(p_allow_overwrite, false) then' in v_def) = 0
       or position('admin_replace_property_book_owners(v_prop_id, v_creatable)' in v_def) = 0 then
      raise notice 'admin_import_property_book: wipe-on-overwrite arm already absent';
      return;
    end if;
    raise exception 'admin_import_property_book: expected replace-owners block not found';
  end if;
  v_new := replace(v_def, v_old, v_repl);
  execute v_new;
end;
$patch$;
