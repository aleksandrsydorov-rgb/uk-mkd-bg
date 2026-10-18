import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FRESH_INSTALL_ORDERED_FILES,
  REMAINING_GREENFIELD_MIGRATION_GAPS,
} from '@/lib/moduleCore';
import { readBulkAccrualSummary } from '@/lib/bulkAccrual';

const PKG = path.resolve(process.cwd(), 'supabase/packages/fresh_install');

describe('R1-CR FINAL · Capital Repair bulk packaging', () => {
  it('orderedFiles place 85a bulk after 85 tariff resolvers', () => {
    const idx85 = FRESH_INSTALL_ORDERED_FILES.indexOf('85_tariff_versions_schema.sql');
    const idx85a = FRESH_INSTALL_ORDERED_FILES.indexOf('85a_capital_repair_bulk_rpcs.sql');
    expect(idx85).toBeGreaterThanOrEqual(0);
    expect(idx85a).toBe(idx85 + 1);
  });

  it('packages ensure + bulk + year_bulk with staff authz and skip-existing conflict', () => {
    const sql = readFileSync(path.join(PKG, '85a_capital_repair_bulk_rpcs.sql'), 'utf8');
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.ensure_capital_repair_year_assessment/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair_bulk/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair_year_bulk/i);
    expect(sql).toMatch(/has_staff_role\('администрация'\)/);
    expect(sql).toMatch(/has_staff_role\('бухгалтер'\)/);
    expect(sql).toMatch(/resolve_capital_tariff_for_year/);
    expect(sql).toMatch(/on conflict \(property_id, assessment_id\)/i);
    expect(sql).toMatch(/do nothing/i);
    expect(sql).toMatch(/skipped_existing/);
    expect(sql).toMatch(/Capital repair module is disabled/);
    // No invented published tariff seeds in bulk file
    expect(sql).not.toMatch(/insert\s+into\s+public\.tariff_versions/i);
  });

  it('MANIFEST requires bulk RPCs and drops bulk from remaining gaps', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PKG, 'MANIFEST.json'), 'utf8'),
    ) as {
      orderedFiles: string[];
      requiredFunctionsAfterPackage: string[];
      explicitRemainingGaps: string[];
    };
    expect(manifest.orderedFiles).toContain('85a_capital_repair_bulk_rpcs.sql');
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.ensure_capital_repair_year_assessment(integer)',
        'public.charge_capital_repair_bulk(uuid,integer,text)',
        'public.charge_capital_repair_year_bulk(integer,text)',
      ]),
    );
    expect(manifest.explicitRemainingGaps).not.toContain(
      'charge_capital_repair_bulk_and_year_bulk',
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'charge_capital_repair_bulk_and_year_bulk',
    );
  });

  it('readBulkAccrualSummary parses year_bulk JSON shape (preview/result contract)', () => {
    const summary = readBulkAccrualSummary({
      total: 10,
      created: 7,
      skipped_existing: 3,
      not_applied: 0,
      assessment_id: 'a1',
      billing_year: 2026,
      amount_eur: 120,
    });
    expect(summary).toEqual({
      total: 10,
      created: 7,
      skipped_existing: 3,
      not_applied: 0,
      repriced: 0,
    });
  });
});
