import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildBudgetPlanTemplateBuffer,
  buildBudgetPreviewGroups,
  enrichBudgetPreviewWithExisting,
  matchBudgetCatalogByPath,
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
    code: 'ops_reserve',
    name_ru: 'Резерв',
    name_en: 'Reserve',
    name_bg: 'Резерв',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance and services',
    group_name_bg: 'Поддръжка и обслужване',
  },
  {
    code: 'svc_cctv',
    name_ru: 'Видеонаблюдение',
    name_en: 'CCTV',
    name_bg: 'Видеонаблюдение',
    group_code: 'services',
    group_name_ru: 'Регулярные услуги',
    group_name_en: 'Regular services',
    group_name_bg: 'Редовни услуги',
    subgroup_code: 'sec',
    subgroup_name_ru: 'Охрана и контроль',
    subgroup_name_en: 'Security and control',
    subgroup_name_bg: 'Охрана и контрол',
  },
  {
    code: 'svc_hall_clean',
    name_ru: 'Уборка холлов',
    name_en: 'Hall cleaning',
    name_bg: 'Почистване на фоайета',
    group_code: 'services',
    group_name_ru: 'Регулярные услуги',
    group_name_en: 'Regular services',
    group_name_bg: 'Редовни услуги',
    subgroup_code: 'clean',
    subgroup_name_ru: 'Клининг',
    subgroup_name_en: 'Cleaning',
    subgroup_name_bg: 'Клийнинг',
  },
  {
    code: 'svc_reserve',
    name_ru: 'Резерв',
    name_en: 'Reserve',
    name_bg: 'Резерв',
    group_code: 'services',
    group_name_ru: 'Регулярные услуги',
    group_name_en: 'Regular services',
    group_name_bg: 'Редовни услуги',
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
];

function validate(
  parsed: ReturnType<typeof parseBudgetPlanMatrix>,
  locale = 'ru',
) {
  return validateBudgetPlanAgainstCatalog(parsed, CATALOG, locale, {
    subgroupColumnPresent: parsed.subgroupColumnPresent,
  });
}

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

  it('parses four-column user files and resolves by full path', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', '50'],
      ['Содержание и обслуживание', '', 'Охрана', '0'],
      ['Содержание и обслуживание', '', 'Лифт', ''],
      ['Регулярные услуги', 'Охрана и контроль', 'Видеонаблюдение', '100'],
      ['Содержание и обслуживание', '', 'Резерв', '5'],
      ['Регулярные услуги', '', 'Резерв', '7'],
    ]);
    expect(parsed.subgroupColumnPresent).toBe(true);
    expect(parsed.issues).toEqual([]);
    const validated = validate(parsed);
    expect(validated.issues).toEqual([]);
    expect(validated.articles.map((row) => [row.code, row.subgroup, row.amount])).toEqual([
      ['cleaning', '', 50],
      ['security', '', 0],
      ['svc_cctv', 'Охрана и контроль', 100],
      ['ops_reserve', '', 5],
      ['svc_reserve', '', 7],
    ]);
    expect(validated.previewRows.find((r) => r.name === 'Лифт')).toMatchObject({
      code: '01',
      amountBlank: true,
      amount: null,
      issues: [],
    });
  });

  it('keeps legacy three-column group+name files compatible', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', 'Уборка', '50'],
      ['Содержание и обслуживание', 'Охрана', '0'],
    ]);
    expect(parsed.subgroupColumnPresent).toBe(false);
    const validated = validate(parsed);
    expect(validated.issues).toEqual([]);
    expect(validated.articles.map((row) => row.code)).toEqual(['cleaning', 'security']);
  });

  it('keeps legacy four-column files with codes compatible', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['cleaning', 'Содержание и обслуживание', 'Уборка', '50'],
      ['svc_cctv', 'Регулярные услуги', 'Видеонаблюдение', '0'],
      ['01', 'Содержание и обслуживание', 'Лифт', ''],
    ]);
    expect(parsed.issues).toEqual([]);
    const validated = validate(parsed);
    expect(validated.issues).toEqual([]);
    expect(validated.previewRows.find((r) => r.code === 'svc_cctv')?.subgroup).toBe(
      'Охрана и контроль',
    );
  });

  it('rejects wrong path and unknown article against catalog', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Чужая группа', '', 'Уборка', '10'],
      ['Регулярные услуги', 'Клининг', 'Видеонаблюдение', '5'],
      ['Содержание и обслуживание', '', 'Опечатка', '8'],
    ]);
    const validated = validate(parsed);
    expect(validated.issues.map((i) => `${i.row}:${i.reason}`).sort()).toEqual([
      '2:unknown_article',
      '3:unknown_article',
      '4:unknown_article',
    ]);
    expect(validated.articles).toEqual([]);
  });

  it('distinguishes same article names in different branches', () => {
    const hitsOps = matchBudgetCatalogByPath(
      CATALOG,
      'Содержание и обслуживание',
      '',
      'Резерв',
      { subgroupColumnPresent: true },
    );
    const hitsSvc = matchBudgetCatalogByPath(CATALOG, 'Регулярные услуги', '', 'Резерв', {
      subgroupColumnPresent: true,
    });
    expect(hitsOps.map((h) => h.code)).toEqual(['ops_reserve']);
    expect(hitsSvc.map((h) => h.code)).toEqual(['svc_reserve']);
  });

  it('resolves group/subgroup from catalog for legacy three-column code files', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['svc_cctv', 'Видеонаблюдение', '12'],
    ]);
    const validated = validate(parsed);
    expect(validated.issues).toEqual([]);
    expect(validated.previewRows[0]?.group).toBe('Регулярные услуги');
    expect(validated.previewRows[0]?.subgroup).toBe('Охрана и контроль');
  });

  it('groups preview with nested subgroups and blank vs create/update', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', '50'],
      ['Содержание и обслуживание', '', 'Охрана', ''],
      ['Регулярные услуги', 'Охрана и контроль', 'Видеонаблюдение', '0'],
      ['Регулярные услуги', 'Клининг', 'Уборка холлов', '10'],
    ]);
    const validated = validate(parsed);
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
      ['svc_cctv', 'create'],
      ['svc_hall_clean', 'create'],
    ]);
    const grouped = buildBudgetPreviewGroups(enriched.previewRows);
    expect(grouped.groups.map((g) => [g.label, g.total, g.directRows.length, g.subgroups.length])).toEqual([
      ['Содержание и обслуживание', 50, 2, 0],
      ['Регулярные услуги', 10, 0, 2],
    ]);
    expect(grouped.groups[1]?.subgroups.map((s) => [s.label, s.total])).toEqual([
      ['Охрана и контроль', 0],
      ['Клининг', 10],
    ]);
    expect(grouped.grandTotal).toBe(60);
  });

  it('downloads a four-column template without internal codes', () => {
    const buf = buildBudgetPlanTemplateBuffer('ru', [
      { group: 'Содержание и обслуживание', subgroup: '', name: 'Уборка', amount: '' },
      {
        group: 'Регулярные услуги',
        subgroup: 'Охрана и контроль',
        name: 'Видеонаблюдение',
        amount: '0',
      },
    ]);
    const matrix = (() => {
      const book = XLSX.read(buf, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      return XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });
    })();
    const header = (matrix[0] || []).map((c) => String(c).toLowerCase());
    expect(header.some((h) => h.includes('код'))).toBe(false);
    expect(header.some((h) => h.includes('групп') && !h.includes('под'))).toBe(true);
    expect(header.some((h) => h.includes('подгрупп'))).toBe(true);
    expect(header.some((h) => h.includes('стать'))).toBe(true);
    expect(header.some((h) => h.includes('сумм'))).toBe(true);
    expect(String(matrix[1]?.[0])).toContain('Содержание');
    expect(String(matrix[1]?.[1])).toBe('');
    expect(String(matrix[1]?.[2])).toBe('Уборка');
    expect(String(matrix[2]?.[1])).toContain('Охрана');
    expect(String(matrix[2]?.[2])).toBe('Видеонаблюдение');
    expect(String(matrix[2]?.[3])).toBe('0');
    const joined = matrix.flat().map(String).join('|');
    expect(joined).not.toMatch(/maintenance|cleaning|utilities_common|ops|svc_cctv|services/i);
  });

  it('still reads legacy coded workbooks after the four-column template change', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer('ru'), { type: 'array' });
    const sheetName = book.SheetNames[0];
    book.Sheets[sheetName] = XLSX.utils.aoa_to_sheet([
      ['Код статьи', 'Группа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['01', 'Содержание и обслуживание', 'Лифт', 10],
      ['cleaning', 'Содержание и обслуживание', 'Уборка', 40],
    ]);
    const parsed = readBudgetPlanWorkbook(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.articles.map((row) => row.code)).toEqual(['01', 'cleaning']);
  });

  it('uses Excel numeric cell.v on four-column layout', () => {
    const book = XLSX.read(buildBudgetPlanTemplateBuffer(), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    // Modern columns: A=group B=subgroup C=name D=amount
    sheet.A2 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.B2 = { t: 's', v: '' };
    sheet.C2 = { t: 's', v: 'Химия' };
    sheet.D2 = { t: 'n', v: 2556.46, w: '2,556.46', z: '#,##0.00' };
    sheet.A3 = { t: 's', v: 'Содержание и текущие расходы' };
    sheet.B3 = { t: 's', v: '' };
    sheet.C3 = { t: 's', v: 'Другая' };
    sheet.D3 = { t: 'n', v: 1022.58, w: '1,022.58', z: '#,##0.00' };
    const parsed = readBudgetPlanWorkbook(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    const validated = validate(parsed);
    expect(validated.issues).toEqual([]);
    expect(validated.articles.map((row) => [row.code, row.amount])).toEqual([
      ['1.2.1', 2556.46],
      ['1.2.2', 1022.58],
    ]);
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
