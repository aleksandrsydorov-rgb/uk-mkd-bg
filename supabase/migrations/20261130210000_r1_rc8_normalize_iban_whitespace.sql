-- =============================================================================
-- R1-RC8 — Fix normalize_iban whitespace stripping
-- =============================================================================
-- Dollar-quoted '\\s+' was a literal backslash-s pattern, so spaces in IBAN
-- input were not removed. Use POSIX [[:space:]] inside $fn$ bodies.
-- =============================================================================

begin;

create or replace function public.normalize_iban(p_iban text)
returns text
language sql
immutable
as $fn$
  select nullif(upper(regexp_replace(coalesce(p_iban, ''), '[[:space:]]+', '', 'g')), '');
$fn$;

revoke all on function public.normalize_iban(text) from public, anon;
grant execute on function public.normalize_iban(text) to authenticated;

commit;
