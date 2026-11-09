import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyOpeningAmountDraft,
  buildBudgetPlanTemplateBuffer,
  buildOpeningTotalsTemplateBuffer,
  openingAmountEditBaseline,
  parseBudgetPlanMatrix,
  parseOpeningTotalsMatrix,
  readBudgetPlanWorkbook,
  readFirstSheetMatrix,
  rebuildOpeningTotalParse,
} from '@/lib/budgetPlanImport';

describe('budget plan workbook', () => {
  it('keeps text codes, skips sections and totals, and rejects a duplicate', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['1', 'Раздел', '100'],
      ['1.1', 'Охрана', '40'],
      ['1.2', 'Уборка', '60'],
      ['01', 'Лифт', '10'],
      ['Итого', '', '110'],
      ['1.1', 'Повтор', '5'],
      ['2', 'Минус', '-1'],
    ]);
    expect(parsed.articles.map((row) => [row.code, row.amount])).toEqual([
      ['1.2', 60],
      ['01', 10],
    ]);
    expect(parsed.skipped.map((row) => row.reason)).toEqual(['section', 'total']);
    expect(parsed.issues.map((row) => `${row.row}:${row.reason}`)).toEqual([
      '7:duplicate_code',
      '8:negative_amount',
    ]);
    expect(parsed.articles.reduce((sum, row) => sum + row.amount, 0)).toBe(70);
  });

  it('reads a text code 1.1 and a leading zero from the template format', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer(), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    sheet.A2 = { t: 's', v: '01', z: '@', w: '01' };
    sheet.B2 = { t: 's', v: 'Лифт' };
    sheet.C2 = { t: 'n', v: 10, w: '10' };
    sheet.A3 = { t: 's', v: '1.1', z: '@', w: '1.1' };
    sheet.B3 = { t: 's', v: 'Охрана' };
    sheet.C3 = { t: 'n', v: 40, w: '40' };
    const parsed = readBudgetPlanWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => row.code)).toEqual(['01', '1.1']);
  });

  it('uses Excel numeric cell.v even when display w has a thousands separator', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer(), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    sheet.A2 = { t: 's', v: '1.2.1', z: '@', w: '1.2.1' };
    sheet.B2 = { t: 's', v: 'Статья' };
    sheet.C2 = { t: 'n', v: 2556.46, w: '2,556.46', z: '#,##0.00' };
    sheet.A3 = { t: 's', v: '1.2.2', z: '@', w: '1.2.2' };
    sheet.B3 = { t: 's', v: 'Другая' };
    sheet.C3 = { t: 'n', v: 1022.58, w: '1,022.58', z: '#,##0.00' };
    const parsed = readBudgetPlanWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => [row.code, row.amount])).toEqual([
      ['1.2.1', 2556.46],
      ['1.2.2', 1022.58],
    ]);
    expect(parsed.previewRows).toHaveLength(2);
  });

  it('rejects ambiguous textual amounts with both comma and dot', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['1.9', 'Текст', '2,556.46'],
      ['1.8', 'EU', '2556,46'],
    ]);
    expect(parsed.issues.map((row) => `${row.row}:${row.reason}`)).toEqual(['2:invalid_amount']);
    expect(parsed.articles.map((row) => [row.code, row.amount])).toEqual([['1.8', 2556.46]]);
    expect(parsed.previewRows.find((row) => row.code === '1.9')?.amount).toBeNull();
    expect(parsed.previewRows.find((row) => row.code === '1.9')?.amountRaw).toBe('2,556.46');
  });

  it('rounds each article to cents without rejecting higher Excel precision', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['1.1', 'A', 10.004],
      ['1.2', 'B', '20.005'],
      ['1.3', 'C', 30.455842],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => [row.code, row.amount])).toEqual([
      ['1.1', 10],
      ['1.2', 20.01],
      ['1.3', 30.46],
    ]);
    expect(parsed.articles.reduce((sum, row) => sum + row.amount, 0)).toBe(60.47);
  });

  it('reads the budget sheet by name even when it is not first', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ignore']]), 'instructions');
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Код статьи', 'Название статьи', 'План на год, EUR'],
        ['1.2.1', 'Химия', 2556.46],
      ]),
      'budget',
    );
    const parsed = readBudgetPlanWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles).toEqual([{ row: 2, code: '1.2.1', name: 'Химия', amount: 2556.46 }]);
  });

  it('rejects an unknown opening code and warns without blocking an overrun', () => {
    const parsed = parseOpeningTotalsMatrix(
      [
        ['Код статьи', 'Название статьи', 'Уже израсходовано, EUR'],
        ['1.1', 'Охрана', '800'],
        ['9.9', 'Чужая', '5'],
      ],
      [{ code: '1.1', name: 'Охрана', planned: 1200 }],
    );
    expect(parsed.rows).toEqual([{ row: 2, code: '1.1', amount: 800, overPlan: false }]);
    expect(parsed.issues).toEqual([{ row: 3, reason: 'unknown_code', code: '9.9' }]);
    expect(parsed.previewRows).toHaveLength(2);
    expect(parsed.previewRows[0]).toMatchObject({
      code: '1.1',
      amount: 800,
      planned: 1200,
      remainder: 400,
      overPlan: false,
      issues: [],
    });
    expect(parsed.previewRows[1]?.amount).toBe(5);
    expect(parsed.previewRows[1]?.issues).toEqual(['unknown_code']);

    const over = parseOpeningTotalsMatrix(
      [
        ['code', 'already spent, eur'],
        ['1.1', '1300'],
      ],
      [{ code: '1.1', planned: 1200 }],
    );
    expect(over.issues).toEqual([]);
    expect(over.warnings).toEqual([{ row: 2, reason: 'over_plan', code: '1.1', overBy: 100 }]);
    expect(over.rows[0]?.overPlan).toBe(true);
    expect(over.previewRows[0]?.remainder).toBe(-100);
  });

  it('keeps empty opening amounts as required errors and accepts explicit zeros', () => {
    const empty = parseOpeningTotalsMatrix(
      [
        ['Код статьи', 'Название статьи', 'Уже израсходовано, EUR'],
        ['1.6', 'Аренда', ''],
        ['2.6', 'Управляющий', 0],
      ],
      [
        { code: '1.6', name: 'Аренда', planned: 100 },
        { code: '2.6', name: 'Управляющий', planned: 200 },
      ],
    );
    expect(empty.issues.map((row) => `${row.row}:${row.reason}`)).toEqual(['2:required_amount']);
    expect(empty.rows).toEqual([{ row: 3, code: '2.6', amount: 0, overPlan: false }]);
    expect(empty.previewRows.find((row) => row.code === '1.6')).toMatchObject({
      amount: null,
      remainder: null,
      issues: ['required_amount'],
    });
    expect(empty.previewRows.find((row) => row.code === '2.6')).toMatchObject({
      amount: 0,
      remainder: 200,
      issues: [],
    });
  });

  it('reads opening numeric cell.v with thousands display format', () => {
    const book = XLSX.read(
      buildOpeningTotalsTemplateBuffer([
        { code: '2.4', name: 'Вода', planned: 9000 },
        { code: '1.1', name: 'Лифт', planned: 700 },
      ]),
      { type: 'array' },
    );
    const sheet = book.Sheets[book.SheetNames[0]];
    sheet.C2 = { t: 'n', v: 8654.97, w: '8,654.97', z: '#,##0.00' };
    sheet.C3 = { t: 'n', v: 630.34, w: '630.34', z: '#,##0.00' };
    const parsed = parseOpeningTotalsMatrix(
      readFirstSheetMatrix(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer),
      [
        { code: '2.4', name: 'Вода', planned: 9000 },
        { code: '1.1', name: 'Лифт', planned: 700 },
      ],
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map((row) => [row.code, row.amount])).toEqual([
      ['2.4', 8654.97],
      ['1.1', 630.34],
    ]);
  });

  it('writes opening codes as text cells', () => {
    const matrix = readFirstSheetMatrix(
      buildOpeningTotalsTemplateBuffer([{ code: '01', name: 'Лифт', planned: 10 }]),
    );
    expect(matrix[1]?.[0]).toBe('01');
    expect(String(matrix[0]?.[2] ?? '').toLowerCase()).toContain('eur');
  });

  it('recomputes opening preview edits without turning empty into zero', () => {
    const parsed = parseOpeningTotalsMatrix(
      [
        ['Код статьи', 'Название статьи', 'Уже израсходовано, EUR'],
        ['1.6', 'Аренда', ''],
        ['2.6', 'Управляющий', '100'],
      ],
      [
        { code: '1.6', name: 'Аренда', planned: 5000 },
        { code: '2.6', name: 'Управляющий', planned: 80 },
      ],
    );
    const empty = parsed.previewRows[0]!;
    expect(openingAmountEditBaseline(empty)).toBe('');
    const stillEmpty = applyOpeningAmountDraft(empty, '');
    expect(stillEmpty.amount).toBeNull();
    expect(stillEmpty.issues).toEqual(['required_amount']);

    const filled = applyOpeningAmountDraft(empty, '120,5');
    expect(filled.amount).toBe(120.5);
    expect(filled.remainder).toBe(4879.5);
    expect(filled.issues).toEqual([]);

    const zeroed = applyOpeningAmountDraft(empty, '0');
    expect(zeroed.amount).toBe(0);
    expect(zeroed.issues).toEqual([]);

    const invalid = applyOpeningAmountDraft(empty, 'abc');
    expect(invalid.amount).toBeNull();
    expect(invalid.amountRaw).toBe('abc');
    expect(invalid.issues).toEqual(['invalid_amount']);

    const over = applyOpeningAmountDraft(parsed.previewRows[1]!, '200');
    expect(over.overPlan).toBe(true);
    expect(over.overBy).toBe(120);
    expect(over.remainder).toBe(-120);

    const rebuilt = rebuildOpeningTotalParse([
      applyOpeningAmountDraft(empty, '0'),
      over,
    ]);
    expect(rebuilt.issues).toEqual([]);
    expect(rebuilt.warnings).toHaveLength(1);
    expect(rebuilt.rows.map((row) => [row.code, row.amount])).toEqual([
      ['1.6', 0],
      ['2.6', 200],
    ]);
  });
});
