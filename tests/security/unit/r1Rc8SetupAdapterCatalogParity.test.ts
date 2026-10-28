import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  bootstrapModuleSetupAdapters,
  listRegisteredModuleKeys,
  resetModuleSetupAdaptersForTests,
} from '@/lib/moduleCore';
import { isRelease1DistributionExcluded } from '@/lib/modules';

const PKG = path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR);
const PARITY_PKG = '99_r1_rc8_setup_adapter_catalog_parity.sql';
const PARITY_MIG =
  'supabase/migrations/20261123120000_r1_rc8_setup_adapter_catalog_parity.sql';

/** Production wizard keys that must pass module_lifecycle_block_unimplemented. */
const SETUP_ADAPTER_CATALOG_KEYS = [
  'property_book',
  'water',
  'electricity',
  'support_fee',
  'internet',
  'uk_expenses',
  'capital_repair',
  'inventory',
  'guest_mode',
  'chat',
  'requests',
  'announcements',
  'building_documents',
] as const;

/** Test-only stub — must NOT require catalog implemented. */
const TEST_ONLY_ADAPTER_KEYS = ['example_opening_roster'] as const;

function assertCatalogImplementedTrue(sql: string, moduleKey: string) {
  const re = new RegExp(`\\('${moduleKey}'\\s*,[^)]*?true\\s*,`, 'm');
  expect(sql, `${moduleKey} must seed implemented=true`).toMatch(re);
}

describe('R1-RC8 setup adapter ↔ module_catalog parity', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('bootstrap registers production keys + test stub only', () => {
    const keys = listRegisteredModuleKeys().sort();
    for (const k of SETUP_ADAPTER_CATALOG_KEYS) {
      expect(keys).toContain(k);
    }
    for (const k of TEST_ONLY_ADAPTER_KEYS) {
      expect(keys).toContain(k);
    }
    expect(keys.filter((k) => !isRelease1DistributionExcluded(k))).not.toContain('rental');
  });

  it('additive migration + package close property_book / uk_expenses gaps', () => {
    const mig = readFileSync(path.join(process.cwd(), PARITY_MIG), 'utf8');
    const pkg = readFileSync(path.join(PKG, PARITY_PKG), 'utf8');
    for (const sql of [mig, pkg]) {
      assertCatalogImplementedTrue(sql, 'property_book');
      assertCatalogImplementedTrue(sql, 'uk_expenses');
      expect(sql).toMatch(/module_key = 'rental'/);
      expect(sql).toMatch(/implemented = false/);
      expect(sql).not.toMatch(/building_modules[\s\S]*enabled\s*=\s*true/i);
      expect(sql).not.toMatch(/\('example_opening_roster'/);
    }
    // Upgrade migration also seeds lifecycle; package stays catalog-only (pre-IS-1).
    expect(mig).toMatch(/insert into public\.module_lifecycle/);
    expect(pkg).not.toMatch(/insert into public\.module_lifecycle/);
    // Dry-run path: text apartment_number lookup (blocks confirm button otherwise).
    expect(mig).toMatch(/apartment_number = v_apt_num/);
    expect(mig).toMatch(/apartment_number = v_apt/);
    expect(mig).toMatch(/pg_get_functiondef/);
  });

  it('fresh-install orders parity after storage baseline', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(PARITY_PKG);
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PARITY_PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('98_storage_buckets_baseline.sql'),
    );
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PARITY_PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('96_r1_module_catalog_implemented_parity.sql'),
    );
  });

  it('MANIFEST inventories migration and bumps expected count', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PKG, 'MANIFEST.json'), 'utf8'),
    ) as {
      orderedFiles: string[];
      chronologicalMigrationsPackaged: string[];
      chronologicalMigrationTree: string[];
      expectedChronologicalMigrationCount: number;
    };
    expect(manifest.orderedFiles).toContain(PARITY_PKG);
    expect(manifest.chronologicalMigrationsPackaged).toContain(PARITY_MIG);
    expect(manifest.chronologicalMigrationTree).toContain(PARITY_MIG);
    expect(manifest.expectedChronologicalMigrationCount).toBe(
      manifest.chronologicalMigrationTree.length,
    );
    expect(manifest.expectedChronologicalMigrationCount).toBe(148);
  });

  it('UI confirm button still gated on dry-run pendingPayload + batchId', () => {
    const ui = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminInitialSetup.tsx'),
      'utf8',
    );
    expect(ui).toMatch(/admin_import_property_book/);
    expect(ui).toMatch(/p_dry_run:\s*true/);
    expect(ui).toMatch(
      /isPropertyBook && pendingPayload && batchId[\s\S]*?is2PropertyBookConfirmButton/,
    );
    expect(ui).toMatch(/transition\('SETUP_REQUIRED'/);
    expect(ui).toMatch(/transition\('SETUP_IN_PROGRESS'/);
  });
});
