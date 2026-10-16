import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  OPENING_READING_ROW_COMMIT,
  REMAINING_GREENFIELD_MIGRATION_GAPS,
  assertFreshInstallDependencyOrder,
  assertPackageObjectCoverage,
  isOpeningReadingRowCommitEnabled,
  parseFreshInstallManifest,
} from '@/lib/moduleCore';

const MTR3_MIGRATION =
  'supabase/migrations/20261109130000_mtr3_opening_readings_and_safe_corrections.sql';
const MTR3_SUBMIT_PATCH =
  'supabase/migrations/20261109130100_mtr3_submit_electricity_active_filter.sql';
const MTR3_PACKAGE = '83_opening_readings_and_safe_corrections.sql';

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('MTR-3 · opening readings and safe corrections packaging', () => {
  it('enables charge-free opening reading row commit', () => {
    expect(OPENING_READING_ROW_COMMIT).toBe('ENABLED');
    expect(isOpeningReadingRowCommitEnabled()).toBe(true);
  });

  it('orderedFiles include 83 after utilities DDL and MTR-2 assign RPCs', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(MTR3_PACKAGE);
    expect(assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES).ok).toBe(true);
    const idx = (f: string) =>
      FRESH_INSTALL_ORDERED_FILES.indexOf(f as (typeof FRESH_INSTALL_ORDERED_FILES)[number]);
    expect(idx(MTR3_PACKAGE)).toBeGreaterThan(idx('75_utilities_readings_ledgers.sql'));
    expect(idx(MTR3_PACKAGE)).toBeGreaterThan(idx('82_electricity_meter_assign_replace_rpcs.sql'));
  });

  it('MANIFEST requires opening/correct RPCs; charged/paid gap closed by MTR-3F', () => {
    const manifest = parseFreshInstallManifest(
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')),
    );
    expect(manifest.phase).toBe('IS-10d');
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.register_water_opening_reading(bigint,numeric,date,text,uuid)',
        'public.register_electricity_opening_reading(bigint,numeric,numeric,date,text,uuid)',
        'public.correct_water_reading(uuid,numeric,text,uuid)',
        'public.correct_electricity_reading(bigint,bigint,numeric,numeric,text,uuid)',
      ]),
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'charged_paid_meter_reading_financial_correction',
    );
    expect(manifest.explicitRemainingGaps).toEqual(
      expect.arrayContaining([...REMAINING_GREENFIELD_MIGRATION_GAPS]),
    );
  });

  it('opening SQL never posts operational charges; MTR-3F posts adjustments only', () => {
    const mig = read(MTR3_MIGRATION);
    const pkg = read(path.join(FRESH_INSTALL_PACKAGE_DIR, MTR3_PACKAGE));
    for (const sql of [mig, pkg]) {
      expect(sql).toMatch(/register_water_opening_reading/i);
      expect(sql).toMatch(/register_electricity_opening_reading/i);
      expect(sql).toMatch(/correct_water_reading/i);
      expect(sql).toMatch(/correct_electricity_reading/i);
      expect(sql).not.toMatch(/\binsert\s+into\s+public\.electricity_charges\b/i);
      expect(sql).toMatch(/tariff_eur_per_m3/i);
      expect(sql).toMatch(/reading_kind/i);
    }
    const patch = read(MTR3_SUBMIT_PATCH);
    expect(patch).toMatch(/coalesce\(r\.status,\s*'active'\)\s*=\s*'active'/i);

    const mtr3f = read(
      'supabase/migrations/20261109140000_mtr3f_charged_paid_reading_corrections.sql',
    );
    expect(mtr3f).toMatch(/adjustment_debit/i);
    expect(mtr3f).toMatch(/adjustment_credit/i);
    expect(mtr3f).toMatch(/mtr3f:water_reading:/i);
    expect(mtr3f).not.toMatch(/Reading correction blocked: charge exists/i);
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('83f_charged_paid_reading_corrections.sql');
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'charged_paid_meter_reading_financial_correction',
    );
  });

  it('package object coverage includes MTR-3 RPCs', () => {
    const manifest = parseFreshInstallManifest(
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')),
    );
    const sql = FRESH_INSTALL_ORDERED_FILES.map((f) =>
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, f)),
    ).join('\n');
    const coverage = assertPackageObjectCoverage(
      sql,
      manifest.requiredRelationsAfterPackage,
      manifest.requiredFunctionsAfterPackage ?? [],
    );
    expect(coverage.missingFunctions).toEqual([]);
    expect(coverage.ok).toBe(true);
  });
});
