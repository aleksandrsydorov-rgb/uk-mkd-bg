-- R1-DEPLOY Gate B1 — Auto Expose OFF Data API grants (test project only when applied)
-- Target pattern: Data API ON + Automatically expose new tables OFF.
--
-- Scope (minimal necessary):
--   - service_role: table DML + sequence usage (server admin client / First Boot RPCs via REST)
--   - authenticated: SELECT on module_catalog + building_modules (UI catalog reads)
--   - anon: schema USAGE only — NO table grants
--
-- Does NOT:
--   - disable or alter RLS policies
--   - GRANT any table privilege to anon
--   - enable Email sending, Debt Gate, Meetings, or Rental

begin;

grant usage on schema public to anon, authenticated, service_role;

-- Server role only (PostgREST service_role still requires explicit GRANTs when auto-expose is OFF).
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

-- Future tables created by the migration owner inherit the same service_role DML.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;

-- Narrow authenticated catalog reads (no anon; no write grants here).
grant select on table public.module_catalog to authenticated;
grant select on table public.building_modules to authenticated;

commit;
