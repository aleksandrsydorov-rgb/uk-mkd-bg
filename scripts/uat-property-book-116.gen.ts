/**
 * Build a 116-apartment Property Book workbook for wizard acceptance:
 * entrance A = 80 units, entrance B = 36 units, repeating apartment numbers,
 * European decimal commas on area fields. No Save dialog — writes under tmp/.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { PROPERTY_BOOK_OBJECTS_SPEC, PROPERTY_BOOK_OWNERS_SPEC } from '../src/lib/importTemplates/specs/propertyBook';
import { buildPropertyBookTemplateBuffer } from '../src/lib/propertyBookAdmin';

const OUT_DIR = path.join(process.cwd(), 'tmp', 'uat-xlsx');

function label(spec: typeof PROPERTY_BOOK_OBJECTS_SPEC, key: string, locale: 'ru') {
  return spec.columns.find((c) => c.key === key)!.label[locale];
}

function build116Workbook(): ArrayBuffer {
  const template = buildPropertyBookTemplateBuffer('ru');
  const wb = XLSX.read(template, { type: 'array' });
  const objectsName = PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName.ru;
  const ownersName = PROPERTY_BOOK_OWNERS_SPEC.dataSheetName.ru;

  const objHeaders = [
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'apartment_number', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'floor', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'section_code', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'block_code', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'purpose', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'area_sqm', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'living_area_sqm', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'ideal_parts_percent', 'ru'),
    label(PROPERTY_BOOK_OBJECTS_SPEC, 'ownership_type', 'ru'),
  ];
  const ownHeaders = [
    label(PROPERTY_BOOK_OWNERS_SPEC as typeof PROPERTY_BOOK_OBJECTS_SPEC, 'apartment_number', 'ru'),
    'Секция',
    'Блок',
    label(PROPERTY_BOOK_OWNERS_SPEC as typeof PROPERTY_BOOK_OBJECTS_SPEC, 'entity_kind', 'ru'),
    label(PROPERTY_BOOK_OWNERS_SPEC as typeof PROPERTY_BOOK_OBJECTS_SPEC, 'ownership_share_percent', 'ru'),
    label(PROPERTY_BOOK_OWNERS_SPEC as typeof PROPERTY_BOOK_OBJECTS_SPEC, 'ideal_parts_percent', 'ru'),
    'Email',
    'Имя',
    'Фамилия',
  ];

  const objectRows: (string | number)[][] = [objHeaders];
  const ownerRows: (string | number)[][] = [ownHeaders];

  const pushUnit = (section: string, apt: number, area: string, living: string) => {
    objectRows.push([
      String(apt),
      String(1 + ((apt - 1) % 8)),
      section,
      '',
      'апартамент',
      area,
      living,
      '0,86',
      'sole',
    ]);
    ownerRows.push([
      String(apt),
      section,
      '',
      'natural_person',
      '100',
      '0,86',
      `owner.${section.toLowerCase()}.${apt}@example.com`,
      `Иван${section}${apt}`,
      `Петров${apt}`,
    ]);
  };

  for (let apt = 1; apt <= 80; apt += 1) {
    // European decimals with comma — reproduce «Некорректная площадь» on old parsers.
    const area = `${40 + (apt % 40)},${(apt % 10) + 10}`;
    const living = `${30 + (apt % 20)},${(apt % 9) + 10}`;
    pushUnit('A', apt, area, living);
  }
  for (let apt = 1; apt <= 36; apt += 1) {
    const area = `${50 + (apt % 30)},${(apt % 8) + 20}`;
    const living = `${35 + (apt % 15)},${(apt % 7) + 15}`;
    pushUnit('B', apt, area, living);
  }

  wb.Sheets[objectsName] = XLSX.utils.aoa_to_sheet(objectRows);
  wb.Sheets[ownersName] = XLSX.utils.aoa_to_sheet(ownerRows);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function buildLegacyNoLiving(): ArrayBuffer {
  const buf = build116Workbook();
  const wb = XLSX.read(buf, { type: 'array' });
  const objectsName = PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName.ru;
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[objectsName], {
    header: 1,
    defval: '',
  });
  const livingIdx = (aoa[0] as string[]).findIndex((h) => String(h).includes('Жилая'));
  if (livingIdx >= 0) {
    for (const row of aoa) {
      if (Array.isArray(row) && row.length > livingIdx) row[livingIdx] = '';
    }
  }
  // Keep only first 3 rows of A + first 3 of B as a small legacy sample? No — full 116 without living.
  wb.Sheets[objectsName] = XLSX.utils.aoa_to_sheet(aoa as (string | number)[][]);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const mainPath = path.join(OUT_DIR, 'property-book-116-A80-B36.xlsx');
const legacyPath = path.join(OUT_DIR, 'property-book-116-A80-B36-no-living.xlsx');
fs.writeFileSync(mainPath, Buffer.from(build116Workbook()));
fs.writeFileSync(legacyPath, Buffer.from(buildLegacyNoLiving()));
fs.writeFileSync(
  path.join(OUT_DIR, 'property-book-116-manifest.json'),
  JSON.stringify(
    {
      objects: 116,
      sectionA: 80,
      sectionB: 36,
      repeatingNumbers: true,
      areaFormat: 'european_comma',
      main: mainPath,
      legacyNoLiving: legacyPath,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ mainPath, legacyPath, objects: 116 }, null, 2));
