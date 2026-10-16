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
} from '@/lib/moduleCore/freshInstallMeterSchema';

const MTR2_MIGRATION =
  'supabase/migrations/20261109120000_mtr2_electricity_meter_assign_replace.sql';
const MTR2_PACKAGE = '82_electricity_meter_assign_replace_rpcs.sql';

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('MTR-2 · electricity meter assign/replace packaging', () => {
  it('orderedFiles includes 82 after electricity meters DDL and auth helpers', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(MTR2_PACKAGE);
    expect(assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES).ok).toBe(true);
    const idx = (f: string) => FRESH_INSTALL_ORDERED_FILES.indexOf(f as (typeof FRESH_INSTALL_ORDERED_FILES)[number]);
    expect(idx(MTR2_PACKAGE)).toBeGreaterThan(idx('20_electricity_meters.sql'));
    expect(idx(MTR2_PACKAGE)).toBeGreaterThan(idx('05_auth_staff_helpers.sql'));
    expect(idx(MTR2_PACKAGE)).toBeLessThan(idx('85_tariff_versions_schema.sql'));
  });

  it('MANIFEST lists assign/replace RPCs and keeps IS-10d financial-safety phase', () => {
    const manifest = parseFreshInstallManifest(
      read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')),
    );
    expect(manifest.phase).toBe('IS-10d');
    expect(manifest.packageId).toBe('is10d_fresh_install_financial_safety');
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.assign_electricity_meter(bigint,text,numeric,numeric,date)',
        'public.replace_electricity_meter(bigint,text,numeric,numeric,date,text)',
      ]),
    );
    expect(manifest.explicitRemainingGaps).toEqual(
      expect.arrayContaining([...REMAINING_GREENFIELD_MIGRATION_GAPS]),
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain('electricity_balance_payment_rpcs');
  });

  it('migration and package SQL match canonical signatures and fail closed', () => {
    const mig = read(MTR2_MIGRATION);
    const pkg = read(path.join(FRESH_INSTALL_PACKAGE_DIR, MTR2_PACKAGE));
    for (const sql of [mig, pkg]) {
      expect(sql).toMatch(
        /create\s+or\s+replace\s+function\s+public\.assign_electricity_meter\s*\(\s*p_property_id\s+bigint/i,
      );
      expect(sql).toMatch(/p_initial_day_reading\s+numeric/i);
      expect(sql).toMatch(/p_initial_night_reading\s+numeric/i);
      expect(sql).toMatch(
        /create\s+or\s+replace\s+function\s+public\.replace_electricity_meter\s*\(\s*p_property_id\s+bigint/i,
      );
      expect(sql).toMatch(/p_replacement_reason\s+text/i);
      expect(sql).toMatch(/security\s+definer/i);
      expect(sql).toMatch(/set\s+search_path\s*=\s*''/i);
      expect(sql).toMatch(/An active electricity meter is already assigned/i);
      expect(sql).toMatch(/to_regclass\('public\.electricity_meters'\)/i);
      expect(sql).toMatch(/to_regprocedure\('public\.has_staff_role\(text\)'\)/i);
      expect(sql).not.toMatch(/\binsert\s+into\s+public\.electricity_ledger\b/i);
      expect(sql).not.toMatch(/\binsert\s+into\s+public\.electricity_charges\b/i);
      expect(sql).not.toMatch(/\binsert\s+into\s+public\.meter_readings\b/i);
      expect(sql).not.toMatch(/\binsert\s+into\s+public\.tariff_versions\b/i);
      expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+authenticated/i);
      expect(sql).toMatch(/revoke\s+all[\s\S]*from\s+anon/i);
    }
  });

  it('package object coverage includes electricity assign/replace', () => {
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
