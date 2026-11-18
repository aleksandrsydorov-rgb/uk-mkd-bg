import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  AMOUNT_DUE_COLUMN_LABEL,
} from '@/lib/importTemplates/amountDueColumn';
import {
  CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  INTERNET_SIMPLE_IMPORT_SPEC,
  SUPPORT_FEE_SIMPLE_IMPORT_SPEC,
  WATER_METERS_IMPORT_SPEC,
  buildCapitalRepairSimpleTemplateBuffer,
  buildInternetSimpleTemplateBuffer,
  buildSupportFeeSimpleTemplateBuffer,
  buildLocalizedImportWorkbook,
  parseLocalizedImportBuffer,
  type ImportTemplateLocale,
  type ImportTemplateSpec,
} from '@/lib/importTemplates';
import { buildElectricityMeterIs3TemplateBuffer, buildWaterMeterIs3TemplateBuffer } from '@/lib/moduleCore';

const LOCALES: ImportTemplateLocale[] = ['ru', 'bg', 'en'];

const FIVE: { name: string; spec: ImportTemplateSpec; build: (loc: ImportTemplateLocale) => ArrayBuffer }[] = [
  {
    name: 'support_fee',
    spec: SUPPORT_FEE_SIMPLE_IMPORT_SPEC,
    build: (loc) => buildSupportFeeSimpleTemplateBuffer(loc, [
      { apartment_number: '1', section_code: 'A', block_code: '' },
    ]),
  },
  {
    name: 'capital_repair',
    spec: CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC,
    build: (loc) => buildCapitalRepairSimpleTemplateBuffer(loc, [
      { apartment_number: '1', section_code: 'A', block_code: '' },
    ]),
  },
  {
    name: 'internet',
    spec: INTERNET_SIMPLE_IMPORT_SPEC,
    build: (loc) => buildInternetSimpleTemplateBuffer(loc, [
      { apartment_number: '1', section_code: 'A', block_code: '' },
    ]),
  },
  {
    name: 'water',
    spec: WATER_METERS_IMPORT_SPEC,
    build: (loc) => buildWaterMeterIs3TemplateBuffer(loc, [
      { apartment_number: '1', section_code: 'A', block_code: '' },
    ]),
  },
  {
    name: 'electricity',
    spec: ELECTRICITY_METERS_IMPORT_SPEC,
    build: (loc) => buildElectricityMeterIs3TemplateBuffer(loc, [
      { apartment_number: '1', section_code: 'A', block_code: '' },
    ]),
  },
];

const OLD_HEADERS = [
  'Сумма начального остатка, EUR',
  'Сума начален остатък, EUR',
  'Opening balance amount, EUR',
  'Сумма начального остатка (EUR)',
  'Opening balance amount (EUR)',
] as const;

function sheetHeaders(buf: ArrayBuffer, sheetName: string): string[] {
  const book = XLSX.read(buf, { type: 'array' });
  const sheet = book.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
  return (rows[0] ?? []).map(String);
}

function workbookWithHeader(
  spec: ImportTemplateSpec,
  locale: ImportTemplateLocale,
  amountHeader: string,
): ArrayBuffer {
  const headers = spec.columns.map((c) =>
    c.key === 'opening_balance_eur' ? amountHeader : c.label[locale],
  );
  const body = spec.columns.map((c) => (c.key === 'opening_balance_eur' ? '50' : c.example ?? '1'));
  // Prefer identity-ish values for required-ish fields
  const aptIdx = spec.columns.findIndex((c) => c.key === 'apartment_number');
  if (aptIdx >= 0) body[aptIdx] = '12';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([headers, body]),
    spec.dataSheetName[locale],
  );
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('amount-due column rename + legacy header compat', () => {
  for (const item of FIVE) {
    describe(item.name, () => {
      for (const locale of LOCALES) {
        it(`downloads ${locale} with new Amount due header + instructions`, () => {
          const buf = item.build(locale);
          const book = XLSX.read(buf, { type: 'array' });
          const dataName = item.spec.dataSheetName[locale];
          expect(book.SheetNames).toContain(dataName);
          const headers = sheetHeaders(buf, dataName);
          expect(headers).toContain(AMOUNT_DUE_COLUMN_LABEL[locale]);
          expect(headers).not.toContain('Сумма начального остатка, EUR');
          expect(headers).not.toContain('Opening balance amount, EUR');
          // Prefill identity when builder was given seeds / empty meters still parseable
          const parsed = parseLocalizedImportBuffer(buf, item.spec);
          expect(parsed.ok).toBe(true);

          const instrName = book.SheetNames.find((n) => /инструк|instruction/i.test(n));
          expect(instrName).toBeTruthy();
          const instr = XLSX.utils.sheet_to_json<string[]>(book.Sheets[instrName!], {
            header: 1,
            raw: false,
          });
          const text = instr.flat().map(String).join('\n');
          if (locale === 'ru') {
            expect(text).toMatch(/положительн|плюс/i);
            expect(text).toMatch(/долг/i);
            expect(text).toMatch(/переплат/i);
            expect(text).toMatch(/пусто|пуст/i);
          } else if (locale === 'bg') {
            expect(text).toMatch(/положителн|плюс/i);
            expect(text).toMatch(/дълг/i);
            expect(text).toMatch(/преплат/i);
            expect(text).toMatch(/празно/i);
          } else {
            expect(text).toMatch(/positive|plus/i);
            expect(text).toMatch(/debt/i);
            expect(text).toMatch(/overpayment/i);
            expect(text).toMatch(/blank/i);
          }
        });
      }

      for (const old of OLD_HEADERS) {
        it(`parses legacy header "${old}"`, () => {
          const buf = workbookWithHeader(item.spec, 'ru', old);
          const parsed = parseLocalizedImportBuffer(buf, item.spec);
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;
          expect(parsed.rows[0]?.opening_balance_eur).toBeTruthy();
        });
      }

      it('parses new Amount due header explicitly', () => {
        const buf = workbookWithHeader(item.spec, 'en', AMOUNT_DUE_COLUMN_LABEL.en);
        const parsed = parseLocalizedImportBuffer(buf, item.spec);
        expect(parsed.ok).toBe(true);
      });
    });
  }

  it('empty localized builders still expose new labels', () => {
    for (const locale of LOCALES) {
      for (const spec of [
        SUPPORT_FEE_SIMPLE_IMPORT_SPEC,
        CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC,
        INTERNET_SIMPLE_IMPORT_SPEC,
        WATER_METERS_IMPORT_SPEC,
        ELECTRICITY_METERS_IMPORT_SPEC,
      ]) {
        const buf = buildLocalizedImportWorkbook(spec, locale);
        const headers = sheetHeaders(buf, spec.dataSheetName[locale]);
        expect(headers).toContain(AMOUNT_DUE_COLUMN_LABEL[locale]);
      }
    }
  });
});
