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

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('MTR-4 · final meter packaging', () => {
  it('orders balance/payment before tariff versions and submit after', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('84_utility_balance_payment_rpcs.sql');
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('87_utility_submit_resolve_packaging.sql');
    expect(assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES).ok).toBe(true);
    const idx = (f: string) =>
      FRESH_INSTALL_ORDERED_FILES.indexOf(f as (typeof FRESH_INSTALL_ORDERED_FILES)[number]);
    expect(idx('84_utility_balance_payment_rpcs.sql')).toBeGreaterThan(
      idx('75_utilities_readings_ledgers.sql'),
    );
    expect(idx('87_utility_submit_resolve_packaging.sql')).toBeGreaterThan(
      idx('85_tariff_versions_schema.sql'),
    );
  });

  it('closes submit and electricity finance packaging gaps', () => {
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'water_electricity_submit_operational_rpcs',
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain('electricity_balance_payment_rpcs');
    const manifest = parseFreshInstallManifest(
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')),
    );
    expect(manifest.phase).toBe('IS-10d');
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.get_water_balance(bigint)',
        'public.get_electricity_balance(bigint)',
        'public.record_electricity_payment(bigint,numeric,text,uuid)',
        'public.submit_water_reading(bigint,numeric,date,uuid)',
        'public.submit_electricity_reading(bigint,numeric,numeric,date,uuid)',
      ]),
    );
    expect(manifest.explicitRemainingGaps).toEqual(
      expect.arrayContaining([...REMAINING_GREENFIELD_MIGRATION_GAPS]),
    );
  });

  it('balance/payment SQL never seeds prices or invents charge kinds', () => {
    const sql = read(
      path.join(FRESH_INSTALL_PACKAGE_DIR, '84_utility_balance_payment_rpcs.sql'),
    );
    expect(sql).toMatch(/get_water_balance/i);
    expect(sql).toMatch(/get_electricity_balance/i);
    expect(sql).toMatch(/record_electricity_payment/i);
    expect(sql).not.toMatch(/\binsert\s+into\s+public\.tariff_versions\b/i);
    expect(sql).not.toMatch(/\binsert\s+into\s+public\.water_ledger\b[\s\S]{0,120}'charge'/i);
  });

  it('submit package includes resolve and active-status electricity filter', () => {
    const sql = read(
      path.join(FRESH_INSTALL_PACKAGE_DIR, '87_utility_submit_resolve_packaging.sql'),
    );
    expect(sql).toMatch(/resolve_utility_tariff/i);
    expect(sql).toMatch(/submit_water_reading/i);
    expect(sql).toMatch(/submit_electricity_reading/i);
    expect(sql).toMatch(/coalesce\(r\.status,\s*'active'\)\s*=\s*'active'/i);
    expect(sql).not.toMatch(/\binsert\s+into\s+public\.tariff_versions\b/i);
  });

  it('package object coverage includes MTR-4 RPCs', () => {
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
