-- =============================================================================
-- Package-phase stub. Legal-entity electricity readings wait for a UK rate.
-- Full SQL lives in chronological migration
--   supabase/migrations/20261130180000_r1_rc8_legal_entity_electricity.sql
-- Does not publish a complex tariff and does not rewrite old charges.
-- =============================================================================

do $notice$
begin
  raise notice '122_r1_rc8_legal_entity_electricity: package stub — apply via chronological migration 20261130180000';
end;
$notice$;
