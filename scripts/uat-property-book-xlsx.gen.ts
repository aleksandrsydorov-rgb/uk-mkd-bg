/**
 * One-shot UAT artifact generator (no Save dialog). Run:
 *   npx vitest run scripts/uat-property-book-xlsx.gen.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  PROPERTY_BOOK_OBJECTS_SPEC,
  PROPERTY_BOOK_OWNERS_SPEC,
} from '@/lib/importTemplates/specs/propertyBook';
import {
  buildPropertyBookTemplateBuffer,
  propertyBookTemplateFileName,
} from '@/lib/propertyBookAdmin';

const OUT_DIR = join(process.cwd(), 'tmp', 'uat-xlsx');
const LOCALES = ['bg', 'ru', 'en'] as const;

function sheetHeaders(wb: XLSX.WorkBook, sheetName: string): string[] {
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  return (rows[0] ?? []).map((cell) => String(cell));
}

function verifyObjectsHeaders(headers: string[], locale: string) {
  const areaIdx = headers.indexOf(PROPERTY_BOOK_OBJECTS_SPEC.columns.find((c) => c.key === 'area_sqm')!.label[locale as 'ru' | 'bg' | 'en']);
  const livingIdx = headers.indexOf(
    PROPERTY_BOOK_OBJECTS_SPEC.columns.find((c) => c.key === 'living_area_sqm')!.label[locale as 'ru' | 'bg' | 'en'],
  );
  if (areaIdx < 0 || livingIdx !== areaIdx + 1) {
    throw new Error(`[${locale}] living area not immediately after area (area=${areaIdx}, living=${livingIdx})`);
  }
}

function verifyOwnersPhones(headers: string[], locale: string) {
  const loc = locale as 'ru' | 'bg' | 'en';
  const phone = PROPERTY_BOOK_OWNERS_SPEC.columns.find((c) => c.key === 'phone')!.label[loc];
  const phone2 = PROPERTY_BOOK_OWNERS_SPEC.columns.find((c) => c.key === 'phone_secondary')!.label[loc];
  if (!headers.includes(phone)) throw new Error(`[${locale}] missing primary phone column: ${phone}`);
  if (!headers.includes(phone2)) throw new Error(`[${locale}] missing secondary phone column: ${phone2}`);
}

describe('uat property book xlsx generation', () => {
  it('writes localized templates and update workbook', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const report: Record<string, { objects: string[]; owners: string[]; templatePath: string }> = {};

    for (const locale of LOCALES) {
      const buf = buildPropertyBookTemplateBuffer(locale);
      const name = propertyBookTemplateFileName(locale);
      const templatePath = join(OUT_DIR, name);
      writeFileSync(templatePath, Buffer.from(buf));

      const wb = XLSX.read(buf, { type: 'array' });
      const objectsSheet = PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName[locale];
      const ownersSheet = PROPERTY_BOOK_OWNERS_SPEC.dataSheetName[locale];
      const objectHeaders = sheetHeaders(wb, objectsSheet);
      const ownerHeaders = sheetHeaders(wb, ownersSheet);

      verifyObjectsHeaders(objectHeaders, locale);
      verifyOwnersPhones(ownerHeaders, locale);

      report[locale] = {
        objects: objectHeaders,
        owners: ownerHeaders,
        templatePath,
      };
    }

    // Update import: apartment 21 on fullcopy (living_area null) — distinctive UAT value
    const uatApt = '21';
    const uatLiving = '47.331';
    const ruObjects = PROPERTY_BOOK_OBJECTS_SPEC.columns.map((c) => c.label.ru);
    const ruOwnersMin = [
      PROPERTY_BOOK_OWNERS_SPEC.columns.find((c) => c.key === 'apartment_number')!.label.ru,
    ];
    const updateWb = XLSX.utils.book_new();
    const livingCol = PROPERTY_BOOK_OBJECTS_SPEC.columns.findIndex((c) => c.key === 'living_area_sqm');
    const objRow = ruObjects.map((_, i) => {
      if (i === 0) return uatApt;
      if (i === livingCol) return uatLiving;
      return '';
    });
    XLSX.utils.book_append_sheet(
      updateWb,
      XLSX.utils.aoa_to_sheet([ruObjects, objRow]),
      PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName.ru,
    );
    XLSX.utils.book_append_sheet(
      updateWb,
      XLSX.utils.aoa_to_sheet([ruOwnersMin, [uatApt]]),
      PROPERTY_BOOK_OWNERS_SPEC.dataSheetName.ru,
    );
    const updatePath = join(OUT_DIR, 'property-book-update-apt-21-living-uat.xlsx');
    writeFileSync(updatePath, XLSX.write(updateWb, { type: 'buffer', bookType: 'xlsx' }));

    const manifestPath = join(OUT_DIR, 'uat-manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          generator: 'buildPropertyBookTemplateBuffer (AdminPropertyBook download)',
          report,
          updateImport: { path: updatePath, apartment_number: uatApt, living_area_sqm: uatLiving },
        },
        null,
        2,
      ),
    );

    console.log('UAT manifest:', manifestPath);
    console.log(JSON.stringify({ report, updateImport: { path: updatePath, apartment_number: uatApt, living_area_sqm: uatLiving } }, null, 2));
  });
});