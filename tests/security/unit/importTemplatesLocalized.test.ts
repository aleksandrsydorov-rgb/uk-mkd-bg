import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  BUDGET_PLAN_IMPORT_SPEC,
  CAPITAL_REPAIR_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  IMPORT_INSTRUCTION_SHEET,
  INVENTORY_IMPORT_SPEC,
  INTERNET_IMPORT_SPEC,
  OPENING_TOTALS_IMPORT_SPEC,
  PROPERTY_BOOK_OBJECTS_SPEC,
  PROPERTY_BOOK_OWNERS_SPEC,
  SUPPORT_FEE_IMPORT_SPEC,
  UK_EXPENSES_IMPORT_SPEC,
  WATER_METERS_IMPORT_SPEC,
  buildLocalizedImportWorkbook,
  buildLocalizedImportWorkbookWithRows,
  buildLocalizedMultiSheetImportWorkbook,
  isInstructionSheetName,
  parseLocalizedImportBuffer,
  type ImportTemplateLocale,
  type ImportTemplateSpec,
} from '@/lib/importTemplates';
import { buildBudgetPlanTemplateBuffer, parseBudgetPlanMatrix } from '@/lib/budgetPlanImport';
import { buildWaterMeterIs3TemplateBuffer } from '@/lib/moduleCore/adapters/metersOpening';
import { buildSupportFeeIs4TemplateBuffer } from '@/lib/moduleCore/adapters/supportFeeOpening';

const LOCALES: ImportTemplateLocale[] = ['ru', 'bg', 'en'];

function assertHumanHeaders(spec: ImportTemplateSpec, locale: ImportTemplateLocale, headers: string[]) {
  for (const h of headers) {
    expect(h.includes('_'), `snake_case header "${h}"`).toBe(false);
    expect(h.includes('*'), `star in header "${h}"`).toBe(false);
    expect(h).toBe(spec.columns.find((c) => c.label[locale] === h)?.label[locale]);
  }
  expect(headers).toEqual(spec.columns.map((c) => c.label[locale]));
}

function fillExampleRow(spec: ImportTemplateSpec): Record<string, string> {
  const row: Record<string, string> = {};
  for (const col of spec.columns) {
    row[col.key] = col.example ?? (col.required ? 'x' : '');
  }
  return row;
}

function workbookFromFilledSpec(spec: ImportTemplateSpec, locale: ImportTemplateLocale) {
  // Build empty localized template then inject one data row under localized headers.
  const empty = buildLocalizedImportWorkbook(spec, locale);
  const book = XLSX.read(empty, { type: 'array' });
  const dataName = spec.dataSheetName[locale];
  const sheet = book.Sheets[dataName];
  const headers = spec.columns.map((c) => c.label[locale]);
  const example = fillExampleRow(spec);
  const body = spec.columns.map((c) => example[c.key] ?? '');
  const next = XLSX.utils.aoa_to_sheet([headers, body]);
  book.Sheets[dataName] = next;
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function legacySnakeWorkbook(spec: ImportTemplateSpec, sheetName: string) {
  const headers = spec.columns.map((c) => c.key);
  const body = spec.columns.map((c) => c.example ?? (c.required ? '1' : ''));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, body]), sheetName);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const SINGLE_SPECS: ImportTemplateSpec[] = [
  WATER_METERS_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  SUPPORT_FEE_IMPORT_SPEC,
  CAPITAL_REPAIR_IMPORT_SPEC,
  INTERNET_IMPORT_SPEC,
  UK_EXPENSES_IMPORT_SPEC,
  BUDGET_PLAN_IMPORT_SPEC,
  OPENING_TOTALS_IMPORT_SPEC,
  INVENTORY_IMPORT_SPEC,
];

describe('localized import templates matrix', () => {
  for (const spec of SINGLE_SPECS) {
    describe(spec.id, () => {
      for (const locale of LOCALES) {
        it(`builds ${locale} with human headers + instruction sheet`, () => {
          const buf = buildLocalizedImportWorkbook(spec, locale);
          const book = XLSX.read(buf, { type: 'array' });
          expect(book.SheetNames).toContain(spec.dataSheetName[locale]);
          expect(book.SheetNames).toContain(IMPORT_INSTRUCTION_SHEET[locale]);
          expect(book.SheetNames.some(isInstructionSheetName)).toBe(true);
          const sheet = book.Sheets[spec.dataSheetName[locale]];
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
          const headers = (rows[0] ?? []).map(String);
          assertHumanHeaders(spec, locale, headers);
          // Data sheet has no example body rows (only reserved empty cells).
          const dataRows = rows.slice(1).filter((r) => (r ?? []).some((c) => String(c ?? '').trim()));
          expect(dataRows.length).toBe(0);
        });

        it(`parses filled ${locale} example`, () => {
          const buf = workbookFromFilledSpec(spec, locale);
          const parsed = parseLocalizedImportBuffer(buf, spec);
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;
          expect(parsed.rows.length).toBe(1);
          for (const col of spec.columns.filter((c) => c.required)) {
            expect(parsed.rows[0][col.key]).toBeTruthy();
          }
        });
      }

      it('parses legacy snake_case headers on legacy sheet name', () => {
        const legacySheet = spec.legacySheetNames?.[0] ?? 'data';
        const buf = legacySnakeWorkbook(spec, legacySheet);
        const parsed = parseLocalizedImportBuffer(buf, spec);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.rows.length).toBe(1);
      });

      it('parses template of another language while UI is different', () => {
        const buf = workbookFromFilledSpec(spec, 'bg');
        const parsed = parseLocalizedImportBuffer(buf, spec);
        expect(parsed.ok).toBe(true);
      });

      it('reports missing required column keys', () => {
        const required = spec.columns.filter((c) => c.required);
        if (required.length < 2) return;
        const keep = required.slice(1);
        const headers = keep.map((c) => c.label.ru);
        const body = keep.map((c) => c.example ?? '1');
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          book,
          XLSX.utils.aoa_to_sheet([headers, body]),
          spec.dataSheetName.ru,
        );
        const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
        const parsed = parseLocalizedImportBuffer(buf, spec);
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.error).toContain('missing_headers:');
        expect(parsed.missing?.some((c) => c.key === required[0].key)).toBe(true);
      });
    });
  }

  it('property book multi-sheet localized + legacy', () => {
    for (const locale of LOCALES) {
      const buf = buildLocalizedMultiSheetImportWorkbook(
        [
          { spec: PROPERTY_BOOK_OBJECTS_SPEC, locale },
          { spec: PROPERTY_BOOK_OWNERS_SPEC, locale },
        ],
        locale,
        { title: PROPERTY_BOOK_OBJECTS_SPEC.title, notes: PROPERTY_BOOK_OBJECTS_SPEC.notes },
      );
      const book = XLSX.read(buf, { type: 'array' });
      expect(book.SheetNames).toContain(PROPERTY_BOOK_OBJECTS_SPEC.dataSheetName[locale]);
      expect(book.SheetNames).toContain(PROPERTY_BOOK_OWNERS_SPEC.dataSheetName[locale]);
      expect(book.SheetNames).toContain(IMPORT_INSTRUCTION_SHEET[locale]);
    }
    const legacy = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      legacy,
      XLSX.utils.aoa_to_sheet([
        PROPERTY_BOOK_OBJECTS_SPEC.columns.map((c) => c.key),
        PROPERTY_BOOK_OBJECTS_SPEC.columns.map((c) => c.example ?? '1'),
      ]),
      'objects',
    );
    XLSX.utils.book_append_sheet(
      legacy,
      XLSX.utils.aoa_to_sheet([
        PROPERTY_BOOK_OWNERS_SPEC.columns.map((c) => c.key),
        PROPERTY_BOOK_OWNERS_SPEC.columns.map((c) => c.example ?? ''),
      ]),
      'owners',
    );
    const buf = XLSX.write(legacy, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const objects = parseLocalizedImportBuffer(buf, PROPERTY_BOOK_OBJECTS_SPEC);
    expect(objects.ok).toBe(true);
  });

  it('budget plan builder keeps codes as text and parses RU amount header', () => {
    const buf = buildBudgetPlanTemplateBuffer('ru');
    const book = XLSX.read(buf, { type: 'array' });
    const sheet = book.Sheets[BUDGET_PLAN_IMPORT_SPEC.dataSheetName.ru];
    const headers = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false })[0] ?? []).map(
      String,
    );
    expect(headers.some((h) => h.toLowerCase().includes('код'))).toBe(true);
    expect(headers.every((h) => !h.includes('_'))).toBe(true);

    const filled = XLSX.utils.aoa_to_sheet([
      headers,
      ['1.1', 'Охрана', '100.5'],
      ['01', 'Лифт', '20'],
    ]);
    book.Sheets[BUDGET_PLAN_IMPORT_SPEC.dataSheetName.ru] = filled;
    const round = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = parseLocalizedImportBuffer(round, BUDGET_PLAN_IMPORT_SPEC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].code).toBe('1.1');
    expect(parsed.rows[1].code).toBe('01');
  });

  it('opening totals prefills categories without importing examples from instruction', () => {
    const buf = buildLocalizedImportWorkbookWithRows(OPENING_TOTALS_IMPORT_SPEC, 'en', [
      { code: '2.1', name: 'Cleaning', amount: '' },
    ]);
    const parsed = parseLocalizedImportBuffer(buf, OPENING_TOTALS_IMPORT_SPEC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].code).toBe('2.1');
    expect(parsed.rows[0].amount).toBe('');
  });

  it('water + support fee builders match specs', () => {
    const water = buildWaterMeterIs3TemplateBuffer('bg');
    const sf = buildSupportFeeIs4TemplateBuffer('en');
    expect(parseLocalizedImportBuffer(water, WATER_METERS_IMPORT_SPEC).ok).toBe(true);
    expect(parseLocalizedImportBuffer(sf, SUPPORT_FEE_IMPORT_SPEC).ok).toBe(true);
  });

  it('budget matrix still accepts legacy technical headers', () => {
    const matrix = [
      ['category code', 'category name', 'annual plan, eur'],
      ['3.1', 'Garden', '15'],
    ];
    const parsed = parseBudgetPlanMatrix(matrix);
    expect(parsed.articles).toHaveLength(1);
    expect(parsed.articles[0].code).toBe('3.1');
    expect(parsed.articles[0].amount).toBe(15);
  });
});
