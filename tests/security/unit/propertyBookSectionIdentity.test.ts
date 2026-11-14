import { describe, expect, it } from 'vitest';
import {
  classifyPropertyBookOpeningRows,
  splitPropertyBookObjectProps,
} from '@/lib/moduleCore/adapters/propertyBookOpening';
import {
  parseImportDecimal,
  propertyBookIdentityKey,
  propertyBookIdentityLabel,
} from '@/lib/propertyBookIdentity';

function objectRow(
  apt: string,
  section: string,
  area: string,
  living = '',
  row = 2,
): Record<string, string> {
  return {
    apartment_number: apt,
    section_code: section,
    block_code: '',
    purpose: 'апартамент',
    area_sqm: area,
    living_area_sqm: living,
    ideal_parts_percent: '1',
    ownership_type: 'sole',
    _row: String(row),
  };
}

describe('property book section identity', () => {
  it('parses European and US decimals', () => {
    expect(parseImportDecimal('85,40')).toBe(85.4);
    expect(parseImportDecimal('85.40')).toBe(85.4);
    expect(parseImportDecimal('1.085,40')).toBe(1085.4);
    expect(parseImportDecimal('1,085.40')).toBe(1085.4);
    expect(parseImportDecimal('')).toBeNull();
    expect(parseImportDecimal('abc')).toBeNull();
  });

  it('accepts comma decimals in object validation', () => {
    expect(splitPropertyBookObjectProps(objectRow('1', 'A', '85,40', '62,75')).errors).toEqual([]);
    expect(splitPropertyBookObjectProps(objectRow('1', 'A', '0', '')).errors).toContain(
      'invalid:area_sqm',
    );
  });

  it('treats A/1 and B/1 as distinct apartments', () => {
    const objects = [
      objectRow('1', 'A', '40,10', '30,10', 2),
      objectRow('1', 'B', '50,20', '35,15', 3),
    ];
    for (let i = 2; i <= 80; i += 1) objects.push(objectRow(String(i), 'A', '41,10', '', i + 1));
    for (let i = 2; i <= 36; i += 1) {
      objects.push(objectRow(String(i), 'B', '51,20', '', 80 + i));
    }
    // 80 A + 36 B = 116 (includes the two №1 rows already added)
    expect(objects).toHaveLength(116);
    expect(propertyBookIdentityKey(objects[0]!)).not.toBe(propertyBookIdentityKey(objects[1]!));
    expect(propertyBookIdentityLabel({ apartmentNumber: '1', sectionCode: 'A', blockCode: '' })).toBe(
      'A/1',
    );

    const preview = classifyPropertyBookOpeningRows(
      {
        objects,
        owners: objects.map((o, idx) => ({
          apartment_number: o.apartment_number,
          section_code: o.section_code,
          block_code: '',
          entity_kind: 'natural_person',
          ownership_share_percent: '100',
          first_name: 'Ivan',
          last_name: `Owner${idx}`,
          email: `o${idx}@example.com`,
          _row: String(idx + 2),
        })),
      },
      [],
      { allowCreateMissing: true, allowOverwrite: false },
    );

    expect(preview.uniqueObjectCount).toBe(116);
    expect(preview.errorCount).toBe(0);
    expect(preview.createCount).toBeGreaterThanOrEqual(116);
  });

  it('flags two rows of the same apartment in one section with both row numbers', () => {
    const preview = classifyPropertyBookOpeningRows(
      {
        objects: [
          objectRow('7', 'A', '40,00', '', 2),
          objectRow('7', 'A', '41,00', '', 5),
        ],
        owners: [],
      },
      [],
      { allowCreateMissing: true, allowOverwrite: false },
    );
    const dup = preview.rows.find((r) => r.rowNumber === 5);
    expect(dup?.errors).toContain('duplicate_in_file:apartment_number');
    expect(dup?.errors.some((e) => e.startsWith('duplicate_rows:'))).toBe(true);
  });

  it('asks for section when the same apartment number appears without entrance', () => {
    const preview = classifyPropertyBookOpeningRows(
      {
        objects: [objectRow('1', '', '40,00', '', 2), objectRow('1', '', '41,00', '', 3)],
        owners: [],
      },
      [],
      { allowCreateMissing: true, allowOverwrite: false },
    );
    expect(
      preview.rows.some((r) => r.errors.includes('section_code_required_for_disambiguation')),
    ).toBe(true);
  });
});
