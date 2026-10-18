#!/usr/bin/env node
/**
 * R1 RC7 — list expected chronological migration versions from the repo tree.
 * Does NOT apply SQL. Does NOT touch remote databases.
 *
 * Usage:
 *   node scripts/r1-migration-inventory.mjs
 *   node scripts/r1-migration-inventory.mjs --json
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migDir = join(root, 'supabase', 'migrations');
const manifestPath = join(root, 'supabase', 'packages', 'fresh_install', 'MANIFEST.json');

const files = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const versions = files.map((f) => f.replace(/\.sql$/, ''));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const asJson = process.argv.includes('--json');
const payload = {
  release: manifest.release || null,
  expectedChronologicalMigrationCount: versions.length,
  manifestExpectedCount: manifest.expectedChronologicalMigrationCount ?? null,
  orderedFilesCount: Array.isArray(manifest.orderedFiles) ? manifest.orderedFiles.length : null,
  packagedCriticalCount: Array.isArray(manifest.chronologicalMigrationsPackaged)
    ? manifest.chronologicalMigrationsPackaged.length
    : null,
  versions,
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`release=${payload.release}`);
  console.log(`expected_count=${payload.expectedChronologicalMigrationCount}`);
  console.log(`manifest_expected_count=${payload.manifestExpectedCount}`);
  console.log(`ordered_files=${payload.orderedFilesCount}`);
  console.log(`packaged_critical=${payload.packagedCriticalCount}`);
  for (const v of versions) console.log(v);
}

if (
  payload.manifestExpectedCount != null &&
  payload.manifestExpectedCount !== payload.expectedChronologicalMigrationCount
) {
  console.error(
    `MISMATCH: MANIFEST.expectedChronologicalMigrationCount=${payload.manifestExpectedCount} but disk has ${payload.expectedChronologicalMigrationCount}`,
  );
  process.exit(1);
}
