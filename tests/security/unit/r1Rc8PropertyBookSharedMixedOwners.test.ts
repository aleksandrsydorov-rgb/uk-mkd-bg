import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  classifyPropertyBookOpeningRows,
  mergePropertyBookLocalAndRpcPreview,
  previewFromPropertyBookDryRun,
} from '@/lib/moduleCore';

const PKG = path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR);
const MIG =
  'supabase/migrations/20261124120000_r1_rc8_property_book_shared_mixed_owners.sql';
const PKG_FILE = '100_r1_rc8_property_book_shared_mixed_owners.sql';

describe('R1-RC8 Property Book shared natural+legal', () => {
  it('migration allows shared mix; keeps multiple-legal and sum checks', () => {
    const sql = readFileSync(path.join(process.cwd(), MIG), 'utf8');
    expect(sql).toMatch(/property_book_validate_owners_payload/);
    expect(sql).toMatch(/multiple_legal_forbidden/);
    expect(sql).toMatch(/shares_must_sum_100/);
    expect(sql).toMatch(/owner_ideal_parts_sum_mismatch/);
    expect(sql).not.toMatch(/v_errors := array_append\(v_errors, 'mixed_natural_legal_forbidden'\)/);
    expect(sql).not.toMatch(/v_errors := array_append\(v_errors, 'shared_legal_forbidden'\)/);
    expect(sql).toMatch(/property_book requires at least one object before/);
    expect(sql).toMatch(/empty_book_requires_setup/);
  });

  it('fresh-install package ships validate helpers before chronological patch', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(PKG_FILE);
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_FILE)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('45_property_book_auth_helpers.sql'),
    );
    const pkg = readFileSync(path.join(PKG, PKG_FILE), 'utf8');
    expect(pkg).toMatch(/property_book_validate_owners_payload/);
    expect(pkg).toMatch(/create or replace function public\.property_book_validate/);
  });

  it('client classify accepts shared NP+LE and surfaces concrete sum codes', () => {
    const preview = classifyPropertyBookOpeningRows(
      {
        objects: [
          {
            apartment_number: '47',
            purpose: 'апартамент',
            area_sqm: '112',
            ideal_parts_percent: '2',
            ownership_type: 'shared',
          },
        ],
        owners: [
          {
            apartment_number: '47',
            entity_kind: 'natural_person',
            ownership_share_percent: '50',
            ideal_parts_percent: '1',
            first_name: 'A',
            last_name: 'B',
            email: 'a@example.com',
          },
          {
            apartment_number: '47',
            entity_kind: 'legal_entity',
            ownership_share_percent: '50',
            ideal_parts_percent: '1',
            entity_name: 'Co',
            eik_bulstat: '123',
            email: 'c@example.com',
          },
        ],
      },
      [],
      { allowOverwrite: false, allowCreateMissing: true },
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.createCount).toBeGreaterThan(0);
  });

  it('merge preview attaches concrete RPC validation codes to apartments', () => {
    const local = classifyPropertyBookOpeningRows(
      {
        objects: [
          {
            apartment_number: '47',
            purpose: 'апартамент',
            area_sqm: '10',
            ideal_parts_percent: '1',
            ownership_type: 'shared',
          },
        ],
        owners: [
          {
            apartment_number: '47',
            entity_kind: 'natural_person',
            ownership_share_percent: '50',
            ideal_parts_percent: '0.5',
            first_name: 'A',
            last_name: 'B',
            email: 'a@example.com',
          },
          {
            apartment_number: '47',
            entity_kind: 'legal_entity',
            ownership_share_percent: '50',
            ideal_parts_percent: '0.5',
            entity_name: 'Co',
            eik_bulstat: '1',
            email: 'c@example.com',
          },
        ],
      },
      [],
      { allowOverwrite: false, allowCreateMissing: true },
    );
    expect(local.errorCount).toBe(0);

    const rpc = previewFromPropertyBookDryRun({
      ok: false,
      errors: [
        {
          sheet: 'validation',
          apartment_number: '47',
          codes: ['shares_must_sum_100'],
        },
      ],
      new_properties: [{ apartment_number: '47' }],
    });
    const merged = mergePropertyBookLocalAndRpcPreview(local, rpc);
    expect(merged.errorCount).toBeGreaterThan(0);
    expect(merged.rows.some((r) => r.errors.includes('shares_must_sum_100'))).toBe(true);
  });
});
