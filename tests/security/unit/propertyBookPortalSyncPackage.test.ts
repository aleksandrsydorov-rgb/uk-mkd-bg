import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FRESH_INSTALL_ORDERED_FILES,
  assertPropertyBookPortalSyncSql,
} from '@/lib/moduleCore';

const PKG = path.resolve(process.cwd(), 'supabase/packages/fresh_install');

describe('R1-CLOSE · Property Book portal sync in fresh-install package', () => {
  it('orderedFiles place 46 portal sync after 45 book auth', () => {
    const idx45 = FRESH_INSTALL_ORDERED_FILES.indexOf('45_property_book_auth_helpers.sql');
    const idx46 = FRESH_INSTALL_ORDERED_FILES.indexOf('46_property_book_portal_sync.sql');
    expect(idx45).toBeGreaterThanOrEqual(0);
    expect(idx46).toBe(idx45 + 1);
  });

  it('46_property_book_portal_sync.sql ships sync + mutation guard; owns_property stays Book-only', () => {
    const syncSql = readFileSync(path.join(PKG, '46_property_book_portal_sync.sql'), 'utf8');
    const bookSql = readFileSync(path.join(PKG, '45_property_book_auth_helpers.sql'), 'utf8');
    const combined = `${bookSql}\n${syncSql}`;
    const result = assertPropertyBookPortalSyncSql(combined);
    expect(result.ok).toBe(true);
    expect(result.hasSyncFn).toBe(true);
    expect(result.hasMutationGuard).toBe(true);
    expect(result.syncDoesNotAuthorize).toBe(true);
  });

  it('MANIFEST lists property_book_sync_portal_owner_fields', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PKG, 'MANIFEST.json'), 'utf8'),
    ) as { requiredFunctionsAfterPackage: string[]; orderedFiles: string[] };
    expect(manifest.orderedFiles).toContain('46_property_book_portal_sync.sql');
    expect(manifest.requiredFunctionsAfterPackage).toContain(
      'public.property_book_sync_portal_owner_fields(bigint)',
    );
  });

  it('module catalog packages residence_status identity', () => {
    const sql = readFileSync(path.join(PKG, '60_module_catalog_baseline.sql'), 'utf8');
    expect(sql).toMatch(/'residence_status'/);
  });
});
