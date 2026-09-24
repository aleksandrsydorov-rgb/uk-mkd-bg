import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = '\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f';

const sql = `-- =============================================================================
-- AMADEUS 11 — UTF-8 fix for public.can_read_property_book
-- Encoding: UTF-8 (no BOM). BEGIN/COMMIT included. Do not execute from app.
-- Recreates only the helper. Does not change owns_property(), occupancy,
-- finance, meters, or polls.
-- =============================================================================

begin;

create or replace function public.can_read_property_book(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.owns_property(p_property_id)
    or public.has_staff_role('${ADMIN}');
$fn$;

revoke all on function public.can_read_property_book(bigint) from public;
revoke execute on function public.can_read_property_book(bigint) from anon;
grant execute on function public.can_read_property_book(bigint) to authenticated;

commit;
`;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const path = join(dir, 'property_registry_utf8_fix.sql');
writeFileSync(path, sql, { encoding: 'utf8' });
const buf = Buffer.from(sql, 'utf8');
if (!buf.includes(Buffer.from(ADMIN, 'utf8'))) {
  throw new Error('UTF-8 fix missing administration literal');
}
if (buf.includes(Buffer.from('\uFFFD')) || buf.includes(Buffer.from('Ð°Ð´Ð¼'))) {
  throw new Error('UTF-8 fix contains mojibake');
}
console.log('wrote property_registry_utf8_fix.sql');
