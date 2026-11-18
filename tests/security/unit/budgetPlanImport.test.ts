import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildBudgetPlanTemplateBuffer,
  buildBudgetPreviewGroups,
  enrichBudgetPreviewWithExisting,
  matchBudgetCatalogByGroupName,
  parseBudgetPlanMatrix,
  readBudgetPlanWorkbook,
  validateBudgetPlanAgainstCatalog,
} from '@/lib/budgetPlanImport';

const CATALOG = [
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
    code: 'security',
    name_ru: 'Охрана',
    name_en: 'Security',
    name_bg: 'Охрана',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance and services',
    group_name_bg: 'Поддръжка и обслужване',
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
    code: '1.1',
    name_ru: 'Охрана двора',
    name_en: 'Yard security',
    name_bg: 'Охрана на двора',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
  },
  {
    code: '1.2',
    name_ru: 'Уборка подъезда',
    name_en: 'Entrance cleaning',
    name_bg: 'Почистване на входа',
    group_code: '1',
    group_name_ru: 'Содержание и текущие расходы',
    group_name_en: 'Maintenance and current expenses',
    group_name_bg: 'Поддръжка и текущи разходи',
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
    code: 'twin_a',
    name_ru: 'Резерв',
    name_en: 'Reserve',
    name_bg: 'Резерв',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance and services',
    group_name_bg: 'Поддръжка и обслужване',
  },
  {
    code: 'twin_b',
    name_ru: 'Резерв',
    name_en: 'Reserve',
    name_bg: 'Резерв',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance and services',
    group_name_bg: 'Поддръжка и обслужване',
  },
];

describe('budget plan workbook', () => {
  it('keeps text codes, skips sections and totals, and rejects a duplicate', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['1', 'Раздел', '100'],
      ['1.1', 'Охрана двора', '40'],
      ['1.2', 'Уборка подъезда', '60'],
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

  it('parses three-column user files and resolves stable codes by group+name', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', 'Уборка', '50'],
      ['Содержание и обслуживание', 'Охрана', '0'],
      ['Содержание и обслуживание', 'Лифт', ''],
    ]);
    expect(parsed.issues).toEqual([]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues).toEqual([]);
    expect(validated.articles.map((row) => [row.code, row.group, row.amount])).toEqual([
      ['cleaning', 'Содержание и обслуживание', 50],
      ['security', 'Содержание и обслуживание', 0],
    ]);
    expect(validated.previewRows.find((r) => r.name === 'Лифт')).toMatchObject({
      code: '01',
      amountBlank: true,
      amount: null,
      issues: [],
    });
  });

  it('keeps legacy four-column files with codes compatible', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['cleaning', 'Содержание и обслуживание', 'Уборка', '50'],
      ['security', 'Содержание и обслуживание', 'Охрана', '0'],
      ['01', 'Содержание и обслуживание', 'Лифт', ''],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => [row.code, row.group, row.amount])).toEqual([
      ['cleaning', 'Содержание и обслуживание', 50],
      ['security', 'Содержание и обслуживание', 0],
    ]);
  });

  it('rejects group mismatch and unknown article against catalog', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Чужая группа', 'Уборка', '10'],
      ['X', 'Y', '5'],
      ['Содержание и обслуживание', 'Опечатка', '8'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues.map((i) => `${i.row}:${i.reason}`).sort()).toEqual([
      '2:unknown_article',
      '3:unknown_article',
      '4:unknown_article',
    ]);
    expect(validated.articles).toEqual([]);
  });

  it('rejects ambiguous group+name without picking arbitrarily', () => {
    const hits = matchBudgetCatalogByGroupName(
      CATALOG,
      'Содержание и обслуживание',
      'Резерв',
    );
    expect(hits.map((h) => h.code).sort()).toEqual(['twin_a', 'twin_b']);
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', 'Резерв', '10'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues.map((i) => i.reason)).toEqual(['ambiguous_article']);
    expect(validated.articles).toEqual([]);
  });

  it('resolves group from catalog for legacy three-column files', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['cleaning', 'Уборка', '12'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues).toEqual([]);
    expect(validated.previewRows[0]?.group).toBe('Содержание и обслуживание');
    expect(validated.articles[0]?.group).toBe('Содержание и обслуживание');
  });

  it('groups preview totals by group and preserves blank vs create/update', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', 'Уборка', '50'],
      ['Содержание и обслуживание', 'Охрана', ''],
      ['Содержание и текущие расходы', 'Химия', '0'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    const enriched = enrichBudgetPreviewWithExisting(
      validated,
      new Map([
        ['cleaning', 40],
        ['security', 20],
      ]),
    );
    expect(enriched.previewRows.map((r) => [r.code, r.action])).toEqual([
      ['cleaning', 'update'],
      ['security', 'unchanged'],
      ['1.2.1', 'create'],
    ]);
    const grouped = buildBudgetPreviewGroups(enriched.previewRows);
    expect(grouped.groups.map((g) => [g.label, g.total])).toEqual([
      ['Содержание и обслуживание', 50],
      ['Содержание и текущие расходы', 0],
    ]);
    expect(grouped.grandTotal).toBe(50);
  });

  it('downloads a three-column template without internal codes', () => {
    const buf = buildBudgetPlanTemplateBuffer('ru', [
      { group: 'Содержание и обслуживание', name: 'Уборка', amount: '' },
      { group: 'Содержание и обслуживание', name: 'Охрана', amount: '0' },
    ]);
    const matrix = (() => {
      const book = XLSX.read(buf, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      return XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: false, defval: '' });
    })();
    const header = (matrix[0] || []).map((c) => String(c).toLowerCase());
    expect(header.some((h) => h.includes('код'))).toBe(false);
    expect(header.some((h) => h.includes('групп'))).toBe(true);
    expect(header.some((h) => h.includes('стать'))).toBe(true);
    expect(header.some((h) => h.includes('сумм'))).toBe(true);
    expect(String(matrix[1]?.[0])).toContain('Содержание');
    expect(String(matrix[1]?.[1])).toBe('Уборка');
    expect(String(matrix[2]?.[1])).toBe('Охрана');
    expect(String(matrix[2]?.[2])).toBe('0');
    const joined = matrix.flat().map(String).join('|');
    expect(joined).not.toMatch(/maintenance|cleaning|utilities_common|ops/i);
  });

  it('still reads legacy coded workbooks after the three-column template change', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer('ru'), { type: 'array' });
    // Force a legacy-shaped sheet: code | group | name | amount
    const sheetName = book.SheetNames[0];
    book.Sheets[sheetName] = XLSX.utils.aoa_to_sheet([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['01', 'Содержание и обслуживание', 'Лифт', 10],
      ['cleaning', 'Содержание и обслуживание', 'Уборка', 40],
    ]);
    const parsed = readBudgetPlanWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => row.code)).toEqual(['01', 'cleaning']);
  });

  it('uses Excel numeric cell.v even when display w has a thousands separator', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer(), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    // Modern columns: A=group B=name C=amount
    sheet.A2 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.B2 = { t: 's', v: 'Химия' };
    sheet.C2 = { t: 'n', v: 2556.46, w: '2,556.46', z: '#,##0.00' };
    sheet.A3 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.B3 = { t: 's', v: 'Другая' };
    sheet.C3 = { t: 'n', v: 1022.58, w: '1,022.58', z: '#,##0.00' };
    const parsed = readBudgetPlanWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru');
    expect(validated.issues).toEqual([]);
    expect(validated.articles.map((row) => [row.code, row.amount])).toEqual([
      ['1.2.1', 2556.46],
      ['1.2.2', 1022.58],
    ]);
    expect(validated.previewRows).toHaveLength(2);
  });

  it('rejects ambiguous textual amounts with both comma and dot', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['1.9', 'Текст', '2,556.46'],
      ['1.8', 'EU', '2556,46'],
    ]);
    expect(parsed.issues.map((row) => `${row.row}:${row.reason}`)).toEqual(['2:invalid_amount']);
    expect(parsed.articles.map((row) => [row.code, row.amount])).toEqual([['1.8', 2556.46]]);
  });
});
