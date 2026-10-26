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
  emptyBuildingModulesState,
  isBuildingModuleEnabled,
  isImplementedModuleKey,
  isModuleToggleable,
  isRelease1DistributionExcluded,
} from '@/lib/modules';
import { catalogModuleKeys } from '@/lib/email/eventCatalog';
import { EMAIL_MODULE_INTEGRATIONS } from '@/lib/email/moduleIntegrations';
import { canEnqueueEmail } from '@/lib/securityRpcPolicy';

const HIDE_MIG = 'supabase/migrations/20261117130000_r1_mt_hide_general_meeting.sql';
const RESTORE_MIG = 'supabase/migrations/20261121120000_r1_rc8_restore_general_meeting.sql';
const RESTORE_PKG = '97_r1_rc8_restore_general_meeting.sql';

describe('R1-MT-HIDE history · Meetings hide migration retained', () => {
  it('RC7 hide migration remains in tree and is not rewritten', () => {
    const mig = readFileSync(path.join(process.cwd(), HIDE_MIG), 'utf8');
    expect(mig).toMatch(/R1-MT-HIDE/);
    expect(mig).toMatch(/general_meeting_module_available/);
    expect(mig).toMatch(/general_meeting_assert_available/);
    expect(mig).toMatch(/general_meeting_block_mutate_when_unavailable/);
    expect(mig).toMatch(/module_lifecycle_block_unimplemented/);
    expect(mig).toMatch(/state = 'DISABLED'/);
    expect(mig).toMatch(/meetings not available in this release/);
    expect(mig).toMatch(/implemented = false/);
    expect(mig).toMatch(/Schema \/ historical migrations retained for future upgrade/);
    expect(mig).not.toMatch(/drop table.*general_meetings/i);
    expect(mig).toMatch(/general_meeting\.allow_mutate/);
  });

  it('fresh-install still packages hide gate after email core (before RC8 restore)', () => {
    const idx88 = FRESH_INSTALL_ORDERED_FILES.indexOf('88_email_core_baseline.sql');
    const idx88b = FRESH_INSTALL_ORDERED_FILES.indexOf('88b_r1_mt_hide_general_meeting.sql');
    const idx97 = FRESH_INSTALL_ORDERED_FILES.indexOf(RESTORE_PKG);
    expect(idx88).toBeGreaterThanOrEqual(0);
    expect(idx88b).toBeGreaterThan(idx88);
    expect(idx97).toBeGreaterThan(idx88b);

    const gate = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '88b_r1_mt_hide_general_meeting.sql'),
      'utf8',
    );
    expect(gate).toMatch(/general_meeting_module_available/);
    expect(gate).toMatch(/implemented = false/);
  });
});

describe('R1-RC8 · Meetings restored; Rental stays excluded', () => {
  it('release composition excludes rental only', () => {
    expect(RELEASE_1_DISTRIBUTION_EXCLUDED_MODULE_KEYS).toEqual(['rental']);
    expect(isRelease1DistributionExcluded('general_meeting')).toBe(false);
    expect(isRelease1DistributionExcluded('rental')).toBe(true);
    expect(isImplementedModuleKey('general_meeting')).toBe(true);
    expect(IMPLEMENTED_MODULE_KEYS).toContain('general_meeting');
    expect(IMPLEMENTED_MODULE_KEYS).not.toContain('rental');
  });

  it('client: Meetings toggleable when implemented; disabled stays fail-closed; enabled works', () => {
    const off = emptyBuildingModulesState();
    expect(isBuildingModuleEnabled(off, 'general_meeting')).toBe(false);
    expect(isModuleToggleable('general_meeting', true)).toBe(true);

    const on = emptyBuildingModulesState();
    on.general_meeting = true;
    expect(isBuildingModuleEnabled(on, 'general_meeting')).toBe(true);

    const rentalOn = emptyBuildingModulesState();
    rentalOn.rental = true;
    expect(isBuildingModuleEnabled(rentalOn, 'rental')).toBe(false);
    expect(isModuleToggleable('rental', true)).toBe(false);
  });

  it('notification catalog offers Meetings; email matrix INFORMATIONAL; admin enqueue allowed', () => {
    expect(catalogModuleKeys()).toContain('meetings');
    expect(
      EMAIL_MODULE_INTEGRATIONS.find((m) => m.moduleKey === 'meetings')?.status,
    ).toBe('INFORMATIONAL');
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'meeting',
        templateKey: 'meeting_published',
      }),
    ).toBe(true);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: false,
        moduleKey: 'meeting',
        templateKey: 'meeting_published',
      }),
    ).toBe(false);
  });

  it('RC8 restore migration supersedes hide for general_meeting only', () => {
    const restore = readFileSync(path.join(process.cwd(), RESTORE_MIG), 'utf8');
    expect(restore).toMatch(/R1-RC8/);
    expect(restore).toMatch(/implemented = true/);
    expect(restore).toMatch(/general_meeting/);
    expect(restore).toMatch(/module_key = 'rental'/);
    expect(restore).toMatch(/implemented = false/);
    expect(restore).not.toMatch(/email_enabled\s*=\s*true/i);
    expect(restore).not.toMatch(/ordinary_debt_gate_enabled\s*=\s*true/i);
    expect(restore).not.toMatch(/\bset\s+enabled\s*=\s*true\b/i);
    expect(restore).not.toMatch(/values\s*\(\s*'general_meeting'\s*,\s*true/i);
    expect(restore).toMatch(/do nothing/);

    const pkg = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, RESTORE_PKG),
      'utf8',
    );
    expect(pkg).toMatch(/implemented = true/);
    expect(pkg).toMatch(/module_key = 'rental'/);

    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(RESTORE_PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('96_r1_module_catalog_implemented_parity.sql'),
    );
  });

  it('Initial Setup filter no longer excludes Meetings', () => {
    const setup = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminInitialSetup.tsx'),
      'utf8',
    );
    expect(setup).toMatch(/isRelease1DistributionExcluded/);
    expect(isRelease1DistributionExcluded('general_meeting')).toBe(false);
  });
});
