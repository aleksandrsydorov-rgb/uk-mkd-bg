import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
} from '@/lib/moduleCore';

/** Package stubs + full chronological migration tree (as applied on fresh install). */
export function readFreshInstallCoverageSql(cwd = process.cwd()): string {
  const pkg = FRESH_INSTALL_ORDERED_FILES.map((f) =>
    readFileSync(path.join(cwd, FRESH_INSTALL_PACKAGE_DIR, f), 'utf8'),
  ).join('\n\n');
  const migDir = path.join(cwd, 'supabase/migrations');
  const chrono = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(path.join(migDir, f), 'utf8'))
    .join('\n\n');
  return `${pkg}\n\n${chrono}`;
}
