import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRESH_INSTALL_ORDERED_FILES, FRESH_INSTALL_PACKAGE_DIR } from '@/lib/moduleCore';

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const MANIFEST_PATH = path.join(ROOT, FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json');

const REQUIRED_PACKAGED = [
  'supabase/migrations/20261117120000_r1_close_residence_status_catalog.sql',
  'supabase/migrations/20261117130000_r1_mt_hide_general_meeting.sql',
  'supabase/migrations/20261118120000_r1_first_boot_bootstrap_invite.sql',
  'supabase/migrations/20261119120000_r1_auto_expose_off_api_grants.sql',
  'supabase/migrations/20261120120000_r1_module_catalog_implemented_parity.sql',
  'supabase/migrations/20261121120000_r1_rc8_restore_general_meeting.sql',
  'supabase/migrations/20261122120000_r1_rc8_storage_buckets_baseline.sql',
] as const;

describe('R1 RC7 migration inventory / MANIFEST integrity', () => {
  const diskFiles = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    orderedFiles: string[];
    chronologicalMigrationsPackaged: string[];
    chronologicalMigrationTree?: string[];
    expectedChronologicalMigrationCount?: number;
    release?: string;
  };

  it('disk migration count matches MANIFEST expectedChronologicalMigrationCount', () => {
    expect(manifest.expectedChronologicalMigrationCount).toBe(diskFiles.length);
    expect(diskFiles.length).toBeGreaterThanOrEqual(138);
  });

  it('chronologicalMigrationTree matches disk filenames in order', () => {
    expect(manifest.chronologicalMigrationTree).toEqual(
      diskFiles.map((f) => `supabase/migrations/${f}`),
    );
  });

  it('every packaged critical migration exists on disk', () => {
    for (const rel of manifest.chronologicalMigrationsPackaged) {
      const name = rel.replace(/^supabase\/migrations\//, '');
      expect(existsSync(path.join(MIG_DIR, name)), rel).toBe(true);
    }
  });

  it('includes First Boot, Auto Expose grants, and catalog parity migrations', () => {
    for (const rel of REQUIRED_PACKAGED) {
      expect(manifest.chronologicalMigrationsPackaged).toContain(rel);
      expect(manifest.chronologicalMigrationTree).toContain(rel);
    }
  });

  it('orderedFiles stay aligned with FRESH_INSTALL_ORDERED_FILES', () => {
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
  });

  it('release tag is 1.0.0-rc8', () => {
    expect(manifest.release).toBe('1.0.0-rc8');
  });
});
