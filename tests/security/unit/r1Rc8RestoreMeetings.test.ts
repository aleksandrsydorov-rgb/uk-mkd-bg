import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guestCabinetAllows } from '@/lib/guestMode';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
} from '@/lib/moduleCore';
import {
  emptyBuildingModulesState,
  isBuildingModuleEnabled,
  isModuleToggleable,
  isRelease1DistributionExcluded,
} from '@/lib/modules';
import { moduleCatalogStatusKind } from '@/components/admin/AdminModuleCatalogPanel';

const RESTORE_MIG = 'supabase/migrations/20261121120000_r1_rc8_restore_general_meeting.sql';
const HIDE_MIG = 'supabase/migrations/20261117130000_r1_mt_hide_general_meeting.sql';

describe('R1-RC8 restore · Initial Setup / gates / Guest Mode', () => {
  it('implemented=true + enabled=false → Initial Setup eligible, UI fail-closed', () => {
    expect(isRelease1DistributionExcluded('general_meeting')).toBe(false);
    expect(isModuleToggleable('general_meeting', true)).toBe(true);
    const state = emptyBuildingModulesState();
    expect(isBuildingModuleEnabled(state, 'general_meeting')).toBe(false);
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: false,
        moduleKey: 'general_meeting',
      }),
    ).toBe('disabled');
  });

  it('enabled=true → Meetings available in working UI status', () => {
    const state = emptyBuildingModulesState();
    state.general_meeting = true;
    expect(isBuildingModuleEnabled(state, 'general_meeting')).toBe(true);
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: true,
        moduleKey: 'general_meeting',
      }),
    ).toBe('enabled');
  });

  it('Rental remains r1_unavailable / excluded', () => {
    expect(isRelease1DistributionExcluded('rental')).toBe(true);
    expect(
      moduleCatalogStatusKind({
        implemented: false,
        enabled: false,
        moduleKey: 'rental',
      }),
    ).toBe('r1_unavailable');
  });

  it('Guest Mode never receives general_meetings / owner_voting', () => {
    expect(guestCabinetAllows('general_meetings')).toBe(false);
    expect(guestCabinetAllows('owner_voting')).toBe(false);
    expect(guestCabinetAllows('polls')).toBe(false);
  });

  it('hide migration kept; restore is additive and ordered after parity', () => {
    expect(readFileSync(path.join(process.cwd(), HIDE_MIG), 'utf8')).toMatch(/R1-MT-HIDE/);
    const restore = readFileSync(path.join(process.cwd(), RESTORE_MIG), 'utf8');
    expect(restore).toMatch(/Supersedes R1-MT-HIDE/);
    expect(restore).not.toMatch(/drop trigger.*general_meeting_r1_block_mutate/i);
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('97_r1_rc8_restore_general_meeting.sql');
    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'),
        'utf8',
      ),
    ) as {
      orderedFiles: string[];
      chronologicalMigrationsPackaged: string[];
      expectedChronologicalMigrationCount: number;
    };
    expect(manifest.orderedFiles).toContain('97_r1_rc8_restore_general_meeting.sql');
    expect(manifest.chronologicalMigrationsPackaged).toContain(RESTORE_MIG);
    expect(manifest.expectedChronologicalMigrationCount).toBe(151);
  });
});
