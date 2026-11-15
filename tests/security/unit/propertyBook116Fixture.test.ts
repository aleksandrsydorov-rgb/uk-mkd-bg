import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  PROPERTY_BOOK_OBJECTS_SPEC,
  PROPERTY_BOOK_OWNERS_SPEC,
} from '@/lib/importTemplates/specs/propertyBook';
import { classifyPropertyBookOpeningRows } from '@/lib/moduleCore/adapters/propertyBookOpening';
import {
  buildPropertyBookTemplateBuffer,
  parsePropertyBookWorkbookBuffer,
} from '@/lib/propertyBookAdmin';

const OUT_DIR = path.join(process.cwd(), 'tmp', 'uat-xlsx');

function colLabel(
  spec: typeof PROPERTY_BOOK_OBJECTS_SPEC | typeof PROPERTY_BOOK_OWNERS_SPEC,
  key: string,
): string {
  return spec.columns.find((c) => c.key === key)!.label.ru;
}

function build116Buffer(includeLiving: boolean): ArrayBuffer {
  const template = buildPropertyBookTemplateBuffer('ru');
  const wb = XLSX.read(template, { type: 'array' });
  const objectsName = PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName.ru;
  const ownersName = PROPERTY_BOOK_OWNERS_SPEC.dataSheetName.ru;

  const objHeaders = [
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'apartment_number'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'floor'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'section_code'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'block_code'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'purpose'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'area_sqm'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'living_area_sqm'),
    colLabel(PROPERTY_BOOK_OBJECTS_SPEC, 'ideal_parts_percent'),
  ];
  const ownHeaders = [
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'apartment_number'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'section_code'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'block_code'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'ownership_type'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'entity_kind'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'ownership_share_percent'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'ideal_parts_percent'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'email'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'first_name'),
    colLabel(PROPERTY_BOOK_OWNERS_SPEC, 'last_name'),
  ];

  const objectRows: (string | number)[][] = [objHeaders];
  const ownerRows: (string | number)[][] = [ownHeaders];

  const pushUnit = (section: string, apt: number) => {
    const area = `${40 + (apt % 40)},${(apt % 10) + 10}`;
    const living = includeLiving ? `${30 + (apt % 20)},${(apt % 9) + 10}` : '';
    objectRows.push([
      String(apt),
      String(1 + ((apt - 1) % 8)),
      section,
      '',
      'апартамент',
      area,
      living,
      '0,86',
    ]);
    ownerRows.push([
      String(apt),
      section,
      '',
      'sole',
      'natural_person',
      '100',
      '0,86',
      `owner.${section.toLowerCase()}.${apt}@example.com`,
      `Иван${section}${apt}`,
      `Петров${apt}`,
    ]);
  };

  for (let apt = 1; apt <= 80; apt += 1) pushUnit('A', apt);
  for (let apt = 1; apt <= 36; apt += 1) pushUnit('B', apt);

  wb.Sheets[objectsName] = XLSX.utils.aoa_to_sheet(objectRows);
  wb.Sheets[ownersName] = XLSX.utils.aoa_to_sheet(ownerRows);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('property book 116-apartment fixture', () => {
  it('writes A80+B36 workbook and classifies 116 unique apartments', () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const main = build116Buffer(true);
    const legacy = build116Buffer(false);
    const mainPath = path.join(OUT_DIR, 'property-book-116-A80-B36.xlsx');
    const legacyPath = path.join(OUT_DIR, 'property-book-116-A80-B36-no-living.xlsx');
    fs.writeFileSync(mainPath, Buffer.from(main));
    fs.writeFileSync(legacyPath, Buffer.from(legacy));

    const parsed = parsePropertyBookWorkbookBuffer(main);
    expect(parsed.objects).toHaveLength(116);
    expect(parsed.objects.filter((r) => r.section_code === 'A')).toHaveLength(80);
    expect(parsed.objects.filter((r) => r.section_code === 'B')).toHaveLength(36);
    expect(parsed.objects.some((r) => String(r.area_sqm).includes(','))).toBe(false); // normalized

    const preview = classifyPropertyBookOpeningRows(parsed, [], {
      allowCreateMissing: true,
      allowOverwrite: false,
    });
    expect(preview.uniqueObjectCount).toBe(116);
    expect(preview.errorCount).toBe(0);

    const legacyParsed = parsePropertyBookWorkbookBuffer(legacy);
    const legacyPreview = classifyPropertyBookOpeningRows(legacyParsed, [], {
      allowCreateMissing: true,
      allowOverwrite: false,
    });
    expect(legacyPreview.uniqueObjectCount).toBe(116);
    expect(legacyPreview.errorCount).toBe(0);
  });
});
