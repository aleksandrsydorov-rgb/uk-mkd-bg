import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
} from '@/lib/moduleCore';
import {
  IMPLEMENTED_MODULE_KEYS,
  RELEASE_1_DISTRIBUTION_EXCLUDED_MODULE_KEYS,
  isImplementedModuleKey,
  isModuleToggleable,
  isRelease1DistributionExcluded,
} from '@/lib/modules';

const PKG = path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR);
const PARITY_PKG = '96_r1_module_catalog_implemented_parity.sql';
const PARITY_MIG = 'supabase/migrations/20261120120000_r1_module_catalog_implemented_parity.sql';

/** Mandatory Distribution R1.0 product surfaces (catalog keys where applicable). */
const R1_MANDATORY_CATALOG_KEYS = [
  'water',
  'electricity',
  'budget',
  'internet',
  'requests',
  'chat',
  'residence_status',
  'cleaning',
  'support_fee',
  'capital_repair',
  'inventory',
] as const;

function assertImplementedTrue(sql: string, moduleKey: string) {
  const re = new RegExp(`\\('${moduleKey}'\\s*,[^)]*?true\\s*,`, 'm');
  expect(sql, `${moduleKey} must seed implemented=true`).toMatch(re);
}

function assertImplementedFalse(sql: string, moduleKey: string) {
  const re = new RegExp(`\\('${moduleKey}'\\s*,[^)]*?false\\s*,`, 'm');
  expect(sql, `${moduleKey} must seed implemented=false`).toMatch(re);
}

describe('R1 module catalog implemented parity', () => {
  it('client allowlist includes mandatory R1 catalog keys + inventory', () => {
    for (const key of R1_MANDATORY_CATALOG_KEYS) {
      expect(IMPLEMENTED_MODULE_KEYS).toContain(key);
      expect(isImplementedModuleKey(key)).toBe(true);
    }
    expect(isModuleToggleable('internet', true)).toBe(true);
    expect(isModuleToggleable('inventory', true)).toBe(true);
    expect(isModuleToggleable('cleaning', true)).toBe(true);
  });

  it('RC8: Meetings implemented/toggleable; Rental stays excluded', () => {
    expect(RELEASE_1_DISTRIBUTION_EXCLUDED_MODULE_KEYS).toEqual(['rental']);
    expect(IMPLEMENTED_MODULE_KEYS).toContain('general_meeting');
    expect(IMPLEMENTED_MODULE_KEYS).not.toContain('rental');
    expect(isRelease1DistributionExcluded('general_meeting')).toBe(false);
    expect(isRelease1DistributionExcluded('rental')).toBe(true);
    expect(isModuleToggleable('general_meeting', true)).toBe(true);
    expect(isModuleToggleable('rental', true)).toBe(false);
  });

  it('fresh-install baseline seeds R1 live modules as implemented=true', () => {
    const baseline = readFileSync(path.join(PKG, '60_module_catalog_baseline.sql'), 'utf8');
    for (const key of [
      'internet',
      'cleaning',
      'security',
      'inventory',
      'budget',
      'tariffs',
      'water',
      'electricity',
      'support_fee',
      'capital_repair',
      'requests',
      'chat',
      'residence_status',
    ] as const) {
      assertImplementedTrue(baseline, key);
    }
    assertImplementedFalse(baseline, 'general_meeting');
    assertImplementedFalse(baseline, 'rental');
  });

  it('package parity file is ordered after baseline and restores internet/cleaning/inventory', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(PARITY_PKG);
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PARITY_PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('60_module_catalog_baseline.sql'),
    );
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PARITY_PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('88b_r1_mt_hide_general_meeting.sql'),
    );

    const sql = readFileSync(path.join(PKG, PARITY_PKG), 'utf8');
    assertImplementedTrue(sql, 'internet');
    assertImplementedTrue(sql, 'cleaning');
    assertImplementedTrue(sql, 'security');
    assertImplementedTrue(sql, 'inventory');
    expect(sql).toMatch(/module_key in \('general_meeting', 'rental'\)/);
    expect(sql).not.toMatch(/email_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/ordinary_debt_gate_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/building_modules[\s\S]*enabled\s*=\s*true/i);

    // RC8 restore package supersedes Meetings hide after parity
    const restorePkg = '97_r1_rc8_restore_general_meeting.sql';
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(restorePkg)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf(PARITY_PKG),
    );
    const restoreSql = readFileSync(path.join(PKG, restorePkg), 'utf8');
    expect(restoreSql).toMatch(/'general_meeting'[\s\S]*?true/);
    expect(restoreSql).toMatch(/module_key = 'rental'/);
  });

  it('chronological migration repairs IS-9a overwrite after 20261028', () => {
    const mig = readFileSync(path.join(process.cwd(), PARITY_MIG), 'utf8');
    expect(mig).toMatch(/is9a/i);
    assertImplementedTrue(mig, 'internet');
    assertImplementedTrue(mig, 'cleaning');
    assertImplementedTrue(mig, 'security');
    assertImplementedTrue(mig, 'inventory');
    expect(mig).toMatch(/general_meeting/);
    expect(mig).toMatch(/implemented = false/);

    const restore = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261121120000_r1_rc8_restore_general_meeting.sql',
      ),
      'utf8',
    );
    expect(restore).toMatch(/implemented = true/);
  });

  it('Settings cleaning deep-link uses уборка not клиник', () => {
    const panel = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminModuleCatalogPanel.tsx'),
      'utf8',
    );
    const hub = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminSettingsHub.tsx'),
      'utf8',
    );
    expect(panel).toMatch(/cleaning:\s*'уборка'/);
    expect(hub).toMatch(/cleaning:\s*'уборка'/);
    expect(panel).not.toMatch(/cleaning:\s*'клининг'/);
    expect(hub).not.toMatch(/cleaning:\s*'клининг'/);
  });

  it('MANIFEST includes parity package file and migration', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PKG, 'MANIFEST.json'), 'utf8'),
    ) as {
      orderedFiles: string[];
      chronologicalMigrationsPackaged: string[];
    };
    expect(manifest.orderedFiles).toContain(PARITY_PKG);
    expect(manifest.chronologicalMigrationsPackaged).toContain(PARITY_MIG);
  });
});
