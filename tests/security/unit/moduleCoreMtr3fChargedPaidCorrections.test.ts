import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  REMAINING_GREENFIELD_MIGRATION_GAPS,
  assertFreshInstallDependencyOrder,
  assertPackageObjectCoverage,
  parseFreshInstallManifest,
} from '@/lib/moduleCore';
import { readFreshInstallCoverageSql } from './_freshInstallCoverageSql';

const MTR3F =
  'supabase/migrations/20261109140000_mtr3f_charged_paid_reading_corrections.sql';
const MTR3F_PKG = '83f_charged_paid_reading_corrections.sql';

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('MTR-3F · charged/paid reading corrections', () => {
  it('packages after MTR-3 opening RPCs and preserves IS-10d', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(MTR3F_PKG);
    expect(assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES).ok).toBe(true);
    const idx = (f: string) =>
      FRESH_INSTALL_ORDERED_FILES.indexOf(f as (typeof FRESH_INSTALL_ORDERED_FILES)[number]);
    expect(idx(MTR3F_PKG)).toBeGreaterThan(idx('83_opening_readings_and_safe_corrections.sql'));

    const manifest = parseFreshInstallManifest(
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')),
    );
    expect(manifest.phase).toBe('IS-10d');
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'charged_paid_meter_reading_financial_correction',
    );
  });

  it('uses canonical adjustment_debit/credit; never mutates payments or duplicate charges', () => {
    const sql = read(MTR3F);
    const pkg = read(path.join(FRESH_INSTALL_PACKAGE_DIR, MTR3F_PKG));
    for (const s of [sql, pkg]) {
      expect(s).toMatch(/Accounting invariants/i);
      expect(s).toMatch(/adjustment_debit/);
      expect(s).toMatch(/adjustment_credit/);
      expect(s).toMatch(/mtr3f:water_reading:/);
      expect(s).toMatch(/mtr3f:electricity_charge:/);
      expect(s).not.toMatch(/\bdelete\s+from\s+public\.water_ledger\b/i);
      expect(s).not.toMatch(/\bdelete\s+from\s+public\.electricity_ledger\b/i);
      expect(s).not.toMatch(/\bupdate\s+public\.water_ledger\b/i);
      expect(s).not.toMatch(/\bupdate\s+public\.electricity_charges\b/i);
      expect(s).not.toMatch(/\binsert\s+into\s+public\.water_ledger\b[\s\S]{0,200}'charge'/i);
      expect(s).not.toMatch(/\binsert\s+into\s+public\.electricity_ledger\b[\s\S]{0,200}'charge'/i);
      expect(s).toMatch(/'adjustment_debit'/);
      expect(s).toMatch(/has_staff_role\('администрация'\)/);
    }
  });

  it('package coverage still ok after 83f', () => {
    const manifest = parseFreshInstallManifest(
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')),
    );
    const coverage = assertPackageObjectCoverage(
      readFreshInstallCoverageSql(),
      manifest.requiredRelationsAfterPackage,
      manifest.requiredFunctionsAfterPackage ?? [],
    );
    expect(coverage.missingFunctions).toEqual([]);
    expect(coverage.ok).toBe(true);
  });
});
