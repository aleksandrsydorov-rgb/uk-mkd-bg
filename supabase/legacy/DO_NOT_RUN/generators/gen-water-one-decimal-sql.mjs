import fs from 'node:fs';

const src = fs.readFileSync('supabase/water_submission_mode_hotfix.sql', 'utf8');
const m = src.match(
  /create or replace function public\.submit_water_reading\([\s\S]*?grant execute on function public\.submit_water_reading\(bigint, numeric, date, uuid\) to authenticated;/,
);
if (!m) throw new Error('submit_water_reading not found');
if (!m[0].includes('round(p_current_value, 1)')) throw new Error('round 1 missing');

const out = `-- =============================================================================
-- AMADEUS 11 — water reading one-decimal hotfix
-- =============================================================================
-- Encoding: UTF-8 (no BOM).
-- Replaces submit_water_reading only: normalize current/previous to 1 decimal.
-- Does not UPDATE historical rows.
-- Does not change tables, assign/replace, tariffs, or ledger logic.
-- Apply after water_submission_mode_hotfix.sql if that version still uses round(..., 3).
-- =============================================================================

BEGIN;

${m[0]}

COMMIT;
`;

fs.writeFileSync('supabase/water_one_decimal_hotfix.sql', out, { encoding: 'utf8' });
console.log('wrote water_one_decimal_hotfix.sql', out.length);
