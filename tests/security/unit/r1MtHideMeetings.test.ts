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

describe('R1-MT-HIDE · Meetings excluded from Distribution Release 1.0', () => {
  it('release composition excludes general_meeting and rental', () => {
    expect(RELEASE_1_DISTRIBUTION_EXCLUDED_MODULE_KEYS).toEqual(
      expect.arrayContaining(['general_meeting', 'rental']),
    );
    expect(isRelease1DistributionExcluded('general_meeting')).toBe(true);
    expect(isImplementedModuleKey('general_meeting')).toBe(false);
    expect(IMPLEMENTED_MODULE_KEYS).not.toContain('general_meeting');
  });

  it('client fail-closed: Meetings never enabled / never toggleable', () => {
    const state = emptyBuildingModulesState();
    state.general_meeting = true; // even if stale row says enabled
    expect(isBuildingModuleEnabled(state, 'general_meeting')).toBe(false);
    expect(isModuleToggleable('general_meeting', true)).toBe(false);
    expect(isModuleToggleable('general_meeting', false)).toBe(false);
  });

  it('notification catalog and email matrix hide Meetings', () => {
    expect(catalogModuleKeys()).not.toContain('meetings');
    expect(catalogModuleKeys()).not.toContain('meeting');
    expect(
      EMAIL_MODULE_INTEGRATIONS.find((m) => m.moduleKey === 'meetings')?.status,
    ).toBe('EXCLUDED');
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'meeting',
        templateKey: 'meeting_published',
      }),
    ).toBe(false);
  });

  it('fresh-install packages R1 meetings hide gate after email core', () => {
    const idx88 = FRESH_INSTALL_ORDERED_FILES.indexOf('88_email_core_baseline.sql');
    const idx88b = FRESH_INSTALL_ORDERED_FILES.indexOf('88b_r1_mt_hide_general_meeting.sql');
    expect(idx88).toBeGreaterThanOrEqual(0);
    expect(idx88b).toBeGreaterThan(idx88);

    const catalog = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '60_module_catalog_baseline.sql'),
      'utf8',
    );
    expect(catalog).toMatch(/'general_meeting'[\s\S]*?false/);

    const gate = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '88b_r1_mt_hide_general_meeting.sql'),
      'utf8',
    );
    expect(gate).toMatch(/general_meeting_module_available/);
    expect(gate).toMatch(/general_meeting_assert_available/);
    expect(gate).toMatch(/general_meeting_block_mutate_when_unavailable/);
    expect(gate).toMatch(/module_lifecycle_block_unimplemented/);
    expect(gate).toMatch(/state = 'DISABLED'/);
    expect(gate).toMatch(/meetings not available in this release/);
    expect(gate).toMatch(/implemented = false/);

    const mig = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261117130000_r1_mt_hide_general_meeting.sql',
      ),
      'utf8',
    );
    expect(mig).toMatch(/R1-MT-HIDE/);
    expect(mig).toMatch(/general_meeting_module_available/);
  });

  it('future upgrade path documented: flip implemented without dropping schema', () => {
    const mig = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261117130000_r1_mt_hide_general_meeting.sql',
      ),
      'utf8',
    );
    expect(mig).toMatch(/Schema \/ historical migrations retained for future upgrade/);
    expect(mig).not.toMatch(/drop table.*general_meetings/i);
    expect(mig).toMatch(/general_meeting\.allow_mutate/);
  });
});
