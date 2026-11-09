-- Poll attachments: multiple images + PDF in the existing poll-images bucket.
-- Keeps polls.photo_url for legacy readers; attachments jsonb is the source of truth.

alter table public.polls
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.polls.attachments is
  'Ordered poll attachments: [{path,name,size,contentType}]. Same private bucket as photo_url.';

-- Backfill legacy single photo into attachments (compat).
update public.polls p
set attachments = jsonb_build_array(
  jsonb_build_object(
    'path', p.photo_url,
    'name', coalesce(nullif(split_part(p.photo_url, '/', 3), ''), 'photo'),
    'size', null,
    'contentType', case
      when lower(p.photo_url) like '%.png' then 'image/png'
      when lower(p.photo_url) like '%.webp' then 'image/webp'
      when lower(p.photo_url) like '%.gif' then 'image/gif'
      when lower(p.photo_url) like '%.bmp' then 'image/bmp'
      when lower(p.photo_url) like '%.heic' then 'image/heic'
      when lower(p.photo_url) like '%.heif' then 'image/heif'
      else 'image/jpeg'
    end
  )
)
where p.photo_url is not null
  and btrim(p.photo_url) <> ''
  and (
    p.attachments is null
    or p.attachments = '[]'::jsonb
    or jsonb_typeof(p.attachments) <> 'array'
  );

-- Allow PDF in the existing private poll-images bucket (not a new store).
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/bmp',
  'application/pdf'
]
where id = 'poll-images';

-- Read access: path must be linked on the poll (photo_url or attachments), same audience.
create or replace function public.can_read_poll_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.polls as p
    where p_name like 'polls/' || p.id::text || '/%'
      and (
        p.photo_url = p_name
        or exists (
          select 1
          from jsonb_array_elements(coalesce(p.attachments, '[]'::jsonb)) as e
          where e->>'path' = p_name
        )
      )
      and (public.is_owner() or public.is_staff())
  );
$fn$;

revoke all on function public.can_read_poll_image(text) from public;
grant execute on function public.can_read_poll_image(text) to authenticated;
