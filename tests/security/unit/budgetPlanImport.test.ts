import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyOpeningAmountDraft,
  buildBudgetPlanTemplateBuffer,
  buildBudgetPreviewGroups,
  buildOpeningTotalsTemplateBuffer,
  enrichBudgetPreviewWithExisting,
  openingAmountEditBaseline,
  parseBudgetPlanMatrix,
  parseOpeningTotalsMatrix,
  readBudgetPlanWorkbook,
  readFirstSheetMatrix,
  rebuildOpeningTotalParse,
  validateBudgetPlanAgainstCatalog,
} from '@/lib/budgetPlanImport';

const CATALOG = [
  {
    code: '1.10',
    name_ru: 'Резерв группы 1',
    name_en: 'Group 1 reserve',
    name_bg: 'Резерв на група 1',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.1',
    name_ru: 'Охрана',
    name_en: 'Security',
    name_bg: 'Охрана',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.2',
    name_ru: 'Уборка',
    name_en: 'Cleaning',
    name_bg: 'Почистване',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '01',
    name_ru: 'Лифт',
    name_en: 'Lift',
    name_bg: 'Асансьор',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance and services',
    group_name_bg: 'Поддръжка и обслужване',
  },
  {
    code: 'cleaning',
    name_ru: 'Уборка',
    name_en: 'Cleaning',
    name_bg: 'Почистване',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance and services',
    group_name_bg: 'Поддръжка и обслужване',
  },
  {
    code: '1.2.1',
    name_ru: 'Химия',
    name_en: 'Chemicals',
    name_bg: 'Химия',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.2.2',
    name_ru: 'Другая',
    name_en: 'Other',
    name_bg: 'Друга',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.8',
    name_ru: 'EU',
    name_en: 'EU',
    name_bg: 'EU',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.9',
    name_ru: 'Текст',
    name_en: 'Text',
    name_bg: 'Текст',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.3',
    name_ru: 'C',
    name_en: 'C',
    name_bg: 'C',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
];

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

  it('parses four-column files and treats blank amount as preserve (not error)', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['1.10', 'Содержание и текущие расходы', 'Резерв группы 1', '50'],
      ['cleaning', 'Содержание и обслуживание', 'Уборка', '0'],
      ['01', 'Содержание и обслуживание', 'Лифт', ''],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => [row.code, row.group, row.amount])).toEqual([
      ['1.10', 'Содержание и текущие расходы', 50],
      ['cleaning', 'Содержание и обслуживание', 0],
    ]);
    expect(parsed.previewRows.find((r) => r.code === '01')).toMatchObject({
      amountBlank: true,
      amount: null,
      issues: [],
    });
  });

  it('rejects group mismatch and unknown code against catalog', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['1.10', 'Чужая группа', 'Резерв группы 1', '10'],
      ['nope', 'X', 'Y', '5'],
      ['1.1', 'Содержание и текущие расходы', 'Опечатка', '8'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues.map((i) => `${i.row}:${i.reason}`).sort()).toEqual([
      '2:group_mismatch',
      '3:unknown_code',
      '4:name_mismatch',
    ]);
    expect(validated.articles).toEqual([]);
  });

  it('resolves group from catalog for legacy three-column files', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['1.10', 'Резерв группы 1', '12'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues).toEqual([]);
    expect(validated.previewRows[0]?.group).toBe('Содержание и текущие расходы');
    expect(validated.articles[0]?.group).toBe('Содержание и текущие расходы');
  });

  it('groups preview totals by group and preserves blank vs create/update', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['1.10', 'Содержание и текущие расходы', 'Резерв группы 1', '50'],
      ['1.1', 'Содержание и текущие расходы', 'Охрана', ''],
      ['cleaning', 'Содержание и обслуживание', 'Уборка', '0'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    const enriched = enrichBudgetPreviewWithExisting(
      validated,
      new Map([
        ['1.10', 40],
        ['1.1', 20],
      ]),
    );
    expect(enriched.previewRows.map((r) => [r.code, r.action])).toEqual([
      ['1.10', 'update'],
      ['1.1', 'unchanged'],
      ['cleaning', 'create'],
    ]);
    const grouped = buildBudgetPreviewGroups(enriched.previewRows);
    expect(grouped.groups.map((g) => [g.label, g.total])).toEqual([
      ['Содержание и текущие расходы', 50],
      ['Содержание и обслуживание', 0],
    ]);
    expect(grouped.grandTotal).toBe(50);
  });

  it('reads a text code 1.10 and a leading zero from the template format', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer('ru'), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    // A=code B=group C=name D=amount
    sheet.A2 = { t: 's', v: '01', z: '@', w: '01' };
    sheet.B2 = { t: 's', v: 'Содержание и обслуживание' };
    sheet.C2 = { t: 's', v: 'Лифт' };
    sheet.D2 = { t: 'n', v: 10, w: '10' };
    sheet.A3 = { t: 's', v: '1.10', z: '@', w: '1.10' };
    sheet.B3 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.C3 = { t: 's', v: 'Резерв группы 1' };
    sheet.D3 = { t: 'n', v: 40, w: '40' };
    const parsed = readBudgetPlanWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => row.code)).toEqual(['01', '1.10']);
  });

  it('prefills catalog rows with text codes including 1.10', () => {
    const buf = buildBudgetPlanTemplateBuffer('ru', [
      { code: '1.10', group: 'Содержание и текущие расходы', name: 'Резерв группы 1', amount: '' },
      { code: 'cleaning', group: 'Содержание и обслуживание', name: 'Уборка', amount: '0' },
    ]);
    const matrix = (() => {
      const book = XLSX.read(buf, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      return XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: false, defval: '' });
    })();
    expect(String(matrix[0]?.[0] ?? '').toLowerCase()).toContain('код');
    expect(String(matrix[1]?.[0])).toBe('1.10');
    expect(String(matrix[1]?.[1])).toContain('Содержание');
    expect(String(matrix[2]?.[0])).toBe('cleaning');
    expect(String(matrix[2]?.[3])).toBe('0');
  });

  it('uses Excel numeric cell.v even when display w has a thousands separator', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer(), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    sheet.A2 = { t: 's', v: '1.2.1', z: '@', w: '1.2.1' };
    sheet.B2 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.C2 = { t: 's', v: 'Химия' };
    sheet.D2 = { t: 'n', v: 2556.46, w: '2,556.46', z: '#,##0.00' };
    sheet.A3 = { t: 's', v: '1.2.2', z: '@', w: '1.2.2' };
    sheet.B3 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.C3 = { t: 's', v: 'Другая' };
    sheet.D3 = { t: 'n', v: 1022.58, w: '1,022.58', z: '#,##0.00' };
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
    expect(parsed.articles).toEqual([
      { row: 2, code: '1.2.1', name: 'Химия', group: '', amount: 2556.46 },
    ]);
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
