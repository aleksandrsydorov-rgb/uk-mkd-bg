import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyPropertyBookOpeningRows,
  splitPropertyBookObjectProps,
  splitPropertyBookOwnerRow,
} from '@/lib/moduleCore/adapters/propertyBookOpening';
import {
  EMPTY_PROPERTY_BOOK_LIST_FILTERS,
  filterPropertyBookListRows,
  type PropertyBookListRow,
} from '@/lib/propertyBookAdmin';

const root = join(__dirname, '../../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20261130240000_r1_rc8_property_book_incomplete_import.sql'),
  'utf8',
);
const manifest = JSON.parse(
  readFileSync(join(root, 'supabase/packages/fresh_install/MANIFEST.json'), 'utf8'),
) as {
  expectedChronologicalMigrationCount: number;
  chronologicalMigrationsPackaged: string[];
  orderedFiles: string[];
};

describe('property book incomplete import', () => {
  it('ships migration + package stub + MANIFEST 176', () => {
    expect(migration).toMatch(/property_book_validate_owners_payload/);
    expect(migration).toMatch(/importable/);
    expect(migration).toMatch(/warnings/);
    expect(migration).toMatch(/property_book_clarification_issues/);
    expect(migration).toMatch(/owner_update_own_registry_contact/);
    expect(migration).toMatch(/admin_record_property_book_clarification_request/);
    expect(manifest.expectedChronologicalMigrationCount).toBe(221);
    expect(manifest.orderedFiles).toContain('128_r1_rc8_property_book_incomplete_import.sql');
    expect(manifest.chronologicalMigrationsPackaged).toContain(
      'supabase/migrations/20261130240000_r1_rc8_property_book_incomplete_import.sql',
    );
  });

  it('treats missing contacts as soft warnings, apartment_number as hard', () => {
    const obj = splitPropertyBookObjectProps({
      apartment_number: '12',
      purpose: '',
      area_sqm: '',
      ideal_parts_percent: '',
      ownership_type: '',
    });
    expect(obj.errors).toEqual([]);
    expect(obj.warnings).toEqual(
      expect.arrayContaining([
        'required:purpose',
        'required:area_sqm',
        'required:ideal_parts_percent',
      ]),
    );
    expect(obj.warnings).not.toContain('required:ownership_type');
    expect(splitPropertyBookObjectProps({ apartment_number: '' }).errors).toContain(
      'required:apartment_number',
    );

    const owner = splitPropertyBookOwnerRow({
      apartment_number: '12',
      entity_kind: 'natural_person',
      first_name: 'Ivan',
      last_name: 'Petrov',
      ownership_share_percent: '100',
      email: '',
    });
    expect(owner.errors).toEqual([]);
    expect(owner.warnings).toContain('required:email');
  });

  it('keeps mixed ownership as a blocking classify error', () => {
    const preview = classifyPropertyBookOpeningRows(
      {
        objects: [
          {
            apartment_number: '14',
            purpose: 'апартамент',
            area_sqm: '90',
            ideal_parts_percent: '2',
            ownership_type: 'shared',
          },
        ],
        owners: [
          {
            apartment_number: '14',
            entity_kind: 'natural_person',
            first_name: 'A',
            last_name: 'A',
            ownership_share_percent: '50',
            ideal_parts_percent: '1',
            email: 'a@x.com',
          },
          {
            apartment_number: '14',
            entity_kind: 'legal_entity',
            entity_name: 'EOOD',
            eik_bulstat: '123',
            ownership_share_percent: '50',
            ideal_parts_percent: '1',
            email: 'b@x.com',
          },
        ],
      },
      [],
      { allowCreateMissing: true, allowOverwrite: false },
    );
    expect(preview.errorCount).toBeGreaterThan(0);
    expect(preview.rows.some((r) => r.errors.includes('mixed_natural_legal_forbidden'))).toBe(true);
  });

  it('filters needs_clarification rows', () => {
    const rows: PropertyBookListRow[] = [
      {
        property_id: 1,
        apartment_number: '1',
        floor: 1,
        section_code: null,
        block_code: null,
        purpose: 'x',
        area_sqm: 10,
        ideal_parts_percent: 1,
        ownership_type: 'sole',
        owner_count: 1,
        book_complete: true,
        needs_clarification: false,
        validation: { ok: true, importable: true },
      },
      {
        property_id: 2,
        apartment_number: '2',
        floor: 1,
        section_code: null,
        block_code: null,
        purpose: 'x',
        area_sqm: 10,
        ideal_parts_percent: 1,
        ownership_type: 'sole',
        owner_count: 1,
        book_complete: false,
        needs_clarification: true,
        clarification: { needs_clarification: true, issues: [{ code: 'owner_email_required' }] },
        validation: { ok: false, importable: true, warnings: ['owner_email_required'] },
      },
    ];
    const filtered = filterPropertyBookListRows(rows, {
      ...EMPTY_PROPERTY_BOOK_LIST_FILTERS,
      completeness: 'needs_clarification',
    });
    expect(filtered.map((r) => r.apartment_number)).toEqual(['2']);
  });

  it('does not invent identity values in migration', () => {
    expect(migration).not.toMatch(/Иван Иванов/);
    expect(migration).not.toMatch(/owner@example\.com/);
    expect(migration).toMatch(/No invented identity/);
  });
});

